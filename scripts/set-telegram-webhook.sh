#!/usr/bin/env bash
# Register Telegram webhook for WebUI-XL Worker.
# Usage:
#   TELEGRAM_BOT_TOKEN=xxx TELEGRAM_WEBHOOK_SECRET=yyy WEBHOOK_URL=https://host/telegram/webhook ./scripts/set-telegram-webhook.sh

set -euo pipefail

TOKEN="${TELEGRAM_BOT_TOKEN:?TELEGRAM_BOT_TOKEN required}"
URL="${WEBHOOK_URL:?WEBHOOK_URL required (e.g. https://webui.example.com/telegram/webhook)}"
SECRET="${TELEGRAM_WEBHOOK_SECRET:-}"

PAYLOAD="url=${URL}"
if [[ -n "$SECRET" ]]; then
  PAYLOAD="${PAYLOAD}&secret_token=${SECRET}"
fi

echo "Setting webhook → ${URL}"
curl -fsS "https://api.telegram.org/bot${TOKEN}/setWebhook" -d "${PAYLOAD}"
echo ""
curl -fsS "https://api.telegram.org/bot${TOKEN}/getWebhookInfo"
echo ""