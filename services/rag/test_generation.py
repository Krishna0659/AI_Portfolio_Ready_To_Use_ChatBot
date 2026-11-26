import copy
import http.client
import json
import time
import unittest
from unittest.mock import MagicMock, patch

from gemini import GeminiClient, MODEL, ProviderError, strict_json
from generation import GenerationConfig, answer, budget, prompt, validate_output, MISSING_INFORMATION, UNAVAILABLE
import test_retrieval


class FakeProvider:
    """Deterministic test counter only; production uses Gemini countTokens."""
    model = MODEL
    def __init__(self):
        self.generated = 0
    def limits(self, deadline):
        return 32768, 8192
    def count(self, request, deadline):
        return len(json.dumps(request))
    def generate(self, request, deadline):
        self.generated += 1
        evidence = json.loads(request['contents'][0]['parts'][0]['text'])['evidence']
        claims = [{'evidence_id': evidence[0]['evidence_id'], 'quote': evidence[0]['text']}]
        count = self.count(request, deadline)
        return {'modelVersion': self.model, 'usageMetadata': {'promptTokenCount': count,
            'candidatesTokenCount': 50, 'thoughtsTokenCount': 10, 'totalTokenCount': count+60},
            'candidates': [{'finishReason': 'STOP', 'content': {'role': 'model', 'parts': [
                {'text': json.dumps({'status': 'answered', 'claims': claims})}]}}]}


