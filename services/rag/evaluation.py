"""Independent retrieval metrics over explicitly approved synthetic evidence."""
import hashlib
import json
import math
import time
from statistics import mean

from preparation import Scope, PIPELINE_VERSION, CHUNKING_VERSION, EXTRACTOR_VERSION
from retrieval import MODES, retrieve


def metrics_at_k(retrieved, relevance, k):
    if type(k) is not int or k < 1 or not relevance or any(type(v) is not int or not 1 <= v <= 3 for v in relevance.values()):
        raise ValueError('invalid relevance labels')
    ranked, seen, dcg = retrieved[:k], set(), 0.0
    reciprocal = 0.0
    for rank, chunk_id in enumerate(ranked, 1):
        if chunk_id in seen:
            continue
        seen.add(chunk_id)
        grade = relevance.get(chunk_id, 0)
        if grade:
            reciprocal = reciprocal or 1 / rank
            dcg += (2 ** grade - 1) / math.log2(rank + 1)
    hits = len(seen & relevance.keys())
    ideal = sum((2 ** grade - 1) / math.log2(rank + 1)
                for rank, grade in enumerate(sorted(relevance.values(), reverse=True)[:k], 1))
    return {'mrr': reciprocal, 'recall': hits / len(relevance), 'precision': hits / k,
            'ndcg': dcg / ideal, 'duplicate_rate': (len(ranked) - len(set(ranked))) / max(1, len(ranked))}


def synthetic_documents(dataset, model):
    if dataset.get('data_classification') != 'synthetic' or not dataset.get('version'):
        raise ValueError('only explicitly synthetic fixtures are allowed')
    documents, ids = [], {}
    for item in dataset['documents']:
        scope = Scope('rag-evaluation', 'synthetic-v1', item['id'], 1, 1, 'approved-profile', 'Synthetic evaluation', model)
        text, section = item['text'], item['section']
        identity = hashlib.sha256(json.dumps([CHUNKING_VERSION, section, text], ensure_ascii=False).encode()).hexdigest()
        source_hash = hashlib.sha256(text.encode()).hexdigest()
        meta = {**scope.__dict__, 'section': section, 'chunk_id': f"{item['id']}:{identity[:32]}",
                'content_hash': source_hash, 'source_content_hash': source_hash,
                'pipeline_version': PIPELINE_VERSION, 'chunking_version': CHUNKING_VERSION,
                'extractor_version': EXTRACTOR_VERSION}
        if item['id'] in ids:
            raise ValueError('duplicate document label')
        ids[item['id']] = meta['chunk_id']
        documents.append({'pipeline_version': PIPELINE_VERSION, 'source_content_hash': source_hash,
                          'chunks': [{'text': text, 'metadata': meta}]})
    return documents, ids


def evaluate(client, scope, dataset, chunk_ids, k=3, interval_seconds=0.55):
    if dataset.get('data_classification') != 'synthetic' or not dataset['questions']:
        raise ValueError('synthetic evaluation cases required')
    if not 0 <= interval_seconds <= 5:
        raise ValueError('invalid evaluation pacing')
    results = {mode: [] for mode in MODES}
    for case in dataset['questions']:
        labels = {chunk_ids[document_id]: grade for document_id, grade in case['relevance'].items()}
        for mode in MODES:
            # Respect the existing 120/minute tenant quota without counting sleeps as latency.
            time.sleep(interval_seconds)
            response = retrieve(client, scope, case['query'], mode=mode, top_k=k)
            if response['status'] not in {'retrieved', 'insufficient_evidence'}:
                raise RuntimeError(f"retrieval evaluation service failure: {response['status']} HTTP {response['http_status']}")
            ids = [row['metadata']['chunk_id'] for row in response['results']]
            results[mode].append({'case_id': case['id'], 'retrieved': ids,
                **metrics_at_k(ids, labels, k), 'latency_ms': response['latency_ms']})
    def percentile(values, fraction):
        values = sorted(values)
        position = (len(values) - 1) * fraction
        lo, hi = math.floor(position), math.ceil(position)
        return values[lo] + (values[hi] - values[lo]) * (position - lo)
    summary = {}
    for mode, cases in results.items():
        latencies = [row['latency_ms'] for row in cases]
        summary[mode] = {metric + '_at_k' if metric != 'duplicate_rate' else metric:
                         mean(row[metric] for row in cases)
                         for metric in ('mrr', 'recall', 'precision', 'ndcg', 'duplicate_rate')}
        summary[mode].update({f'latency_p{p}_ms': percentile(latencies, p / 100) for p in (50, 95, 99)})
    return {'dataset_version': dataset['version'], 'dataset_sha256': hashlib.sha256(
                json.dumps(dataset, sort_keys=True).encode()).hexdigest(),
            'questions': len(dataset['questions']), 'k': k, 'rrf_k': 60, 'request_interval_seconds': interval_seconds,
            'embedding_model': scope.embedding_model, 'snapshot': scope.snapshot,
            'summary': summary, 'cases': results,
            'limitations': 'Small synthetic development set; no general quality or production latency claim. V2 queries include calibrated reranking and parent expansion in all modes. No generation or compression evaluated.'}
