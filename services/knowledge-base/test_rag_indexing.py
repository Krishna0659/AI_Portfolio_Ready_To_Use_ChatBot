import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

import test_app
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'rag'))
from indexing import IndexClient, IndexingError
from test_indexing import batch, document

app = test_app.app


class RagContractTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.col, self.model = MagicMock(), MagicMock()
        self.rows = {}
        def upsert(**kw):
            self.rows.update({key: (text, meta) for key, text, meta in zip(kw['ids'], kw['documents'], kw['metadatas'])})
        def get(**kw):
            keys = kw.get('ids', [])
            return {'ids': [k for k in keys if k in self.rows], 'metadatas': []}
        self.col.upsert.side_effect = upsert
        self.col.get.side_effect = get
        self.model.encode.return_value.tolist.return_value = [[0.1, 0.2]]
        self.reranker=MagicMock()
        self.reranker.encode.return_value.tolist.return_value=[10.0]
        grant = {hashlib.sha256(b'test-key').hexdigest(): {'profiles': {'t': ['p']}, 'operations': ['index', 'status']}}
        for p in [patch.object(app, 'DATA_DIR', Path(self.tmp.name)),
                  patch.object(app, 'STATE_PATH', Path(self.tmp.name) / 'state.json'),
                  patch.object(app, 'MODEL_NAME', 'test-model'), patch.object(app, 'GRANTS', grant),
                  patch.object(app, 'resources', return_value=(self.col, self.model)),
                  patch('parent_retrieval.reranker',return_value=self.reranker),
                  patch.object(app.tenant_rate_limit, 'check'), patch('indexing.time.sleep')]:
            p.start()
            self.addCleanup(p.stop)
        self.http = TestClient(app.app)
        self.client = IndexClient('http://localhost', 'test-key')
        self.client._request = self.request

    def request(self, path, payload=None, **options):
        headers = {'x-kb-api-key': 'test-key', 'content-type': 'application/json'}
        response = self.http.get(path, headers=headers) if payload is None else self.http.post(path, content=payload, headers=headers)
        return response.status_code, response.json()

    def test_http_metadata_digest_and_exact_replay(self):
        value = batch([document('a'), document('b')])
        result = self.client.submit(value)
        self.assertEqual(result['count'], 2)
        self.assertEqual(app.load_state()['t:p']['snapshot'], value.batch_id)
        for chunk in json.loads(value.payload)['chunks']:
            stored = next(meta for text, meta in self.rows.values() if meta['chunk_id'] == chunk['metadata']['chunk_id'])
            for key, expected in chunk['metadata'].items():
                self.assertEqual(stored[key], expected)
        self.assertTrue(self.client.submit(value)['reconciled'])
        self.assertEqual(self.col.upsert.call_count, 1)
        self.assertEqual(self.model.encode.call_count, 1)

    def test_http_timeout_after_commit(self):
        def timeout_after_write(path, payload=None):
            result = self.request(path, payload)
            return (0, {}) if payload is not None else result
        self.client._request = timeout_after_write
        self.assertTrue(self.client.submit(batch())['reconciled'])
        self.assertEqual(self.col.upsert.call_count, 1)

    def test_http_rejects_scope_hash_model_and_version_mismatch(self):
        original = json.loads(batch().payload)
        for location, key, value in [('meta', 'tenant_id', 'other'), ('meta', 'content_hash', 'b'*64),
                ('meta', 'pipeline_version', 'other'), ('top', 'preprocessing_version', 'other'),
                ('top', 'embedding_model', 'other')]:
            body = json.loads(json.dumps(original))
            target = body['chunks'][0]['metadata'] if location == 'meta' else body
            target[key] = value
            code, _ = self.request('/v1/index', json.dumps(body).encode())
            self.assertEqual(code, 422)
        body = json.loads(json.dumps(original))
        body['embedding_model'] = body['chunks'][0]['metadata']['embedding_model'] = 'wrong-configured-model'
        self.assertEqual(self.request('/v1/index', json.dumps(body).encode())[0], 409)
        self.col.upsert.assert_not_called()

    def test_http_missing_credentials_and_cross_tenant(self):
        self.assertEqual(self.http.post('/v1/index', content=batch().payload).status_code, 401)
        body = json.loads(batch().payload)
        body['tenant_id'] = 'other'
        self.assertEqual(self.request('/v1/index', json.dumps(body).encode())[0], 403)
        self.col.upsert.assert_not_called()

    def test_failed_stage_preserves_old_generation_and_retries(self):
        first = batch()
        self.client.submit(first)
        second = batch([document(generation=2)], generation=2)
        self.col.upsert.side_effect = app.httpx.ReadTimeout('synthetic unavailable')
        with self.assertRaisesRegex(IndexingError, 'index_outcome_uncertain'):
            self.client.submit(second)
        state = app.load_state()['t:p']
        self.assertEqual(state['snapshot'], first.batch_id)
        self.assertEqual(state['pending']['snapshot'], second.batch_id)

    def test_legacy_digest_and_replay_unchanged(self):
        request = app.IndexRequest(tenant_id='t', profile_id='p', generation=1, profile_version=1,
            embedding_model='test-model', facts=[app.Fact(section='Skills', text='Python', fact_id='f')])
        expected = hashlib.sha256(json.dumps(request.model_dump(), sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        code, response = self.request('/v1/index', request.model_dump_json().encode())
        self.assertEqual(code, 200)
        self.assertEqual(response['snapshot'], expected)
        self.assertEqual(self.request('/v1/index', request.model_dump_json().encode())[0], 200)
        self.assertEqual(self.col.upsert.call_count, 1)

    def query_payload(self, value, mode='hybrid'):
        return dict(tenant_id='t', profile_id='p', generation=1, profile_version=1,
            embedding_model='test-model', contract_version='rag-chunks-v1',
            preprocessing_version=app.PREPROCESSING_VERSION, snapshot=value.batch_id,
            query='synthetic search', mode=mode, top_k=3)

    def test_scoped_query_fences_before_search(self):
        value = batch()
        self.client.submit(value)
        grant = next(iter(app.GRANTS.values()))
        grant['operations'].append('query')
        for field, replacement in [('generation', 2), ('profile_version', 2),
                                   ('snapshot', 'b'*64), ('embedding_model', 'other')]:
            request = {**self.query_payload(value), field: replacement}
            self.assertEqual(self.request('/v1/query', json.dumps(request).encode())[0], 409)
        incomplete = self.query_payload(value)
        del incomplete['snapshot']
        self.assertEqual(self.request('/v1/query', json.dumps(incomplete).encode())[0], 422)
        self.col.query.assert_not_called()
        self.assertEqual(self.model.encode.call_count, 1)

    def test_lexical_does_not_embed_and_shares_hybrid_scope(self):
        from retrieval import RetrievalScope, retrieve
        value = batch()
        self.client.submit(value)
        next(iter(app.GRANTS.values()))['operations'].append('query')
        keys = list(self.rows)
        text, meta = self.rows[keys[0]]
        self.col.get.side_effect = None
        self.col.get.return_value = {'ids': keys, 'documents': [text], 'metadatas': [meta]}
        self.col.query.return_value = {'ids': [keys], 'documents': [[text]], 'metadatas': [[meta]], 'distances': [[0.1]]}
        scope = RetrievalScope('t', 'p', 1, 1, 'test-model', value.batch_id)
        self.model.encode.reset_mock()
        response = retrieve(self.client, scope, 'synthetic search', mode='lexical')
        self.assertEqual(response['status'], 'retrieved')
        self.model.encode.assert_not_called()
        self.col.query.assert_not_called()
        response = retrieve(self.client, scope, 'synthetic search')
        self.assertEqual(response['status'], 'retrieved')
        self.assertEqual(self.col.query.call_args.kwargs['where'], self.col.get.call_args.kwargs['where'])
        self.assertEqual(self.col.get.call_args.kwargs['where'], {'$and': [
            {'tenant_id': 't'}, {'profile_id': 'p'}, {'snapshot': value.batch_id}]})

    def test_missing_profile_scoped_query_is_unavailable(self):
        next(iter(app.GRANTS.values()))['operations'].append('query')
        self.assertEqual(self.request('/v1/query', json.dumps(self.query_payload(batch())).encode())[0], 404)
        self.col.query.assert_not_called()


if __name__ == '__main__':
    unittest.main()