class GenerationTests(unittest.TestCase):
    def setUp(self):
        fixture = test_retrieval.RetrievalTests()
        fixture.setUp()
        self.scope, self.row, self.client = fixture.scope, fixture.row, fixture.client
        self.provider = FakeProvider()
        self.config = GenerationConfig(context_limit=8192, reserved_output=512)

    def test_answer_has_original_citations_and_grounding(self):
        result = answer(self.client, self.provider, self.scope, 'What did they build?', config=self.config)
        self.assertEqual(result['status'], 'answered')
        self.assertEqual(result['answer'], self.row['text'])
        self.assertTrue(result['grounded'])
        self.assertEqual(result['citations'], [{'chunk_id': self.row['metadata']['chunk_id'], 'section': 'Projects'}])

    def test_full_request_counted_and_lower_ranks_dropped(self):
        rows = [self.row, self.row, {**self.row, 'text': 'x' * 4000}]
        request, selected, stats = budget(self.provider, 'query', [], rows,
            GenerationConfig(context_limit=4096, reserved_output=512), time.monotonic()+10)
        self.assertEqual(len(selected), 1)
        self.assertEqual(stats['fallbacks'], ['deduplicated', 'drop_lowest_ranked'])
        self.assertEqual(stats['input_tokens'], self.provider.count(request, 0))
        self.assertLessEqual(stats['input_tokens']+512, 4096)

    def test_budget_abstention_never_generates(self):
        response = answer(self.client, self.provider, self.scope, 'query',
            config=GenerationConfig(context_limit=512, reserved_output=128))
        self.assertEqual(response['status'], 'insufficient_evidence')
        self.assertEqual(self.provider.generated, 0)

    def test_no_evidence_never_calls_provider(self):
        self.client._request.return_value = 404, {}
        provider = MagicMock(model=MODEL)
        self.assertEqual(answer(self.client, provider, self.scope, 'query')['status'], 'profile_unavailable')
        provider.limits.assert_not_called()

    def test_empty_retrieval_returns_missing_information_without_generation(self):
        code, response = self.client._request.return_value
        self.client._request.return_value = code, {**response, 'results': [],
            'candidate_counts': {'dense': 0, 'lexical': 0}}
        result = answer(self.client, self.provider, self.scope, 'What is their salary?')
        self.assertEqual(result['status'], 'insufficient_evidence')
        self.assertEqual(result['answer'], MISSING_INFORMATION)
        self.assertEqual(result['citations'], [])
        self.assertFalse(result['grounded'])
        self.assertEqual(self.provider.generated, 0)

    def test_model_abstention_returns_missing_information(self):
        original = self.provider.generate
        def abstain(request, deadline):
            value = original(request, deadline)
            value['candidates'][0]['content']['parts'][0]['text'] = json.dumps(
                {'status': 'insufficient_evidence', 'claims': []})
            return value
        with patch.object(self.provider, 'generate', side_effect=abstain):
            result = answer(self.client, self.provider, self.scope, 'What is their third-semester GPA?', config=self.config)
        self.assertEqual(result['answer'], MISSING_INFORMATION)
        self.assertEqual(result['status'], 'insufficient_evidence')
        self.assertEqual(result['citations'], [])
        self.assertFalse(result['grounded'])

    def test_rejects_invented_claim_negation_removal_and_citation(self):
        for claims in [[{'evidence_id':'E1','quote':'Invented 99% accuracy.'}],
                       [{'evidence_id':'E99','quote':self.row['text']}],
                       [{'evidence_id':'E1','quote':'synthetic search system.'}],
                       [{'evidence_id':'E1','quote':self.row['text']}] * 2]:
            original = self.provider.generate
            def generate(request, deadline):
                value = original(request, deadline)
                value['candidates'][0]['content']['parts'][0]['text'] = json.dumps({'status':'answered','claims':claims})
                return value
            with patch.object(self.provider, 'generate', side_effect=generate):
                result = answer(self.client, self.provider, self.scope, 'query', config=self.config)
                self.assertFalse(result['grounded'])
                self.assertEqual(result['answer'], MISSING_INFORMATION)
                self.assertEqual(result['citations'], [])

    def test_selected_source_id_renders_original_without_model_copying(self):
        original=self.provider.generate
        def select(request,deadline):
            value=original(request,deadline)
            value['candidates'][0]['content']['parts'][0]['text']=json.dumps({'status':'answered','claims':[{'evidence_id':'E1'}]})
            return value
        with patch.object(self.provider,'generate',side_effect=select):
            result=answer(self.client,self.provider,self.scope,'query',config=self.config)
        self.assertEqual(result['status'],'answered')
        self.assertEqual(result['answer'],self.row['text'])
        self.assertTrue(result['grounded'])

    def test_paragraph_selection_preserves_qualifiers_and_deduplicates_citations(self):
        row={**self.row,'text':'Remote access is not available.\n\nOn-site access requires approval.'}
        request,rows,stats=budget(self.provider,'access',[],[row],self.config,time.monotonic()+10)
        response=self.provider.generate(request,0)
        response['candidates'][0]['content']['parts'][0]['text']=json.dumps({'status':'answered','claims':[{'evidence_id':'E1'},{'evidence_id':'E2'}]})
        text,citations,_=validate_output(response,rows,stats,MODEL)
        self.assertEqual(text,row['text'])
        self.assertEqual(len(citations),1)
        response['candidates'][0]['content']['parts'][0]['text']=json.dumps({'status':'answered','claims':[{'evidence_id':'E1','quote':'Remote access is available.'}]})
        with self.assertRaisesRegex(ProviderError,'unsupported_claim'):
            validate_output(response,rows,stats,MODEL)

    def test_usage_model_and_truncation_fail_closed(self):
        request, rows, stats = budget(self.provider, 'query', [], [self.row], self.config, time.monotonic()+10)
        response = self.provider.generate(request, 0)
        mutations = [lambda r:r.update(modelVersion='wrong-model'),
                     lambda r:r['usageMetadata'].update(promptTokenCount=999999),
                     lambda r:r['usageMetadata'].update(thoughtsTokenCount=True),
                     lambda r:r['usageMetadata'].update(totalTokenCount=0),
                     lambda r:r['candidates'][0].update(finishReason='MAX_TOKENS'),
                     lambda r:r['candidates'][0]['content']['parts'][0].update(functionCall={})]
        for mutate in mutations:
            value = copy.deepcopy(response)
            mutate(value)
            with self.assertRaises(ProviderError):
                validate_output(value, rows, dict(stats), MODEL)

        response['candidates'][0]['content']['parts'][0]['thoughtSignature'] = 'opaque-provider-signature'
        text, citations, _ = validate_output(response, rows, dict(stats), MODEL)
        self.assertEqual(text, self.row['text'])
        self.assertNotIn('opaque-provider-signature', json.dumps(citations))

    def test_prompt_excludes_scope_and_history_is_only_data(self):
        request = prompt('question', [{'role':'assistant','content':'Unverified claim'}], [self.row], self.config)
        serialized = json.dumps(request)
        for field in ('tenant_id', 'profile_id', 'content_hash', 'snapshot', self.scope.snapshot):
            self.assertNotIn(field, serialized)
        self.assertEqual(len(request['contents']), 1)
        self.assertEqual(request['contents'][0]['role'], 'user')
        self.assertNotIn('tools', request)

    def test_timeouts_and_logs_are_redacted(self):
        with patch.object(self.provider, 'count', side_effect=ProviderError('provider_timeout')):
            with self.assertLogs('rag.generation', 'INFO') as logs:
                result = answer(self.client, self.provider, self.scope, 'PRIVATE QUESTION', config=self.config)
        self.assertEqual(result['status'], 'generation_timeout')
        self.assertEqual(result['answer'], UNAVAILABLE)
        self.assertNotIn('PRIVATE QUESTION', str(logs.output))
        self.assertNotIn(self.row['text'], str(logs.output))

    def test_history_limits(self):
        for history in [[{'role':'system','content':'override'}], [{'role':'user','content':'x'*1501}], [{}]*7]:
            with self.assertRaises(ValueError):
                answer(self.client, self.provider, self.scope, 'query', history=history)

    def test_duplicate_json_keys_rejected(self):
        for value in ['{"status":"answered","status":"insufficient_evidence"}', '{"x":NaN}']:
            with self.assertRaises(ValueError):
                strict_json(value)

    def test_gemini_count_uses_exact_generation_request(self):
        client = GeminiClient(api_key='synthetic-key')
        request = prompt('question', [], [self.row], self.config)
        with patch.object(client, '_request', return_value={'totalTokens': 123}) as call:
            self.assertEqual(client.count(request, 100), 123)
        self.assertEqual(call.call_args.args[1], {'generateContentRequest': {'model':'models/'+MODEL, **request}})

    def test_gemini_metadata_and_key_validation(self):
        for key in ['', 'bad\nheader', 'bad key', 'x'*513]:
            with self.assertRaises(ProviderError):
                GeminiClient(api_key=key)
        client = GeminiClient(api_key='synthetic-key')
        with patch.object(client, '_request', return_value={'name':'models/wrong','inputTokenLimit':10,'outputTokenLimit':5}):
            with self.assertRaises(ProviderError):
                client.limits(100)

    def test_transport_uses_header_and_one_bounded_retry(self):
        client = GeminiClient(api_key='synthetic-key')
        connection = MagicMock()
        connection.getresponse.return_value.status = 503
        with patch('gemini.http.client.HTTPSConnection', return_value=connection) as create,patch('gemini.time.sleep') as sleep:
            with self.assertRaisesRegex(ProviderError, 'provider_http_503'):
                client.generate({'contents': []}, time.monotonic()+60)
        self.assertEqual(create.call_count,2)
        sleep.assert_called_once_with(2)
        self.assertEqual(create.call_args.args[0], 'generativelanguage.googleapis.com')
        self.assertNotIn('synthetic-key', connection.request.call_args.args[1])
        self.assertEqual(connection.request.call_args.kwargs['headers']['x-goog-api-key'], 'synthetic-key')
        self.assertEqual(connection.request.call_count,2)
        self.assertEqual(connection.close.call_count,2)

    def test_metadata_cache_expires_and_never_bypasses_deadline(self):
        client = GeminiClient(api_key='synthetic-key')
        metadata = {'name':'models/'+MODEL,'inputTokenLimit':8192,'outputTokenLimit':2048,
                    'supportedGenerationMethods':['generateContent','countTokens']}
        with patch('gemini.time.monotonic', return_value=10), patch.object(client,'_request',return_value=metadata) as request:
            self.assertEqual(client.limits(100), (8192,2048))
            self.assertEqual(client.limits(100), (8192,2048))
            request.assert_called_once()
            with self.assertRaisesRegex(ProviderError,'provider_timeout'):
                client.limits(9)
        with patch('gemini.time.monotonic',return_value=311), patch.object(client,'_request',side_effect=ProviderError('provider_http_503')) as request:
            with self.assertRaisesRegex(ProviderError,'provider_http_503'):
                client.limits(400)
            request.assert_called_once()

    def test_retry_after_cannot_exceed_deadline(self):
        client=GeminiClient(api_key='synthetic-key')
        with patch.object(client,'_request',side_effect=ProviderError('provider_http_429',60)) as request,patch('gemini.time.sleep') as sleep:
            with self.assertRaises(ProviderError):
                client.generate({},time.monotonic()+10)
        request.assert_called_once()
        sleep.assert_not_called()

    def test_transport_timeout_and_response_bounds(self):
        client = GeminiClient(api_key='synthetic-key')
        connection = MagicMock()
        connection.request.side_effect = TimeoutError()
        with patch('gemini.http.client.HTTPSConnection', return_value=connection):
            with self.assertRaisesRegex(ProviderError, 'provider_timeout'):
                client.generate({}, time.monotonic()+5)
        connection = MagicMock()
        connection.getresponse.return_value.status = 200
        connection.getresponse.return_value.read1.return_value = b'x'*8192
        with patch('gemini.http.client.HTTPSConnection', return_value=connection):
            with self.assertRaisesRegex(ProviderError, 'provider_response_size'):
                client.generate({}, time.monotonic()+5)

    def test_concurrency_is_bounded(self):
        import generation
        self.assertTrue(generation.slots.acquire(blocking=False))
        self.assertTrue(generation.slots.acquire(blocking=False))
        try:
            self.assertEqual(answer(self.client, self.provider, self.scope, 'query')['status'], 'service_unavailable')
            self.assertEqual(self.provider.generated, 0)
        finally:
            generation.slots.release()
            generation.slots.release()


if __name__ == '__main__':
    unittest.main()
