"""Read-only acceptance against an isolated restored copy."""
import json
import os
import urllib.request
from urllib.error import HTTPError
from pathlib import Path

def call(path, payload=None):
    request = urllib.request.Request('http://localhost:8080' + path,
        data=json.dumps(payload).encode() if payload else None,
        headers={'Content-Type': 'application/json', 'x-kb-api-key': os.environ['KB_API_KEY']})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)

assert call('/health/ready')['status'] == 'ready'
states = json.loads(Path('/data/index-state.json').read_text())
active = purged = 0
for key, state in states.items():
    tenant, profile = key.split(':', 1)
    if tenant != 'fixture-tenant':
        continue
    rows = call('/v1/query', {'tenant_id': tenant, 'profile_id': profile,
        'query': 'escrow payments', 'top_k': 3})['results']
    if state.get('purged'):
        assert not rows, 'purged data became visible'
        payload = json.loads(Path('/app/fixtures/krishna-gaur-approved-profile.json').read_text())
        payload.update(tenant_id=tenant, profile_id=profile, generation=state['generation'])
        try:
            call('/v1/index', payload)
            raise AssertionError('restored tombstone accepted stale index')
        except HTTPError as error:
            assert error.code == 409
        purged += 1
    else:
        assert rows, 'active profile lost'
        assert all(row['metadata']['generation'] == state['generation'] for row in rows)
        assert 'PaySure' in rows[0]['text']
        active += 1
assert active and purged
print(json.dumps({'restored_active_profiles': active, 'restored_purge_markers': purged, 'result': 'PASS'}))
