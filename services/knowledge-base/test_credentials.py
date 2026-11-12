import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import test_app
from fastapi.testclient import TestClient
app = test_app.app


class CredentialTests(unittest.TestCase):
    def test_provision_scope_revoke_and_fail_closed_without_restart(self):
        script = Path(__file__).resolve().parent / 'credentials.py'
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {'KB_DATA_DIR': folder, 'KB_CALLER_GRANTS': '{}'}), patch.object(app, 'DATA_DIR', Path(folder)), patch.object(app, 'load_state', return_value={}):
            key_file = Path(folder) / 'caller.key'
            subprocess.run([sys.executable, str(script), '--tenant', 't', '--profile', 'p', '--operation', 'query', '--key-file', str(key_file)], check=True, capture_output=True)
            key = key_file.read_text()
            client = TestClient(app.app)
            body = {'tenant_id': 't', 'profile_id': 'p', 'query': 'skills'}
            headers = {'x-kb-api-key': key}
            self.assertEqual(client.post('/v1/query', json=body, headers=headers).status_code, 200)
            self.assertEqual(client.post('/v1/query', json={**body, 'profile_id': 'other'}, headers=headers).status_code, 403)
            digest = hashlib.sha256(key.encode()).hexdigest()
            subprocess.run([sys.executable, str(script), '--revoke-hash', digest], check=True, capture_output=True)
            self.assertEqual(client.post('/v1/query', json=body, headers=headers).status_code, 401)
            (Path(folder) / 'caller-grants.json').write_text('invalid')
            self.assertEqual(client.post('/v1/query', json=body, headers=headers).status_code, 503)
