# App Store listing — copy deck

Everything here is dictated by one rule from the research:
**billing is 23% of 1–2★ reviews and "missing feature" is 3%.** So the listing
leads with money and trust, never with a feature grid.

---

## 1. Name (60 char limit)

```
AdsGuard: Ad Landing Page Monitor
```
*(33 chars — leaves room for the ranking tokens)*

**Rejected alternatives:** "Store Monitor", "Uptime Monitor", "Ads Monitor" — every
one of those is already owned by a 100+ review incumbent and we lose the
head-to-head on review count.

---

## 2. Tagline / subtitle (70 char limit) — the single most important line

```
Tells you which page you're paying for is broken — and what it costs per hour.
```
*(77 chars — trim to option B)*

**Option B (recommended, 68 chars):**
```
See the $/hour you're losing when a paid landing page breaks.
```

This line is what appears in search results. It contains `$/hour` (nobody else
owns this phrase), `paid landing page` (the buyer's own vocabulary) and `breaks`
(their fear).

---

## 3. Search keywords (Shopify ranks on listing coverage)

Primary (put into the app name + subtitle):
- `ad landing page monitor`
- `out of stock alert`
- `price change alert`
- `store monitoring`
- `checkout monitor`

Secondary (put into the description body, naturally):
- `broken link alert`, `404 alert`, `inventory alert`, `downtime alert`,
  `sale price monitor`, `landing page health`, `ads conversion protection`,
  `meta ads landing page`, `google ads landing page`, `tiktok ads`

Deliberately avoided: `SEO`, `AI`, `all-in-one`, `growth` — high competition,
wrong intent, and Google/Shopify have trained merchants to distrust them.

---

## 4. Description

> **You are paying for pages that cannot convert.**
>
> An uptime monitor pings your homepage and reports green. Meanwhile the product
> behind your best Meta ad is out of stock, or the theme update dropped the buy
> button, or a price sync pushed your $45 desk mat to $53. The page returns 200.
> Your dashboard says everything is fine. You keep paying for the clicks.
>
> **AdsGuard checks the pages you are actually buying traffic for**, every 5
> minutes, and reports one number: how many dollars per hour the page is costing
> you while it cannot convert.
>
> #### What it checks
> - **Does it resolve?** 4xx, 5xx, timeouts, DNS and TLS failures
> - **Is the content there?** the failure a 200-response check is blind to —
>   broken theme, app conflict, redirect to the wrong template
> - **Is the product buyable?** deleted, unpublished, or inventory at zero
> - **Is the price where you left it?** catches feed and ad-copy drift
> - **Can we still see your store?** an Admin API failure is itself an incident
>
> #### The number
> `$/hour = ad spend ÷ 720 + sessions ÷ 720 × conversion rate × AOV`
>
> Built from *your* numbers during onboarding. It is the burn rate of a page that
> cannot convert — not a guess. If it says $31/hour, you have until your next
> coffee to fix a $750/month leak.
>
> #### What it does not do
> It does not fix your store, write your ads, or manage your inventory. It
> monitors and it tells you. One job, done every five minutes.
>
> #### The fair-billing promise
> This category's #1 complaint is billing. So:
> - **Hard cap at $49/month.** No overage, ever.
> - **No charge for checks.** You are billed for incidents we caught, not for
>   pings we sent.
> - **The meter stops the moment you uninstall.**
> - **No auto-upgrade.** There is no code path for it.
> - 14-day trial. Cancel inside the app.
>
> #### Who this is for
> Stores spending **$300+/month** on paid traffic to specific product or landing
> pages. If you spend less than that, this is not worth your money and we would
> rather tell you now.
>
> #### Who this is not for
> Stores that only need generic uptime monitoring, or that want a full store-health
> suite. There are good, cheaper tools for both.

---

## 5. The five screenshots (this is the whole conversion)

Rank-aware rule: **screenshot 1 decides the install.** It must be the number, not
the logo.

| # | Headline (large) | Sub (small) | Visual |
|---|---|---|---|
| **1** | **$54/hour** | "This store is paying for two broken pages right now. None of its monitors reported an incident." | Dashboard hero, red number, two red incident cards |
| **2** | **"200 OK" is not "healthy"** | "The page loaded. The product was sold out. It still returned 200." | Split: left = green uptime check, right = out-of-stock product |
| **3** | **Billing that can't surprise you** | "Hard cap $49. No charge for checks. Meter stops on uninstall." | The four promise rows, checkmarks |
| **4** | **Alert where you already are** | "Email, Slack, SMS — with the $/hour in the subject line" | Phone + Slack notification mockups |
| **5** | **Setup in 3 minutes** | "Pick a page, enter ad spend + sessions. That's the whole onboarding." | 3-step inline UI |

Rules applied:
- Never show a feature grid as screenshot 1. Nobody installs for a table.
- Every screenshot has **one number** in it.
- No stock photography. No gradients behind text. Shopify admins are looking at
  12 of these listings in a row; clarity wins.

---

## 6. Pricing page copy (inside the app)

```
Free       $0    · 1 watchpoint   · 60-min checks · email
Starter    $19   · 15 watchpoints · 10-min checks · + Slack
Growth     $49   · 60 watchpoints · 5-min checks  · + SMS
```

On the pricing screen, above the tiers:

> **Break-even math:** Growth is $1.63/day. It pays for itself if it catches one
> 2.5-hour incident per month on a page where an hour of downtime costs $20.

---

## 7. Support / response policy (paste into the listing + FAQ)

- Replies within **4 business hours**, 7 days a week, for the first 12 months.
  This is a commitment, not marketing: **17% of 1–2★ reviews in this category are
  "support never replied."**
- Never ask a merchant to change a review. (Shopify removes those and it is
  against the Partner rules.)
- Publish a public status page for *our* checks, not just Shopify's.

---

## 8. Review-request timing (this is deliberate)

Data: the median **5★ reviewer writes after 30 days**, the median **1★ reviewer
after 90 days**. So ask for a review at **day 21–30**, right after the first
"we caught it" moment, not at day 90.

Trigger: first time an incident is **resolved** and the merchant has ≥ 1 healthy
week → in-app prompt.

---

## 9. Launch-week distribution (no cold outreach)

| Day | Action | Why |
|---|---|---|
| 1 | Publish listing; set free tier live | install engine |
| 2 | Post in r/shopify: *"I measured 4 paid landing pages for 30 days — here's what broke"* — no link in the post | Reddit rewards genuine data; the profile link does the selling |
| 3 | Same teardown as a Shopify Community post with the data table | merchants read the Community while researching |
| 5 | Submit an MCP endpoint to the Claude/ChatGPT directories | free credibility badge, usage-ranked, no ad bidding |
| 7 | Post the *cost-of-downtime* methodology (formula + two anonymised case numbers) | owns the `$/hour` phrase before an incumbent does |

No cold DMs. No paid ads. No review incentives (they get you delisted).
