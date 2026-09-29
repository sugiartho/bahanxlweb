"""Smoke tests for storage-backed webui modules (PR-4)."""
from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from webui.storage.backend import (
    SHARED_HOT2,
    USER_DECOY_DIR,
    USER_MONITORING,
    USER_QUOTA_CACHE,
)
from webui.storage.tenant import current_storage_username


class StorageRoutesTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.hot_dir = self.root / "hot_data"
        self.hot_dir.mkdir()
        (self.hot_dir / "hot2.json").write_text('[{"packages":[]}]', encoding="utf-8")

        os.environ["STORAGE_ENCRYPTION_KEY"] = "d" * 64
        os.environ["WEBUI_STORAGE_BACKEND"] = "sqlite"
        os.environ["WEBUI_SQLITE_PATH"] = str(self.root / "webui.db")

        patchers = [
            mock.patch("webui.storage.sqlite_backend.WEBUI_DATA", self.root),
            mock.patch("webui.storage.sqlite_backend.PROJECT_DIR", self.root),
            mock.patch("webui.storage.file_backend.PROJECT_DIR", self.root),
            mock.patch("webui.storage.tenant.USERS_DIR", self.root / "users"),
            mock.patch("webui.storage.tenant.PROJECT_DIR", self.root),
        ]
        for patcher in patchers:
            patcher.start()
            self.addCleanup(patcher.stop)

        from webui.storage import clear_storage_cache
        clear_storage_cache()

    def test_quota_cache_roundtrip(self):
        from webui import quota_cache as QC
        QC.save_cache("alice", {"6281": {"updated_at": 1, "balance": {}, "quotas": []}})
        data = QC.load_cache("alice")
        self.assertIn("6281", data)

    def test_monitoring_rules_roundtrip(self):
        from webui import monitoring as M
        from webui.context import current_user_dir

        udir = self.root / "users" / "bob"
        udir.mkdir(parents=True)
        dir_token = current_user_dir.set(udir)
        user_token = current_storage_username.set("bob")
        self.addCleanup(current_storage_username.reset, user_token)
        self.addCleanup(current_user_dir.reset, dir_token)

        rule = M.add_rule({"name": "test", "msisdn": 628123, "actions": []})
        rules = M.load_rules()
        self.assertEqual(len(rules), 1)
        self.assertEqual(rules[0]["id"], rule["id"])

    def test_shared_hot2_readable(self):
        from webui.storage import get_storage
        raw = get_storage().get_blob(None, SHARED_HOT2)
        self.assertIsNotNone(raw)
        data = json.loads(raw)
        self.assertIsInstance(data, list)


if __name__ == "__main__":
    unittest.main()