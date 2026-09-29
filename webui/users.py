"""WebUI user model & session helpers (multi-tenant).

Each webui user has their own data directory under webui_data/users/{username}/
containing refresh-tokens.json, active.number, ax.fp, bookmark.json, and decoy_data/.
"""
import os
import json
import hmac
import time
import hashlib
import secrets
import shutil
import re
from pathlib import Path
from typing import Optional

from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired

PROJECT_DIR = Path(__file__).resolve().parents[1]
WEBUI_DATA = PROJECT_DIR / "webui_data"
USERS_FILE = WEBUI_DATA / "users.json"
USERS_DIR = WEBUI_DATA / "users"
SECRET_FILE = WEBUI_DATA / "session.secret"
COOKIE_NAME = "mecli_session"
SESSION_MAX_AGE = 60 * 60 * 24 * 30  # 30 days

USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{2,30}$")

# Files migrated into the FIRST registered user's dir (existing MyXL session carried over).
# decoy_data is NOT moved — it stays at root as the canonical template that new users seed from.
USER_FILES = ["refresh-tokens.json", "active.number", "ax.fp", "bookmark.json"]
USER_DIRS: list[str] = []


def _ensure_dirs():
    WEBUI_DATA.mkdir(exist_ok=True)
    USERS_DIR.mkdir(exist_ok=True)


def _secret_key() -> bytes:
    """Lazily generate & persist session secret. Survives restarts."""
    from webui.storage import get_storage
    return get_storage().get_session_secret()


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(_secret_key(), salt="webui-session")


def hash_password(password: str) -> str:
    """PBKDF2-HMAC-SHA256, 200k iters. Returns 'pbkdf2_sha256$iter$salt$hash'."""
    iters = 200_000
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iters)
    return f"pbkdf2_sha256${iters}${salt.hex()}${dk.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algo, iters_s, salt_hex, hash_hex = encoded.split("$")
        if algo != "pbkdf2_sha256":
            return False
        iters = int(iters_s)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(hash_hex)
    except Exception:
        return False
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iters)
    return hmac.compare_digest(dk, expected)


def load_users() -> list[dict]:
    _ensure_dirs()
    from webui.storage import get_storage
    return get_storage().load_users()


def save_users(users: list[dict]) -> None:
    _ensure_dirs()
    from webui.storage import get_storage
    get_storage().save_users(users)


def get_user(username: str) -> Optional[dict]:
    username = (username or "").lower().strip()
    for u in load_users():
        if u.get("username", "").lower() == username:
            return u
    return None


def user_dir(username: str) -> Path:
    return USERS_DIR / username


def _migrate_legacy_data_into(username: str) -> list[str]:
    """Move root-level legacy MyXL files into the first webui user's storage."""
    from webui.storage import get_storage

    storage = get_storage()
    migrated: list[str] = []
    for name in USER_FILES:
        src = PROJECT_DIR / name
        if src.exists() and not storage.blob_exists(username, name):
            try:
                storage.put_blob(username, name, src.read_text(encoding="utf-8"))
                src.unlink()
                migrated.append(name)
            except Exception:
                pass
    for d in USER_DIRS:
        src = PROJECT_DIR / d
        if not src.exists():
            continue
        for path in src.rglob("*"):
            if not path.is_file():
                continue
            rel = path.relative_to(src).as_posix()
            key = f"{d}/{rel}"
            if not storage.blob_exists(username, key):
                try:
                    storage.put_blob(username, key, path.read_text(encoding="utf-8"))
                except Exception:
                    continue
        try:
            shutil.rmtree(src)
            migrated.append(d + "/")
        except Exception:
            pass
    return migrated


