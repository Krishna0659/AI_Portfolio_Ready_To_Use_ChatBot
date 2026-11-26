import copy
import hashlib
import json
import unittest
from unittest.mock import patch

from indexing import Batch, IndexClient, IndexingError, form_batch, CONTRACT, PREPROCESSING
from preparation import Scope, PIPELINE_VERSION, CHUNKING_VERSION, EXTRACTOR_VERSION


def document(document_id='resume', text='Built a synthetic search system.', **changes):
    scope = Scope('t', 'p', document_id, 1, 1, 'approved-profile', 'Synthetic', 'test-model')
    identity = hashlib.sha256(json.dumps([CHUNKING_VERSION, 'Projects', text], ensure_ascii=False).encode()).hexdigest()
    metadata = {**scope.__dict__, 'chunk_id': f'{document_id}:{identity[:32]}', 'section': 'Projects',
        'content_hash': hashlib.sha256(text.encode()).hexdigest(), 'source_content_hash': 'a' * 64,
        'pipeline_version': PIPELINE_VERSION, 'chunking_version': CHUNKING_VERSION,
        'extractor_version': EXTRACTOR_VERSION, **changes}
    return dict(title='Synthetic', source_content_hash='a' * 64, pipeline_version=PIPELINE_VERSION,
                chunks=[dict(text=text, metadata=metadata)])


def batch(documents=None, **changes):
    options = dict(tenant_id='t', profile_id='p', profile_version=1, generation=1,
                   embedding_model='test-model', approved=True)
    return form_batch(documents or [document()], **{**options, **changes})


def receipt(value, **changes):
    request = json.loads(value.payload)
    return dict(status='ok', tenant_id='t', profile_id='p', generation=1, profile_version=1,
        count=len(request['chunks']), parent_count=len(request['chunks']), snapshot=value.batch_id, embedding_model='test-model',
        contract_version=CONTRACT, preprocessing_version=PREPROCESSING, pipeline_version=PIPELINE_VERSION,
        **changes)


class IndexingTests(unittest.TestCase):
    def setUp(self):
        self.client = IndexClient('http://localhost:8080', 'synthetic-key')
        self.sleep = patch('indexing.time.sleep')
        self.sleep.start()
        self.addCleanup(self.sleep.stop)

    def test_canonical_order_and_payload_immutability(self):
        docs = [document('b'), document('a')]
        first = batch(docs)
        self.assertEqual(first, batch(list(reversed(docs))))
        docs[0]['chunks'][0]['text'] = 'changed'
        self.assertNotIn(b'changed', first.payload)
        self.assertEqual(first.batch_id, hashlib.sha256(first.payload).hexdigest())

    def test_rejects_unapproved_mismatched_tampered_and_oversized(self):
        for docs, options in [([document()], {'approved': False}), ([document(tenant_id='other')], {}),
                ([document(embedding_model='other')], {}), ([document(generation=2)], {}),
                ([document(content_hash='b'*64)], {}), ([document(), document()], {}),
                ([document(pipeline_version='unknown')], {}), ([document()], {'generation': True}),
                ([document(str(i), text='x'*3900) for i in range(250)], {})]:
            with self.subTest(options=options), self.assertRaises(ValueError):
                batch(docs, **options)

    def test_initial_write_and_verified_receipt(self):
        value = batch()
        indexed = receipt(value)
        indexed['status'] = 'indexed'
        with patch.object(self.client, '_request', side_effect=[(404, {}), (200, indexed)]) as send:
            result = self.client.submit(value)
        self.assertEqual(result['status'], 'indexed')
        self.assertEqual(result['writes'], 1)
        self.assertEqual(send.call_args.args[1], value.payload)

    def test_timeout_after_commit_reconciles_without_rewrite(self):
        value = batch()
        with patch.object(self.client, '_request', side_effect=[(404, {}), (0, {}), (200, receipt(value))]) as send:
            result = self.client.submit(value)
        self.assertTrue(result['reconciled'])
        self.assertEqual(result['writes'], 1)
        self.assertEqual(send.call_count, 3)

    def test_timeout_before_commit_exact_replay(self):
        value = batch()
        indexed = receipt(value)
        indexed['status'] = 'indexed'
        pending = dict(status='ok', tenant_id='t', profile_id='p', generation=0,
                       pending=dict(generation=1, snapshot=value.batch_id))
        with patch.object(self.client, '_request', side_effect=[(404, {}), (504, {}), (200, pending), (200, indexed)]) as send:
            self.assertEqual(self.client.submit(value)['writes'], 2)
        writes = [call.args[1] for call in send.call_args_list if call.args[0] == '/v1/index']
        self.assertEqual(writes, [value.payload, value.payload])

    def test_last_timeout_still_reconciles(self):
        self.client.attempts = 1
        value = batch()
        with patch.object(self.client, '_request', side_effect=[(404, {}), (0, {}), (200, receipt(value))]):
            self.assertTrue(self.client.submit(value)['reconciled'])

    def test_no_writes_while_status_unavailable(self):
        with patch.object(self.client, '_request', return_value=(503, {})) as send:
            with self.assertRaisesRegex(IndexingError, 'index_outcome_uncertain'):
                self.client.submit(batch())
        self.assertEqual(send.call_count, 4)
        self.assertTrue(all(call.args[0].startswith('/v1/status?') for call in send.call_args_list))

    def test_stale_purged_conflict_and_corrupt_receipt(self):
        value = batch()
        for changes in [dict(generation=2), dict(purged=True), dict(snapshot='other'), dict(count=2001), dict(parent_count=999),
                        dict(embedding_model='other'), dict(preprocessing_version='other'),
                        dict(tenant_id='other'), dict(pending={'generation': 2}), dict(generation=True)]:
            state = {**receipt(value), **changes}
            with self.subTest(changes=changes), patch.object(self.client, '_request', return_value=(200, state)) as send:
                with self.assertRaises(IndexingError):
                    self.client.submit(value)
                self.assertEqual(send.call_count, 1)

    def test_rejects_bad_restored_batch_before_network(self):
        with patch.object(self.client, '_request') as send:
            with self.assertRaises(IndexingError):
                self.client.submit(Batch(b'{"chunks": []}'))
            send.assert_not_called()

    def test_authorization_failure_is_not_retried(self):
        with patch.object(self.client, '_request', return_value=(403, {})) as send:
            with self.assertRaisesRegex(IndexingError, 'status_rejected'):
                self.client.submit(batch())
            self.assertEqual(send.call_count, 1)

    def test_logs_exclude_source_and_credentials(self):
        value = batch()
        with self.assertLogs('rag.indexing', 'INFO') as logs, patch.object(self.client, '_request', return_value=(200, receipt(value))):
            self.client.submit(value)
        output = ' '.join(logs.output)
        self.assertIn(value.batch_id, output)
        self.assertNotIn('Built a synthetic', output)
        self.assertNotIn('synthetic-key', output)


if __name__ == '__main__':
    unittest.main()
