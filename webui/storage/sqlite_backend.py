"""SQLite storage backend for portable dev (Codespaces)."""
from __future__ import annotations

import os
import secrets
import sqlite3
import threading
import time
from pathlib import Path
from typing import Optional

from webui.storage.backend import (
    GLOBAL_DATA_KEYS,
    GLOBAL_SESSION_SECRET,
    GLOBAL_USERS_REGISTRY,
    USER_REFRESH_TOKENS,
    StorageBackend,
    is_encrypted_key,
    normalize_blob_key,
)
from webui.storage.crypto import decrypt_bytes, encrypt_bytes, resolve_encryption_key
from webui.users import PROJECT_DIR, WEBUI_DATA

_SCHEMA_VERSION = 1
_SHARED_ROOT = PROJECT_DIR / "hot_data"


def default_db_path() -> Path:
    override = os.getenv("WEBUI_SQLITE_PATH", "").strip()
    if override:
        return Path(override)
    return WEBUI_DATA / "webui.db"


def init_db(db_path: Path | None = None) -> Path:
    path = db_path or default_db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    schema_file = Path(__file__).resolve().parent / "schema.sql"
    schema_sql = schema_file.read_text(encoding="utf-8")
    with sqlite3.connect(path) as conn:
        conn.executescript(schema_sql)
        row = conn.execute("SELECT version FROM schema_version WHERE id = 1").fetchone()
        if row is None:
            conn.execute(
                "INSERT INTO schema_version (id, version, applied_at) VALUES (1, ?, ?)",
                (_SCHEMA_VERSION, int(time.time())),
            )
        conn.commit()
    return path


