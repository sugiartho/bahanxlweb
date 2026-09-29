#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -f "$ROOT/.cf.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$ROOT/.cf.env"
  set +a
fi
cd "$ROOT"
exec "$@"