import copy
import json
from pathlib import Path
import threading
import unittest
from unittest.mock import patch
import uuid

import observability as obs
from release import REQUIRED, assess
from answer_evaluation import evaluate_answers
from gemini import ProviderError
from test_generation import FakeProvider
from load_check import run_load_check
import test_retrieval
from generation import answer


class ProductionTests(unittest.TestCase):
    def test_nested_trace_same_root_and_no_content(self):
        exported = []
        class Capture:
            def submit(self, events):
                exported.extend(events)
        @obs.observed('retrieval')
        def child(secret):
            obs.annotate({'input_tokens':12, 'query':secret})
            return {'status':'retrieved','text':secret}
        @obs.observed('answer')
        def parent(secret):
            child(secret)
            return {'status':'answered','answer':secret}
        with patch.object(obs, '_exporter', Capture()):
            parent('PRIVATE KEY AND PROFILE')
        self.assertEqual(len(exported), 2)
        self.assertEqual(exported[0]['trace_id'], exported[1]['trace_id'])
        self.assertEqual(exported[0]['parent_run_id'], exported[1]['id'])
        self.assertNotIn('PRIVATE', json.dumps(exported))

    def test_export_error_does_not_change_result_or_capture_exception(self):
        class Broken:
            def submit(self, events):
                raise RuntimeError('PRIVATE')
        @obs.observed('extraction')
        def run():
            raise ValueError('PRIVATE SOURCE')
        with patch.object(obs, '_exporter', Broken()):
            with self.assertRaisesRegex(ValueError, 'PRIVATE SOURCE'):
                run()
        self.assertIsNone(obs._active.get())

    def test_metrics_bounded_labels_rates_and_alerts(self):
        metrics = obs.Metrics()
        for _ in range(600):
            metrics.record('answer','service_unavailable',11000, {'input_tokens':5,'private':123}, {'provider_failure'})
        report = metrics.snapshot()
        self.assertEqual(len(metrics.samples['answer']),512)
        self.assertEqual(report['rates']['provider_failure'],1)
        self.assertIn('provider_failure_rate_high', report['alerts'])
        self.assertNotIn('private', json.dumps(report))

    def test_langsmith_sampling_redaction_and_off_request_thread(self):
        calls, called = [], threading.Event()
        def post(self, path, payload):
            calls.append((threading.current_thread().name, path, payload))
            called.set()
            return {}
        event = {'id':'0'*31+'1', 'trace_id':'0'*32, 'parent_run_id':None,
                 'stage':'answer','status':'answered', 'start_time':'2026-11-15T00:00:00+00:00',
                 'end_time':'2026-11-15T00:00:01+00:00', 'numbers':{'input_tokens':5,'query':'PRIVATE'},
                 'flags':['PRIVATE','overflow'], 'secret':'PRIVATE'}
        with patch.object(obs.LangSmith, '_post', post):
            exporter = obs.LangSmith('synthetic-key',sample_rate=.1)
            try:
                exporter.submit([event])
                self.assertTrue(called.wait(2))
                event['trace_id'] = 'f'*32
                exporter.submit([event])
            finally:
                exporter.close()
        self.assertEqual(len(calls),1)
        self.assertEqual(calls[0][0], 'rag-traces')
        self.assertNotIn('PRIVATE', json.dumps(calls))
        self.assertNotIn('synthetic-key', json.dumps(calls))

    def test_tracing_disabled_and_host_allowlist(self):
        with patch.dict('os.environ', {'RAG_LANGSMITH_ENABLED':'0'}):
            self.assertIsNone(obs.configure_langsmith_from_env())
        with self.assertRaises(ValueError):
            obs.LangSmith('key', host='attacker.example')
        with self.assertRaises(ValueError):
            obs.LangSmith('key', sample_rate=1)

    def test_synthetic_dataset_upload_has_no_external_inputs(self):
        sent = []
        def post(self, path, payload):
            sent.append((path,payload))
            return {'id':str(uuid.uuid4())}
        with patch.object(obs.LangSmith, '_post', post):
            exporter = obs.LangSmith('synthetic-key',sample_rate=0)
            try:
                result = exporter.publish_synthetic_answers()
                dataset_calls = list(sent)
                report = {'dataset_version':'synthetic-answers-v1', 'model':'gemini-3.8-flash',
                          'prompt_version':'grounded-excerpts-v1', 'private':'PRIVATE',
                          'cases':[{'case_id':'payment','status':'answered','correct_status':True,
                                    'correct_citations':True,'supported':True,'answer':'PRIVATE'}]}
                exporter.publish_evaluation(report,result['examples'],str(uuid.uuid4()))
            finally:
                exporter.close()
        self.assertEqual(len(result['examples']),10)
        self.assertEqual(dataset_calls[0][0],'/datasets')
        self.assertTrue(all(path=='/examples' for path,_ in dataset_calls[1:]))
        self.assertEqual([p for p,_ in sent[len(dataset_calls):]], ['/runs']+['/api/v1/feedback']*3)
        self.assertNotIn('PRIVATE',json.dumps(sent))

    def test_provider_failure_does_not_produce_answer_scores(self):
        root = Path(__file__).with_name('fixtures')
        corpus = json.loads((root/'retrieval-v1.json').read_text())
        dataset = json.loads((root/'answers-v1.json').read_text())
        provider = FakeProvider()
        with patch.object(provider,'limits',side_effect=ProviderError('provider_timeout')):
            report = evaluate_answers(provider,corpus,dataset)
        self.assertFalse(report['completed'])
        self.assertFalse(report['real_provider'])
        self.assertNotIn('metrics',report)
        self.assertEqual(len(report['cases']),1)

    def test_quality_score_rejects_incomplete_role_answer(self):
        root = Path(__file__).with_name('fixtures')
        corpus = json.loads((root/'retrieval-v1.json').read_text())
        dataset = json.loads((root/'fallback-v1.json').read_text())
        dataset['cases'] = [c for c in dataset['cases'] if c['id'] == 'roles-complete']
        # This provider returns the first exact quote, omitting the second role.
        report = evaluate_answers(FakeProvider(), corpus, dataset)
        self.assertTrue(report['completed'])
        self.assertTrue(report['cases'][0]['correct_status'])
        self.assertFalse(report['cases'][0]['correct_citations'])
        self.assertEqual(report['metrics']['answer_accuracy'], 0)
        self.assertEqual(report['retrieval_metrics']['labelled_context_recall'], 1)
        self.assertEqual(report['retrieval_metrics']['labelled_context_precision'], 1)
        self.assertEqual(len(report['cases'][0]['context_chunk_ids']), 2)

    def test_release_gate_fails_missing_mock_small_and_regressed(self):
        evidence = {'gates':{k:{'passed':True,'evidence':'operator evidence'} for k in REQUIRED},
                    'retrieval_baseline':{'mrr_at_k':.95,'recall_at_k':.95,'dataset_sha256':'abc'}}
        retrieval = {'k':3,'rrf_k':60,'questions':100,'held_out':True,'dataset_sha256':'abc',
                     'summary':{'hybrid':{'mrr_at_k':.96,'recall_at_k':.96}}}
        cases = [{'case_id':str(i),'status':'answered' if i<80 else 'insufficient_evidence',
                  'expected_status':'answered' if i<80 else 'insufficient_evidence',
                  'correct_status':True,'correct_citations':True,'supported':True,'latency_ms':1000} for i in range(100)]
        answers = {'completed':True,'real_provider':True,'held_out':True,'cases':cases,
                   'metrics':{'answer_accuracy':1,'citation_correctness':1,'unsupported_claim_rate':0,
                              'abstention_accuracy':1,'p95_latency_ms':1000}}
        self.assertTrue(assess(evidence,retrieval,answers)['release_ready'])
        self.assertFalse(assess({},retrieval,answers)['release_ready'])
        self.assertFalse(assess(evidence,retrieval,{**answers,'real_provider':False})['release_ready'])
        self.assertFalse(assess(evidence,{**retrieval,'questions':12},answers)['release_ready'])
        wrong = copy.deepcopy(retrieval)
        wrong['summary']['hybrid']['recall_at_k'] = .90
        self.assertFalse(assess(evidence,wrong,answers)['release_ready'])
        wrong_answer = copy.deepcopy(answers)
        wrong_answer['metrics']['unsupported_claim_rate'] = -1
        self.assertFalse(assess(evidence,retrieval,wrong_answer)['release_ready'])
        self.assertFalse(assess(evidence,retrieval,{**answers,'cases':[{}]*100})['release_ready'])

    def test_concurrent_load_rejects_excess_and_recovers(self):
        report = run_load_check(32)
        self.assertTrue(report['passed'])
        self.assertEqual(report['peak_provider_concurrency'],2)

    def test_generation_kill_switch_prevents_external_calls(self):
        fixture = test_retrieval.RetrievalTests()
        fixture.setUp()
        provider = FakeProvider()
        with patch.dict('os.environ', {'RAG_GENERATION_DISABLED':'1'}):
            result = answer(fixture.client,provider,fixture.scope,'query')
        self.assertEqual(result['status'],'service_unavailable')
        fixture.client._request.assert_not_called()
        self.assertEqual(provider.generated,0)

    def test_trace_queue_drops_instead_of_blocking_requests(self):
        started, release = threading.Event(), threading.Event()
        def post(self,path,payload):
            started.set()
            release.wait(2)
            return {}
        event = {'id':'0'*31+'1','trace_id':'0'*32,'parent_run_id':None,'stage':'answer','status':'answered',
                 'start_time':'2026-11-15T00:00:00+00:00','end_time':'2026-11-15T00:00:01+00:00',
                 'numbers':{},'flags':[]}
        with patch.object(obs.LangSmith,'_post',post):
            exporter = obs.LangSmith('synthetic-key',sample_rate=.1)
            try:
                exporter.submit([event])
                self.assertTrue(started.wait(1))
                for _ in range(9):
                    exporter.submit([event])
                self.assertEqual(exporter.queue.qsize(),8)
                self.assertEqual(exporter.dropped,1)
            finally:
                release.set()
                exporter.close()


if __name__ == '__main__':
    unittest.main()
