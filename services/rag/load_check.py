"""Bounded-concurrency fault drill with synthetic transports; no paid API calls."""
from concurrent.futures import ThreadPoolExecutor
import json
import threading
import time

from generation import answer, UNAVAILABLE
from test_generation import FakeProvider
import test_retrieval


def run_load_check(requests=128):
    if type(requests) is not int or not 1 <= requests <= 1000:
        raise ValueError('invalid load size')
    entered, release, lock = threading.Event(), threading.Event(), threading.Lock()
    active, peak = 0, 0
    class SlowProvider(FakeProvider):
        def generate(self, request, deadline):
            nonlocal active, peak
            with lock:
                active += 1
                peak = max(peak, active)
                if active == 2:
                    entered.set()
            try:
                if not release.wait(5):
                    raise RuntimeError('load fixture release timed out')
                return super().generate(request, deadline)
            finally:
                with lock:
                    active -= 1
    fixture = test_retrieval.RetrievalTests()
    fixture.setUp()
    provider = SlowProvider()
    started = time.monotonic()
    with ThreadPoolExecutor(max_workers=32) as pool:
        first = [pool.submit(answer, fixture.client, provider, fixture.scope, 'synthetic query') for _ in range(2)]
        try:
            if not entered.wait(3):
                raise RuntimeError('generation concurrency fixture did not start')
            overflow = [pool.submit(answer, fixture.client, provider, fixture.scope, 'synthetic query') for _ in range(requests)]
            rejected = [f.result(timeout=3) for f in overflow]
        finally:
            release.set()
        completed = [f.result(timeout=3) for f in first]
    recovery = answer(fixture.client, provider, fixture.scope, 'synthetic query')
    passed = peak == 2 and all(r['status']=='service_unavailable' and r['answer'] == UNAVAILABLE for r in rejected)
    passed = passed and all(r['status']=='answered' for r in completed) and recovery['status']=='answered'
    return {'passed':passed, 'real_provider':False, 'requests':requests+3, 'overload_rejections':len(rejected),
            'peak_provider_concurrency':peak, 'recovered':recovery['status']=='answered',
            'elapsed_ms':(time.monotonic()-started)*1000,
            'limitation':'Synthetic concurrency/failure drill, not provider or production capacity evidence.'}


if __name__ == '__main__':
    result = run_load_check()
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result['passed'] else 1)
