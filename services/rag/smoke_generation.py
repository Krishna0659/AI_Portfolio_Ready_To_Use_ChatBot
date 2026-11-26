"""Explicit live Gemini check with synthetic evidence only; no KB service access."""
import json
from pathlib import Path
import sys

from evaluation import synthetic_documents
from generation import answer
from gemini import GeminiClient, ProviderError
from indexing import CONTRACT, PREPROCESSING
from retrieval import RetrievalScope


class SyntheticKB:
    def __init__(self, row, scope):
        self.row, self.scope = row, scope
    def _request(self, path, payload, **kwargs):
        return 200, {**self.scope.__dict__, 'contract_version': CONTRACT, 'preprocessing_version': PREPROCESSING,
            'mode':'hybrid', 'rrf_k':60, 'candidate_counts':{'dense':1,'lexical':1}, 'results':[self.row]}


def main():
    provider = GeminiClient()
    dataset = json.loads(Path(__file__).with_name('fixtures').joinpath('retrieval-v1.json').read_text())
    documents, _ = synthetic_documents(dataset, 'synthetic-embedding-model')
    scope = RetrievalScope('rag-evaluation', 'synthetic-v1', 1, 1, 'synthetic-embedding-model', 'a'*64)
    row = documents[0]['chunks'][0]
    row['metadata'].update(snapshot=scope.snapshot, profile_version=1,
                           contract_version=CONTRACT, preprocessing_version=PREPROCESSING)
    row['distance'] = 0.1
    kb = SyntheticKB(row, scope)
    import logging
    logging.basicConfig(level=logging.INFO, format='%(message)s')
    results = []
    for question, expected in [('What did Mira build to prevent duplicate transfers?', 'answered'),
                               ('What is Mira\'s medical degree and graduation date?', 'insufficient_evidence')]:
        response = answer(kb, provider, scope, question)
        results.append({'expected': expected, 'status': response['status'], 'grounded': response['grounded'],
                        'citation_count':len(response['citations'])})
        if response['status'] in {'service_unavailable', 'generation_timeout'}:
            break
    print(json.dumps({'model':provider.model, 'cases':results,
                      'passed':all(case['expected']==case['status'] for case in results)}, indent=2))
    if not all(case['expected']==case['status'] for case in results):
        sys.exit(1)


if __name__ == '__main__':
    try:
        main()
    except ProviderError as exc:
        print(json.dumps({'status':'failed','code':exc.code}))
        sys.exit(1)
