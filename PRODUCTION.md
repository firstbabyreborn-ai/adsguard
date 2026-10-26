# Production runbook

You are four commands away from a live app. This file is the operational half of
the product — the part that decides whether merchants trust it.

---

## 0. What "production ready" means here (and what it doesn't)

| Ready | Not ready (do these before submitting) |
|---|---|
| Multi-driver storage (Postgres + JSON), migrations that run on boot | Real-product gaps: no UI form for adding watchpoints (API only) |
| App Bridge session-token auth, HMAC, CSRF state, SSRF guards | `built for Shopify` checklist (embedded nav, Polaris-ish styling, mobile) |
| Compliance webhooks (`customers/data_request`, `customers/redact`, `shop/redact`) | Screenshots rendered from a real store (currently HTML mocks) |
| Flap gate, de-duplication, delivery-health metrics | A support inbox you actually answer within 4 hours |
| Fair-billing enforcement (hard cap, no overage code path) | Multi-marketplace (BigCommerce/Woo) — month 6+, not now |
| Docker, CI with real Postgres, smoke suite, structured logs | Pricing experiment data — needs 100 installs first |

**Do not submit to the App Store until the right column is finished.** One
listing that overstates capability got a studio's **entire 10-app portfolio
delisted** in September 2026. Overclaiming is the single highest-severity risk in
this category.

---

## 1. Local, 60 seconds

```bash
cd adsguard
STORAGE_DRIVER=json node scripts/seed.js
STORAGE_DRIVER=json SCHEDULER_ENABLED=false node src/server.js
# http://localhost:3000/app
node scripts/smoke.js            # 11 assertions
npm test                         # 37 assertions
```

---

## 2. Postgres (production storage)

```bash
# local
docker run -d --name agdb -e POSTGRES_PASSWORD=pg -e POSTGRES_DB=adsguard -p 5432:5432 postgres:16
export DATABASE_URL='postgres://postgres:pg@localhost:5432/adsguard?sslmode=disable'

node scripts/migrate.js
STORAGE_DRIVER=pg node scripts/seed.js
STORAGE_DRIVER=pg node src/server.js
```

Migrations are **idempotent and run on boot** (`PgStore.init()` → `migrate()`),
so a fresh container self-heals. On a multi-instance deploy, run
`scripts/migrate.js` as a release command instead to avoid races.

`STORAGE_DRIVER=json` in production is a **hard boot failure**. That is
deliberate: a monitoring app with a corrupt half-written file will report
"healthy" when it means "unknown", which is worse than being down.

---

## 3. Shopify app setup

1. **Partners dashboard → Apps → Create app.** Copy the client ID + secret.
2. **App setup → URLs**
   - App URL: `https://<your-domain>/app`
   - Allowed redirection URL: `https://<your-domain>/auth/callback`
3. **Embedded app: enabled.** Session-token auth is already implemented.
4. **Webhooks:** leave the Partner UI empty — the app registers its own on
   install (`registerWebhooks`), including the three compliance topics.
5. **Scopes:** `read_products, read_inventory, read_orders, read_analytics,
   read_online_store_pages`. Anything wider fails review.
6. **Billing:** the app creates subscriptions via the GraphQL Admin API against
   the merchant's approval — never charge outside Shopify's billing.

```bash
export SHOPIFY_API_KEY=...
export SHOPIFY_API_SECRET=...
export APP_URL=https://adsguard.yourdomain.com
```

### Test the install loop
```
https://adsguard.yourdomain.com/auth?shop=your-dev-store.myshopify.com
```
Expect: consent screen → callback → webhooks registered (check logs for
`installed`) → redirect to `/app`.

---

## 4. Deploy