class SQLiteBackend(StorageBackend):
    def __init__(self, db_path: Path | None = None, *, encrypt_at_rest: bool = True) -> None:
        self._db_path = init_db(db_path)
        self._encrypt_at_rest = encrypt_at_rest
        self._lock = threading.RLock()
        self._shadow_root = WEBUI_DATA / "sqlite_shadow"

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def _encryption_key(self) -> bytes:
        return resolve_encryption_key(session_secret=self.get_session_secret())

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

    def _blob_location(self, username: Optional[str], key: str) -> tuple[str, str, str] | None:
        """Return (scope, username, object_key) or None when stored on filesystem (shared/)."""
        normalized = normalize_blob_key(key)
        if normalized.startswith("shared/"):
            return None
        if username:
            return ("user", username, normalized)
        if normalized in GLOBAL_DATA_KEYS and normalized != GLOBAL_USERS_REGISTRY:
            return ("global", "", normalized)
        if normalized == GLOBAL_USERS_REGISTRY:
            return None
        return ("cli", "", normalized)

    def _get_fs_shared_path(self, key: str) -> Path:
        normalized = normalize_blob_key(key)
        return _SHARED_ROOT / normalized.removeprefix("shared/")

    def load_users(self) -> list[dict]:
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                """
                SELECT username, password_hash, created_at, theme, telegram_chat_id
                FROM webui_users
                ORDER BY created_at ASC
                """
            ).fetchall()
        users: list[dict] = []
        for row in rows:
            item = {
                "username": row["username"],
                "password_hash": row["password_hash"],
                "created_at": row["created_at"],
            }
            if row["theme"]:
                item["theme"] = row["theme"]
            if row["telegram_chat_id"] is not None:
                item["telegram_chat_id"] = row["telegram_chat_id"]
            users.append(item)
        return users

    def save_users(self, users: list[dict]) -> None:
        now = int(time.time())
        with self._lock, self._connect() as conn:
            conn.execute("DELETE FROM webui_users")
            for user in users:
                conn.execute(
                    """
                    INSERT INTO webui_users (
                        username, password_hash, created_at, theme, telegram_chat_id
                    ) VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        user.get("username", "").lower().strip(),
                        user.get("password_hash", ""),
                        int(user.get("created_at") or now),
                        user.get("theme") or "dark",
                        user.get("telegram_chat_id"),
                    ),
                )
            conn.commit()

    def get_session_secret(self) -> bytes:
        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT value FROM storage_meta WHERE key = ?",
                (GLOBAL_SESSION_SECRET,),
            ).fetchone()
            if row:
                return bytes(row["value"])
            secret = secrets.token_bytes(32)
            conn.execute(
                """
                INSERT INTO storage_meta (key, value, updated_at)
                VALUES (?, ?, ?)
                """,
                (GLOBAL_SESSION_SECRET, secret, int(time.time())),
            )
            conn.commit()
            return secret

    def ensure_user_dir(self, username: str) -> None:
        (self._shadow_root / "users" / username).mkdir(parents=True, exist_ok=True)

    def get_blob(self, username: Optional[str], key: str, *, binary: bool = False) -> str | bytes | None:
        normalized = normalize_blob_key(key)
        if normalized.startswith("shared/"):
            path = self._get_fs_shared_path(normalized)
            if not path.is_file():
                return None
            raw = path.read_bytes()
            plain = raw
        else:
            loc = self._blob_location(username, normalized)
            if loc is None:
                return None
            scope, uname, object_key = loc
            with self._lock, self._connect() as conn:
                row = conn.execute(
                    """
                    SELECT data FROM blobs
                    WHERE scope = ? AND username = ? AND object_key = ?
                    """,
                    (scope, uname, object_key),
                ).fetchone()
            if row is None:
                return None
            plain = self._maybe_decrypt(object_key, bytes(row["data"]))

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
        if normalized.startswith("shared/"):
            path = self._get_fs_shared_path(normalized)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(bytes(payload))
            return

        loc = self._blob_location(username, normalized)
        if loc is None:
            return
        scope, uname, object_key = loc
        stored = self._maybe_encrypt(object_key, bytes(payload))
        now = int(time.time())
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO blobs (scope, username, object_key, data, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(scope, username, object_key) DO UPDATE SET
                    data = excluded.data,
                    updated_at = excluded.updated_at
                """,
                (scope, uname, object_key, stored, now),
            )
            conn.commit()

    def delete_blob(self, username: Optional[str], key: str) -> None:
        normalized = normalize_blob_key(key)
        if normalized.startswith("shared/"):
            path = self._get_fs_shared_path(normalized)
            if path.exists():
                path.unlink()
            return
        loc = self._blob_location(username, normalized)
        if loc is None:
            return
        scope, uname, object_key = loc
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                DELETE FROM blobs
                WHERE scope = ? AND username = ? AND object_key = ?
                """,
                (scope, uname, object_key),
            )
            conn.commit()

    def blob_exists(self, username: Optional[str], key: str) -> bool:
        normalized = normalize_blob_key(key)
        if normalized.startswith("shared/"):
            return self._get_fs_shared_path(normalized).is_file()
        loc = self._blob_location(username, normalized)
        if loc is None:
            return False
        scope, uname, object_key = loc
        with self._lock, self._connect() as conn:
            row = conn.execute(
                """
                SELECT 1 FROM blobs
                WHERE scope = ? AND username = ? AND object_key = ?
                """,
                (scope, uname, object_key),
            ).fetchone()
        return row is not None

    def list_blobs(self, username: Optional[str], prefix: str = "") -> list[str]:
        normalized_prefix = normalize_blob_key(prefix)
        if normalized_prefix.startswith("shared/"):
            root = _SHARED_ROOT
            fs_prefix = normalized_prefix.removeprefix("shared/")
            if not root.exists():
                return []
            base = root / fs_prefix if fs_prefix else root
            if not base.exists():
                return []
            results = []
            for path in sorted(base.rglob("*") if base.is_dir() else [base]):
                if path.is_file():
                    rel = path.relative_to(root).as_posix()
                    results.append(f"shared/{rel}")
            return results

        if username:
            scope, uname = "user", username
        else:
            scope, uname = "cli", ""

        like = f"{normalized_prefix}%" if normalized_prefix else "%"
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                """
                SELECT object_key FROM blobs
                WHERE scope = ? AND username = ? AND object_key LIKE ?
                ORDER BY object_key
                """,
                (scope, uname, like),
            ).fetchall()
        return [row["object_key"] for row in rows]

    def resolve_user_path(self, username: str, key: str = "") -> Path:
        base = self._shadow_root / "users" / username
        if key:
            return base / normalize_blob_key(key)
        return base

    def resolve_global_path(self, key: str = "") -> Path:
        base = self._shadow_root / "global"
        if key:
            return base / normalize_blob_key(key)
        return base