# WebUI-XL Staging Cutover Checklist

Use this checklist before DNS cutover from VPS to Cloudflare Worker. Run E2E smoke tests after each major step.

## Prerequisites

- [ ] Cloudflare account with Workers, D1, R2 provisioned
- [ ] `worker/wrangler.toml` bindings configured for staging (`DB`, `DATA`, secrets)
- [ ] `STORAGE_ENCRYPTION_KEY` and `SESSION_SECRET` set via `wrangler secret put`
- [ ] MyXL API secrets (`API_KEY`, `BASE_API_URL`, etc.) configured on staging

## 1. Deploy staging Worker

```bash
cd worker
npm run typecheck
npm test
npx wrangler deploy --env staging   # or default workers.dev URL
```

- [ ] `GET /health` returns `{"ok":true,"service":"webui-xl",...}`
- [ ] Login page loads at `/u/login`

## 2. Migrate data to staging D1 + R2

```bash
cd ..
STORAGE_ENCRYPTION_KEY=<hex> python3 scripts/migrate-to-d1-r2.py \
  --remote --d1 webui-xl --r2-bucket webui-xl-data

python3 scripts/verify-migration.py \
  --manifest ./manifest.json --remote \
  --d1 webui-xl --r2-bucket webui-xl-data
```

- [ ] User count matches `webui_data/users.json`
- [ ] `r2_objects` row count matches manifest
- [ ] Sample checksum verification passes

## 3. Register Telegram webhook (staging)

```bash
TELEGRAM_BOT_TOKEN=... \
TELEGRAM_WEBHOOK_SECRET=... \
WEBHOOK_URL=https://<staging-host>/telegram/webhook \
  ./scripts/set-telegram-webhook.sh
```

- [ ] `getWebhookInfo` shows correct URL and no pending errors
- [ ] `/link` command links a test user
- [ ] Test message from `/monitoring/telegram/test` succeeds

## 4. Run E2E smoke suite

**Local (in-process, no staging URL required):**

```bash
cd worker
npm run test:e2e
```

**Against staging:**

```bash
cd worker
E2E_BASE_URL=https://<staging-host> \
E2E_USERNAME=<webui-user> \
E2E_PASSWORD=<password> \
E2E_TELEGRAM_WEBHOOK_SECRET=<optional-secret> \
  npm run test:e2e:staging
```

- [ ] All local smoke tests pass (health, auth, monitoring, telegram webhook)
- [ ] Staging public routes pass when `E2E_BASE_URL` is set
- [ ] Staging authenticated routes pass with `E2E_USERNAME` / `E2E_PASSWORD`

## 5. Functional smoke (manual)

- [ ] WebUI login / logout
- [ ] MyXL OTP login and account switch
- [ ] Dashboard, packages, hot, store pages
- [ ] Purchase flow (balance + async QRIS poll)
- [ ] Monitoring: refresh, add rule, run-once
- [ ] Family-loop SSE (`/purchase/family-loop/stream`)
- [ ] Telegram commands: `/start`, `/menu`, `/quota`, `/link`

## 6. Parallel run vs VPS

- [ ] Run VPS and staging side-by-side for 24–48h
- [ ] Compare quota responses and purchase outcomes on same MSISDN
- [ ] Monitor cron fires (check `monitor.log` / Telegram alerts)

## 7. DNS cutover (production)

- [ ] Lower DNS TTL to 300s at least 24h before cutover
- [ ] Deploy production Worker + run migration against prod D1/R2
- [ ] Point DNS to Worker route / custom domain
- [ ] Re-register Telegram webhook to production URL
- [ ] Stop VPS `me-cli-sunset.service` and disable cloudflared
- [ ] Watch error rate for 48h; rollback DNS if error rate > 1%

## Rollback

1. Restore DNS to VPS / cloudflared tunnel
2. Re-point Telegram webhook to VPS URL
3. Keep D1/R2 data — do not delete until stable for 48h

## References

- **Production runbook:** [cutover-runbook.md](cutover-runbook.md) (DNS, secrets, VPS decommission)
- Migration: `scripts/migrate-to-d1-r2.py`, `scripts/verify-migration.py`
- Design: `docs/DESIGN-cf-worker-migration.md`
- E2E tests: `worker/e2e/`
- Wrangler envs: `worker/wrangler.toml` (`--env staging` / `--env production`)