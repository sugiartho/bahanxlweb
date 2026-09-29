#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

if [[ ! -f .env ]]; then
  cp .env.template .env
  echo "Created .env from template — fill API secrets via Codespaces Secrets."
fi

python scripts/init-sqlite.py

if command -v npm >/dev/null 2>&1; then
  (cd worker && npm ci && npm test)
fi

echo ""
echo "WebUI-XL Codespaces ready."
echo "  source venv/bin/activate && python run-web.py"
echo "  Open forwarded port 8089"
echo "  cd worker && npm run dev   # CF Worker (Phase 2)"