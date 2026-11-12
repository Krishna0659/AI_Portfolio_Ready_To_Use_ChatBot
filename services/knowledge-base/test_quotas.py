import hashlib
import unittest
from unittest.mock import MagicMock, patch

import test_app
import quotas
from fastapi.testclient import TestClient

app = test_app.app


class QuotaTests(unittest.TestCase):
    def test_rate_refill_tenant_isolation_and_maintenance_capacity(self):
        now = [100.0]
        limiter = quotas.TenantRateLimit(clock=lambda: now[0])
        for _ in range(10):
            limiter.check('a', 'index')
        with self.assertRaises(app.HTTPException) as failure:
            limiter.check('a', 'index')
        self.assertEqual(failure.exception.status_code, 429)
        self.assertEqual(failure.exception.headers['Retry-After'], '6')
        limiter.check('b', 'index')
        limiter.check('a', 'purge')
        limiter.check('a', 'query')
        now[0] += 6
        limiter.check('a', 'index')
        with self.assertRaises(app.HTTPException):
            limiter.check('a', 'index')

    def test_storage_replacement_and_tombstone_accounting(self):
        state = {'a:one': {'count': 3}, 'a:deleted': {'purged': True, 'count': 0},
                 'ab:one': {'count': 999}}
        with patch.object(quotas, 'MAX_TENANT_PROFILES', 2), patch.object(quotas, 'MAX_TENANT_FACTS', 4):
            quotas.check_storage(state, 'a', 'one', 4)
            quotas.check_storage(state, 'b', 'new', 4)
            with self.assertRaises(app.HTTPException):
                quotas.check_storage(state, 'a', 'deleted', 2)
            for count in (1, None):
                with self.assertRaises(app.HTTPException):
                    quotas.check_storage(state, 'a', 'new', count)
            quotas.check_storage(state, 'a', 'deleted', 1)

    def test_rejected_write_never_embeds_or_mutates_and_purge_still_works(self):
        state = {'a:one': {'count': 1, 'generation': 1, 'profile_version': 1}}
        req = app.IndexRequest(tenant_id='a', profile_id='two', generation=1, profile_version=1,
                               facts=[app.Fact(section='skills', text='Python', fact_id='f')])
        with patch.object(app, 'load_state', return_value=state), patch.object(app, 'save_state') as save, patch.object(app, 'resources') as resources, patch.object(quotas, 'MAX_TENANT_PROFILES', 1):
            with self.assertRaises(app.HTTPException) as failure:
                app.index(req)
            self.assertEqual(failure.exception.status_code, 409)
            resources.assert_not_called()
            save.assert_not_called()
            with self.assertRaises(app.HTTPException):
                app.purge(app.PurgeRequest(tenant_id='a', profile_id='two', generation=1))
            save.assert_not_called()
            resources.return_value = (MagicMock(), None)
            app.purge(app.PurgeRequest(tenant_id='a', profile_id='one', generation=2))
            self.assertTrue(state['a:one']['purged'])

    def test_http_rate_shared_across_credentials_and_bad_input_safe(self):
        grant = {'profiles': {'a': ['p']}, 'operations': ['query']}
        grants = {hashlib.sha256(key.encode()).hexdigest(): grant for key in ['one', 'two']}
        limiter = quotas.TenantRateLimit(clock=lambda: 100.0)
        with patch.object(app, 'GRANTS', grants), patch.object(app, 'tenant_rate_limit', limiter), patch.object(app, 'load_state', return_value={}):
            client = TestClient(app.app)
            body = {'tenant_id': 'a', 'profile_id': 'p', 'query': 'skills'}
            headers = {'x-kb-api-key': 'one'}
            for invalid in ('{', '[]', '{"tenant_id": [], "profile_id": "p"}'):
                self.assertEqual(client.post('/v1/query', content=invalid, headers=headers).status_code, 422)
            self.assertEqual(limiter.buckets, {})
            for _ in range(20):
                self.assertEqual(client.post('/v1/query', json=body, headers=headers).status_code, 200)
            result = client.post('/v1/query', json=body, headers={'x-kb-api-key': 'two'})
            self.assertEqual(result.status_code, 429)
            self.assertEqual(result.headers['retry-after'], '1')
            self.assertEqual(client.post('/v1/query', json={**body, 'tenant_id': 'denied'}, headers=headers).status_code, 403)
            self.assertNotIn(('denied', 'query'), limiter.buckets)
