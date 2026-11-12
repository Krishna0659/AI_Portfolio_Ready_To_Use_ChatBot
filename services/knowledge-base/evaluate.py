"""Prepare once, then evaluate again after restarting the containers."""
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

def call(path, body):
    req = urllib.request.Request('http://localhost:8080/v1/' + path,
        data=json.dumps(body).encode(), headers={'Content-Type': 'application/json',
        'x-kb-api-key': os.environ['KB_API_KEY']})
    with urllib.request.urlopen(req, timeout=120) as response:
        return json.load(response)

profile = json.loads(Path('/app/fixtures/krishna-gaur-approved-profile.json').read_text())
profile['profile_id'] = 'recovery-evaluation-v1'
if sys.argv[1] == 'prepare':
    for generation in (1, 2):
        profile.update(generation=generation, profile_version=generation)
        result = call('index', profile)
        assert not result['cleanup_pending']
    print('Prepared two generations; obsolete snapshot cleanup succeeded')
else:
    questions = json.loads(Path('/app/fixtures/evaluation-questions.json').read_text())
    recalls, ranks, timings = [], [], []
    for case in questions:
        start = time.perf_counter()
        rows = call('query', {'tenant_id': profile['tenant_id'], 'profile_id': profile['profile_id'],
            'query': case['question'], 'top_k': 3})['results']
        timings.append((time.perf_counter() - start) * 1000)
        ids = [row['metadata']['fact_id'] for row in rows]
        assert rows and all(row['metadata']['generation'] == 2 for row in rows)
        expected = set(case['expected_fact_ids'])
        recalls.append(len(expected.intersection(ids)) / len(expected))
        ranks.append(next((1 / rank for rank, fact in enumerate(ids, 1) if fact in expected), 0))
    print(json.dumps({'questions': len(questions), 'recall_at_3': sum(recalls)/len(recalls),
        'mrr_at_3': sum(ranks)/len(ranks), 'max_latency_ms': round(max(timings), 2),
        'mean_latency_ms': round(sum(timings)/len(timings), 2)}))
