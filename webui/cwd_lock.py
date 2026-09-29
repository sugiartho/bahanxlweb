"""Thread-safe CWD isolation for background tasks.

The Auth singleton reads from CWD. We have transitioned away from os.chdir()
to ContextVars. This module now just sets the ContextVar so background threads
like the Telegram bot or Monitoring loop can isolate their data.
"""
import time
import threading
from pathlib import Path

from webui.users import user_dir
from webui.context import current_user_dir
from webui.storage.backend import USER_REFRESH_TOKENS
from webui.storage.tenant import current_storage_username, read_user_json

_cache_lock = threading.Lock()
_token_cache: dict[tuple[str, int], tuple[float, dict]] = {}
_TOKEN_CACHE_TTL=300  # seconds — avoid re-refreshing on every button tap


class _UserCwd:
    """Context manager: set context var for the background thread, reload AuthInstance."""

    def __init__(self, username: str):
        self.username = username
        self.dir_token = None
        self.user_token = None

    def __enter__(self):
        udir = user_dir(self.username)
        udir.mkdir(parents=True, exist_ok=True)
        self.dir_token = current_user_dir.set(udir)
        self.user_token = current_storage_username.set(self.username)

        try:
            from app.service.auth import AuthInstance
            AuthInstance.reload_for_current_dir()
        except Exception:
            pass
        return self

    def __exit__(self, *exc):
        if self.user_token is not None:
            current_storage_username.reset(self.user_token)
        if self.dir_token is not None:
            current_user_dir.reset(self.dir_token)
        return False


def user_cwd(username: str) -> _UserCwd:
    return _UserCwd(username)


def list_user_accounts(username: str) -> list[dict]:
    """Account metadata from refresh-tokens.json — no network calls."""
    with user_cwd(username):
        entries = read_user_json(USER_REFRESH_TOKENS, default=[])
    if not isinstance(entries, list):
        return []
    results = []
    for entry in entries:
        msisdn = entry.get("number")
        if not msisdn:
            continue
        results.append({
            "number": int(msisdn),
            "subscriber_id": entry.get("subscriber_id", ""),
            "subscription_type": entry.get("subscription_type", ""),
        })
    return results


def invalidate_user_token_cache(username: str, msisdn: int | None = None) -> None:
    with _cache_lock:
        if msisdn is None:
            keys = [k for k in _token_cache if k[0] == username]
        else:
            keys = [(username, int(msisdn))]
        for key in keys:
            _token_cache.pop(key, None)


def get_user_tokens(username: str, msisdn: int, *, force: bool = False) -> dict | None:
    """Get tokens for one MSISDN. Cached briefly to keep Telegram menus snappy."""
    key = (username, int(msisdn))
    if not force:
        with _cache_lock:
            hit = _token_cache.get(key)
            if hit and (time.time() - hit[0]) < _TOKEN_CACHE_TTL:
                return dict(hit[1])

    with user_cwd(username):
        from app.service.auth import AuthInstance
        try:
            AuthInstance.set_active_user(msisdn)
        except Exception:
            return None
        user = AuthInstance.get_active_user()
        if not user or user.get("number") != msisdn:
            return None
        tokens = dict(user["tokens"])

    with _cache_lock:
        _token_cache[key] = (time.time(), tokens)
    return tokens


def get_all_user_tokens(username: str) -> list[dict]:
    """Tokens for all accounts — uses per-number cache when possible."""
    results = []
    for entry in list_user_accounts(username):
        tokens = get_user_tokens(username, entry["number"])
        if tokens:
            results.append({**entry, "tokens": tokens})
    return results


def get_api_key() -> str:
    from app.util import ensure_api_key
    return ensure_api_key()
