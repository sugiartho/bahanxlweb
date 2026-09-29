#!/usr/bin/env python3
"""Migrate webui_data/ (or SQLite) into Cloudflare D1 + R2 for WebUI-XL Worker."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_DIR))

from dotenv import load_dotenv

load_dotenv(PROJECT_DIR / ".env")

from scripts.migration_common import (  # noqa: E402
    WORKER_DIR,
    MigrationPlan,
    build_d1_sql,
    collect_from_files,
    collect_from_sqlite,
    default_data_dir,
    manifest_r2_path,
    migration_timestamp,
)
from webui.storage.sqlite_backend import default_db_path  # noqa: E402


def run_wrangler(args: list[str], *, dry_run: bool, wrangler_env: str | None = None) -> int:
    cmd = ["npx", "wrangler", *args]
    if wrangler_env:
        cmd.extend(["--env", wrangler_env])
    label = " ".join(cmd)
    if dry_run:
        print(f"[dry-run] {label}")
        return 0
    print(f"$ {label}")
    proc = subprocess.run(cmd, cwd=WORKER_DIR, check=False)
    return proc.returncode


def apply_d1_migrations(
    d1_name: str,
    *,
    remote: bool,
    dry_run: bool,
    wrangler_env: str | None = None,
) -> int:
    args = ["d1", "migrations", "apply", d1_name]
    if remote:
        args.append("--remote")
    return run_wrangler(args, dry_run=dry_run, wrangler_env=wrangler_env)


def execute_d1_sql(d1_name: str, sql: str, *, remote: bool, dry_run: bool, wrangler_env: str | None = None) -> int:
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8") as fh:
        fh.write(sql)
        sql_path = fh.name
    args = ["d1", "execute", d1_name, "--file", sql_path]
    if remote:
        args.append("--remote")
    rc = run_wrangler(args, dry_run=dry_run, wrangler_env=wrangler_env)
    Path(sql_path).unlink(missing_ok=True)
    return rc


def upload_r2_object(
    bucket: str,
    r2_path: str,
    payload: bytes,
    *,
    remote: bool,
    dry_run: bool,
    wrangler_env: str | None = None,
) -> int:
    with tempfile.NamedTemporaryFile(delete=False) as fh:
        fh.write(payload)
        tmp = fh.name
    args = ["r2", "object", "put", f"{bucket}/{r2_path}", "--file", tmp]
    if remote:
        args.append("--remote")
    rc = run_wrangler(args, dry_run=dry_run, wrangler_env=wrangler_env)
    Path(tmp).unlink(missing_ok=True)
    return rc


def write_bundle(output_dir: Path, plan: MigrationPlan, manifest: dict, sql: str) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "migration.sql").write_text(sql, encoding="utf-8")
    (output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    r2_root = output_dir / "r2"
    for obj in plan.r2_objects:
        path = r2_root / obj.r2_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(obj.payload)
    print(f"Bundle written to {output_dir}")


def migrate(plan: MigrationPlan, args: argparse.Namespace) -> dict:
    ts = migration_timestamp()
    manifest = plan.manifest(source=args.source, timestamp=ts)
    sql = build_d1_sql(plan)

    print(
        f"Plan: {len(plan.users)} users, {len(plan.monitoring_rules)} rules, "
        f"{len(plan.r2_objects)} R2 objects"
    )
    if plan.skipped:
        print(f"Skipped: {len(plan.skipped)} item(s)")

    if args.write_manifest:
        Path(args.write_manifest).write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        print(f"Manifest saved: {args.write_manifest}")

    if args.bundle_dir:
        bundle = Path(args.bundle_dir)
        write_bundle(bundle, plan, manifest, sql)
        return manifest

    if not args.skip_migrations:
        rc = apply_d1_migrations(
            args.d1,
            remote=args.remote,
            dry_run=args.dry_run,
            wrangler_env=args.wrangler_env,
        )
        if rc != 0:
            raise SystemExit(rc)

    rc = execute_d1_sql(
        args.d1,
        sql,
        remote=args.remote,
        dry_run=args.dry_run,
        wrangler_env=args.wrangler_env,
    )
    if rc != 0:
        raise SystemExit(rc)

    for i, obj in enumerate(plan.r2_objects, start=1):
        rc = upload_r2_object(
            args.r2_bucket,
            obj.r2_path,
            obj.payload,
            remote=args.remote,
            dry_run=args.dry_run,
            wrangler_env=args.wrangler_env,
        )
        if rc != 0:
            raise SystemExit(rc)
        if i % 25 == 0 or i == len(plan.r2_objects):
            print(f"R2 upload: {i}/{len(plan.r2_objects)}")

    manifest_bytes = json.dumps(manifest, indent=2).encode("utf-8")
    manifest_path = manifest_r2_path(ts)
    rc = upload_r2_object(
        args.r2_bucket,
        manifest_path,
        manifest_bytes,
        remote=args.remote,
        dry_run=args.dry_run,
        wrangler_env=args.wrangler_env,
    )
    if rc != 0:
        raise SystemExit(rc)

    print(f"Migration complete. Manifest: r2://{args.r2_bucket}/{manifest_path}")
    return manifest


def build_plan(args: argparse.Namespace) -> MigrationPlan:
    encrypt = not args.no_encrypt
    if args.source == "file":
        data_dir = Path(args.data_dir) if args.data_dir else default_data_dir()
        return collect_from_files(data_dir, encrypt_at_rest=encrypt)
    db_path = Path(args.db) if args.db else default_db_path()
    return collect_from_sqlite(db_path, encrypt_at_rest=encrypt)


def main() -> int:
    parser = argparse.ArgumentParser(description="Migrate WebUI-XL storage to D1 + R2")
    parser.add_argument("--source", choices=("file", "sqlite"), default="file")
    parser.add_argument("--data-dir", type=Path, default=None, help="webui_data root (file source)")
    parser.add_argument("--db", type=Path, default=None, help="SQLite path (sqlite source)")
    parser.add_argument("--d1", default="webui-xl", help="D1 database name (wrangler.toml)")
    parser.add_argument("--r2-bucket", default="webui-xl-data", help="R2 bucket name")
    parser.add_argument("--remote", action="store_true", help="Target remote CF (default: local)")
    parser.add_argument("--dry-run", action="store_true", help="Print wrangler commands only")
    parser.add_argument("--no-encrypt", action="store_true", help="Disable AES-GCM at rest")
    parser.add_argument("--skip-migrations", action="store_true", help="Skip d1 migrations apply")
    parser.add_argument(
        "--bundle-dir",
        type=Path,
        default=None,
        help="Write SQL + R2 payloads + manifest locally (no wrangler)",
    )
    parser.add_argument("--write-manifest", type=Path, default=None, help="Also save manifest.json locally")
    parser.add_argument(
        "--wrangler-env",
        default=None,
        help="Wrangler environment from wrangler.toml (e.g. production, staging)",
    )
    args = parser.parse_args()

    if args.dry_run and not args.bundle_dir:
        print("Dry-run: wrangler commands will be printed, not executed.")

    plan = build_plan(args)
    if not plan.users and not plan.r2_objects:
        print("Nothing to migrate — check --source / paths.")
        return 1

    migrate(plan, args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())