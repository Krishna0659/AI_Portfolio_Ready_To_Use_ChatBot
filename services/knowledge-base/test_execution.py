import time
import unittest
import threading
from execution import EmbeddingWorker, acquire, deadline, remaining
from fastapi import HTTPException


def stall(requests, responses, model_path):
    requests.get()
    time.sleep(60)


def echo(requests, responses, model_path):
    while True:
        texts, options = requests.get()
        responses.put(('ok', [[float(len(text))] for text in texts]))


class ExecutionTests(unittest.TestCase):
    def test_worker_timeout_kills_then_recovers(self):
        worker = EmbeddingWorker('unused', timeout=0.5, target=stall)
        try:
            start = time.monotonic()
            with self.assertRaises(HTTPException) as failure:
                worker.encode(['hello'])
            self.assertEqual(failure.exception.status_code, 504)
            self.assertLess(time.monotonic() - start, 3)
            self.assertIsNone(worker.process)
            worker.target, worker.timeout = echo, 5
            self.assertEqual(worker.encode(['hello']).tolist(), [[5.0]])
            pid = worker.process.pid
            self.assertEqual(worker.encode(['ok']).tolist(), [[2.0]])
            self.assertEqual(pid, worker.process.pid)
        finally:
            worker.close()

    def test_expired_budget_and_lock_queue_are_bounded(self):
        token = deadline.set(time.monotonic() - 1)
        try:
            with self.assertRaises(HTTPException) as failure:
                remaining()
            self.assertEqual(failure.exception.status_code, 504)
        finally:
            deadline.reset(token)
        lock = threading.Lock()
        lock.acquire()
        token = deadline.set(time.monotonic() + 0.02)
        try:
            with self.assertRaises(HTTPException):
                with acquire(lock):
                    self.fail('locked operation admitted')
        finally:
            deadline.reset(token)
            lock.release()
