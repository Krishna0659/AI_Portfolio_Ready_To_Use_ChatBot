"""Seed an unactivated stage on a disposable fixture and verify scoped cleanup."""
import json
import os
from pathlib import Path
from uuid import uuid4
import urllib.request

import chromadb
from chroma_transport import configure_transport


def call(path, body):
    request = urllib.request.Request('http://localhost:8080' + path,
        data=json.dumps(body).encode(), headers={'Content-Type': 'application/json',
        'x-kb-api-key': os.environ['KB_API_KEY']})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


profile = json.loads(Path('/app/fixtures/krishna-gaur-approved-profile.json').read_text())
profile['profile_id'] = 'recovery-smoke-' + uuid4().hex
scope = {key: profile[key] for key in ('tenant_id', 'profile_id')}
configure_transport()
col = chromadb.HttpClient(host='chroma', port=8000).get_collection('portfolioai-approved-v1')
where = {'$and': [{key: value} for key, value in scope.items()]}
call('/v1/index', profile)
try:
    before = col.get(where=where, include=['documents', 'metadatas', 'embeddings'])
    orphan_id = 'orphan-' + uuid4().hex
    metadata = {**before['metadatas'][0], 'snapshot': 'unactivated-stage', 'generation': 999}
    col.upsert(ids=[orphan_id], documents=['Unactivated test stage'], metadatas=[metadata],
               embeddings=[before['embeddings'][0].tolist()])
    assert orphan_id in col.get(where=where, include=[])['ids']
    result = call('/v1/reconcile', scope)
    assert result['cleanup_pending'] is False
    assert set(col.get(where=where, include=[])['ids']) == set(before['ids'])
    hits = call('/v1/query', {**scope, 'query': 'Which project uses escrow?', 'top_k': 3})['results']
    assert hits and 'PaySure' in hits[0]['text']
    call('/v1/reconcile', scope)  # Idempotent repeat.
finally:
    call('/v1/purge', {**scope, 'generation': 2})
assert col.get(where=where, include=[])['ids'] == []
assert call('/v1/reconcile', scope)['cleanup_pending'] is False
print('PASS: real staged orphan removed, active snapshot/query preserved, repeat and purge cleanup')
