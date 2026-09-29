# WebUI-XL Production Cutover Runbook

Operational guide for moving production traffic from the VPS (uvicorn + `webui_data/`) to Cloudflare Worker (D1 + R2). Complete [cutover-checklist.md](cutover-checklist.md) on **staging** before executing this runbook.

**Estimated maintenance window:** 30–60 minutes (DNS propagation may take longer).

---

## Roles

| Role | Responsibility |
|------|----------------|
| Operator | Runs commands, owns go/no-go |
| DNS admin | Updates A/CNAME records |
| Maintainer | MyXL API secrets, Telegram bot token |

---

## Phase 0 — Go / no-go gates

All must be true before production cutover:

- [ ] Staging E2E passed (`npm run test:e2e:staging` with staging URL + credentials)
- [ ] Staging migration verified (`scripts/verify-migration.py`)
- [ ] Telegram webhook tested on staging (`/link`, `/quota`, purchase callback)
- [ ] Parallel VPS vs staging comparison completed (24–48h)
- [ ] DNS TTL lowered to **300s** at least 24h before cutover
- [ ] Rollback plan reviewed (Section 8)

---

## Phase 1 — Provision production bindings

From repo root:

```bash
cd worker

# D1 (production)
npx wrangler d1 create webui-xl
# Note database_id from output → fill worker/wrangler.toml [env.production]

# R2
npx wrangler r2 bucket create webui-xl-data

# Queue (optional — async purchase)
npx wrangler queues create purchase-jobs

# Apply schema
npx wrangler d1 migrations apply webui-xl --env production --remote
```

Update `worker/wrangler.toml` `[env.production]` placeholders:

- `database_id` for D1
- `bucket_name` for R2
- `routes` / `custom_domain` for your hostname
- Queue / Durable Object IDs when enabled

---

## Phase 2 — Production secrets

Never commit secrets. Set via Wrangler (repeat for `--env staging` if needed):

```bash
cd worker

# Session & storage
npx wrangler secret put SESSION_SECRET --env production
npx wrangler secret put STORAGE_ENCRYPTION_KEY --env production

# MyXL API (from .env.template)
npx wrangler secret put BASE_API_URL --env production
npx wrangler secret put BASE_CIAM_URL --env production
npx wrangler secret put BASIC_AUTH --env production
npx wrangler secret put UA --env production
npx wrangler secret put API_KEY --env production
npx wrangler secret put AES_KEY_ASCII --env production
npx wrangler secret put AX_FP_KEY --env production
npx wrangler secret put AX_FP --env production
npx wrangler secret put ENCRYPTED_FIELD_KEY --env production
npx wrangler secret put XDATA_KEY --env production
npx wrangler secret put AX_API_SIG_KEY --env production
npx wrangler secret put X_API_BASE_SECRET --env production

# Telegram
npx wrangler secret put TELEGRAM_BOT_TOKEN --env production
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET --env production
```

Verify bindings:

```bash
npx wrangler secret list --env production
```

---

## Phase 3 — Migrate production data

Run during the maintenance window (or immediately before DNS switch if traffic is still on VPS).

```bash
cd ..   # repo root

# Use the SAME STORAGE_ENCRYPTION_KEY as production Worker secret
STORAGE_ENCRYPTION_KEY=<hex> python3 scripts/migrate-to-d1-r2.py \
  --remote \
  --d1 webui-xl \
  --r2-bucket webui-xl-data \
  --write-manifest ./manifest-production.json

python3 scripts/verify-migration.py \
  --manifest ./manifest-production.json \
  --remote \
  --d1 webui-xl \
  --r2-bucket webui-xl-data
```

**Checkpoint:** user count, `r2_objects` count, and checksum sample all match manifest.

---

## Phase 4 — Deploy production Worker

```bash
cd worker
npm run typecheck
npm test
npm run test:e2e
npx wrangler deploy --env production
```

Smoke immediately on the production URL (workers.dev or custom domain):

```bash
curl -sS "https://<production-host>/health"
```

Expected: `{"ok":true,"service":"webui-xl","environment":"production",...}`

Optional authenticated smoke:

```bash
E2E_BASE_URL=https://<production-host> \
E2E_USERNAME=<user> \
E2E_PASSWORD=<pass> \
E2E_TELEGRAM_WEBHOOK_SECRET=<secret> \
  npm run test:e2e:staging
```

