#!/usr/bin/env python3
"""Import existing webui_data/ filesystem layout into SQLite storage."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_DIR))

from dotenv import load_dotenv

load_dotenv(PROJECT_DIR / ".env")

from webui.storage.backend import GLOBAL_DATA_KEYS, GLOBAL_SESSION_SECRET, normalize_blob_key
from webui.storage.sqlite_backend import SQLiteBackend, default_db_path, init_db
from webui.users import PROJECT_DIR as ROOT, USERS_DIR, WEBUI_DATA


def _import_file(backend: SQLiteBackend, username: str | None, key: str, path: Path) -> bool:
    if not path.is_file():
        return False
    try:
        if key.endswith((".json", ".number", ".fp")) or "decoy_data" in key:
            backend.put_blob(username, key, path.read_text(encoding="utf-8"))
        else:
            backend.put_blob(username, key, path.read_bytes(), binary=True)
        return True
    except Exception as exc:
        print(f"  skip {path}: {exc}")
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Migrate file storage to SQLite")
    parser.add_argument("--db", type=Path, default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    db_path = args.db or default_db_path()
    if args.dry_run:
        print(f"[dry-run] Would migrate into {db_path}")
        return 0

    init_db(db_path)
    backend = SQLiteBackend(db_path, encrypt_at_rest=True)
    imported = 0

    users_file = WEBUI_DATA / "users.json"
    if users_file.exists():
        users = json.loads(users_file.read_text(encoding="utf-8"))
        if isinstance(users, list):
            backend.save_users(users)
            imported += len(users)
            print(f"users: {len(users)}")

    secret_file = WEBUI_DATA / "session.secret"
    if secret_file.exists():
        import time
        secret = secret_file.read_bytes()
        with backend._lock, backend._connect() as conn:
            conn.execute(
                """
                INSERT INTO storage_meta (key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = excluded.updated_at
                """,
                (GLOBAL_SESSION_SECRET, secret, int(time.time())),
            )
            conn.commit()
        imported += 1
        print("session secret: ok")

    for name in GLOBAL_DATA_KEYS:
        if name in ("users.json", "session.secret"):
            continue
        path = WEBUI_DATA / name
        if _import_file(backend, None, name, path):
            imported += 1
            print(f"global {name}: ok")

    if USERS_DIR.exists():
        for user_dir in sorted(USERS_DIR.iterdir()):
            if not user_dir.is_dir():
                continue
            username = user_dir.name
            backend.ensure_user_dir(username)
            for path in sorted(user_dir.rglob("*")):
                if not path.is_file():
                    continue
                rel = path.relative_to(user_dir).as_posix()
                if _import_file(backend, username, rel, path):
                    imported += 1
            print(f"user {username}: imported")

    for legacy in ("refresh-tokens.json", "active.number", "ax.fp", "bookmark.json"):
        path = ROOT / legacy
        if _import_file(backend, None, legacy, path):
            imported += 1
            print(f"cli legacy {legacy}: ok")

    print(f"Done. Imported {imported} blob(s) into {db_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())