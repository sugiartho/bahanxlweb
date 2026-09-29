"""Tests for SQLite storage backend (PR-3)."""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from webui.storage import clear_storage_cache
from webui.storage.backend import USER_BOOKMARK, USER_REFRESH_TOKENS
from webui.storage.crypto import is_encrypted
from webui.storage.sqlite_backend import SQLiteBackend, init_db
from webui.storage.tenant import current_storage_username


class SQLiteBackendTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.db_path = self.root / "webui.db"
        os.environ["STORAGE_ENCRYPTION_KEY"] = "c" * 64
        os.environ["WEBUI_STORAGE_BACKEND"] = "sqlite"
        os.environ["WEBUI_SQLITE_PATH"] = str(self.db_path)
        os.environ.setdefault("BASE_CIAM_URL", "https://example.test/ciam")
        os.environ.setdefault("BASE_API_URL", "https://example.test/api")
        os.environ.setdefault("BASIC_AUTH", "test")
        os.environ.setdefault("UA", "test")
        clear_storage_cache()

        patchers = [
            mock.patch("webui.storage.sqlite_backend.WEBUI_DATA", self.root),
            mock.patch("webui.storage.sqlite_backend.PROJECT_DIR", self.root),
            mock.patch("webui.storage.tenant.USERS_DIR", self.root / "users"),
            mock.patch("webui.storage.tenant.PROJECT_DIR", self.root),
            mock.patch("webui.users.WEBUI_DATA", self.root),
            mock.patch("webui.users.USERS_DIR", self.root / "users"),
            mock.patch("webui.users.PROJECT_DIR", self.root),
        ]
        for patcher in patchers:
            patcher.start()
            self.addCleanup(patcher.stop)

        init_db(self.db_path)
        self.backend = SQLiteBackend(self.db_path, encrypt_at_rest=True)

    def test_users_roundtrip(self):
        users = [
            {
                "username": "alice",
                "password_hash": "pbkdf2_sha256$200000$abc$def",
                "created_at": 1710000000,
                "theme": "light",
            }
        ]
        self.backend.save_users(users)
        loaded = self.backend.load_users()
        self.assertEqual(len(loaded), 1)
        self.assertEqual(loaded[0]["username"], "alice")
        self.assertEqual(loaded[0]["theme"], "light")

    def test_user_blob_encrypted_in_db(self):
        self.backend.put_blob("alice", USER_REFRESH_TOKENS, "[]")
        with self.backend._connect() as conn:
            row = conn.execute(
                "SELECT data FROM blobs WHERE scope='user' AND username='alice' AND object_key=?",
                (USER_REFRESH_TOKENS,),
            ).fetchone()
        self.assertIsNotNone(row)
        self.assertTrue(is_encrypted(bytes(row[0])))
        self.assertEqual(self.backend.get_blob("alice", USER_REFRESH_TOKENS), "[]")

    def test_get_storage_factory(self):
        from webui.storage import get_storage
        backend = get_storage()
        self.assertIsInstance(backend, SQLiteBackend)

    def test_auth_via_sqlite_storage(self):
        from app.service.auth import AuthInstance

        os.environ.setdefault("BASE_CIAM_URL", "https://example.test/ciam")
        os.environ.setdefault("BASE_API_URL", "https://example.test/api")
        os.environ.setdefault("BASIC_AUTH", "test")
        os.environ.setdefault("UA", "test")

        token = current_storage_username.set("bob")
        self.addCleanup(current_storage_username.reset, token)
        AuthInstance.refresh_tokens = [
            {"number": 628222, "subscriber_id": "s", "subscription_type": "PREPAID", "refresh_token": "x"}
        ]
        AuthInstance.write_tokens_to_file()
        AuthInstance.refresh_tokens = []
        AuthInstance.reload_for_current_dir()
        self.assertEqual(len(AuthInstance.refresh_tokens), 1)


if __name__ == "__main__":
    unittest.main()