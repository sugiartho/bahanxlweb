"""Smoke tests for webui.storage (PR-1)."""
from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from webui.storage.backend import USER_REFRESH_TOKENS, is_encrypted_key
from webui.storage.crypto import decrypt_text, encrypt_text, is_encrypted, resolve_encryption_key
from webui.storage.file_backend import FileBackend


class StorageCryptoTests(unittest.TestCase):
    def test_roundtrip_aes_gcm(self):
        key = resolve_encryption_key(explicit="test-key-for-unit-tests-only")
        raw = encrypt_text('{"refresh_token":"abc"}', key)
        self.assertTrue(is_encrypted(raw))
        self.assertEqual(decrypt_text(raw, key), '{"refresh_token":"abc"}')

    def test_sensitive_key_detection(self):
        self.assertTrue(is_encrypted_key(USER_REFRESH_TOKENS))
        self.assertTrue(is_encrypted_key("decoy_data/decoy-default-balance.json"))
        self.assertFalse(is_encrypted_key("shared/hot.json"))


class FileBackendTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.users = self.root / "users"
        self.patchers = [
            mock.patch("webui.storage.file_backend.WEBUI_DATA", self.root),
            mock.patch("webui.storage.file_backend.USERS_DIR", self.users),
            mock.patch("webui.storage.file_backend.PROJECT_DIR", self.root),
        ]
        for patcher in self.patchers:
            patcher.start()
            self.addCleanup(patcher.stop)
        os.environ["STORAGE_ENCRYPTION_KEY"] = "a" * 64
        self.backend = FileBackend(encrypt_at_rest=True)

    def test_user_blob_encrypts_on_disk(self):
        self.backend.put_blob("alice", USER_REFRESH_TOKENS, "[]")
        path = self.backend.resolve_user_path("alice", USER_REFRESH_TOKENS)
        on_disk = path.read_bytes()
        self.assertTrue(is_encrypted(on_disk))
        self.assertEqual(self.backend.get_blob("alice", USER_REFRESH_TOKENS), "[]")

    def test_legacy_plaintext_read_still_works(self):
        path = self.backend.resolve_user_path("bob", USER_REFRESH_TOKENS)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("[]", encoding="utf-8")
        self.assertEqual(self.backend.get_blob("bob", USER_REFRESH_TOKENS), "[]")

    def test_users_registry_roundtrip(self):
        users = [{"username": "alice", "password_hash": "x", "created_at": 1}]
        self.backend.save_users(users)
        self.assertEqual(self.backend.load_users(), users)


if __name__ == "__main__":
    unittest.main()