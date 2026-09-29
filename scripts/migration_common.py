"""Shared helpers for webui_data → D1 + R2 migration (PR-21)."""
from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator, Optional

from webui.storage.backend import (
    GLOBAL_DATA_KEYS,
    GLOBAL_SESSION_SECRET,
    GLOBAL_USERS_REGISTRY,
    USER_MONITORING,
    is_encrypted_key,
    normalize_blob_key,
)
from webui.storage.crypto import decrypt_bytes, encrypt_bytes, is_encrypted, resolve_encryption_key
from webui.users import PROJECT_DIR, USERS_DIR, WEBUI_DATA

WORKER_DIR = PROJECT_DIR / "worker"
SCHEMA_VERSION = 1
SHARED_HOT = "shared/hot.json"
SHARED_HOT2 = "shared/hot2.json"
DECOY_TEMPLATE_PREFIX = "shared/decoy-templates/"


@dataclass
class R2ObjectPlan:
    scope: str
    username: str
    object_key: str
    r2_path: str
    payload: bytes
    plaintext_sha256: str
    stored_sha256: str
    size_bytes: int


@dataclass
class MonitoringRulePlan:
    id: str
    username: str
    name: str
    msisdn: str
    match_json: str
    trigger_json: str
    actions_json: str
    cooldown_seconds: int
    enabled: int
    last_fired_at: Optional[int]
    last_status: str
    last_msg: str
    created_at: int
    updated_at: int