---

## Phase 5 — DNS cutover

1. **Record target:** Cloudflare Worker custom domain or `*.workers.dev` (temporary).
2. **Update DNS** (example — adjust for your zone):

   | Type | Name | Target |
   |------|------|--------|
   | CNAME | `webui` | `<production-worker-host>` |

3. **Purge CDN cache** if a proxy sits in front of the old VPS.
4. Confirm resolution:

   ```bash
   dig +short webui.<your-domain>
   curl -sS -o /dev/null -w "%{http_code}" "https://webui.<your-domain>/health"
   ```

5. **Session note:** existing `mecli_session` cookies remain valid if `SESSION_SECRET` was migrated unchanged.

---

## Phase 6 — Telegram webhook switch

Point the bot to production (downtime: seconds until Telegram updates).

```bash
TELEGRAM_BOT_TOKEN=... \
TELEGRAM_WEBHOOK_SECRET=... \
WEBHOOK_URL=https://<production-host>/telegram/webhook \
  ./scripts/set-telegram-webhook.sh
```

Verify:

- [ ] `getWebhookInfo` shows production URL, `pending_update_count` reasonable
- [ ] Send `/start` — bot responds
- [ ] Linked user receives monitor alert or daily summary (if enabled)

---

## Phase 7 — VPS decommission

After **48h stable** production (see Phase 8), retire the old stack.

### 7.1 Stop services

```bash
# On VPS
sudo systemctl stop me-cli-sunset.service
sudo systemctl disable me-cli-sunset.service

# If using cloudflared tunnel
sudo systemctl stop cloudflared
sudo systemctl disable cloudflared
```

Reference unit file (archived): `ops/archive/me-cli-sunset-vps.service`

### 7.2 Archive data (do not delete immediately)

```bash
sudo tar -czf /backup/webui_data-$(date +%Y%m%d).tar.gz /path/to/me-cli-sunset/webui_data
sudo tar -czf /backup/webui-xl-env-$(date +%Y%m%d).tar.gz /path/to/me-cli-sunset/.env
```

Keep archives **≥ 30 days** after cutover.

### 7.3 Optional — remove packages

Only after confirmed rollback is no longer needed:

```bash
sudo rm /etc/systemd/system/me-cli-sunset.service
sudo systemctl daemon-reload
```

---

## Phase 8 — Post-cutover monitoring (48h)

| Check | How | Threshold |
|-------|-----|-----------|
| Health | `GET /health` every 5m | HTTP 200, `ok: true` |
| Error rate | CF Workers analytics | < 1% 5xx |
| Monitor cron | Telegram alerts / `monitor.log` in R2 | Rules fire as expected |
| Purchase queue | QRIS poll + Telegram receipt | Success path works |
| Telegram | User reports / webhook logs | No auth failures |

**Rollback trigger:** sustained 5xx > 1% for 15m, or data corruption detected → Section 8.

---

## Section 8 — Rollback

If production is unhealthy and VPS is still available:

1. **DNS:** revert CNAME/A to VPS / cloudflared tunnel target.
2. **Telegram:** re-register webhook to VPS URL.
3. **Start VPS:**

   ```bash
   sudo systemctl enable --now me-cli-sunset.service
   sudo systemctl enable --now cloudflared   # if used
   ```

4. **Do not delete** D1/R2 data — use for post-mortem and re-cutover.
5. Document incident; fix Worker issue on staging before retry.

---

## Quick reference

| Item | Path / command |
|------|----------------|
| Staging checklist | `docs/cutover-checklist.md` |
| Migration | `scripts/migrate-to-d1-r2.py` |
| Verify migration | `scripts/verify-migration.py` |
| E2E local | `cd worker && npm run test:e2e` |
| E2E staging/prod | `npm run test:e2e:staging` + `E2E_BASE_URL` |
| Webhook | `scripts/set-telegram-webhook.sh` |
| Wrangler prod | `npx wrangler deploy --env production` |
| Design doc | `docs/DESIGN-cf-worker-migration.md` |

---

## Changelog

| Date | Operator | Notes |
|------|----------|-------|
| | | Initial production cutover |