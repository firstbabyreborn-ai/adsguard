# LIVE TODAY — the hour-by-hour runbook

**Read this first, because it changes what "live" means.**

| What people think "live" means | What is actually possible today |
|---|---|
| Listed in the Shopify App Store | ❌ **No.** App review takes days to weeks (one founder reported 72 days). Nobody can shortcut it. |
| Deployed, installable, monitoring real pages, sending real alerts | ✅ **Yes. Today, 2–4 hours.** |

So today's target is: **a real, public, HTTPS app that installs on a real store and
starts paging you within minutes.** The App Store listing is submitted *after*
that works — and the install link works without the listing.

Total time: **~3 hours**, of which ~40 minutes is you clicking in the Partners
dashboard and ~30 minutes is waiting for deploys.

---

## Hour 0 — accounts (20 min, do these in parallel)

| # | Where | What | Cost |
|---|---|---|---|
| 1 | partners.shopify.com | Create a Partner account | **$0** |
| 2 | partners.shopify.com → Stores | Create a **development store** (free, no card) | **$0** |
| 3 | fly.io | Sign up (`fly auth signup`), add card | ~$0 (bill below $5) |
| 4 | resend.com | Sign up → API key (3,000 emails/mo free) | **$0** |

You need a **development store** because real (paid-plan) stores cannot install an
unlisted app without a link from you — and you should test on a throwaway store anyway.

---

## Hour 1 — deploy the app (40 min)

### 1.1 Create the Shopify app (5 min)

Partners dashboard → **Apps → Create app → Create app manually**.

Copy these four values somewhere; you will paste them twice.

```
Client ID        →  SHOPIFY_API_KEY
Client secret    →  SHOPIFY_API_SECRET
```

Now open **Configuration** and fill:

| Field | Value |
|---|---|
| App URL | `https://adsguard.fly.dev/app` |
| Allowed redirection URL(s) | `https://adsguard.fly.dev/auth/callback` |
| Embedded app | **Enabled** (Embed app in Shopify admin) |
| Webhooks | **Leave empty** — the app registers its own on install, including the 3 mandatory GDPR topics |

**Access scopes** (Configuration → Admin API access scopes):
```
read_products, read_inventory, read_orders, read_analytics, read_online_store_pages
```
Do not add more. Wider scopes get flagged in review and merchants see a scarier
permission screen.

### 1.2 Deploy (25 min, mostly waiting)

```bash
cd adsguard

export SHOPIFY_API_KEY=...        # client ID
export SHOPIFY_API_SECRET=...     # client secret
export APP_URL=https://adsguard.fly.dev
export RESEND_API_KEY=re_...
export ALERT_FROM=alerts@yourdomain.com

bash deploy.sh
```

`deploy.sh` validates secrets, runs the test suite, creates the app + Postgres,
attaches the database, sets secrets, deploys, and curls `/healthz`.

No `fly` CLI? `curl -L https://fly.io/install.sh | sh && fly auth signup`.
Prefer Render? `render.yaml` is included — but **use the Starter plan ($7)**; the
free tier sleeps and the scheduler dies with it, which means the product silently
does nothing. That is the worst possible failure for a monitoring app.

### 1.3 Verify (2 min)

```bash
curl -s https://adsguard.fly.dev/healthz   # {"ok":true,"storage":"pg",...}
curl -s https://adsguard.fly.dev/metrics | head
```

Open `https://adsguard.fly.dev` — landing page. Open `/app` — empty dashboard.
**The app is live.** Everything from here is making it useful.

---

## Hour 2 — install it and make it page you (40 min)

### 2.1 Install on your dev store (5 min)

Add the client ID `?shop=` install URL:

```
https://adsguard.fly.dev/auth?shop=YOUR-DEV-STORE.myshopify.com
```

You will see the consent screen → approve → land on `/app`. In your logs:

```bash
fly logs | grep installed
```

Expect: `{"msg":"installed","shop":"...","hooks":8}`. If webhooks show 0, your
`APP_URL` does not exactly match the Partner dashboard — fix that, it is always the cause.

### 2.2 Create your first watchpoint (5 min)

In the dev store, add a product (any product), copy its **product ID** from the
admin URL (`/products/1234567890`), and publish it.

Then in `/app` fill the form:

| Field | Value |
|---|---|
| Page URL | `https://YOUR-STORE.myshopify.com/products/your-product` |
| Label | `Test product — Meta Ads` |
| Shopify product ID | `1234567890` |
| Ad spend 30d | `600` |
| Sessions 30d | `3000` |
| Conversion rate % | `2` |
| AOV | `50` |
| Expected text | the first word of your product title |
| Check every | `5` |

Expected: the dashboard shows **$X/hour** for that row. With those numbers it is
`600/720 + (3000/720)×0.02×50 = $5.00/hour`.

### 2.3 Prove the alert works — the most important 15 minutes today

A monitor you have not seen fire is a monitor you cannot sell.

```bash
# 1. set your alert email in /app → Alerts form
# 2. break the product: set its inventory to 0 in Shopify admin → save
# 3. wait one interval (5 min), or force it:
curl -X POST https://adsguard.fly.dev/cron/run -H "x-cron-secret: $CRON_SECRET"
```