### Fly.io (recommended: always-on scheduler)
```bash
fly launch --no-deploy
fly postgres create --name adsguard-db
fly postgres attach adsguard-db          # sets DATABASE_URL
fly secrets set SHOPIFY_API_KEY=... SHOPIFY_API_SECRET=... APP_URL=https://adsguard.fly.dev RESEND_API_KEY=...
fly deploy
fly logs
```
`auto_stop_machines = false` in `fly.toml` is intentional. If the machine sleeps,
**checks stop and the product silently does nothing** — the worst possible
failure for a monitoring app.

### Render
`render.yaml` is included. **Use the Starter plan.** The free tier sleeps on
idle, which stops the scheduler. A free-tier deploy of this product is a
malfunction.

### Cloudflare Workers (cheapest at scale, more work)
- Port `server.js` to a `fetch(request, env)` handler (routes map 1:1).
- Swap `src/storage/pg.js` for `src/storage/d1.js` (~120 lines; same interface).
- Cron Trigger `*/5 * * * *` → `runner.runAll()`.
- Free plan allows commercial use; Vercel's Hobby tier does not.

---

## 5. Environment variables

See `.env.example`. In production the process **refuses to boot** if:
`SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, an `https://` `APP_URL`, or
`DATABASE_URL` (when `STORAGE_DRIVER=pg`) is missing. Fail fast beats a silent
half-configured monitor.

---

## 6. Observability

```bash
curl -s localhost:3000/healthz   # includes last sweep + scheduler state
curl -s localhost:3000/metrics   # Prometheus text format
```

Worth alerting on in your own dashboards:

| Metric | Alert if |
|---|---|
| `adsguard_alert_failures_24h` | > 0 for two hours — **the product is silently broken** |
| `adsguard_uptime_seconds` | drops (crash loop) |
| `/healthz` `.scheduler.lastSweepAt` | older than 3× tick interval |
| `adsguard_shops_active` | sudden drop (bad webhook handling) |

Logs are one JSON object per line. Useful messages:
`sweep_complete`, `shop_run_failed`, `alert_delivery_failed`,
`alert_suppressed_flap_gate`, `webhook_bad_hmac`, `gdpr_shop_redact`.

---

## 7. The operational promises that make this sellable

| Promise | Where it's enforced | How a merchant verifies it |
|---|---|---|
| Alert on the first real failure, within one interval | `scheduler.js` + `runner.isDue` | `/healthz` last sweep |
| No alert storms | flap gate (`ALERT_AFTER_FAILURES=2`) + one open incident per (watch, kind) + 300s cooldown | incident count on the dashboard |
| No billing surprises | `PRICING.maxMonthly`, no overage code path, `markUninstalled` stops the meter | Shopify subscription line item |
| Support answers | policy + inbox | listing FAQ |
| Delete my data | `shop/redact` → `redactShop()` | privacy page |

---

## 8. Pre-submission checklist

- [ ] `npm test` — 37/37 green
- [ ] `node scripts/smoke.js` against the deployed URL — 11/11
- [ ] Postgres CI job green (real DB round-trip)
- [ ] Real dev store: install → add watchpoint with a `productId` → trigger a
      stock-out → alert received
- [ ] Uninstall → webhook received → `billing.stoppedAt` set → scheduler skips
- [ ] `shop/redact` processed → rows gone
- [ ] Listing copy matches actual behaviour **word for word**
- [ ] Screenshots rendered from a real store
- [ ] Support email monitored, 4-hour SLA written down
- [ ] `/privacy` and `/terms` reachable and accurate
- [ ] Status page for your own uptime created

---

## 9. The first 30 days after approval

| Week | Focus | Signal to watch |
|---|---|---|
| 1 | free tier live, one Reddit teardown post (no link) | installs |
| 2 | fix the top onboarding drop-off | install → watchpoint created |
| 3 | first "we caught it" email to every installer | reply rate = product-market fit |
| 4 | review prompt at day 21–30 | reviews |

If week 4 gives you **< 4% install→paid**, the problem is the value story, not the
code. Interview ten free users before writing a single new feature — that is the
discipline the median $145/month app never applies.
