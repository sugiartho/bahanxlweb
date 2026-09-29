"""Filesystem storage backend — mirrors current webui_data/ layout."""
from __future__ import annotations

import json
import os
import secrets
from pathlib import Path
from typing import Optional

from webui.storage.backend import (
    GLOBAL_SESSION_SECRET,
    GLOBAL_TELEGRAM_CONFIG,
    GLOBAL_USERS_REGISTRY,
    USER_REFRESH_TOKENS,
    StorageBackend,
    is_encrypted_key,
    normalize_blob_key,
)
from webui.storage.tenant import resolve_effective_root
from webui.storage.crypto import decrypt_bytes, encrypt_bytes, resolve_encryption_key
from webui.users import PROJECT_DIR, USERS_DIR, WEBUI_DATA

_SHARED_ROOT = PROJECT_DIR / "hot_data"


class FileBackend(StorageBackend):
    def __init__(self, *, encrypt_at_rest: bool = True) -> None:
        self._data_root = WEBUI_DATA
        self._users_root = USERS_DIR
        self._encrypt_at_rest = encrypt_at_rest
        self._ensure_dirs()

    def _ensure_dirs(self) -> None:
        self._data_root.mkdir(parents=True, exist_ok=True)
        self._users_root.mkdir(parents=True, exist_ok=True)

    def _encryption_key(self) -> bytes:
        return resolve_encryption_key(session_secret=self.get_session_secret())

    def _path_for(self, username: Optional[str], key: str) -> Path:
        normalized = normalize_blob_key(key)
        if normalized.startswith("shared/"):
            return _SHARED_ROOT / normalized.removeprefix("shared/")
        root = resolve_effective_root(username, normalized)
        return root / normalized

    def _read_raw(self, path: Path) -> bytes | None:
        if not path.exists() or not path.is_file():
            return None
        return path.read_bytes()

    def _write_raw(self, path: Path, payload: bytes) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_bytes(payload)
        os.replace(tmp, path)

    def _maybe_decrypt(self, key: str, raw: bytes) -> bytes:
        if not self._encrypt_at_rest or not is_encrypted_key(key):
            return raw
        try:
            return decrypt_bytes(raw, self._encryption_key())
        except Exception:
            return raw

    def _maybe_encrypt(self, key: str, raw: bytes) -> bytes:
        if not self._encrypt_at_rest or not is_encrypted_key(key):
            return raw
        return encrypt_bytes(raw, self._encryption_key())

    def load_users(self) -> list[dict]:
        path = self._data_root / GLOBAL_USERS_REGISTRY
        if not path.exists():
            return []
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, list) else []
        except Exception:
            return []

    def save_users(self, users: list[dict]) -> None:
        path = self._data_root / GLOBAL_USERS_REGISTRY
        tmp = path.with_suffix(".json.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(users, f, indent=2)
        os.replace(tmp, path)

    def get_session_secret(self) -> bytes:
        path = self._data_root / GLOBAL_SESSION_SECRET
        if path.exists():
            return path.read_bytes()
        secret = secrets.token_bytes(32)
        path.write_bytes(secret)
        try:
            os.chmod(path, 0o600)
        except Exception:
            pass
        return secret

    def ensure_user_dir(self, username: str) -> None:
        (self._users_root / username).mkdir(parents=True, exist_ok=True)

    def get_blob(self, username: Optional[str], key: str, *, binary: bool = False) -> str | bytes | None:
        path = self._path_for(username, key)
        raw = self._read_raw(path)
        if raw is None:
            return None
        plain = self._maybe_decrypt(normalize_blob_key(key), raw)
        if binary:
            return plain
        return plain.decode("utf-8")

    def put_blob(
        self,
        username: Optional[str],
        key: str,
        data: str | bytes,
        *,
        binary: bool = False,
    ) -> None:
        normalized = normalize_blob_key(key)
        payload = data if isinstance(data, (bytes, bytearray)) else data.encode("utf-8")
        stored = self._maybe_encrypt(normalized, bytes(payload))
        self._write_raw(self._path_for(username, normalized), stored)

    def delete_blob(self, username: Optional[str], key: str) -> None:
        path = self._path_for(username, key)
        if path.exists():
            path.unlink()

    def blob_exists(self, username: Optional[str], key: str) -> bool:
        return self._path_for(username, key).is_file()

    def list_blobs(self, username: Optional[str], prefix: str = "") -> list[str]:
        normalized_prefix = normalize_blob_key(prefix)
        if normalized_prefix.startswith("shared/"):
            root = _SHARED_ROOT
            normalized_prefix = normalized_prefix.removeprefix("shared/")
        else:
            root = resolve_effective_root(username, normalized_prefix or USER_REFRESH_TOKENS)
        if not root.exists():
            return []
        if normalized_prefix and not normalized_prefix.endswith("/"):
            search = root / normalized_prefix
            if search.is_file():
                rel = search.relative_to(root).as_posix()
                if root == _SHARED_ROOT:
                    return [f"shared/{rel}"]
                return [rel]
        base = root / normalized_prefix if normalized_prefix else root
        if not base.exists():
            return []
        results: list[str] = []
        for path in sorted(base.rglob("*")):
            if not path.is_file():
                continue
            rel = path.relative_to(root).as_posix()
            if root == _SHARED_ROOT:
                results.append(f"shared/{rel}")
            else:
                results.append(rel)
        return results

    def resolve_user_path(self, username: str, key: str = "") -> Path:
        root = self._users_root / username
        if key:
            return self._path_for(username, key)
        return root

    def resolve_global_path(self, key: str = "") -> Path:
        if key:
            return self._path_for(None, key)
        return self._data_root