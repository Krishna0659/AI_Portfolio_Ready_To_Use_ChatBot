"""Run separately from mocked app tests, against the installed Chroma SDK."""
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

try:
    import chromadb
    import httpx
    from chromadb.api.fastapi import FastAPI
    from chroma_transport import configure_transport, TIMEOUT
    CHROMA_INSTALLED = True
except ImportError:
    CHROMA_INSTALLED = False


@unittest.skipUnless(CHROMA_INSTALLED, "chromadb library not installed in local host Python environment")
class TransportTests(unittest.TestCase):
    def test_timeout_applies_to_every_request_and_installs_once(self):
        configure_transport()
        method = FastAPI._make_request
        configure_transport()
        self.assertIs(method, FastAPI._make_request)
        seen = []

        def respond(request):
            seen.append(request.extensions['timeout'])
            return httpx.Response(200, json={})

        api = object.__new__(FastAPI)
        api._api_url = 'http://chroma/api/v2'
        with httpx.Client(transport=httpx.MockTransport(respond), timeout=None) as session:
            api._session = session
            api._make_request('POST', '/test', json={'ids': ['one']})
        self.assertEqual(seen, [TIMEOUT.as_dict()])

    def test_stalled_initial_connection_times_out(self):
        class Stall(BaseHTTPRequestHandler):
            def do_GET(self):
                time.sleep(0.3)

            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(('127.0.0.1', 0), Stall)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            configure_transport()
            start = time.monotonic()
            with patch('chroma_transport.TIMEOUT', httpx.Timeout(0.05)):
                with self.assertRaises(ValueError) as failure:
                    chromadb.HttpClient(host='127.0.0.1', port=server.server_port)
                self.assertIsInstance(failure.exception.__context__, httpx.ReadTimeout)
            self.assertLess(time.monotonic() - start, 2)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
