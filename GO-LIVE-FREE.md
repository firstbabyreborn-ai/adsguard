# LIVE — ₹0, no credit card, no terminal

**Reality:** card ke bina bhi ho jaayega. 5 steps, sab browser me. ~40 min.
Bas 3 free accounts banane hain: **GitHub**, **Render**, **cron-job.org**. Koi card nahi lagta.

Aur ek: **Resend** (email bhejne ke liye) — free, no card. Optional, par iske bina alert email nahi jaayega.

---

## Step 1 — GitHub pe code chadhao (10 min)

1. **github.com** → Sign up (free)
2. Top-right **+** → **New repository** → naam `adsguard` → **Public** → **Create repository**
3. Us page pe link milega **"uploading an existing file"** — click karo
4. Maine tumhe **`adsguard-deploy.zip`** diya hai — **download karo, extract karo**
5. Extract hua **`adsguard` folder kholo**, uske andar ka **saara maal** select karo aur GitHub ke upload box me **drag-drop** karo
   (ya seedha `adsguard` folder drag kar do)
6. Neeche **Commit changes**

> **Kabhi bhi koi key, secret ya `.env` file public repo me mat daalo.** GitHub khud pakad leta hai (secret scanning) — aur agar pakda na jaaye to bhi wo public hai.
>
> `.env` file zip me nahi hai — usme tumhari keys thi, isliye maine nikaal di. Achha hua.

---

## Step 2 — Render pe deploy (10 min)

1. **render.com** → **Get Started** → **GitHub se sign up** (card nahi maangega)
2. Dashboard → **New +** → **Blueprint**
3. Repo list me **adsguard** select karo → **Connect**
4. Render `render.yaml` padh lega. Ab 3 values maangega — ye daalo:

| Key | Value |
|---|---|
| `SHOPIFY_API_KEY` | Client ID (Shopify dashboard se copy) |
| `SHOPIFY_API_SECRET` | *(tumhara Client Secret — jo tumne mujhe bheja tha, wahi paste karo. Document me kabhi mat likhna.)* |
| `RESEND_API_KEY` | resend.com se (free) — aaj chhod bhi sakte ho |
| `ALERT_FROM` | `onboarding@resend.dev` (test ke liye chalta hai) |

5. **Apply** → 3-5 min me build hoga

`CRON_SECRET` Render khud bana dega.
Database bhi khud ban jaayega aur connect ho jaayega.
**URL koi bhi maango mat** — Render khud `RENDER_EXTERNAL_URL` de deta hai.

---

## Step 3 — URL copy karo aur Shopify me daalo (5 min)

1. Render dashboard me tumhari service ka URL dikhega, jaise:
   `https://adsguard-a1b2.onrender.com`
2. Wapas **dev.shopify.com** → **Apps** → **AdsGuard** → **Configuration / Versions**
3. Do field badlo:
   - **App URL** → `https://adsguard-a1b2.onrender.com/app`
   - **Allowed redirection URL(s)** → `https://adsguard-a1b2.onrender.com/auth/callback`
4. **Save** / **Release version**

---

## Step 4 — App install karo (5 min)

Browser me kholo:

```
https://adsguard-a1b2.onrender.com/auth?shop=adsguard-dev.myshopify.com
```

(apna asli URL daalna)

Consent screen aayegi → **Install** → dashboard khul jaayega. **App live hai.**

---

## Step 5 — Sone se pehle: alert fire karke dekho (10 min)

1. Store admin → **Products** → koi product kholo → **Inventory** → **0** karo → Save
2. `/app` me **Alerts** form me apna email daalo → Save
3. **cron-job.org** pe free account banao → **Create cronjob**:
   - URL: `https://adsguard-a1b2.onrender.com/cron/run`
   - Method: **POST**
   - Header: `x-cron-secret` = (Render dashboard → Environment → CRON_SECRET copy karo)
   - Schedule: **every 5 minutes**
4. Do baar chalao (5 min gap), **email aayega jisme `$X/hour` likha hoga**

> **Kyun do baar?** Flap gate — pehla failure sirf record hota hai, dusra consecutive failure page karta hai. Ye jaan-boojh ke hai, alert storms rokne ke liye.
>
> **cron-job.org free kyun zaroori hai:** Render free tier 15 min inactivity ke baad so jaata hai. Ye job har 5 min me jagata hai — isse app jaagta rehta hai **aur** checks chalte rehte hain. Dono kaam ek hi ping se.

Ho gaya. **Aaj ka target pura.**

---

## Free tier ke 3 sach (chhupa nahi raha)

| Sach | Matlab |
|---|---|
| Render free web service **15 min** baad so jaati hai | cron-job.org ka 5-min ping isko solve karta hai. Isi liye Step 5 skip nahi karna. |
| Free **Postgres 30 din** baad expire hota hai | Pehle mahine koi paying merchant nahi hoga, toh theek hai. **Day 20 tak** data ko **neon.tech** (free, no expiry, no card, 2 min) pe shift kar dena — `DATABASE_URL` badalna hai bas. |
| Render ke docs me likha hai "free tier production ke liye mat use karo" | Sahi hai. **Jis din pehla paying merchant aaye, us din $7/mo Starter le lena.** Wo din aane se pehle paisa kharch karna bekaar hai. |

---

## Agar atak jao

| Problem | Fix |
|---|---|
| Render card maang raha hai | Plan **free** hona chahiye. `render.yaml` me `plan: starter` ya disk ho to card maangega. Maine `plan: free` kar diya hai — dobara check kar lo. |
| Build fail — Dockerfile | Repo me `Dockerfile` root me hona chahiye, kisi folder ke andar nahi. Upload dobara karo. |
| App khulta hai par blank | Install `/auth?shop=...` se karo, seedha `/app` se nahi. |
| Email nahi aaya | `RESEND_API_KEY` nahi hai, ya `/app` me alert email set nahi. |
| OAuth pe "app can't be installed" | Step 3 ke dono URL exact match nahi kar rahe. Trailing slash mat lagao. |

---

## Aaj ke baad kya

- **App Store listing submit** karo (`listing/APP-STORE-LISTING.md` me poora copy deck hai). Review me din-hafte lagenge, tumhare haath me nahi hai.
- Uske pehle koi bhi install link se app use kar sakta hai — listing zaroori nahi.
- Pehla paying customer realistically **week 4-8** me. Aaj revenue nahi, aaj **proof** bana rahe ho.
