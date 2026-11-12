"""Exercise live HTTP throttling without storing profile data."""
import json
import os
import time
import urllib.error
import urllib.request
from uuid import uuid4

body = {'tenant_id': 'fixture-tenant', 'profile_id': 'rate-smoke-' + uuid4().hex, 'query': 'skills'}
headers = {'Content-Type': 'application/json', 'x-kb-api-key': os.environ['KB_API_KEY']}


def query():
    request = urllib.request.Request('http://localhost:8080/v1/query', data=json.dumps(body).encode(), headers=headers)
    with urllib.request.urlopen(request, timeout=10) as response:
        assert json.load(response) == {'results': []}


for attempt in range(50):
    try:
        query()
    except urllib.error.HTTPError as error:
        assert error.code == 429, error.code
        retry = int(error.headers['Retry-After'])
        assert 1 <= retry <= 2, retry
        break
else:
    raise AssertionError('rate limit never triggered')

request = urllib.request.Request(
    'http://localhost:8080/v1/status?tenant_id=' + body['tenant_id'] + '&profile_id=' + body['profile_id'], headers=headers)
try:
    urllib.request.urlopen(request, timeout=10)
    raise AssertionError('unexpected profile state')
except urllib.error.HTTPError as error:
    assert error.code == 404, error.code  # Maintenance was admitted despite query throttle.
time.sleep(retry)
query()
print('PASS: live 429, Retry-After, independent status capacity and query refill')
