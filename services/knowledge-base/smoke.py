"""Run inside the KB container against its real HTTP API and Chroma instance."""
import json
import os
import urllib.request
from uuid import uuid4
from urllib.error import HTTPError
from pathlib import Path

def call(path, body=None):
    req = urllib.request.Request('http://localhost:8080' + path,
        data=json.dumps(body).encode() if body else None,
        headers={'Content-Type': 'application/json', 'x-kb-api-key': os.environ['KB_API_KEY']})
    with urllib.request.urlopen(req, timeout=120) as response:
        return json.load(response)

assert call('/health/ready')['status'] == 'ready'
profile = json.loads(Path('/app/fixtures/krishna-gaur-approved-profile.json').read_text())
profile['profile_id'] = 'smoke-' + uuid4().hex
assert call('/v1/index', profile)['count'] == len(profile['facts'])
assert call('/v1/index', profile)['count'] == len(profile['facts'])
query = {'tenant_id': profile['tenant_id'], 'profile_id': profile['profile_id'],
         'query': 'Which project uses escrow?', 'top_k': 3}
results = call('/v1/query', query)['results']
assert results and 'PaySure' in results[0]['text']
query['tenant_id'] = 'unrelated-tenant'
try:
    call('/v1/query', query)
    raise AssertionError('cross-tenant request accepted')
except HTTPError as error:
    assert error.code == 403
changed = json.loads(json.dumps(profile))
changed['facts'][0]['text'] = 'Conflicting payload'
try:
    call('/v1/index', changed)
    raise AssertionError('conflicting replay accepted')
except HTTPError as error:
    assert error.code == 409
call('/v1/purge', {'tenant_id': profile['tenant_id'], 'profile_id': profile['profile_id'], 'generation': 2})
query['tenant_id'] = profile['tenant_id']
assert call('/v1/query', query)['results'] == []
try:
    call('/v1/index', profile)
    raise AssertionError('purged generation resurrected')
except HTTPError as error:
    assert error.code == 409
print('PASS: readiness, resume indexing, replay, PaySure retrieval, tenant filtering')
print('PASS: conflicting replay, purge withdrawal, stale resurrection rejection')