@dataclass
class MigrationPlan:
    users: list[dict[str, Any]] = field(default_factory=list)
    session_secret: Optional[bytes] = None
    monitoring_rules: list[MonitoringRulePlan] = field(default_factory=list)
    r2_objects: list[R2ObjectPlan] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)

    def manifest(self, *, source: str, timestamp: str) -> dict[str, Any]:
        return {
            "version": 1,
            "timestamp": timestamp,
            "source": source,
            "counts": {
                "users": len(self.users),
                "monitoring_rules": len(self.monitoring_rules),
                "r2_objects": len(self.r2_objects),
            },
            "users": [u.get("username") for u in self.users],
            "r2_samples": [
                {
                    "r2_path": o.r2_path,
                    "scope": o.scope,
                    "username": o.username,
                    "object_key": o.object_key,
                    "plaintext_sha256": o.plaintext_sha256,
                    "stored_sha256": o.stored_sha256,
                    "size_bytes": o.size_bytes,
                }
                for o in self.r2_objects[:20]
            ],
            "checksum_sample": sample_checksums(self.r2_objects, n=5),
        }


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sample_checksums(objects: list[R2ObjectPlan], n: int = 5) -> list[dict[str, str]]:
    if not objects:
        return []
    step = max(1, len(objects) // n)
    out: list[dict[str, str]] = []
    for obj in objects[::step][:n]:
        out.append(
            {
                "r2_path": obj.r2_path,
                "plaintext_sha256": obj.plaintext_sha256,
                "stored_sha256": obj.stored_sha256,
            }
        )
    return out


def user_r2_path(username: str, object_key: str) -> str:
    return f"users/{username}/{normalize_blob_key(object_key)}"


def global_r2_path(object_key: str) -> str:
    return f"global/{normalize_blob_key(object_key)}"


def cli_r2_path(object_key: str) -> str:
    return f"cli/{normalize_blob_key(object_key)}"


def shared_r2_path(key: str) -> str:
    normalized = normalize_blob_key(key)
    return normalized if normalized.startswith("shared/") else f"shared/{normalized}"


def resolve_r2_location(username: Optional[str], key: str) -> Optional[tuple[str, str, str, str]]:
    """Return (scope, username, object_key, r2_path) or None when not stored in R2."""
    normalized = normalize_blob_key(key)

    if normalized.startswith("shared/"):
        return ("shared", "", normalized, shared_r2_path(normalized))

    if normalized == GLOBAL_USERS_REGISTRY:
        return None

    if username:
        return ("user", username, normalized, user_r2_path(username, normalized))

    if normalized in GLOBAL_DATA_KEYS:
        return ("global", "", normalized, global_r2_path(normalized))

    return ("cli", "", normalized, cli_r2_path(normalized))


def _encryption_key(session_secret: Optional[bytes]) -> bytes:
    return resolve_encryption_key(session_secret=session_secret)


def prepare_blob_payload(
    object_key: str,
    raw: bytes,
    *,
    session_secret: Optional[bytes],
    encrypt_at_rest: bool,
) -> tuple[bytes, str, str]:
    plain_sha = sha256_hex(raw)
    if encrypt_at_rest and is_encrypted_key(object_key):
        stored = encrypt_bytes(raw, _encryption_key(session_secret))
    else:
        stored = raw
    return stored, plain_sha, sha256_hex(stored)


def add_r2_object_raw(
    plan: MigrationPlan,
    scope: str,
    username: str,
    object_key: str,
    r2_path: str,
    stored: bytes,
    *,
    plaintext_sha256: str,
) -> None:
    plan.r2_objects.append(
        R2ObjectPlan(
            scope=scope,
            username=username,
            object_key=object_key,
            r2_path=r2_path,
            payload=stored,
            plaintext_sha256=plaintext_sha256,
            stored_sha256=sha256_hex(stored),
            size_bytes=len(stored),
        )
    )


def add_r2_object(
    plan: MigrationPlan,
    username: Optional[str],
    key: str,
    raw: bytes,
    *,
    session_secret: Optional[bytes],
    encrypt_at_rest: bool,
) -> bool:
    loc = resolve_r2_location(username, key)
    if loc is None:
        return False
    scope, uname, object_key, r2_path = loc
    stored, plain_sha, _stored_sha = prepare_blob_payload(
        object_key, raw, session_secret=session_secret, encrypt_at_rest=encrypt_at_rest
    )
    add_r2_object_raw(plan, scope, uname, object_key, r2_path, stored, plaintext_sha256=plain_sha)
    return True


def _plaintext_bytes(raw: bytes, object_key: str, session_secret: Optional[bytes]) -> bytes:
    if is_encrypted(raw):
        return decrypt_bytes(raw, _encryption_key(session_secret))
    return raw


def parse_monitoring_rules(username: str, raw: str, now: int) -> list[MonitoringRulePlan]:
    try:
        rules = json.loads(raw)
    except Exception:
        return []
    if not isinstance(rules, list):
        return []

    out: list[MonitoringRulePlan] = []
    for r in rules:
        if not isinstance(r, dict):
            continue
        rule_id = str(r.get("id") or "").strip()
        if not rule_id:
            continue
        created = int(r.get("created_at") or now)
        last_fired = r.get("last_fired_at")
        out.append(
            MonitoringRulePlan(
                id=rule_id,
                username=username,
                name=str(r.get("name") or "Untitled"),
                msisdn=str(int(r.get("msisdn") or 0)),
                match_json=json.dumps(r.get("match") or {"kind": "any", "data_type": "ANY"}, separators=(",", ":")),
                trigger_json=json.dumps(
                    r.get("trigger") or {"metric": "remaining_pct", "op": "lt", "value": 10},
                    separators=(",", ":"),
                ),
                actions_json=json.dumps(r.get("actions") or [], separators=(",", ":")),
                cooldown_seconds=int(r.get("cooldown_seconds") or 3600),
                enabled=1 if r.get("enabled", True) else 0,
                last_fired_at=int(last_fired) if last_fired else None,
                last_status=str(r.get("last_status") or ""),
                last_msg=str(r.get("last_msg") or ""),
                created_at=created,
                updated_at=now,
            )
        )
    return out


def _read_file_blob(path: Path) -> bytes:
    if path.suffix in (".json", ".number", ".log") or "decoy_data" in path.as_posix():
        try:
            return path.read_text(encoding="utf-8").encode("utf-8")
        except UnicodeDecodeError:
            pass
    return path.read_bytes()


def collect_from_files(
    data_dir: Path,
    *,
    encrypt_at_rest: bool = True,
) -> MigrationPlan:
    plan = MigrationPlan()
    now = int(time.time())

    users_file = data_dir / "users.json"
    if users_file.is_file():
        users = json.loads(users_file.read_text(encoding="utf-8"))
        if isinstance(users, list):
            plan.users = users

    secret_file = data_dir / "session.secret"
    if secret_file.is_file():
        plan.session_secret = secret_file.read_bytes()

    for name in GLOBAL_DATA_KEYS:
        if name in (GLOBAL_USERS_REGISTRY, GLOBAL_SESSION_SECRET):
            continue
        path = data_dir / name
        if path.is_file():
            add_r2_object(plan, None, name, _read_file_blob(path), session_secret=plan.session_secret, encrypt_at_rest=encrypt_at_rest)

    users_root = data_dir / "users"
    if users_root.is_dir():
        for user_dir in sorted(users_root.iterdir()):
            if not user_dir.is_dir():
                continue
            username = user_dir.name
            monitoring_path = user_dir / USER_MONITORING
            if monitoring_path.is_file():
                plan.monitoring_rules.extend(
                    parse_monitoring_rules(username, monitoring_path.read_text(encoding="utf-8"), now)
                )
            for path in sorted(user_dir.rglob("*")):
                if not path.is_file():
                    continue
                rel = path.relative_to(user_dir).as_posix()
                add_r2_object(
                    plan,
                    username,
                    rel,
                    _read_file_blob(path),
                    session_secret=plan.session_secret,
                    encrypt_at_rest=encrypt_at_rest,
                )

    hot_dir = PROJECT_DIR / "hot_data"
    for name in ("hot.json", "hot2.json"):
        path = hot_dir / name
        if path.is_file():
            key = SHARED_HOT if name == "hot.json" else SHARED_HOT2
            add_r2_object(plan, None, key, path.read_bytes(), session_secret=plan.session_secret, encrypt_at_rest=encrypt_at_rest)

    decoy_dir = PROJECT_DIR / "decoy_data"
    if decoy_dir.is_dir():
        for path in sorted(decoy_dir.rglob("*.json")):
            rel = path.relative_to(decoy_dir).as_posix()
            key = f"{DECOY_TEMPLATE_PREFIX}{rel}"
            add_r2_object(
                plan,
                None,
                key,
                path.read_bytes(),
                session_secret=plan.session_secret,
                encrypt_at_rest=encrypt_at_rest,
            )

    for legacy in ("refresh-tokens.json", "active.number", "ax.fp", "bookmark.json"):
        path = PROJECT_DIR / legacy
        if path.is_file():
            add_r2_object(
                plan,
                None,
                legacy,
                _read_file_blob(path),
                session_secret=plan.session_secret,
                encrypt_at_rest=encrypt_at_rest,
            )

    return plan


def collect_from_sqlite(
    db_path: Path,
    *,
    encrypt_at_rest: bool = True,
) -> MigrationPlan:
    plan = MigrationPlan()
    now = int(time.time())

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT username, password_hash, created_at, theme, telegram_chat_id FROM webui_users ORDER BY created_at"
        ).fetchall()
        for row in rows:
            user = {
                "username": row["username"],
                "password_hash": row["password_hash"],
                "created_at": row["created_at"],
            }
            if row["theme"]:
                user["theme"] = row["theme"]
            if row["telegram_chat_id"] is not None:
                user["telegram_chat_id"] = row["telegram_chat_id"]
            plan.users.append(user)

        meta = conn.execute(
            "SELECT value FROM storage_meta WHERE key = ?",
            (GLOBAL_SESSION_SECRET,),
        ).fetchone()
        if meta:
            plan.session_secret = bytes(meta["value"])

        blob_rows = conn.execute(
            "SELECT scope, username, object_key, data FROM blobs ORDER BY scope, username, object_key"
        ).fetchall()
        for row in blob_rows:
            scope = row["scope"]
            username = row["username"] or ""
            object_key = row["object_key"]
            raw = bytes(row["data"])
            plain = _plaintext_bytes(raw, object_key, plan.session_secret)

            if scope == "user" and username and object_key == USER_MONITORING:
                try:
                    plan.monitoring_rules.extend(
                        parse_monitoring_rules(username, plain.decode("utf-8"), now)
                    )
                except Exception:
                    plan.skipped.append(f"monitoring:{username}")

            if scope == "shared":
                r2_path = shared_r2_path(object_key)
            elif scope == "user":
                r2_path = user_r2_path(username, object_key)
            elif scope == "global":
                r2_path = global_r2_path(object_key)
            else:
                r2_path = cli_r2_path(object_key)

            if is_encrypted(raw):
                stored = raw
            else:
                stored, _, _ = prepare_blob_payload(
                    object_key,
                    raw,
                    session_secret=plan.session_secret,
                    encrypt_at_rest=encrypt_at_rest,
                )

            add_r2_object_raw(
                plan,
                scope,
                username,
                object_key,
                r2_path,
                stored,
                plaintext_sha256=sha256_hex(plain),
            )

    hot_dir = PROJECT_DIR / "hot_data"
    existing_shared = {o.object_key for o in plan.r2_objects if o.scope == "shared"}
    for name, key in (("hot.json", SHARED_HOT), ("hot2.json", SHARED_HOT2)):
        if key in existing_shared:
            continue
        path = hot_dir / name
        if path.is_file():
            add_r2_object(
                plan,
                None,
                key,
                path.read_bytes(),
                session_secret=plan.session_secret,
                encrypt_at_rest=encrypt_at_rest,
            )

    decoy_dir = PROJECT_DIR / "decoy_data"
    for path in sorted(decoy_dir.rglob("*.json")):
        rel = path.relative_to(decoy_dir).as_posix()
        key = f"{DECOY_TEMPLATE_PREFIX}{rel}"
        if key in existing_shared:
            continue
        add_r2_object(
            plan,
            None,
            key,
            path.read_bytes(),
            session_secret=plan.session_secret,
            encrypt_at_rest=encrypt_at_rest,
        )

    return plan


