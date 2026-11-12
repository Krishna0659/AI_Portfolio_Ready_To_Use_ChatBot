import json
import sys
import os
import urllib.request
from pathlib import Path
from uuid import uuid4

path = Path('/data/backup-probe.json')
if sys.argv[1] == 'prepare':
    profile = json.loads(Path('/app/fixtures/krishna-gaur-approved-profile.json').read_text())
    profile['profile_id'] = 'backup-probe-' + uuid4().hex
    path.write_text(json.dumps(profile))
    endpoint, body = 'index', profile
else:
    profile = json.loads(path.read_text())
    endpoint = 'purge'
    body = {key: profile[key] for key in ('tenant_id', 'profile_id')}
    body['generation'] = 2
request = urllib.request.Request('http://localhost:8080/v1/' + endpoint, data=json.dumps(body).encode(),
    headers={'Content-Type': 'application/json', 'x-kb-api-key': os.environ['KB_API_KEY']})
with urllib.request.urlopen(request, timeout=60) as response:
    assert response.status == 200
print('Backup probe:', endpoint)
