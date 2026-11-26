"""Generator evaluation with gold synthetic evidence, independent of retrieval ranking."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import time

from evaluation import synthetic_documents
from gemini import GeminiClient
from generation import answer, PROMPT_VERSION, MISSING_INFORMATION, UNAVAILABLE
from indexing import CONTRACT, PREPROCESSING
from retrieval import RetrievalScope


class GoldEvidence:
    def __init__(self, rows, scope):
        self.rows, self.scope = rows, scope
    def _request(self, path, payload, **kwargs):
        return 200, {**self.scope.__dict__, 'contract_version': CONTRACT, 'preprocessing_version': PREPROCESSING,
            'mode': 'hybrid', 'rrf_k': 60, 'candidate_counts': {'dense': len(self.rows), 'lexical': len(self.rows)},
            'results': self.rows}


class RecordedEvidence:
    """Record returned context IDs for synthetic evaluation, without changing retrieval."""
    def __init__(self, transport):
        self.transport, self.ids = transport, set()

    def _request(self, *args, **kwargs):
        status, body = self.transport._request(*args, **kwargs)
        if status == 200:
            self.ids = {row['metadata']['chunk_id'] for row in body.get('results', [])}
        return status, body


def evaluate_answers(provider, corpus, dataset, transport_factory=None):
    if corpus.get('data_classification') != 'synthetic' or dataset.get('data_classification') != 'synthetic':
        raise ValueError('only synthetic evaluation content is allowed')
    cases = dataset['cases']
    if not 1 <= len(cases) <= 100 or len({c['id'] for c in cases}) != len(cases):
        raise ValueError('invalid evaluation cases')
    scope = RetrievalScope('rag-evaluation', 'synthetic-v1', 1, 1, 'synthetic-embedding', 'a'*64)
    results = []
    for case in cases:
        # Live development-key quotas must not turn a burst into a quality score.
        # Pacing is outside measured request latency; this is not a load test.
        if results and type(provider) is GeminiClient:
            time.sleep(12)
        items = [item for item in corpus['documents'] if item['id'] in case['documents']] + case.get('extra_evidence', [])
        documents, ids = synthetic_documents({'data_classification': 'synthetic', 'version':dataset['version'], 'documents':items}, scope.embedding_model)
        rows = [doc['chunks'][0] for doc in documents]
        transport = None
        if transport_factory is not None:
            transport, scope = transport_factory(case)
        for row in rows:
            row['metadata'].update(snapshot=scope.snapshot, profile_version=1,
                contract_version=CONTRACT, preprocessing_version=PREPROCESSING)
            row['distance'] = None
        started = time.monotonic()
        recorded = RecordedEvidence(transport if transport is not None else GoldEvidence(rows, scope))
        response = answer(recorded, provider, scope, case['question'])
        cited = {c['chunk_id'] for c in response['citations']}
        permitted = {ids[name] for name in case['required_documents']}
        correct_citations = (cited == permitted) if case['expected_status'] == 'answered' else not cited
        supported = (response['answer'] in {MISSING_INFORMATION, UNAVAILABLE}) if not cited else response['answer'] == '\n\n'.join(
            next(row['text'] for row in rows if row['metadata']['chunk_id'] == c['chunk_id'])
            for c in response['citations'] if c['chunk_id'] in ids.values())
        results.append({'case_id':case['id'], 'expected_status':case['expected_status'],
            'question':case['question'], 'answer':response['answer'],
            'cited_chunk_ids':sorted(cited), 'expected_chunk_ids':sorted(permitted),
            'context_chunk_ids':sorted(recorded.ids),
            'status':response['status'], 'correct_status':response['status']==case['expected_status'],
            'correct_citations':correct_citations, 'supported':supported,
            'latency_ms':(time.monotonic()-started)*1000})
        if response['status'] in {'generation_timeout', 'service_unavailable'} and transport_factory is None:
            break
    completed = len(results) == len(cases) and all(r['status'] in {'answered','insufficient_evidence'} for r in results)
    negative = [r for r in results if r['expected_status']=='insufficient_evidence']
    report = {'dataset_version':dataset['version'], 'dataset_sha256':hashlib.sha256(json.dumps(dataset,sort_keys=True).encode()).hexdigest(),
        'model':provider.model, 'prompt_version':PROMPT_VERSION, 'real_provider':type(provider) is GeminiClient,
        'held_out':dataset.get('held_out') is True, 'retrieval_source':'real_http_chroma' if transport_factory else 'gold_synthetic_fixture',
        'completed':completed, 'planned_cases':len(cases), 'cases':results}
    positives = [r for r in results if r['expected_status'] == 'answered']
    if len(results) == len(cases) and positives:
        report['retrieval_metrics'] = {
            'labelled_context_recall':sum(len(set(r['context_chunk_ids']) & set(r['expected_chunk_ids'])) / len(r['expected_chunk_ids']) for r in positives)/len(positives),
            'labelled_context_precision':sum(len(set(r['context_chunk_ids']) & set(r['expected_chunk_ids'])) / max(1,len(r['context_chunk_ids'])) for r in positives)/len(positives),
            'positive_questions':len(positives),
            'definition':'Macro document-ID overlap on answerable questions; full returned retrieval context, before generation budgeting; not an LLM judge.'}
    # A partial provider outage must never masquerade as a quality score.
    if completed:
        report['metrics'] = {'answer_accuracy':sum(r['correct_status'] and r['correct_citations'] and r['supported'] for r in results)/len(results),
            'citation_correctness':sum(r['correct_citations'] for r in results)/len(results),
            'unsupported_claim_rate':sum(not r['supported'] for r in results)/len(results),
            'abstention_accuracy':sum(r['correct_status'] for r in negative)/max(1,len(negative)),
            'p95_latency_ms':sorted(r['latency_ms'] for r in results)[max(0, math.ceil(.95*len(results))-1)]}
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--live', action='store_true', required=True, help='Explicitly call Gemini with synthetic evidence')
    parser.add_argument('--dataset', choices=['answers-v1', 'fallback-v1'], default='answers-v1')
    args = parser.parse_args()
    root = Path(__file__).with_name('fixtures')
    report = evaluate_answers(GeminiClient(), json.loads((root/'retrieval-v1.json').read_text()),
                              json.loads((root/(args.dataset+'.json')).read_text()))
    print(json.dumps(report, indent=2))
    raise SystemExit(0 if report['completed'] else 1)