def sql_blob_literal(data: bytes) -> str:
    return "X'" + data.hex().upper() + "'"


def sql_str(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def build_d1_sql(plan: MigrationPlan, now: Optional[int] = None) -> str:
    ts = now or int(time.time())
    lines: list[str] = [
        "PRAGMA foreign_keys = ON;",
        f"INSERT OR REPLACE INTO schema_version (id, version, applied_at) VALUES (1, {SCHEMA_VERSION}, {ts});",
        "DELETE FROM monitoring_rules;",
        "DELETE FROM r2_objects;",
        "DELETE FROM webui_users;",
    ]

    if plan.session_secret:
        lines.append(
            "INSERT OR REPLACE INTO storage_meta (key, value, updated_at) VALUES "
            f"({sql_str(GLOBAL_SESSION_SECRET)}, {sql_blob_literal(plan.session_secret)}, {ts});"
        )

    for user in plan.users:
        username = str(user.get("username", "")).lower().strip()
        theme = str(user.get("theme") or "dark")
        chat_id = user.get("telegram_chat_id")
        chat_sql = str(int(chat_id)) if chat_id is not None else "NULL"
        lines.append(
            "INSERT INTO webui_users (username, password_hash, created_at, theme, telegram_chat_id, updated_at) VALUES ("
            f"{sql_str(username)}, {sql_str(str(user.get('password_hash', '')))}, "
            f"{int(user.get('created_at') or ts)}, {sql_str(theme)}, {chat_sql}, {ts});"
        )

    for rule in plan.monitoring_rules:
        last_fired = str(rule.last_fired_at) if rule.last_fired_at else "NULL"
        lines.append(
            "INSERT INTO monitoring_rules ("
            "id, username, name, msisdn, match_json, trigger_json, actions_json, "
            "cooldown_seconds, enabled, last_fired_at, last_status, last_msg, created_at, updated_at"
            ") VALUES ("
            f"{sql_str(rule.id)}, {sql_str(rule.username)}, {sql_str(rule.name)}, {sql_str(rule.msisdn)}, "
            f"{sql_str(rule.match_json)}, {sql_str(rule.trigger_json)}, {sql_str(rule.actions_json)}, "
            f"{rule.cooldown_seconds}, {rule.enabled}, {last_fired}, "
            f"{sql_str(rule.last_status)}, {sql_str(rule.last_msg)}, {rule.created_at}, {rule.updated_at});"
        )

    for obj in plan.r2_objects:
        lines.append(
            "INSERT INTO r2_objects (scope, username, object_key, r2_path, size_bytes, updated_at) VALUES ("
            f"{sql_str(obj.scope)}, {sql_str(obj.username)}, {sql_str(obj.object_key)}, "
            f"{sql_str(obj.r2_path)}, {obj.size_bytes}, {ts});"
        )

    return "\n".join(lines) + "\n"


def default_data_dir() -> Path:
    return WEBUI_DATA


def migration_timestamp() -> str:
    return time.strftime("%Y%m%d_%H%M%S")


def manifest_r2_path(timestamp: str) -> str:
    return f"migration/{timestamp}/manifest.json"