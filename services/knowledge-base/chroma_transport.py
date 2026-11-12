"""Transport compatibility adapter for the pinned Chroma 1.4.1 client."""
from functools import wraps

import httpx

TIMEOUT = httpx.Timeout(connect=3, read=10, write=10, pool=3)


def configure_transport():
    import chromadb
    from chromadb.api.fastapi import FastAPI

    if chromadb.__version__ != '1.4.1':
        raise RuntimeError('Revalidate Chroma transport adapter before upgrading')
    original = FastAPI._make_request
    if getattr(original, '_kb_bounded', False):
        return

    @wraps(original)
    def bounded(self, method, path, **kwargs):
        kwargs['timeout'] = TIMEOUT
        return original(self, method, path, **kwargs)

    bounded._kb_bounded = True
    # Chroma exposes no timeout setting; cover startup calls too, without
    # changing HTTPX defaults for other clients or retrying ambiguous writes.
    FastAPI._make_request = bounded
