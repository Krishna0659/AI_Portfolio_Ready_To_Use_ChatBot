"""Run inside the API container while Chroma is paused; always unpause afterward."""
import os
import time
import urllib.error
import urllib.request

start = time.monotonic()
request = urllib.request.Request(
    'http://127.0.0.1:8080/health/ready',
    headers={'x-kb-api-key': os.environ['KB_API_KEY']},
)
try:
    urllib.request.urlopen(request, timeout=25)
    raise AssertionError('unexpected readiness during database stall')
except urllib.error.HTTPError as exc:
    assert exc.code == 503, exc.code
elapsed = time.monotonic() - start
assert elapsed < 23, elapsed  # A concurrent readiness probe may hold the resource lock.
print(f'PASS: stalled Chroma returns 503 in {elapsed:.2f} seconds')
