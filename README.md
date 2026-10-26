# AdsGuard

**Paid-traffic protection for Shopify stores.**

An uptime monitor tells you a page is up. AdsGuard tells you a page you are
*paying* for cannot convert — and how many dollars an hour that is costing you.

```
Money at risk right now:  $53/hour
= the burn rate of 2 pages you are currently buying traffic for
```

---

## Why this exists (evidence, not a pitch)

I read the public App Store complaint data before writing a line of code.

| Finding | Source |
|---|---|
| **Billing is the #1 complaint in 1–2★ reviews (23%).** Support #2 (17%), "it stopped working" #3 (12%). **"Missing a feature" came last, at 3%.** | 5,851 bad reviews across 209 apps, Aug 2026 |
| Median **1★** reviewer had been paying **90 days**. Median **5★** reviewer wrote after **30**. | 2,797 bad reviews, Aug 2026 |
| **51% of the 22,546 live apps have zero reviews. 72% of all revenue goes to 225 apps.** | State of the Shopify App Economy, Jun 2026 |
| **99% of scanned stores have no support app; 98.2% no analytics app.** | 1.6M-store scan, Oct 2026 |
| Shopify take rate: **0% on your first $1M lifetime**, then 15%. | Shopify Partner terms, Jul 2026 |

Three design consequences:

1. **Features are not the product. Reliability and billing fairness are.**
2. **The output must be a number, not a dashboard.**
3. **Nothing may require a human at our end.** Every alert is generated and
   delivered with us out of the loop.

---

## What it does

For each URL you buy traffic for, every 5–10 minutes:

| Check | Catches |
|---|---|
| **Resolves** | 4xx/5xx, timeout, DNS/TLS failure |
| **Expected content present** | the failure a 200-status check is blind to — theme bug, app conflict, wrong template |
| **Product exists, published, buyable** | deleted, draft, `totalInventory = 0` |
| **Price within threshold** | feed / ad copy / checkout quoting different numbers |
| **Admin API reachable** | "you have lost visibility" — itself an incident |

And for every failure, one derived number:

```
riskPerHour = (30-day ad spend ÷ 720) + (sessions ÷ 720 × conversion rate × AOV)
```

Ad burn **plus** revenue you can no longer earn. Never hard-coded — change the
onboarding inputs and the dashboard changes.

### Deliberately out of scope
Not a synthetic browser test (that is Uptime by Jagged Pixel's lane, and a good
one). Not a competitor scraper. Not an all-in-one "store health" suite. One job.

---

## The fair-billing promise (a growth channel, not charity)

Billing is the single biggest source of 1★ reviews in this category, so being
*provably* fair is the differentiator:

| Promise | Enforced in code |
|---|---|
| Hard cap, no overages | `PRICING.maxMonthly = 49`; there is no overage code path |
| **No charge for checks** | billing counts *incidents caught*, never pings (`incidentOnlyBilling`) |
| Nothing caught → nothing charged | no incident in a period = no usage line |
| Meter stops on uninstall | `markUninstalled()` sets `billing.stoppedAt` in the same write |
| No auto-upgrade | the code path does not exist |
| 14-day trial, cancel in-app | Shopify Billing handles it |

Put this in screenshot #3 of the listing. It is the cheapest available
differentiator in a category where 23% of complaints are about money.

---

## Architecture

```
                    ┌──────────────────────────────────────────┐
   Shopify  ───────▶│ session token (HS256) → shop             │
   (iframe)         │                                          │
                    │  /app  /api/*   →  views.js              │
                    └───────────────┬──────────────────────────┘
                                    │
   webhooks ───────────────▶ server.js (HMAC verified)
   (products, inventory,            │
    uninstall, GDPR)                ▼
                          ┌────────────────────┐
                          │ runner.js          │  single writer of events
                          │  flap gate (N≥2)   │
                          │  dedupe (watch,kind)│
                          │  cooldown 300s     │
                          └─────────┬──────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
            ┌──────────────┐                ┌──────────────┐
            │ checks.js    │                │ alerts.js    │
            │ http/content │                │ email/slack  │
            │ stock/price  │                │ sms + record │
            │ → $/hour     │                └──────────────┘
            └──────────────┘
                    │
                    ▼
            ┌──────────────────────────────┐
            │ storage: pg | json           │   same interface
            └──────────────────────────────┘
```

`runner.js` is the only module that writes incidents, so the rules that keep
merchants from uninstalling live in exactly one file.

---

## Run it

Zero required dependencies. Node 20.11+.

```bash
cd adsguard
STORAGE_DRIVER=json node scripts/seed.js
STORAGE_DRIVER=json node src/server.js      # http://localhost:3000
```

