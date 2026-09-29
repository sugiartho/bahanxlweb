"""Tests for D1+R2 migration helpers (PR-21)."""
from __future__ import annotations

import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path

from scripts.migration_common import (
    build_d1_sql,
    collect_from_files,
    collect_from_sqlite,
    parse_monitoring_rules,
    resolve_r2_location,
    sha256_hex,
    user_r2_path,
)
from webui.storage.backend import GLOBAL_USERS_REGISTRY, USER_MONITORING
from webui.storage.sqlite_backend import init_db


class MigrationCommonTests(unittest.TestCase):
    def test_resolve_r2_location(self):
        self.assertEqual(
            resolve_r2_location("alice", "bookmark.json"),
            ("user", "alice", "bookmark.json", user_r2_path("alice", "bookmark.json")),
        )
        self.assertIsNone(resolve_r2_location(None, GLOBAL_USERS_REGISTRY))
        self.assertEqual(resolve_r2_location(None, "shared/hot.json")[0], "shared")

    def test_parse_monitoring_rules(self):
        raw = json.dumps(
            [
                {
                    "id": "abc123",
                    "name": "Low",
                    "msisdn": 628111,
                    "match": {"kind": "any"},
                    "trigger": {"metric": "remaining_pct", "op": "lt", "value": 10},
                    "actions": [{"type": "telegram", "message": "hi"}],
                    "enabled": True,
                    "created_at": 100,
                }
            ]
        )
        rules = parse_monitoring_rules("alice", raw, now=200)
        self.assertEqual(len(rules), 1)
        self.assertEqual(rules[0].id, "abc123")
        self.assertEqual(rules[0].username, "alice")
        self.assertEqual(rules[0].msisdn, "628111")
        self.assertEqual(rules[0].enabled, 1)

    def test_collect_from_files_with_temp_data(self):
        with tempfile.TemporaryDirectory() as td:
            tmp_path = Path(td)
            data_dir = tmp_path / "webui_data"
            users_dir = data_dir / "users" / "alice"
            users_dir.mkdir(parents=True)
            (data_dir / "users.json").write_text(
                json.dumps([{"username": "alice", "password_hash": "h", "created_at": 1}]),
                encoding="utf-8",
            )
            (data_dir / "session.secret").write_bytes(b"\x01" * 32)
            (users_dir / "bookmark.json").write_text("[]", encoding="utf-8")
            (users_dir / USER_MONITORING).write_text(
                json.dumps(
                    [
                        {
                            "id": "r1",
                            "name": "rule",
                            "msisdn": 628111,
                            "actions": [],
                            "created_at": 1,
                        }
                    ]
                ),
                encoding="utf-8",
            )

            os.environ["STORAGE_ENCRYPTION_KEY"] = "a" * 64
            plan = collect_from_files(data_dir, encrypt_at_rest=True)
            self.assertEqual(len(plan.users), 1)
            self.assertEqual(len(plan.monitoring_rules), 1)
            self.assertTrue(any(o.object_key == "bookmark.json" for o in plan.r2_objects))

            sql = build_d1_sql(plan, now=999)
            with sqlite3.connect(":memory:") as conn:
                schema = Path(__file__).resolve().parents[1] / "worker" / "migrations" / "0001_init.sql"
                conn.executescript(schema.read_text(encoding="utf-8"))
                conn.executescript(sql)
                users = conn.execute("SELECT COUNT(*) FROM webui_users").fetchone()[0]
                rules = conn.execute("SELECT COUNT(*) FROM monitoring_rules").fetchone()[0]
                blobs = conn.execute("SELECT COUNT(*) FROM r2_objects").fetchone()[0]
            self.assertEqual(users, 1)
            self.assertEqual(rules, 1)
            self.assertGreaterEqual(blobs, 1)

    def test_bundle_roundtrip_via_sqlite_source(self):
        os.environ["STORAGE_ENCRYPTION_KEY"] = "b" * 64
        with tempfile.TemporaryDirectory() as td:
            db_path = Path(td) / "webui.db"
            init_db(db_path)
            with sqlite3.connect(db_path) as conn:
                conn.execute(
                    "INSERT INTO webui_users (username, password_hash, created_at, theme) VALUES (?, ?, ?, ?)",
                    ("bob", "hash", 1, "dark"),
                )
                conn.execute(
                    "INSERT INTO blobs (scope, username, object_key, data, updated_at) VALUES (?, ?, ?, ?, ?)",
                    ("user", "bob", "bookmark.json", b"[]", 1),
                )
                conn.commit()

            plan = collect_from_sqlite(db_path, encrypt_at_rest=True)
            manifest = plan.manifest(source="sqlite", timestamp="test")
            self.assertEqual(manifest["counts"]["users"], 1)
            self.assertEqual(
                sha256_hex(b"test"),
                "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
            )


if __name__ == "__main__":
    unittest.main()