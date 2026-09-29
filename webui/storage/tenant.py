"""Per-request tenant helpers for user-scoped blob I/O."""
from __future__ import annotations

import contextvars
import json
from pathlib import Path
from typing import Any, Optional

from webui.context import PROJECT_DIR, current_user_dir
from webui.storage.backend import (
    GLOBAL_DATA_KEYS,
    USER_ACTIVE_NUMBER,
    USER_REFRESH_TOKENS,
    normalize_blob_key,
)
from webui.users import USERS_DIR

current_storage_username: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "current_storage_username",
    default=None,
)


def username_from_user_dir(udir: Path | str | None) -> Optional[str]:
    if not udir:
        return None
    path = Path(udir)
    try:
        rel = path.resolve().relative_to(USERS_DIR.resolve())
    except ValueError:
        return None
    parts = rel.parts
    return parts[0] if parts else None


def get_storage_username() -> Optional[str]:
    explicit = current_storage_username.get()
    if explicit:
        return explicit
    return username_from_user_dir(current_user_dir.get())


def _storage():
    from webui.storage import get_storage
    return get_storage()


def read_user_text(key: str) -> Optional[str]:
    return _storage().get_blob(get_storage_username(), key)


def write_user_text(key: str, data: str) -> None:
    _storage().put_blob(get_storage_username(), key, data)


def read_user_json(key: str, default: Any = None) -> Any:
    raw = read_user_text(key)
    if raw is None:
        return default
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return default


def write_user_json(key: str, data: Any, *, indent: int = 4) -> None:
    write_user_text(key, json.dumps(data, indent=indent))


def user_blob_exists(key: str) -> bool:
    return _storage().blob_exists(get_storage_username(), key)


def delete_user_blob(key: str) -> None:
    _storage().delete_blob(get_storage_username(), key)


def ensure_user_bootstrap(username: str) -> None:
    """Create empty user blobs when a webui session starts."""
    token = current_storage_username.set(username)
    try:
        if not user_blob_exists(USER_REFRESH_TOKENS):
            write_user_json(USER_REFRESH_TOKENS, [])
        backend = _storage()
        backend.ensure_user_dir(username)
        decoy_dir = backend.resolve_user_path(username, "decoy_data")
        decoy_dir.mkdir(parents=True, exist_ok=True)
    finally:
        current_storage_username.reset(token)


def legacy_project_root_for_key(key: str) -> bool:
    """True when CLI-mode blobs live at project root (not webui_data/)."""
    normalized = normalize_blob_key(key)
    return normalized not in GLOBAL_DATA_KEYS and not normalized.startswith("shared/")


def resolve_effective_root(username: Optional[str], key: str) -> Path:
    normalized = normalize_blob_key(key)
    if normalized.startswith("shared/"):
        return PROJECT_DIR / "hot_data"
    if username:
        return USERS_DIR / username
    if normalized in GLOBAL_DATA_KEYS:
        from webui.users import WEBUI_DATA

        return WEBUI_DATA
    return PROJECT_DIR