You should get an email/subject containing **`$5/hour`**.

> Note: the flap gate means the **first** failure is recorded but not paged.
> The second consecutive failure pages you. So run `/cron/run` twice, ~30s apart.
> That is intentional — it is what stops alert storms, which is the #1 reason
> monitoring apps get 1-star reviews.

Now restore inventory and run once more: the incident closes itself and the
dashboard's "loss prevented this month" becomes non-zero.

### 2.4 Set the cron secret (part of the safety net)

```bash
fly secrets set CRON_SECRET=$(openssl rand -hex 16)
```

In-process scheduler already runs (`SCHEDULER_ENABLED=true`, 60s tick). `/cron/run`
is the backup trigger for platforms that suspend idle processes, and lets you force
a sweep while testing.

---

## Hour 3 — make it presentable (40 min)

### 3.1 The three screenshots that decide everything

Do not skip this; App Store discovery is won by screenshot #1.

| # | Headline | What to capture |
|---|---|---|
| 1 | **$54/hour** | your dashboard with a real open incident (set inventory to 0 for the shot) |
| 2 | **"200 OK" is not "healthy"** | left: green uptime check · right: out-of-stock product page |
| 3 | **Billing that can't surprise you** | the four promise rows: hard cap, no charge for checks, meter stops on uninstall, no auto-upgrade |

Full copy deck (name, subtitle, keywords, description, launch-week plan):
**`listing/APP-STORE-LISTING.md`**.

### 3.2 Custom domain (optional, skip today)

`*.fly.dev` is HTTPS and works. A custom domain is nicer for screenshots but DNS
can take hours. Do it tomorrow: `fly certs add adsguard.yourdomain.com`, then
update `APP_URL` + the Partner URLs. **If you change `APP_URL`, re-install the app**
— webhook URLs are absolute.

### 3.3 Submit for review (10 min) — *after* 2.3 passes

Partners → your app → **Distribution** → request access to the App Store →
**Submit for review**.

Before you press submit, the checklist in `PRODUCTION.md §8` must be green. Two
of those items are the ones people skip and get rejected for:

- **Listing must not overstate.** In Sept 2026 one studio's listing overclaimed
  a feature and Shopify delisted **all 10 of their apps**. Write only what the
  app does.
- **Privacy policy reachable** at `/privacy` and **terms** at `/terms` — both exist
  in this app already, linked in the footer.

---

## What "live" looks like by end of day

```
✅ HTTPS app on the public internet
✅ Installed on a real Shopify store (OAuth + billing + 8 webhooks)
✅ Monitoring a real product page every 5 minutes
✅ A real alert in your inbox containing "$X/hour"
✅ Compliance webhooks (customers/data_request, customers/redact, shop/redact)
✅ Landing page, pricing, privacy, terms
⏳ App Store listing → in review (days to weeks; not in your control)
```

---

## If something breaks (these are the only three things that usually break)

| Symptom | Cause | Fix |
|---|---|---|
| OAuth shows "This app can't be installed" | Partner dashboard App URL does not match `APP_URL` **exactly** (including `https`, no trailing slash) | fix both, re-install |
| `/app` loads but is empty | no merchant record — you opened it before installing | install via `/auth?shop=...` first |
| No email arrives | `RESEND_API_KEY` missing (alerts are silently *simulated*) or alert email not set in `/app` → Alerts | set both; check `/metrics` → `adsguard_alert_failures_24h` |
| Healthcheck failing on Fly | app booted with `STORAGE_DRIVER=json` in production — **this is a deliberate boot failure** | `fly secrets set STORAGE_DRIVER=pg` |

Logs, always: `fly logs` — every line is one JSON object. `sweep_complete`,
`installed`, `alert_delivery_failed`, `webhook_bad_hmac` are the useful ones.

---

## Tomorrow → first paying merchant

1. **Free tier live** (already is). Anyone with the install link can install.
2. Post **one** genuinely useful teardown in r/shopify — *"I monitored 4 paid
   landing pages for 30 days, here's what broke"* — no link in the post. Your
   profile has the link.
3. Reply to every install within 4 hours. 17% of 1★ reviews in this category are
   "support never replied." That is the cheapest competitive advantage available.
4. Do **not** ask for reviews before day 21. Median 5★ reviewer writes at day 30;
   median 1★ reviewer writes at day 90 after real money has moved.

---

## The honest part

You can be live today. You **cannot** have revenue today.

- App review: days → weeks.
- First installs after approval: days.
- First paid conversion: **week 4–8** after that (trial is 14 days).
- Realistic month 1: **0–3 paying merchants.**

The thing you are buying today is not revenue, it is **evidence** — a working
alert in your inbox, a real incident log, a dashboard you can screenshot. That is
what makes the listing credible and what makes merchant #1 trust you.

**And one number to keep in front of you:** the median Shopify app earns under
$1,000/month, and half of the 22,546 live apps have never received a single review.
Today you are doing the thing that separates you from that median — shipping, then
answering the phone. There is no faster path, and this file is the fastest honest one.
