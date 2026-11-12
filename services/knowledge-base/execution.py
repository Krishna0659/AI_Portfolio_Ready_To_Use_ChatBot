"""Request budgets and a killable, persistent local embedding worker."""
import atexit
import multiprocessing
import threading
import time
import queue
from contextvars import ContextVar
from contextlib import contextmanager

from fastapi import HTTPException

deadline = ContextVar('kb_deadline', default=None)


def remaining(cap=60):
    end = deadline.get()
    seconds = cap if end is None else min(cap, end - time.monotonic())
    if seconds <= 0:
        raise HTTPException(504, 'operation deadline exceeded; check status before retrying')
    return seconds


@contextmanager
def acquire(lock):
    if not lock.acquire(timeout=remaining(5)):
        raise HTTPException(503, 'knowledge base busy', headers={'Retry-After': '1'})
    try:
        remaining()
        yield
    finally:
        lock.release()


def _embed_worker(requests, responses, model_path):
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer(model_path)
    while True:
        texts, options = requests.get()
        try:
            responses.put(('ok', model.encode(texts, **options).tolist()))
        except Exception:
            responses.put(('error', None))


class Vectors(list):
    def tolist(self):
        return list(self)


class EmbeddingWorker:
    def __init__(self, model_path, timeout=45, target=_embed_worker):
        self.model_path, self.timeout, self.target = model_path, timeout, target
        self.process = self.requests = self.responses = None
        self.lock = threading.RLock()
        atexit.register(self.close)

    def close(self):
        if self.process is not None:
            if self.process.is_alive():
                self.process.kill()
            self.process.join(timeout=2)
            self.process.close()
            self.process = None
        for channel in (self.requests, self.responses):
            if channel is not None:
                channel.cancel_join_thread()
                channel.close()
        self.requests = self.responses = None

    def encode(self, texts, **options):
        with acquire(self.lock):
            timeout = remaining(self.timeout)
            start = time.monotonic()
            if self.process is None:
                context = multiprocessing.get_context('spawn')
                self.requests, self.responses = context.Queue(maxsize=1), context.Queue(maxsize=1)
                self.process = context.Process(target=self.target, args=(self.requests, self.responses, self.model_path), daemon=True)
                self.process.start()
            try:
                self.requests.put((texts, options), timeout=max(0, timeout - (time.monotonic() - start)))
                status, vectors = self.responses.get(timeout=max(0, timeout - (time.monotonic() - start)))
                if status != 'ok':
                    raise HTTPException(503, 'embedding worker unavailable')
                return Vectors(vectors)
            except (queue.Empty, queue.Full) as exc:
                self.close()
                raise HTTPException(504, 'embedding deadline exceeded; retry the same payload') from exc
            except (EOFError, BrokenPipeError, OSError) as exc:
                self.close()
                raise HTTPException(503, 'embedding worker unavailable') from exc
            except Exception:
                self.close()
                raise
