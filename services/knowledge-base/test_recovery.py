import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import test_app

app = test_app.app


class RecoveryTests(unittest.TestCase):
    def test_low_disk_rejects_before_embedding_or_write(self):
        request = app.IndexRequest(tenant_id='t', profile_id='p', generation=1, profile_version=1,
                                  facts=[app.Fact(fact_id='f', section='skills', text='Python')])
        with patch.object(app, 'load_state', return_value={}), patch.object(app.shutil, 'disk_usage', return_value=SimpleNamespace(free=1)), patch.object(app, 'resources') as resources, patch.object(app, 'save_state') as save:
            with self.assertRaises(app.HTTPException) as failure:
                app.index(request)
            self.assertEqual(failure.exception.status_code, 507)
            resources.assert_not_called()
            save.assert_not_called()

    def test_both_volumes_checked_and_unreadable_volume_fails_closed(self):
        with patch.dict(app.os.environ, {'KB_CHROMA_DATA_DIR': '/chroma-storage'}), patch.object(app.shutil, 'disk_usage', side_effect=[SimpleNamespace(free=1024**3), SimpleNamespace(free=1)]) as usage:
            with self.assertRaises(app.HTTPException) as failure:
                app.check_disk_space()
            self.assertEqual(failure.exception.status_code, 507)
            self.assertEqual(usage.call_count, 2)
        with patch.object(app.shutil, 'disk_usage', side_effect=OSError('unavailable')):
            with self.assertRaises(app.HTTPException) as failure:
                app.check_disk_space()
            self.assertEqual(failure.exception.status_code, 503)

    def test_reconcile_preserves_active_and_scopes_deletes(self):
        col = MagicMock()
        col.get.side_effect = [
            {'ids': ['active', 'orphan'], 'metadatas': [{'snapshot': 's'}, {'snapshot': 'staged'}]},
            {'ids': [], 'metadatas': []}]
        with patch.object(app, 'load_state', return_value={'t:p': {'snapshot': 's', 'generation': 1}}), patch.object(app, 'resources', return_value=(col, None)), patch.object(app, 'save_state') as save:
            self.assertFalse(app.reconcile(app.ReconcileRequest(tenant_id='t', profile_id='p'))['cleanup_pending'])
            col.delete.assert_called_once_with(ids=['orphan'])
            save.assert_not_called()
            self.assertEqual(col.get.call_args.kwargs['where'], {'$and': [{'tenant_id': 't'}, {'profile_id': 'p'}]})

    def test_missing_state_never_deletes_and_purge_retries_without_disk_check(self):
        req = app.ReconcileRequest(tenant_id='t', profile_id='p')
        col = MagicMock()
        with patch.object(app, 'load_state', return_value={}), patch.object(app, 'resources') as resources:
            with self.assertRaises(app.HTTPException):
                app.reconcile(req)
            resources.assert_not_called()
        with patch.object(app, 'load_state', return_value={'t:p': {'purged': True}}), patch.object(app, 'resources', return_value=(col, None)), patch.object(app, 'check_disk_space') as disk:
            app.reconcile(req)
            col.delete.assert_called_once_with(where={'$and': [{'tenant_id': 't'}, {'profile_id': 'p'}]})
            disk.assert_not_called()

    def test_legacy_generation_and_bounded_scan(self):
        col = MagicMock()
        col.get.side_effect = [
            {'ids': ['old-active', 'orphan'], 'metadatas': [{'generation': 1}, {'generation': 2}]},
            {'ids': [], 'metadatas': []}]
        self.assertFalse(app.cleanup_snapshots(col, 't', 'p', None, 1))
        col.delete.assert_called_once_with(ids=['orphan'])
        col = MagicMock()
        col.get.return_value = {'ids': ['keep'], 'metadatas': [{'snapshot': 's'}]}
        self.assertTrue(app.cleanup_snapshots(col, 't', 'p', 's'))
        self.assertEqual(col.get.call_count, 50)
        col.delete.assert_not_called()
