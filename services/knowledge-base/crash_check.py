"""Used by crash-drill.ps1; pauses only the embedding worker before container kill."""
import json
import os
import signal
import sys
import threading
import time
import urllib.request
from pathlib import Path
from uuid import uuid4

import chromadb
from chroma_transport import configure_transport


def call(path, body=None):
    request = urllib.request.Request('http://localhost:8080' + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json', 'x-kb-api-key': os.environ['KB_API_KEY']})
    with urllib.request.urlopen(request, timeout=65) as response:
        return json.load(response)


fixture_path = Path('/data/crash-drill-fixture.json')
if sys.argv[1] == 'interrupt':
    profile = json.loads(Path('/app/fixtures/krishna-gaur-approved-profile.json').read_text())
    profile['profile_id'] = 'crash-' + uuid4().hex
    fixture_path.write_text(json.dumps(profile))
    # Warm up via an existing active evaluation profile, then suspend its worker.
    call('/v1/query', {'tenant_id': 'fixture-tenant', 'profile_id': 'recovery-evaluation-context-v2', 'query': 'skills'})
    children = {pid for task in Path('/proc/1/task').iterdir() for pid in (task / 'children').read_text().split()}
    workers = [int(pid) for pid in children if b'spawn_main' in Path(f'/proc/{pid}/cmdline').read_bytes()]
    assert len(workers) == 1, workers
    os.kill(workers[0], signal.SIGSTOP)
    def stage():
        try:
            call('/v1/index', profile)
        except Exception:
            pass  # Expected disconnect when the parent container is killed.
    threading.Thread(target=stage, daemon=True).start()
    key = profile['tenant_id'] + ':' + profile['profile_id']
    for _ in range(100):
        state = json.loads(Path('/data/index-state.json').read_text())
        if state.get(key, {}).get('pending'):
            break
        time.sleep(0.05)
    else:
        raise AssertionError('stage not recorded')
    configure_transport()
    col = chromadb.HttpClient(host='chroma', port=8000).get_collection('portfolioai-approved-v1')
    col.upsert(ids=[profile['profile_id'] + '-orphan'], documents=['Uncommitted crash fixture'],
        embeddings=[[1 / (384 ** 0.5)] * 384], metadatas=[{'tenant_id': profile['tenant_id'],
        'profile_id': profile['profile_id'], 'snapshot': state[key]['pending']['snapshot'], 'generation': 1}])
    print('READY: durable first-stage record and orphan present; embedding worker suspended')
else:
    profile = json.loads(fixture_path.read_text())
    scope = {key: profile[key] for key in ('tenant_id', 'profile_id')}
    assert call('/v1/query', {**scope, 'query': 'skills'}) == {'results': []}
    status = call('/v1/status?tenant_id=' + scope['tenant_id'] + '&profile_id=' + scope['profile_id'])
    assert status['pending']['generation'] == 1 and status['generation'] == 0
    call('/v1/reconcile', scope)
    configure_transport()
    col = chromadb.HttpClient(host='chroma', port=8000).get_collection('portfolioai-approved-v1')
    where = {'$and': [{key: value} for key, value in scope.items()]}
    assert col.get(where=where, include=[])['ids'] == []
    assert call('/v1/index', profile)['count'] == len(profile['facts'])
    call('/v1/purge', {**scope, 'generation': 2})
    print('PASS: SIGKILL recovery, pending status, first-stage cleanup, exact replay, purge')