def _seed_decoy_templates(username: str) -> None:
    """Seed stock decoy templates from project decoy_data/ into user storage."""
    from webui.storage import get_storage
    from webui.storage.backend import USER_DECOY_DIR

    storage = get_storage()
    if storage.list_blobs(username, f"{USER_DECOY_DIR}/"):
        return
    src = PROJECT_DIR / "decoy_data"
    if not src.exists():
        return
    for path in src.rglob("*.json"):
        rel = path.relative_to(src).as_posix()
        key = f"{USER_DECOY_DIR}/{rel}"
        try:
            storage.put_blob(username, key, path.read_text(encoding="utf-8"))
        except Exception:
            pass


def create_user(username: str, password: str) -> tuple[bool, str]:
    username = (username or "").lower().strip()
    if not USERNAME_RE.match(username):
        return False, "Username: 3-31 char, huruf kecil/angka/_/-, awalan huruf/angka."
    if len(password) < 6:
        return False, "Password minimal 6 karakter."
    if get_user(username):
        return False, f"Username '{username}' sudah dipakai."
    users = load_users()
    encoded = hash_password(password)
    users.append({
        "username": username,
        "password_hash": encoded,
        "created_at": int(time.time()),
    })
    save_users(users)
    from webui.storage import get_storage
    get_storage().ensure_user_dir(username)
    is_first = len(users) == 1
    if is_first:
        _migrate_legacy_data_into(username)
    _seed_decoy_templates(username)
    return True, ""


def authenticate(username: str, password: str) -> Optional[dict]:
    u = get_user(username)
    if not u:
        return None
    if not verify_password(password, u.get("password_hash", "")):
        return None
    return u


def change_password(username: str, current_password: str, new_password: str) -> tuple[bool, str]:
    if not authenticate(username, current_password):
        return False, "Password lama salah."
    if len(new_password) < 6:
        return False, "Password baru minimal 6 karakter."
    users = load_users()
    normalized = (username or "").lower().strip()
    for u in users:
        if u.get("username", "").lower() == normalized:
            u["password_hash"] = hash_password(new_password)
            save_users(users)
            return True, ""
    return False, "User tidak ditemukan."


def link_telegram(username: str, chat_id: int) -> bool:
    users = load_users()
    for u in users:
        if u.get("username", "").lower() == username.lower():
            u["telegram_chat_id"] = chat_id
            save_users(users)
            # Sync per-user telegram.json so monitoring alerts find chat_id
            try:
                from webui import telegram_config as TC
                from webui.storage import get_storage
                from webui.storage.backend import USER_TELEGRAM
                token = TC.load_config().get("bot_token", "")
                get_storage().put_blob(
                    username,
                    USER_TELEGRAM,
                    json.dumps({"bot_token": token, "chat_id": str(chat_id)}, indent=2),
                )
            except Exception:
                pass
            return True
    return False


def set_theme(username: str, theme: str) -> bool:
    """Set the UI theme for a user. Valid values: 'dark', 'light'."""
    if theme not in ("dark", "light"):
        return False
    users = load_users()
    for u in users:
        if u.get("username", "").lower() == username.lower():
            u["theme"] = theme
            save_users(users)
            return True
    return False


def get_theme(username: str) -> str:
    """Return the user's theme preference. Default: 'dark'."""
    u = get_user(username)
    if u:
        return u.get("theme", "dark")
    return "dark"


def unlink_telegram(username: str) -> bool:
    users = load_users()
    for u in users:
        if u.get("username", "").lower() == username.lower():
            u.pop("telegram_chat_id", None)
            save_users(users)
            return True
    return False


def get_user_by_telegram(chat_id: int) -> dict | None:
    for u in load_users():
        if u.get("telegram_chat_id") == chat_id:
            return u
    return None


def make_session_token(username: str) -> str:
    return _serializer().dumps({"u": username.lower()})


def parse_session_token(token: str) -> Optional[str]:
    try:
        data = _serializer().loads(token, max_age=SESSION_MAX_AGE)
    except (BadSignature, SignatureExpired):
        return None
    except Exception:
        return None
    if isinstance(data, dict):
        return data.get("u")
    return None
