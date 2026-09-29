"""Storage abstraction for WebUI-XL multi-tenant data."""
from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional

# Relative paths inside a user directory or global data root.
GLOBAL_TELEGRAM_CONFIG = "telegram.json"
GLOBAL_SESSION_SECRET = "session.secret"
GLOBAL_USERS_REGISTRY = "users.json"

GLOBAL_DATA_KEYS: frozenset[str] = frozenset({
    GLOBAL_TELEGRAM_CONFIG,
    GLOBAL_SESSION_SECRET,
    GLOBAL_USERS_REGISTRY,
})

USER_REFRESH_TOKENS = "refresh-tokens.json"
USER_ACTIVE_NUMBER = "active.number"
USER_AX_FP = "ax.fp"
USER_BOOKMARK = "bookmark.json"
USER_QUOTA_CACHE = "quota_cache.json"
USER_MONITORING = "monitoring.json"
USER_MONITOR_LOG = "monitor.log"
USER_TELEGRAM = "telegram.json"
USER_DECOY_DIR = "decoy_data"

# Blobs encrypted at rest (AES-256-GCM) in every backend implementation.
ENCRYPTED_BLOB_KEYS: frozenset[str] = frozenset({
    USER_REFRESH_TOKENS,
    USER_ACTIVE_NUMBER,
    USER_AX_FP,
    USER_BOOKMARK,
    USER_QUOTA_CACHE,
    USER_MONITORING,
    USER_MONITOR_LOG,
    USER_TELEGRAM,
    GLOBAL_TELEGRAM_CONFIG,
})

SHARED_HOT = "shared/hot.json"
SHARED_HOT2 = "shared/hot2.json"


def is_encrypted_key(key: str) -> bool:
    normalized = key.replace("\\", "/").lstrip("/")
    if normalized in ENCRYPTED_BLOB_KEYS:
        return True
    if normalized.startswith(f"{USER_DECOY_DIR}/"):
        return True
    return False


def normalize_blob_key(key: str | Path) -> str:
    return str(key).replace("\\", "/").lstrip("/")


class StorageBackend(ABC):
    """Abstract storage layer — file (Phase 1), SQLite, then D1+R2 (Phase 2)."""

    @abstractmethod
    def load_users(self) -> list[dict]:
        ...

    @abstractmethod
    def save_users(self, users: list[dict]) -> None:
        ...

    @abstractmethod
    def get_session_secret(self) -> bytes:
        ...

    @abstractmethod
    def ensure_user_dir(self, username: str) -> None:
        ...

    @abstractmethod
    def get_blob(self, username: Optional[str], key: str, *, binary: bool = False) -> str | bytes | None:
        """Read a blob. username=None reads from global data root."""
        ...

    @abstractmethod
    def put_blob(
        self,
        username: Optional[str],
        key: str,
        data: str | bytes,
        *,
        binary: bool = False,
    ) -> None:
        ...

    @abstractmethod
    def delete_blob(self, username: Optional[str], key: str) -> None:
        ...

    @abstractmethod
    def blob_exists(self, username: Optional[str], key: str) -> bool:
        ...

    @abstractmethod
    def list_blobs(self, username: Optional[str], prefix: str = "") -> list[str]:
        ...

    @abstractmethod
    def resolve_user_path(self, username: str, key: str = "") -> Path:
        """Return filesystem path for legacy adapters during migration."""
        ...

    @abstractmethod
    def resolve_global_path(self, key: str = "") -> Path:
        ...