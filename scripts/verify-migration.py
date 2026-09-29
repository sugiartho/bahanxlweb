#!/usr/bin/env python3
"""Verify a D1+R2 migration using manifest.json counts and checksum samples."""
from __future__ import annotations

import argparse
import json
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_DIR))

from dotenv import load_dotenv

load_dotenv(PROJECT_DIR / ".env")

from scripts.migration_common import WORKER_DIR, sha256_hex  # noqa: E402


def run_wrangler_json(args: list[str], *, wrangler_env: str | None = None) -> object:
    cmd = ["npx", "wrangler", *args, "--json"]
    if wrangler_env:
        cmd.extend(["--env", wrangler_env])
    proc = subprocess.run(cmd, cwd=WORKER_DIR, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or f"wrangler failed: {cmd}")
    out = proc.stdout.strip()
    if not out:
        return []
    return json.loads(out)


def d1_query(d1_name: str, sql: str, *, remote: bool, wrangler_env: str | None = None) -> list[dict]:
    args = ["d1", "execute", d1_name, "--command", sql]
    if remote:
        args.append("--remote")
    data = run_wrangler_json(args, wrangler_env=wrangler_env)
    if isinstance(data, list) and data and isinstance(data[0], dict) and "results" in data[0]:
        return data[0].get("results") or []
    if isinstance(data, list):
        return data
    return []


def download_r2_object(
    bucket: str,
    r2_path: str,
    *,
    remote: bool,
    wrangler_env: str | None = None,
) -> bytes:
    with tempfile.NamedTemporaryFile(delete=False) as fh:
        tmp = fh.name
    args = ["r2", "object", "get", f"{bucket}/{r2_path}", "--file", tmp]
    if remote:
        args.append("--remote")
    if wrangler_env:
        args.extend(["--env", wrangler_env])
    proc = subprocess.run(["npx", "wrangler", *args], cwd=WORKER_DIR, capture_output=True, check=False)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.decode() or proc.stdout.decode())
    data = Path(tmp).read_bytes()
    Path(tmp).unlink(missing_ok=True)
    return data


def verify_bundle(bundle_dir: Path, manifest: dict) -> list[str]:
    errors: list[str] = []
    sql_path = bundle_dir / "migration.sql"
    r2_root = bundle_dir / "r2"

    if not sql_path.is_file():
        errors.append(f"missing {sql_path}")
        return errors

    with sqlite3.connect(":memory:") as conn:
        conn.executescript((PROJECT_DIR / "worker" / "migrations" / "0001_init.sql").read_text(encoding="utf-8"))
        conn.executescript(sql_path.read_text(encoding="utf-8"))
        users = conn.execute("SELECT COUNT(*) AS c FROM webui_users").fetchone()[0]
        rules = conn.execute("SELECT COUNT(*) AS c FROM monitoring_rules").fetchone()[0]
        objects = conn.execute("SELECT COUNT(*) AS c FROM r2_objects").fetchone()[0]

    expected = manifest.get("counts", {})
    if users != expected.get("users"):
        errors.append(f"users: expected {expected.get('users')}, bundle SQL has {users}")
    if rules != expected.get("monitoring_rules"):
        errors.append(f"rules: expected {expected.get('monitoring_rules')}, bundle SQL has {rules}")
    if objects != expected.get("r2_objects"):
        errors.append(f"r2_objects: expected {expected.get('r2_objects')}, bundle SQL has {objects}")

    for sample in manifest.get("checksum_sample", []):
        r2_path = sample["r2_path"]
        path = r2_root / r2_path
        if not path.is_file():
            errors.append(f"missing bundle object {r2_path}")
            continue
        stored_sha = sha256_hex(path.read_bytes())
        if stored_sha != sample.get("stored_sha256"):
            errors.append(f"stored checksum mismatch for {r2_path}")

    return errors


def verify_remote(
    manifest: dict,
    *,
    d1_name: str,
    r2_bucket: str,
    remote: bool,
    wrangler_env: str | None = None,
) -> list[str]:
    errors: list[str] = []
    expected = manifest.get("counts", {})

    user_rows = d1_query(
        d1_name, "SELECT COUNT(*) AS c FROM webui_users", remote=remote, wrangler_env=wrangler_env
    )
    rule_rows = d1_query(
        d1_name, "SELECT COUNT(*) AS c FROM monitoring_rules", remote=remote, wrangler_env=wrangler_env
    )
    obj_rows = d1_query(
        d1_name, "SELECT COUNT(*) AS c FROM r2_objects", remote=remote, wrangler_env=wrangler_env
    )

    def _count(rows: list[dict]) -> int:
        if not rows:
            return -1
        row = rows[0]
        return int(row.get("c", row.get("COUNT(*)", -1)))

    users = _count(user_rows)
    rules = _count(rule_rows)
    objects = _count(obj_rows)

    if users != expected.get("users"):
        errors.append(f"users: expected {expected.get('users')}, D1 has {users}")
    if rules != expected.get("monitoring_rules"):
        errors.append(f"rules: expected {expected.get('monitoring_rules')}, D1 has {rules}")
    if objects != expected.get("r2_objects"):
        errors.append(f"r2_objects: expected {expected.get('r2_objects')}, D1 has {objects}")

    for sample in manifest.get("checksum_sample", []):
        r2_path = sample["r2_path"]
        try:
            data = download_r2_object(
                r2_bucket, r2_path, remote=remote, wrangler_env=wrangler_env
            )
        except Exception as exc:
            errors.append(f"download failed {r2_path}: {exc}")
            continue
        stored_sha = sha256_hex(data)
        if stored_sha != sample.get("stored_sha256"):
            errors.append(f"stored checksum mismatch for {r2_path}")

    return errors


def load_manifest(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify WebUI-XL D1+R2 migration")
    parser.add_argument("--manifest", type=Path, required=True, help="manifest.json path")
    parser.add_argument("--bundle-dir", type=Path, default=None, help="Verify local bundle instead of CF")
    parser.add_argument("--d1", default="webui-xl")
    parser.add_argument("--r2-bucket", default="webui-xl-data")
    parser.add_argument("--remote", action="store_true")
    parser.add_argument("--wrangler-env", default=None, help="Wrangler env (e.g. production)")
    args = parser.parse_args()

    manifest = load_manifest(args.manifest)
    print(
        f"Manifest {manifest.get('timestamp')} — "
        f"{manifest.get('counts', {}).get('users')} users, "
        f"{manifest.get('counts', {}).get('r2_objects')} objects"
    )

    if args.bundle_dir:
        errors = verify_bundle(args.bundle_dir, manifest)
    else:
        errors = verify_remote(
            manifest,
            d1_name=args.d1,
            r2_bucket=args.r2_bucket,
            remote=args.remote,
            wrangler_env=args.wrangler_env,
        )

    if errors:
        print("Verification FAILED:")
        for err in errors:
            print(f"  - {err}")
        return 1

    print("Verification OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())