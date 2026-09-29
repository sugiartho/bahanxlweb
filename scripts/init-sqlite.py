#!/usr/bin/env python3
"""Initialize the SQLite storage database for WebUI-XL."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_DIR))

from dotenv import load_dotenv

load_dotenv(PROJECT_DIR / ".env")

from webui.storage.sqlite_backend import default_db_path, init_db


def main() -> int:
    parser = argparse.ArgumentParser(description="Initialize WebUI-XL SQLite database")
    parser.add_argument(
        "--db",
        type=Path,
        default=None,
        help="Database path (default: WEBUI_SQLITE_PATH or webui_data/webui.db)",
    )
    args = parser.parse_args()

    path = init_db(args.db)
    print(f"SQLite storage ready: {path}")
    print(f"Set WEBUI_STORAGE_BACKEND=sqlite in .env to use it.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())