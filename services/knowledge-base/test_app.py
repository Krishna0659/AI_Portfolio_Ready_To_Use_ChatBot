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
        self.assertNotIn("tenant-1:profile-1", state)

    def test_query_isolation_and_filtering(self):
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
                {"$and": [{"tenant_id": "t1"}, {"profile_id": "p1"}]},
            )


if __name__ == "__main__":
    unittest.main()
