import asyncio
import unittest
import test_app

class LimitTests(unittest.IsolatedAsyncioTestCase):
    async def test_response_deadline_returns_504_and_releases_capacity(self):
        async def downstream(scope, receive, send):
            await asyncio.sleep(10)
        limiter = test_app.app.BodyLimit(downstream)
        limiter.request_timeout = 0.01
        async def receive(): return {'type': 'http.request', 'body': b''}
        messages = []
        async def send(message): messages.append(message)
        await limiter({'type': 'http'}, receive, send)
        self.assertEqual(messages[0]['status'], 504)
        self.assertEqual(limiter.active, 0)

    async def test_timeout_releases_capacity(self):
        async def downstream(scope, receive, send):
            await send({'type': 'http.response.start', 'status': 200})
        limiter = test_app.app.BodyLimit(downstream)
        limiter.body_timeout = 0.01
        messages = []
        async def send(message): messages.append(message)
        async def slow(): await asyncio.sleep(1)
        await limiter({'type': 'http'}, slow, send)
        self.assertEqual(messages[0]['status'], 408)
        self.assertEqual(limiter.active, 0)
        messages.clear()
        async def ready(): return {'type': 'http.request', 'body': b'', 'more_body': False}
        await limiter({'type': 'http'}, ready, send)
        self.assertEqual(messages[0]['status'], 200)

    async def test_concurrent_overload_rejects_and_recovers(self):
        entered, release = asyncio.Event(), asyncio.Event()
        async def downstream(scope, receive, send):
            entered.set()
            await release.wait()
        limiter = test_app.app.BodyLimit(downstream)
        limiter.max_active = 1
        async def receive(): return {'type': 'http.request', 'body': b''}
        messages = []
        async def send(message): messages.append(message)
        task = asyncio.create_task(limiter({'type': 'http'}, receive, send))
        await entered.wait()
        await limiter({'type': 'http'}, receive, send)
        self.assertEqual(messages[0]['status'], 503)
        release.set()
        await task
        self.assertEqual(limiter.active, 0)
