# AdsGuard — validation file

Everything here is from public data pulled on **25 Oct 2026**. If a claim is an
estimate it says so.

---

## 1. The market, in five numbers

| # | Number | What it means for us |
|---|---|---|
| 1 | **22,546 live apps; 51% have zero reviews; 72% of revenue goes to the top 225.** | The store is a power law. There is no "average app" to beat. |
| 2 | **Billing = 23% of 1–2★ reviews. Support = 17%. "Missing a feature" = 3%.** | You do not win on features. You win on trust + response. |
| 3 | **Median 1★ reviewer had been paying 90 days.** | Failures happen *after* the honeymoon. Reliability is the retention lever. |
| 4 | **1.6M stores scanned: 99% have no support app, 98.2% no analytics, 98.2% no subscriptions.** | Monitoring/analytics is the emptiest shelf relative to its value. |
| 5 | **Shopify take rate 0% on your first $1M lifetime, then 15%.** | ~$150k of commission avoided vs Apple's 30%. This is time-limited. |

Sources: revenuehunt.com State of the Shopify App Economy (Jun 2026) · Shopify
Community analysis of 5,851 bad reviews (Aug 2026) + 60,278-review analysis
(Aug 2026) · storeinspect.com State of Shopify (Oct 2026) · weekonelabs.com
Shopify revenue-share benchmarks (Jul 2026).

---

## 2. Why *this* app, and not the thing I told you last week

I have to be straight with you: **the "seller profit tracker" idea I gave you
earlier was a bad bet, and the research killed it.** Three reasons:

1. It sold into **Meesho/Flipkart/Trendyol** — markets where the merchant's
   willingness to pay is $5–15/mo, not $49.
2. The profit math is **commodity**. It is on GitHub, on YouTube, in free
   Telegram sheets. Code is not a moat.
3. It needed **outbound sales** — the exact thing you do not want to do.

What survived every filter:

| Filter | AdsGuard |
|---|---|
| Can you sell it with **zero conversations**? | Yes — App Store listing + free tier |
| Does the platform **handle billing**? | Yes, Shopify Billing API |
| Is the value **a number**, not a feature? | Yes — $/hour at risk |
| Can one person **support it**? | Yes — alerts are automated; tickets are rare because false alarms are the main ticket source and the content check is built to avoid them |
| Is the category **empty**? | No — but the incumbents monitor *uptime*; nobody quantifies *money* |
| Does it work **without a big team**? | Yes |

### Competitive reality (do not skip this)

| App | Their lane | Our difference |
|---|---|---|
| ShopStatus ($9.99) | outages, app issues, low inventory | no money quantification, no paid-traffic mapping |
| StatusBird ($29) | 84 third-party services + storefront | still availability, not revenue |
| Uptime by Jagged Pixel ($29–99) | synthetic browser checkout tests | strongest competitor. Our wedge: **we tell you what the failure costs** |
| SiteSaviour / Rewind Monitor / AppPulse ($5.99) | page + app health | same gap |

**The wedge is one sentence:** *they tell you green or red; we tell you dollars per hour.*
That is a positioning difference a merchant can evaluate in 4 seconds on a
listing screenshot, which matters because App Store discovery is won in the
first screenshot.

---

## 3. Pricing and the math that makes it work

| Plan | Price | Watchpoints | Interval | Channels |
|---|---|---|---|---|
| Free | $0 | 1 | 60 min | email |
| Starter | $19 | 15 | 10 min | email + Slack |
| Growth | $49 | 60 | 5 min | + SMS |

**Why a free tier:** 65% of Shopify apps have one, and it is the install engine.
A free watchpoint on a merchant's best-selling ad landing page is the entire
sales pitch — the moment it fires once, they upgrade.

### Revenue model

| Metric | Value |
|---|---|
| Blended ARPU | **$29** (mix of $19 + $49) |
| Free → paid | 8–12% (trial-based, category norm) |
| Installs needed for **$5k MRR** | ~430 paying = **~4,300 installs** |
| Time to $5k MRR (organic ASO) | 9–15 months |
| Gross margin | ~88% (Shopify 0%, infra <$60/mo, email ~$20/mo) |

### The brutal version

