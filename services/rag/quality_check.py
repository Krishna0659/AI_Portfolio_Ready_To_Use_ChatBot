"""Private resume development evaluation through real index/query HTTP routes.

Input is prepared by the normal host extractor in ignored .local storage.
Reports contain selected evidence only; never upload them as synthetic fixtures.
"""
import json
from pathlib import Path
from statistics import mean
import time

import numpy as np
from transformers import AutoTokenizer
from indexing import form_batch
from retrieval import RetrievalScope, retrieve
from evaluation import metrics_at_k


def evaluate_resume(client, collection, model, model_name):
    document = json.loads(Path('/workspace/.local/resume-quality-input.json').read_text())
    for chunk in document['chunks']:
        chunk['metadata']['generation'] = 3
    batch = form_batch([document], tenant_id='t', profile_id='p', profile_version=3,
                       generation=3, embedding_model=model_name, subject='Krishna', approved=True)
    client.submit(batch)
    scope = RetrievalScope('t', 'p', 3, 3, model_name, batch.batch_id)
    chunks = document['chunks']
    def matches(fragment):
        rows = [c['metadata']['chunk_id'] for c in chunks if fragment.lower() in c['text'].lower()]
        assert len(rows) == 1, (fragment, len(rows))
        return rows[0]
    cgpa, dsa = matches('CGPA'), matches('365+')
    roles = [matches('Operational Head'), matches('Placement Coordinator')]
    cases = [
        ('q1', "What is Krishna's CGPA till 3rd semester?", [cgpa], 'insufficient_evidence'),
        ('q2', "What is Krishna's Total DSA questions?", [dsa], 'answered'),
        ('q3', "What are Krishna's past or currently ongoing leadership roles?", roles, 'answered'),
        ('cgpa_paraphrase', 'What is the cumulative GPA through semester four?', [cgpa], 'answered'),
        ('dsa_paraphrase', 'How many data structures and algorithms problems has he solved?', [dsa], 'answered'),
        ('roles_paraphrase', 'Which student organizations or placement activities does he lead or coordinate?', roles, 'answered'),
    ]
    results = {}
    for mode in ('dense', 'lexical', 'hybrid'):
        rows = []
        for name, query, expected, status in cases:
            time.sleep(.55)
            response = retrieve(client, scope, query, mode=mode, top_k=3)
            assert response['status'] in {'retrieved', 'insufficient_evidence'}, response['status']
            ranked = response['results']
            ids = [c['metadata']['chunk_id'] for c in ranked]
            rows.append({'case': name, 'query': query, 'expected_answer_status': status,
                **metrics_at_k(ids, dict.fromkeys(expected, 3), 3),
                'latency_ms': response['latency_ms'],
                'top3': [{'section': c['metadata']['section'], 'text': c['text'], 'distance': c.get('distance')} for c in ranked]})
        results[mode] = {'summary': {metric: mean(r[metric] for r in rows)
                         for metric in ('mrr', 'recall', 'precision', 'ndcg')}, 'cases': rows}
    records = collection.get(include=['embeddings', 'documents', 'metadatas'])
    vectors = np.asarray(records['embeddings'])
    inputs = [f"Profile: Krishna\nSection: {m['section']}\n{text}"
              for text, m in zip(records['documents'], records['metadatas'])]
    regenerated = np.asarray(model.encode(inputs, normalize_embeddings=True).tolist())
    tokenizer = AutoTokenizer.from_pretrained('/opt/embedding-model', local_files_only=True)
    lengths = [len(tokenizer.encode(text, truncation=False)) for text in inputs]
    config = json.loads(Path('/opt/embedding-model/sentence_bert_config.json').read_text())
    norms = np.linalg.norm(vectors, axis=1)
    assert vectors.shape == regenerated.shape and np.isfinite(vectors).all()
    assert len(vectors) == len(chunks) and np.allclose(norms, 1, atol=1e-6)
    assert np.allclose(vectors, regenerated, atol=1e-6)
    return {'classification': 'private_resume_development_set', 'held_out': False,
        'questions': len(cases), 'k': 3, 'retrieval': results,
        'embeddings': {'model': model_name, 'count': len(vectors), 'dimensions': vectors.shape[1],
            'finite': bool(np.isfinite(vectors).all()), 'norm_min': float(norms.min()), 'norm_max': float(norms.max()),
            'regenerated_max_abs_error': float(np.abs(vectors-regenerated).max()),
            'regenerated_min_cosine': float(np.min(np.sum(vectors*regenerated, axis=1)/(norms*np.linalg.norm(regenerated,axis=1)))),
            'max_input_tokens': max(lengths), 'model_token_limit': config['max_seq_length'],
            'truncated_chunks': sum(n > config['max_seq_length'] for n in lengths)},
        'limitations': 'Six known development questions, not held out. Q1 scores retrieval of conflicting-semester evidence, not answerability. No generated answers scored here. Disposable persistent Chroma, not the running database.'}