| Route | What |
|---|---|
| `/` | landing + pricing |
| `/app` | dashboard (demo shop) |
| `/pricing`, `/privacy`, `/terms` | listing-required pages |
| `/api/state` · `POST /api/run` · `POST /api/watch` · `POST /api/settings` · `POST /api/billing` | JSON API |
| `/healthz` · `/metrics` | liveness + Prometheus text |
| `/app/setup` | onboarding form |
| `POST /app/watch` · `POST /app/settings` · `POST /app/watch/:id/delete` | no-JS HTML forms (HMAC CSRF token) |
| `/auth?shop=…` → `/auth/callback` | real OAuth install |
| `POST /webhooks` | products, inventory, uninstall, **GDPR x3** |
| `POST /cron/run` | external trigger for sleeper platforms (`x-cron-secret`) |

```bash
npm test              # 39 tests
node scripts/smoke.js # 18 end-to-end assertions against a running server
```

**Launching today? Read [INSTALL_TODAY.md](INSTALL_TODAY.md)** — hour-by-hour,
including the 15 minutes that prove an alert actually fires.

### Postgres (production storage)

```bash
export DATABASE_URL='postgres://postgres:pg@localhost:5432/adsguard?sslmode=disable'
node scripts/migrate.js
STORAGE_DRIVER=pg node src/server.js
```

Migrations are idempotent and run on boot. `STORAGE_DRIVER=json` in production is
a **hard boot failure** — a monitor that reports "healthy" when it means
"unknown" is worse than one that is down.

---

## Deploy

`Dockerfile`, `fly.toml`, `render.yaml` and a CI workflow (unit + smoke + a real
Postgres round-trip) are included. Full instructions: **[PRODUCTION.md](PRODUCTION.md)**.

Two non-negotiables:
- **Always-on process.** A sleeping dyno stops the scheduler, which means the
  product silently does nothing. Do not deploy this on a free tier.
- **`APP_URL` must be https** and match the Partner dashboard exactly.

---

## Test coverage (39 assertions)

| Area | What is proven |
|---|---|
| money math | `riskPerHour` formula, zero-safe, string inputs |
| the four checks | content-missing, stock-out, draft product, deleted product, price drift/crash, timeout vs unreachable |
| auth | session-token signature, expiry, audience, non-Shopify destination, tampered payload, garbage input |
| SSRF | `*.myshopify.com` validation, 300-char domain, path traversal |
| webhooks | raw-body HMAC, tampered body rejection |
| orchestration | flap gate, "catch-up" page on persistence, dedupe, recovery duration + loss |
| billing | uninstall stops the meter, no overage key exists |
| GDPR | `shop/redact` removes shop + children |
| ops | delivery-health counters surface a broken alert channel |
| forms | CSRF token bound to one shop, replay to another shop rejected, expiry rejected |

---

## Honest limitations

1. **Not launched.** No App Store listing yet, no merchants. Revenue is $0.
   `PRODUCTION.md §8` is the pre-submission checklist.
2. **No App Store listing yet** — the app is installable and usable today via its
   install link, but public discovery requires review. See INSTALL_TODAY.md.
3. **The demo watchpoints point at `demo-store.com`, which does not resolve.**
   Pressing "run checks" produces 5 `unreachable` incidents. That is the engine
   working correctly.
4. **Admin API checks are skipped without an access token.** Real OAuth supplies
   one; the `productId` on a watchpoint activates stock and price checks.
5. **Forms are server-rendered, no client JS.** App Bridge session tokens are used
   for `/api/*`; the HTML forms use a short-lived HMAC token bound to the shop.
6. **$50k MRR from this app alone is a top-1% outcome** and would need ~1,700
   paying merchants. Plan for $5k on app #1 (430 paying ≈ 4,300 installs);
   the $50k path is 10 apps sharing one backend. See `VALIDATION.md`.
7. **The biggest competitive risk** is an incumbent (ShopStatus, StatusBird,
   Uptime) shipping a "$/hour" column. The mitigation is not more code — it is
   publishing the cost-of-downtime methodology first and owning the phrase.

---

## File map

```
src/
  config.js       env + fail-fast validation
  logger.js       structured JSON logs, asyncRoute wrapper
  checks.js       http · content · stock · price → riskPerHour
  runner.js       flap gate, dedupe, resolve, stats   ← single writer of events
  alerts.js       email / slack / sms, suppression, delivery records
  shopify.js      OAuth, session tokens, HMAC, webhooks, Billing API, PRICING
  scheduler.js    in-process sweep with overlap guard + jitter
  views.js        dashboard, onboarding, landing, pricing, legal, forms
  server.js       routes + bootstrap
  storage/        index.js (factory) · pg.js · json.js
migrations/001_init.sql
scripts/          seed.js · migrate.js · smoke.js
deploy.sh         one-command Fly deploy (validates, tests, deploys, verifies)
docker-compose.yml  app + Postgres, production parity locally
INSTALL_TODAY.md  hour-by-hour launch runbook
listing/          APP-STORE-LISTING.md  (copy deck, screenshots, launch plan)
test/             checks · shopify · runner   (37 assertions)
```

---

## The one sentence

> The product is not a monitor. **The product is the sentence: "you are losing
> $53/hour right now, and here is the page."**
> Everything else in this repo exists to make that sentence true and provable.
