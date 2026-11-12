import hashlib
import unittest
from unittest.mock import patch
import test_app
from fastapi.testclient import TestClient

app = test_app.app

class AuthorizationTests(unittest.TestCase):
    def test_transport_failure_returns_retryable_503_without_details(self):
        grant = {hashlib.sha256(b'reader').hexdigest(): {'profiles': {'t': ['p']}, 'operations': ['query']}}
        with patch.object(app, 'GRANTS', grant), patch.object(app, 'load_state', return_value={'t:p': {'generation': 1, 'snapshot': 's'}}), patch.object(app, 'resources', side_effect=app.httpx.ReadTimeout('private-host-secret')):
            response = TestClient(app.app).post('/v1/query', json={'tenant_id': 't', 'profile_id': 'p', 'query': 'skills'}, headers={'x-kb-api-key': 'reader'})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers['retry-after'], '1')
        self.assertNotIn('private-host-secret', response.text)

    def test_scope_and_size_at_http_boundary(self):
        grant = {hashlib.sha256(b'reader').hexdigest(): {'profiles': {'tenant-a': ['profile-a']}, 'operations': ['query']}}
        with patch.object(app, 'GRANTS', grant), patch.object(app, 'load_state', return_value={}):
            client = TestClient(app.app)
            body = {'tenant_id': 'tenant-a', 'profile_id': 'profile-a', 'query': 'skills'}
            headers = {'x-kb-api-key': 'reader'}
            self.assertEqual(client.post('/v1/query', json=body).status_code, 401)
            self.assertEqual(client.post('/v1/query', json=body, headers=headers).status_code, 200)
            for field in ['tenant_id', 'profile_id']:
                self.assertEqual(client.post('/v1/query', json={**body, field: 'other'}, headers=headers).status_code, 403)
            self.assertEqual(client.post('/v1/purge', json={**body, 'generation': 2}, headers=headers).status_code, 403)
            self.assertEqual(client.get('/v1/status', params=body, headers=headers).status_code, 403)
            self.assertEqual(client.post('/v1/reconcile', json=body, headers=headers).status_code, 403)
            self.assertEqual(client.post('/v1/query', content=b'x' * 1_048_577, headers=headers).status_code, 413)
