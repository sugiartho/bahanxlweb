"""Integration tests for Auth/Bookmark via storage tenant (PR-2)."""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from webui.storage.backend import USER_BOOKMARK, USER_REFRESH_TOKENS
from webui.storage.tenant import current_storage_username


class StorageServiceTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.users = self.root / "users"
        self.patchers = [
            mock.patch("webui.storage.file_backend.WEBUI_DATA", self.root),
            mock.patch("webui.storage.file_backend.USERS_DIR", self.users),
            mock.patch("webui.storage.file_backend.PROJECT_DIR", self.root),
            mock.patch("webui.storage.tenant.USERS_DIR", self.users),
            mock.patch("webui.storage.tenant.PROJECT_DIR", self.root),
            mock.patch("webui.users.WEBUI_DATA", self.root),
            mock.patch("webui.users.USERS_DIR", self.users),
            mock.patch("webui.users.PROJECT_DIR", self.root),
        ]
        for patcher in self.patchers:
            patcher.start()
            self.addCleanup(patcher.stop)
        os.environ["STORAGE_ENCRYPTION_KEY"] = "b" * 64
        os.environ.setdefault("BASE_CIAM_URL", "https://example.test/ciam")
        os.environ.setdefault("BASE_API_URL", "https://example.test/api")
        os.environ.setdefault("BASIC_AUTH", "test")
        os.environ.setdefault("UA", "test")
        from webui.storage import clear_storage_cache
        clear_storage_cache()

    def _bind_user(self, username: str):
        from webui.users import user_dir
        from webui.context import current_user_dir

        udir = user_dir(username)
        udir.mkdir(parents=True, exist_ok=True)
        self.dir_token = current_user_dir.set(udir)
        self.user_token = current_storage_username.set(username)
        self.addCleanup(current_storage_username.reset, self.user_token)
        self.addCleanup(current_user_dir.reset, self.dir_token)

    def test_auth_persists_tokens_via_storage(self):
        from app.service.auth import AuthInstance

        self._bind_user("alice")
        AuthInstance.refresh_tokens = [
            {"number": 628111, "subscriber_id": "s1", "subscription_type": "PREPAID", "refresh_token": "rt"}
        ]
        AuthInstance.write_tokens_to_file()

        AuthInstance.refresh_tokens = []
        AuthInstance.reload_for_current_dir()
        self.assertEqual(len(AuthInstance.refresh_tokens), 1)
        self.assertEqual(AuthInstance.refresh_tokens[0]["number"], 628111)

    def test_bookmark_roundtrip_via_storage(self):
        from app.service.bookmark import BookmarkInstance

        self._bind_user("bob")
        BookmarkInstance.packages = []
        ok = BookmarkInstance.add_bookmark("fam", "Family", False, "var", "opt", 1, "CODE1")
        self.assertTrue(ok)

        BookmarkInstance.packages = []
        BookmarkInstance.reload_for_current_dir()
        self.assertEqual(len(BookmarkInstance.packages), 1)
        self.assertEqual(BookmarkInstance.packages[0]["family_code"], "fam")


if __name__ == "__main__":
    unittest.main()