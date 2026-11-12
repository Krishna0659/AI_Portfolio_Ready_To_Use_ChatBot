import sys
import unittest
from unittest.mock import MagicMock, patch
from pathlib import Path
import tempfile
import json

# Ensure services/knowledge-base is first in sys.path
kb_dir = Path(__file__).resolve().parent
if str(kb_dir) not in sys.path:
    sys.path.insert(0, str(kb_dir))

# Mock chromadb and sentence_transformers before app import
sys.modules.setdefault("chromadb", MagicMock())
sys.modules.setdefault("sentence_transformers", MagicMock())

# Remove any root 'app' from sys.modules if imported as a namespace
if "app" in sys.modules and not hasattr(sys.modules["app"], "DATA_DIR"):
    del sys.modules["app"]

import app


class KnowledgeBaseTests(unittest.TestCase):
    def test_failed_collection_initialization_can_retry(self):
        sdk = MagicMock()
        sdk.get_or_create_collection.side_effect = [app.httpx.ReadTimeout('stall'), 'collection']
        with patch.object(app, 'client', None), patch.object(app, 'collection', None), patch.object(app, 'embedder', 'model'), patch.object(app, 'configure_transport'), patch.object(app.chromadb, 'HttpClient', return_value=sdk) as create:
            with self.assertRaises(app.httpx.ReadTimeout):
                app.resources()
            self.assertEqual(app.resources(), ('collection', 'model'))
            create.assert_called_once()

    def test_hybrid_uses_same_active_scope_for_both_searches(self):
        app.save_state({'t:p': {'generation': 2, 'snapshot': 'active'}})
        col, model = MagicMock(), MagicMock()
        model.encode.return_value.tolist.return_value = [[1.0]]
        meta = {'section': 'skills', 'fact_id': 'f'}
        col.query.return_value = {'ids': [['f']], 'documents': [['Python']], 'metadatas': [[meta]], 'distances': [[0.1]]}
        col.get.return_value = {'ids': ['f'], 'documents': ['Python'], 'metadatas': [meta]}
        with patch.object(app, 'resources', return_value=(col, model)):
            result = app.query(app.QueryRequest(tenant_id='t', profile_id='p', query='Python', mode='hybrid'))
        self.assertEqual(result['results'][0]['text'], 'Python')
        self.assertEqual(col.query.call_args.kwargs['where'], col.get.call_args.kwargs['where'])
        self.assertEqual(col.get.call_args.kwargs['where'], {'$and': [{'tenant_id': 't'}, {'profile_id': 'p'}, {'snapshot': 'active'}]})

    def test_cleanup_keeps_active_and_scopes_every_page(self):
        col = MagicMock()
        col.get.side_effect = [
            {'ids': ['old', 'current'], 'metadatas': [{'snapshot': 'old'}, {'snapshot': 'active'}]},
            {'ids': ['legacy'], 'metadatas': [{}]},
            {'ids': [], 'metadatas': []}]
        app.cleanup_snapshots(col, 'tenant-a', 'profile-a', 'active')
        self.assertEqual([call.kwargs['ids'] for call in col.delete.call_args_list], [['old'], ['legacy']])
        self.assertEqual([call.kwargs['offset'] for call in col.get.call_args_list], [0, 1, 1])
        for call in col.get.call_args_list:
            self.assertEqual(call.kwargs['where'], {'$and': [{'tenant_id': 'tenant-a'}, {'profile_id': 'profile-a'}]})

    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.orig_data_dir = app.DATA_DIR
        self.orig_state_path = app.STATE_PATH
        self.orig_api_key = app.API_KEY

        app.DATA_DIR = Path(self.tmp_dir.name)
        app.STATE_PATH = app.DATA_DIR / "index-state.json"
        app.API_KEY = "test-secret-kb-key-12345"

    def tearDown(self):
        app.DATA_DIR = self.orig_data_dir
        app.STATE_PATH = self.orig_state_path
        app.API_KEY = self.orig_api_key
        self.tmp_dir.cleanup()

    def test_require_key_enforces_auth(self):
        # Missing key -> 401
        with self.assertRaises(app.HTTPException) as ctx:
            app.require_key(None)
        self.assertEqual(ctx.exception.status_code, 401)

        # Wrong key -> 401
        with self.assertRaises(app.HTTPException) as ctx:
            app.require_key("wrong-key")
        self.assertEqual(ctx.exception.status_code, 401)

        # Insecure default "change-me" -> 401 even if supplied
        app.API_KEY = "change-me"
        with self.assertRaises(app.HTTPException) as ctx:
            app.require_key("change-me")
        self.assertEqual(ctx.exception.status_code, 401)
        app.API_KEY = "test-secret-kb-key-12345"

        # Valid key -> succeeds without exception
        app.require_key("test-secret-kb-key-12345")

    def test_index_request_validation(self):
        req = app.IndexRequest(
            tenant_id="tenant-1",
            profile_id="profile-1",
            profile_version=1,
            generation=1,
            facts=[
                app.Fact(section="Experience", text="Led team", fact_id="fact-1"),
                app.Fact(section="Skills", text="TypeScript", fact_id="fact-2"),
            ],
        )
        self.assertEqual(req.profile_version, 1)
        self.assertEqual(len(req.facts), 2)

        # Duplicate fact_id must be rejected
        with self.assertRaises(ValueError):
            app.IndexRequest(
                tenant_id="tenant-1",
                profile_id="profile-1",
                profile_version=1,
                generation=1,
                facts=[
                    app.Fact(section="Experience", text="Text A", fact_id="dup-1"),
                    app.Fact(section="Skills", text="Text B", fact_id="dup-1"),
                ],
            )

    def test_generation_fencing_index(self):
        mock_col = MagicMock()
        mock_model = MagicMock()
        mock_col.get.return_value = {"ids": ["f2"]}
        mock_model.encode.return_value = MagicMock(tolist=lambda: [[0.1, 0.2]])

        # Prepopulate state with generation 5
        app.save_state({"tenant-1:profile-1": {"profile_version": 2, "generation": 5, "count": 1}})

        # Attempt to index older generation 4 -> 409 Conflict
        req_stale = app.IndexRequest(
            tenant_id="tenant-1",
            profile_id="profile-1",
            profile_version=1,
            generation=4,
            facts=[app.Fact(section="Exp", text="Stale", fact_id="f1")],
        )

        with patch.object(app, "resources", return_value=(mock_col, mock_model)):
            with self.assertRaises(app.HTTPException) as ctx:
                app.index(req_stale)
            self.assertEqual(ctx.exception.status_code, 409)
            self.assertIn("stale profile generation", ctx.exception.detail)

        # Attempt to index newer generation 6 -> succeeds and updates state
        req_fresh = app.IndexRequest(
            tenant_id="tenant-1",
            profile_id="profile-1",
            profile_version=3,
            generation=6,
            facts=[app.Fact(section="Exp", text="Fresh", fact_id="f2")],
        )
        with patch.object(app, "resources", return_value=(mock_col, mock_model)):
            res = app.index(req_fresh)
            self.assertEqual(res["status"], "indexed")
            self.assertEqual(res["generation"], 6)

        state = app.load_state()
        self.assertEqual(state["tenant-1:profile-1"]["generation"], 6)

    def test_generation_fencing_purge(self):
        mock_col = MagicMock()
        app.save_state({"tenant-1:profile-1": {"profile_version": 2, "generation": 5, "count": 1}})

        # Attempt to purge with older generation 4 -> 409 Conflict
        req_stale = app.PurgeRequest(tenant_id="tenant-1", profile_id="profile-1", generation=4)
        with patch.object(app, "resources", return_value=(mock_col, None)):
            with self.assertRaises(app.HTTPException) as ctx:
                app.purge(req_stale)
            self.assertEqual(ctx.exception.status_code, 409)
            self.assertIn("stale purge generation", ctx.exception.detail)

        # Attempt to purge with newer generation 6 -> succeeds and removes from state
        req_fresh = app.PurgeRequest(tenant_id="tenant-1", profile_id="profile-1", generation=6)
        with patch.object(app, "resources", return_value=(mock_col, None)):
            res = app.purge(req_fresh)
            self.assertEqual(res["status"], "purged")

        state = app.load_state()
        self.assertTrue(state["tenant-1:profile-1"]["purged"])
        replay = app.IndexRequest(tenant_id="tenant-1", profile_id="profile-1", profile_version=2, generation=5,
            facts=[app.Fact(section="Exp", text="Deleted", fact_id="f1")])
        with self.assertRaises(app.HTTPException) as ctx:
            app.index(replay)
        self.assertEqual(ctx.exception.status_code, 409)

    def test_query_isolation_and_filtering(self):
        app.save_state({"t1:p1": {"generation": 1, "snapshot": "active"}})
        mock_col = MagicMock()
        mock_model = MagicMock()
        mock_model.encode.return_value = MagicMock(tolist=lambda: [[0.5, 0.5]])

        mock_col.query.return_value = {
            "documents": [["Document text"]],
            "metadatas": [[{"tenant_id": "t1", "profile_id": "p1", "section": "Exp"}]],
            "distances": [[0.05]],
        }

        with patch.object(app, "resources", return_value=(mock_col, mock_model)):
            req = app.QueryRequest(tenant_id="t1", profile_id="p1", query="test query", top_k=3)
            res = app.query(req)
            self.assertEqual(len(res["results"]), 1)
            self.assertEqual(res["results"][0]["text"], "Document text")

            # Verify tenant_id and profile_id where clause was passed to chromadb
            mock_col.query.assert_called_once()
            _, kwargs = mock_col.query.call_args
            self.assertEqual(
                kwargs["where"],
                {"$and": [{"tenant_id": "t1"}, {"profile_id": "p1"}, {"snapshot": "active"}]},
            )

    def test_failed_stage_preserves_active_and_conflicting_replay(self):
        col, model = MagicMock(), MagicMock()
        model.encode.return_value.tolist.return_value = [[0.1, 0.2]]
        col.get.return_value = {"ids": ["f1"]}
        req = app.IndexRequest(tenant_id="t", profile_id="p", profile_version=1, generation=1,
            facts=[app.Fact(section="skills", text="Python", fact_id="f1")])
        with patch.object(app, "resources", return_value=(col, model)):
            app.index(req)
            original = app.load_state()
            app.index(req)
            self.assertEqual(col.upsert.call_count, 1)
            changed = req.model_copy(update={"facts": [app.Fact(section="skills", text="Java", fact_id="f1")]})
            with self.assertRaises(app.HTTPException):
                app.index(changed)
            col.upsert.side_effect = RuntimeError("interrupted write")
            with self.assertRaises(RuntimeError):
                app.index(req.model_copy(update={"generation": 2, "profile_version": 2}))
            self.assertEqual(app.load_state(), original)
            col.delete.assert_not_called()

    def test_failed_purge_withdraws_queries(self):
        app.save_state({"t:p": {"generation": 1, "profile_version": 1}})
        col = MagicMock()
        col.delete.side_effect = RuntimeError("offline")
        with patch.object(app, "resources", return_value=(col, None)):
            with self.assertRaises(RuntimeError):
                app.purge(app.PurgeRequest(tenant_id="t", profile_id="p", generation=2))
            self.assertEqual(app.query(app.QueryRequest(tenant_id="t", profile_id="p", query="skills")), {"results": []})


    def test_status_endpoint(self):
        with self.assertRaises(app.HTTPException) as ctx:
            app.status(tenant_id="unknown-t", profile_id="unknown-p")
        self.assertEqual(ctx.exception.status_code, 404)

        app.save_state({"t1:p1": {"profile_version": 2, "generation": 4, "count": 10, "snapshot": "snap123"}})
        res = app.status(tenant_id="t1", profile_id="p1")
        self.assertEqual(res["status"], "ok")
        self.assertEqual(res["tenant_id"], "t1")
        self.assertEqual(res["profile_id"], "p1")
        self.assertEqual(res["generation"], 4)
        self.assertEqual(res["count"], 10)


if __name__ == "__main__":
    unittest.main()
