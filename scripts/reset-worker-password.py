#!/usr/bin/env python3
"""Reset a WebUI user's password hash in remote D1 (Worker-safe 10k PBKDF2 iterations)."""
from __future__ import annotations

import argparse
import hashlib
import secrets
import subprocess
import sys
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parents[1]
WORKER_DIR = PROJECT_DIR / "worker"
WORKER_ITERS = 10_000


def hash_password_worker(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, WORKER_ITERS)
    return f"pbkdf2_sha256${WORKER_ITERS}${salt.hex()}${dk.hex()}"


def main() -> int:
    parser = argparse.ArgumentParser(description="Reset WebUI password in Cloudflare D1")
    parser.add_argument("--username", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--d1", default="webui-xl")
    parser.add_argument("--remote", action="store_true")
    parser.add_argument("--wrangler-env", default="production")
    args = parser.parse_args()

    username = args.username.lower().strip()
    encoded = hash_password_worker(args.password)
    sql = (
        "UPDATE webui_users SET password_hash = "
        f"'{encoded.replace(chr(39), chr(39)*2)}', "
        f"updated_at = strftime('%s','now') "
        f"WHERE username = '{username.replace(chr(39), chr(39)*2)}';"
    )

    cmd = ["npx", "wrangler", "d1", "execute", args.d1, "--command", sql]
    if args.remote:
        cmd.append("--remote")
    if args.wrangler_env:
        cmd.extend(["--env", args.wrangler_env])

    print(f"Updating password for '{username}' ({WORKER_ITERS} PBKDF2 iters)...")
    proc = subprocess.run(cmd, cwd=WORKER_DIR, check=False)
    return proc.returncode


if __name__ == "__main__":
    raise SystemExit(main())