- **Median Shopify app earns under $1,000/month.** Most are abandoned in 12 months.
- **$50k MRR from one app is a top-1% outcome** and would need ~1,700 paying merchants — roughly 17,000 installs. Plan for $5k, not $50k, on app #1.
- The $50k path is **10 apps sharing one backend and one install base** (the App Factory thesis), and it takes ~30 months. This file only concerns app #1.

---

## 4. Value-for-money test (the thing you asked me to double-check)

A merchant must be able to see the ROI in one line:

> Growth plan is **$49/month = $1.63/day**. If the average incident on a
> paid-traffic page costs **$20/hour** and this tool cuts detection from 12 hours
> to 90 seconds, **one caught incident pays for 8 months.**

Break-even: **the tool needs to catch one 2.5-hour incident per month to justify
itself.** For a store spending $5k/month on ads, that is an extremely low bar.

If a store spends **under $300/month on ads**, this tool is not worth it for them.
Say so on the listing. Losing the wrong customers is cheaper than refunding them.

---

## 5. The risk register

| Risk | Severity | Mitigation |
|---|---|---|
| **Uptime by Jagged Pixel / ShopStatus add a "cost" column** | 🔴 High | Our durable advantage is the *economics model* + paid-traffic mapping, not the checks. Ship the Shopify Flow action + a public "cost of downtime" benchmark report in month 1 to own the phrase. |
| **Alert fatigue → 1-star reviews** | 🔴 High | Risk floor (`minRiskToAlert`), one open incident per (watch, kind), no alert for anything under $15/hr. |
| **False positives from bot protection / geo** | 🟠 Medium | Content check uses a real UA; alerts require 2 consecutive failures before paging (add `consecutiveFailures >= 2`). |
| **Shopify native adds monitoring** | 🟠 Medium | They have not in 10 years. Low probability, high impact — hence multi-platform MCP endpoint later. |
| **App review rejection** | 🟠 Medium | Listing must not overstate. This is exactly how one studio lost **all 10 apps** in Sept 2026 (one listing overclaimed; portfolio delisted). Never claim "guaranteed sales". |
| **Privacy/GDPR webhooks missing** | 🟠 Medium | Required by Shopify. Must implement `customers/data_request`, `customers/redact`, `shop/redact` before submission. |
| **Reviews get deleted** | 🟡 Low | A vendor lost 500 reviews in a month in 2026. Do not build a plan that depends on review count. |

---

## 6. Go / no-go gates

| Gate | Date | Pass | Fail |
|---|---|---|---|
| **G1 – Listing live** | Week 12 | App approved | If rejected twice, fix listing, not the product |
| **G2 – First signal** | Month 5 | 100 installs | < 30 installs → the listing/screenshot is wrong, rewrite it |
| **G3 – Conversion** | Month 6 | ≥ 8% of installs go paid | < 4% → the value isn't landing. Interview 10 free users. |
| **G4 – Retention** | Month 9 | Monthly churn < 8% | > 12% → it is alert fatigue. Cut checks, raise the floor. |
| **G5 – Scale or stop** | Month 12 | $1,500 MRR | < $500 → ship app #2 on the same backend; keep this one running |

---

## 7. First 30 days, in order

1. **Day 1–3:** build a real Shopify dev store, install this app, confirm OAuth + webhooks + billing end-to-end. (The code is here; this is the step that turns it into a product.)
2. **Day 4–7:** add `consecutiveFailures >= 2` before paging; add privacy webhooks; add the daily digest email.
3. **Day 8–14:** listing assets — 5 screenshots where **screenshot #1 is the $/hour number**, not the logo. Title: `AdsGuard: Paid Traffic Monitor`. Keywords: `out of stock alert`, `price change alert`, `store monitor`, `checkout monitor`, `ad landing page`.
4. **Day 15–21:** free tier live. Post **one** genuinely useful teardown in r/shopify and one in the Shopify Community — "I measured 4 paid landing pages for 30 days, here's what broke" — no link in the first post.
5. **Day 22–30:** submit for review. Meanwhile build app #2's skeleton on the same backend.

**Expected outcome:** approval in ~6–10 weeks (one founder reported 72 days in 2026 — plan for it), first payment **month 4–5**.

---

## 8. The one thing to remember

> The product is not a monitor. **The product is the sentence "you are losing
> $54/hour right now, and here is the page."**
> Everything else in this repo exists to make that sentence true and provable.
