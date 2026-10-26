/**
 * Server-rendered views. Inline CSS on purpose: renders identically inside the
 * Shopify admin iframe, in a sandboxed preview with no network, and on 3G.
 */
import { PRICING } from './shopify.js';

const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);
const money2 = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = (iso) => {
  if (!iso) return '—';
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

const CSS = `
*{box-sizing:border-box}
body{margin:0;background:#0b0f14;color:#e6edf3;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
a{color:#7dd3fc;text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:1120px;margin:0 auto;padding:28px 20px 60px}
header{display:flex;align-items:center;gap:12px;margin-bottom:26px;flex-wrap:wrap}
.logo{width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,#22d3ee,#3b82f6);display:grid;place-items:center;font-weight:800;color:#04121f;font-size:15px}
h1{font-size:19px;margin:0;font-weight:650;letter-spacing:-.2px}
.sub{color:#7d8b9a;font-size:12.5px}.spacer{flex:1}
.pill{font-size:11.5px;padding:5px 10px;border-radius:999px;border:1px solid #1f2a37;background:#111823;color:#93a4b5;white-space:nowrap}
.pill.ok{color:#34d399;border-color:#134e3a;background:#0a2018}
.pill.bad{color:#f87171;border-color:#4c1d1d;background:#200f0f}
.grid{display:grid;grid-template-columns:1.45fr 1fr;gap:18px;margin-bottom:18px}
@media(max-width:860px){.grid{grid-template-columns:1fr}}
.card{background:#0f151d;border:1px solid #1b2531;border-radius:14px;padding:20px}
.card h2{font-size:12px;text-transform:uppercase;letter-spacing:.8px;color:#7d8b9a;margin:0 0 14px;font-weight:600}
.hero{background:radial-gradient(900px 200px at 0% 0%,#1b1220,#0f151d 60%);border-color:#3b1d24}
.hero .big{font-size:44px;font-weight:750;letter-spacing:-1.5px;line-height:1;color:#fca5a5}
.hero .big.zero{color:#34d399}
.hero .cap{color:#a7b4c2;font-size:13px;margin-top:10px;max-width:52ch}
.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:18px}
.kpi{background:#0b1118;border:1px solid #1b2531;border-radius:10px;padding:12px}
.kpi .n{font-size:19px;font-weight:700;letter-spacing:-.4px}.kpi .l{font-size:11px;color:#7d8b9a;margin-top:3px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.7px;color:#6b7a89;font-weight:600;padding:0 10px 9px 0;border-bottom:1px solid #1b2531}
td{padding:11px 10px 11px 0;border-bottom:1px solid #141c25;vertical-align:middle}
tr:last-child td{border-bottom:none}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#9fb0c0}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:7px}
.dot.g{background:#34d399;box-shadow:0 0 0 3px #0d2b21}
.dot.r{background:#f87171;box-shadow:0 0 0 3px #2b1113;animation:pulse 1.6s infinite}
.dot.y{background:#fbbf24;box-shadow:0 0 0 3px #2b230d}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
.inc{border-left:3px solid #f87171;background:#140d10;border-radius:0 10px 10px 0;padding:13px 15px;margin-bottom:10px}
.inc.warn{border-left-color:#fbbf24;background:#141108}
.inc .t{font-weight:600;font-size:13.5px;margin-bottom:4px}
.inc .d{color:#9fb0c0;font-size:12.5px;line-height:1.5}
.inc .m{color:#fca5a5;font-size:12px;margin-top:7px;font-variant-numeric:tabular-nums}
.inc.resolved{border-left-color:#34d399;background:#0a1310}.inc.resolved .m{color:#6ee7b7}
.empty{color:#6b7a89;font-size:13px;padding:22px 0;text-align:center}
footer{margin-top:26px;color:#5b6875;font-size:11.5px;line-height:1.7}
.bar{height:5px;background:#1b2531;border-radius:3px;overflow:hidden;margin-top:8px}
.bar>i{display:block;height:100%;border-radius:3px;background:linear-gradient(90deg,#22d3ee,#3b82f6)}
.tag{display:inline-block;font-size:10.5px;padding:2px 7px;border-radius:5px;background:#16202b;color:#8fa1b2;margin-left:6px}
.cta{display:inline-block;background:linear-gradient(135deg,#22d3ee,#3b82f6);color:#04121f;font-weight:700;padding:11px 18px;border-radius:9px;margin-top:6px;border:0;cursor:pointer;font-size:14px}
form.inline{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:4px}
form.inline .full{grid-column:1/-1}
@media(max-width:760px){form.inline{grid-template-columns:1fr}}
label{display:block;font-size:11.5px;color:#7d8b9a;margin-bottom:5px;letter-spacing:.3px}
input,select{width:100%;background:#0b1118;border:1px solid #1f2a37;color:#e6edf3;border-radius:8px;padding:9px 11px;font-size:13px;font-family:inherit}
input:focus,select:focus{outline:0;border-color:#2563eb}
.hint{font-size:11px;color:#5b6875;margin-top:4px}
.btn{background:#16202b;border:1px solid #26313f;color:#cbd5e1;border-radius:8px;padding:8px 13px;font-size:12.5px;cursor:pointer}
.btn:hover{border-color:#3b82f6}
.btn.danger{color:#f87171;border-color:#4c1d1d}
.btn.primary{background:linear-gradient(135deg,#22d3ee,#3b82f6);color:#04121f;border:0;font-weight:700}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.toast{background:#0a2018;border:1px solid #134e3a;color:#6ee7b7;border-radius:9px;padding:10px 14px;font-size:12.5px;margin-bottom:16px}
.toast.err{background:#200f0f;border-color:#4c1d1d;color:#fca5a5}
.steps{counter-reset:s;list-style:none;padding:0}
.steps li{counter-increment:s;position:relative;padding-left:34px;margin-bottom:14px;font-size:13px;color:#a7b4c2;line-height:1.6}
.steps li:before{content:counter(s);position:absolute;left:0;top:0;width:22px;height:22px;border-radius:50%;background:#16202b;color:#7dd3fc;font-size:11px;font-weight:700;display:grid;place-items:center}
.plans{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}@media(max-width:760px){.plans{grid-template-columns:1fr}}
.plan{background:#0b1118;border:1px solid #1b2531;border-radius:12px;padding:18px}
.plan.hot{border-color:#2563eb;background:#0c1524}
.plan .p{font-size:28px;font-weight:750;letter-spacing:-1px}.plan ul{padding-left:16px;color:#9fb0c0;font-size:12.5px;line-height:1.8;margin:10px 0 0}
.legal{color:#93a4b5;font-size:13px;line-height:1.8}.legal h3{color:#e6edf3;font-size:14px;margin:20px 0 6px}
`;

function shell({ title, shop, body, activeEvents = [] }) {
  const bad = activeEvents.length;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>${CSS}</style></head><body><div class="wrap">
<header><div class="logo">AG</div>
<div><h1>AdsGuard</h1><div class="sub">${esc(shop?.domain || 'paid-traffic protection')} · ${esc((shop?.plan || 'free').toUpperCase())}</div></div>
<div class="spacer"></div>
<span class="pill ${bad ? 'bad' : 'ok'}">${bad ? `${bad} open incident${bad > 1 ? 's' : ''}` : 'all watchpoints healthy'}</span>
</header>${body}
<footer>Money at risk = (30-day ad spend ÷ 720) + (sessions ÷ 720 × conversion rate × AOV).
It is the burn rate of a page that cannot convert, not an estimate.<br>
AdsGuard never bills for checks. It bills only for incidents it caught. ·
<a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></footer>
</div></body></html>`;
}

export function dashboard({ shop, watchlist, active, recent, stats, plan, csrf = '', notice = null }) {
  const totalRisk = active.reduce((s, e) => s + (Number(e.riskPerHour) || 0), 0);
  const uptime = stats.uptimePct ?? 100;
  const capPct = Math.min(100, (watchlist.length / (plan?.watchpoints || 1)) * 100);

  const heroNote = active.length
    ? `You are paying for traffic to ${active.length} broken page${active.length > 1 ? 's' : ''} right now. At this burn that is ${money(totalRisk * 24)} per day, ${money(totalRisk * 720)} per month.`
    : `Every page you are paying for resolves, contains what it should, is in stock, and is priced as expected. Last checked ${when(stats.lastRunAt)}.`;

  const rows = watchlist.map((w) => {
    const open = active.filter((e) => e.watchId === w.id);
    const state = open.length ? 'r' : w.lastStatus === 'unknown' ? 'y' : 'g';
    const label = open.length ? open[0].kind.replace(/_/g, ' ').toUpperCase() : 'healthy';
    return `<tr><td><span class="dot ${state}"></span>${esc(w.label)}${w.productId ? '<span class="tag">product</span>' : ''}</td>
<td class="mono">${esc(String(w.url).replace(/^https?:\/\//, '').slice(0, 38))}</td>
<td>${open.length ? `<span style="color:#f87171">${esc(label)}</span>` : '<span style="color:#34d399">healthy</span>'}</td>
<td class="mono" style="text-align:right">${money2(w.riskPerHour ?? ((w.adSpend30d || 0) / 720 + ((w.sessions30d || 0) / 720) * (w.conversionRate || 0) * (w.aov || 0)))}/h</td>
<td class="mono" style="text-align:right;color:#7d8b9a">${when(w.lastCheckedAt)}</td></tr>`;
  }).join('');

  const inc = (active.length ? active : recent.slice(0, 6)).map((e, i) => {
    const isActive = !e.cleared;
    return `<div class="inc ${isActive ? '' : 'resolved'}"><div class="t">${esc(e.title)}</div>
<div class="d">${esc(e.detail)}</div>
<div class="m">${isActive ? `burning ${money2(e.riskPerHour)}/hour · ${when(e.at)}` : `resolved after ${e.durationMins ?? 0} min · est. loss ${money2(e.estimatedLoss)}`}</div></div>`;
  }).join('');

  const noticeHtml = notice
    ? `<div class="toast ${notice.ok ? '' : 'err'}">${esc(notice.msg)}</div>`
    : '';

  const addForm = `
<div class="card" style="margin-bottom:18px"><h2>Add a watchpoint — a page you are paying to send traffic to</h2>
<form class="inline" method="POST" action="/app/watch">
  <input type="hidden" name="shop" value="${esc(shop.domain)}">
  <input type="hidden" name="csrf" value="${esc(csrf)}">
  <div class="full"><label>Page URL</label>
    <input name="url" required placeholder="https://yourstore.com/products/your-product">
    <div class="hint">The exact landing page your ads point at.</div></div>
  <div><label>Label</label><input name="label" placeholder="Aurora Lamp — Meta Ads"></div>
  <div><label>Shopify product ID (optional)</label><input name="productId" placeholder="8273...">
    <div class="hint">Enables stock + price checks. Find it in the product URL in admin.</div></div>
  <div><label>Ad spend, last 30 days (USD)</label><input name="adSpend30d" type="number" step="0.01" min="0" placeholder="2400"></div>
  <div><label>Sessions, last 30 days</label><input name="sessions30d" type="number" min="0" placeholder="12500"></div>
  <div><label>Conversion rate (%)</label><input name="conversionRatePct" type="number" step="0.01" min="0" max="100" placeholder="2.6"></div>
  <div><label>Average order value (USD)</label><input name="aov" type="number" step="0.01" min="0" placeholder="62"></div>
  <div><label>Expected text on the page (optional)</label><input name="expectText" placeholder="Aurora Lamp">
    <div class="hint">If this disappears, we alert — this is what a 200 response cannot tell you.</div></div>
  <div><label>Check every (minutes)</label>
    <select name="checkIntervalMins">
      <option value="5">5</option><option value="10" selected>10</option><option value="15">15</option><option value="30">30</option><option value="60">60</option>
    </select></div>
  <div class="full"><button class="btn primary" type="submit">Add watchpoint</button></div>
</form></div>`;

  const settingsForm = `
<div class="card" style="margin-bottom:18px"><h2>Alerts</h2>
<form class="inline" method="POST" action="/app/settings">
  <input type="hidden" name="shop" value="${esc(shop.domain)}">
  <input type="hidden" name="csrf" value="${esc(csrf)}">
  <div><label>Alert email</label><input name="alertEmail" type="email" value="${esc(shop.settings?.alertEmail || '')}" placeholder="you@store.com"></div>
  <div><label>Slack webhook URL</label><input name="slackWebhook" value="${esc(shop.settings?.slackWebhook || '')}" placeholder="https://hooks.slack.com/..."></div>
  <div><label>Phone for SMS (Growth plan)</label><input name="alertPhone" value="${esc(shop.settings?.alertPhone || '')}" placeholder="+91..."></div>
  <div><label>Only page me above this many $/hour</label><input name="minRiskToAlert" type="number" step="1" min="0" value="${esc(shop.settings?.minRiskToAlert ?? 15)}"></div>
  <div class="full"><button class="btn" type="submit">Save</button>
    <span class="hint" style="display:inline-block;margin-left:10px">Quiet by design: one alert per open incident, never more than one page every 5 minutes.</span></div>
</form></div>`;

  const manageRows = watchlist.map((w) => `
<tr><td>${esc(w.label)}</td>
<td class="mono">${esc(String(w.url).replace(/^https?:\/\//, '').slice(0, 34))}</td>
<td style="text-align:right">
  <form method="POST" action="/app/watch/${esc(w.id)}/delete" style="display:inline">
    <input type="hidden" name="shop" value="${esc(shop.domain)}">
    <input type="hidden" name="csrf" value="${esc(csrf)}">
    <button class="btn danger" type="submit">Remove</button>
  </form></td></tr>`).join('');

  return shell({
    title: 'AdsGuard — paid traffic protection', shop, activeEvents: active,
    body: `
${noticeHtml}
<div class="grid">
  <div class="card hero"><h2>Money at risk right now</h2>
    <div class="big ${totalRisk ? '' : 'zero'}">${money(totalRisk)}<span style="font-size:16px;font-weight:600;color:#9fb0c0">/hour</span></div>
    <div class="cap">${esc(heroNote)}</div>
    <div class="kpis">
      <div class="kpi"><div class="n">${money(stats.savedMtd)}</div><div class="l">loss prevented this month</div></div>
      <div class="kpi"><div class="n">${uptime.toFixed(2)}%</div><div class="l">paid-traffic uptime, 30d</div></div>
      <div class="kpi"><div class="n">${watchlist.length}/${plan?.watchpoints ?? 1}</div><div class="l">watchpoints used</div></div>
    </div>
  </div>
  <div class="card"><h2>Response budget</h2>
    <div style="font-size:13px;color:#a7b4c2;line-height:1.6">A $12/hour leak costs <b>${money(12 * 24)}</b> if you notice a day later and <b>${money(12 * 720)}</b> if you notice next month. Detection interval matters more than the tool price.</div>
    <div class="bar"><i style="width:${Math.min(100, uptime)}%"></i></div>
    <div style="display:flex;justify-content:space-between;margin-top:9px;font-size:11.5px;color:#6b7a89"><span>0%</span><span>${uptime.toFixed(2)}% of paid clicks reached a buyable page</span></div>
    <div class="bar" style="margin-top:14px"><i style="width:${capPct}%;background:linear-gradient(90deg,#fbbf24,#f87171)"></i></div>
    <div style="margin-top:8px;font-size:11.5px;color:#6b7a89">${watchlist.length} of ${plan?.watchpoints ?? 1} watchpoints on the ${esc(shop.plan)} plan</div>
  </div>
</div>
<div class="card" style="margin-bottom:18px"><h2>Watchpoints — only pages you are actively paying to send traffic to</h2>
<table><thead><tr><th>Page</th><th>URL</th><th>State</th><th style="text-align:right">Cost when broken</th><th style="text-align:right">Checked</th></tr></thead>
<tbody>${rows || '<tr><td colspan="5" class="empty">No watchpoints yet.</td></tr>'}</tbody></table></div>
<div class="card" style="margin-bottom:18px"><h2>${active.length ? 'Active incidents' : 'Recent incidents'}</h2>${inc || '<div class="empty">No incidents recorded yet.</div>'}</div>
${watchlist.length >= (plan?.watchpoints ?? 1) ? '' : addForm}
${settingsForm}
${watchlist.length ? `<div class="card"><h2>Manage watchpoints</h2><table><tbody>${manageRows}</tbody></table></div>` : ''}`,
  });
}

/* ------------------------------ onboarding ------------------------------ */


/**
 * Shown when a browser opens /app with no session — usually someone typing the
 * URL by hand instead of opening the app from the Shopify admin.
 */
export function signin({ host = '' } = {}) {
  return shell({
    title: 'AdsGuard — open from Shopify',
    shop: { domain: 'no store connected yet', plan: 'free' },
    body: `
<main style="max-width:620px;margin:8vh auto 0;text-align:center">
  <h2 style="font-size:28px;letter-spacing:-.02em;margin:0 0 14px">Open AdsGuard from your Shopify admin</h2>
  <p style="color:#8b98a5;font-size:15px;line-height:1.65;margin:0 0 26px">
    This dashboard belongs to one store. Shopify tells us which store is opening it,
    and that handshake only happens from inside the admin or from your install link.
  </p>
  <p style="font-size:15px;margin:0 0 8px">Your install / open link:</p>
  <div class="mono" style="background:#111820;border:1px solid #1e2a36;border-radius:10px;padding:14px;font-size:13px;word-break:break-all">
    ${esc(host.replace(/\/$/, ''))}/auth?shop=<span style="color:#7dd3fc">YOUR-STORE</span>.myshopify.com
  </div>
  <p style="color:#8b98a5;font-size:13px;margin-top:22px">
    Replace <code>YOUR-STORE</code> with your store handle, e.g. <code>adsguard-dev</code>.
  </p>
</main>`,
  });
}

export function setup({ shop, csrf, plan, notice = null }) {
  return shell({
    title: 'AdsGuard setup', shop, body: `
${notice ? `<div class="toast ${notice.ok ? '' : 'err'}">${esc(notice.msg)}</div>` : ''}
<div class="card hero"><h2>Three minutes to your first number</h2>
<div class="cap">You do not need to connect anything else. Pick one page you are paying for, enter last month's ad spend and sessions, and AdsGuard starts telling you what a broken page costs.</div>
</div>
<div class="card" style="margin-top:18px"><h2>What you will enter</h2>
<ol class="steps">
<li><b>Page URL</b> — the exact landing page your Meta/Google/TikTok ads point at. Not your homepage.</li>
<li><b>Ad spend + sessions (last 30 days)</b> — from your ads manager and Shopify analytics. Rough is fine; the number is a burn rate, not an invoice.</li>
<li><b>Conversion rate + AOV</b> — Shopify analytics gives both in one screen.</li>
<li><b>Expected text (optional but recommended)</b> — a word that must appear on the page. This is what catches the failure a 200 response hides.</li>
</ol>
<form class="inline" method="POST" action="/app/watch">
  <input type="hidden" name="shop" value="${esc(shop.domain)}">
  <input type="hidden" name="csrf" value="${esc(csrf)}">
  <input type="hidden" name="redirect" value="/app">
  <div class="full"><label>Page URL</label><input name="url" required placeholder="https://yourstore.com/products/your-product"></div>
  <div><label>Label</label><input name="label" placeholder="Aurora Lamp — Meta Ads"></div>
  <div><label>Shopify product ID (optional)</label><input name="productId" placeholder="8273..."></div>
  <div><label>Ad spend, 30d (USD)</label><input name="adSpend30d" type="number" step="0.01" min="0" placeholder="2400"></div>
  <div><label>Sessions, 30d</label><input name="sessions30d" type="number" min="0" placeholder="12500"></div>
  <div><label>Conversion rate (%)</label><input name="conversionRatePct" type="number" step="0.01" min="0" max="100" placeholder="2.6"></div>
  <div><label>Average order value (USD)</label><input name="aov" type="number" step="0.01" min="0" placeholder="62"></div>
  <div class="full"><label>Expected text on the page</label><input name="expectText" placeholder="Aurora Lamp"></div>
  <div class="full"><button class="btn primary" type="submit">Create watchpoint</button>
  <span class="hint" style="display:inline-block;margin-left:10px">Your ${esc(shop.plan)} plan allows ${plan.watchpoints} watchpoint${plan.watchpoints > 1 ? 's' : ''}.</span></div>
</form></div>`,
  });
}

export function landing() {
  return shell({
    title: 'AdsGuard — you are paying for broken pages',
    body: `
<div class="card hero"><h2>Your uptime monitor is lying to you</h2>
<div class="big">200 OK</div>
<div class="cap">An uptime monitor sees a healthy response while the product is out of stock, the price changed, or the theme dropped the buy button. You keep paying for the clicks.</div>
<div style="margin-top:18px"><a class="cta" href="/app">See a live dashboard →</a></div></div>

<div class="grid" style="margin-top:18px">
<div class="card"><h2>What it checks, every 5 minutes</h2>
<table><tbody>
<tr><td>Page resolves</td><td class="mono" style="text-align:right">4xx · 5xx · timeout · DNS</td></tr>
<tr><td>Expected content present</td><td class="mono" style="text-align:right">the failure 200 misses</td></tr>
<tr><td>Product is published &amp; buyable</td><td class="mono" style="text-align:right">inventory = 0</td></tr>
<tr><td>Price within your threshold</td><td class="mono" style="text-align:right">feed vs checkout drift</td></tr>
<tr><td>Admin API reachable</td><td class="mono" style="text-align:right">"we lost visibility"</td></tr>
</tbody></table></div>
<div class="card"><h2>The output is one number</h2>
<div style="font-size:13px;color:#a7b4c2;line-height:1.75">
<code style="color:#7dd3fc">$/hour = ad spend ÷ 720 + sessions ÷ 720 × CVR × AOV</code><br><br>
Ad burn plus the revenue you can no longer earn. Derived from <em>your</em> numbers, never hard-coded.
<br><br><b style="color:#e6edf3">Two tools tell you green or red. This one tells you what the red costs.</b>
</div></div></div>

<div class="card" style="margin-top:18px"><h2>Pricing — capped, and only for incidents we caught</h2>
<div class="plans">
${Object.entries(PRICING.plans).map(([key, p]) => `
<div class="plan ${key === 'starter' ? 'hot' : ''}">
<div style="font-size:12px;color:#7d8b9a;text-transform:uppercase;letter-spacing:.8px">${esc(key)}</div>
<div class="p">$${p.price}<span style="font-size:13px;font-weight:500;color:#7d8b9a">/mo</span></div>
<ul><li>${p.watchpoints} watchpoint${p.watchpoints > 1 ? 's' : ''}</li><li>checks every ${p.intervalMins} min</li><li>${p.channels.join(' · ')}</li></ul>
</div>`).join('')}
</div>
<div style="margin-top:16px;font-size:12.5px;color:#93a4b5;line-height:1.7">
<b style="color:#6ee7b7">Fair-billing promise:</b> hard cap at $${PRICING.maxMonthly}/mo · no charge for checks, only incidents ·
billing stops the moment you uninstall · no auto-upgrade, ever · 14-day trial, cancel in the app.
</div></div>

<div class="card" style="margin-top:18px"><h2>Not for everyone</h2>
<div style="font-size:13px;color:#a7b4c2;line-height:1.7">
If you spend under <b>$300/month</b> on ads, this tool is not worth it — say no. It pays for itself when a
single outage on a paid landing page costs more than a month of the subscription.</div></div>`,
  });
}

export function pricing() {
  return shell({
    title: 'AdsGuard pricing',
    body: `<div class="card"><h2>Pricing</h2>
<div class="plans">${Object.entries(PRICING.plans).map(([k, p]) => `
<div class="plan ${k === 'starter' ? 'hot' : ''}"><div style="font-size:12px;color:#7d8b9a;text-transform:uppercase">${esc(k)}</div>
<div class="p">$${p.price}<span style="font-size:13px;color:#7d8b9a">/mo</span></div>
<ul><li>${p.watchpoints} watchpoints</li><li>${p.intervalMins}-minute checks</li><li>${p.channels.join(', ')}</li></ul></div>`).join('')}</div>
<div style="margin-top:18px" class="legal">Hard ceiling $${PRICING.maxMonthly}/month. No overage, no auto-upgrade. Billing stops on uninstall. 14-day trial.</div></div>`,
  });
}

export function privacy() {
  return shell({
    title: 'AdsGuard — Privacy',
    body: `<div class="card"><h2>Privacy policy</h2><div class="legal">
<p>Last updated: October 2026.</p>
<h3>What we collect</h3>
<p>The store domain, a Shopify access token (to read products and inventory), the URLs you add as watchpoints,
and the ad spend / sessions / conversion inputs you enter. Optionally an alert email address, a Slack webhook
URL and a phone number for SMS.</p>
<h3>What we never collect</h3>
<p>We do not collect or store customer personal data. We do not read orders' customer details. We do not sell,
rent or share data with advertisers.</p>
<h3>Where it is stored</h3>
<p>In a PostgreSQL database hosted by our infrastructure provider. Data is encrypted in transit.</p>
<h3>Retention and deletion</h3>
<p>On uninstall we stop all checks and billing immediately. On a <code>shop/redact</code> request we delete the
store record and every watchpoint and incident associated with it. You can request deletion at any time by
emailing support — it is actioned within 30 days.</p>
<h3>Sub-processors</h3>
<p>Shopify (platform), our hosting provider (application + database), Resend (email delivery), Twilio (SMS),
Slack (webhooks you configure).</p>
</div></div>`,
  });
}

export function terms() {
  return shell({
    title: 'AdsGuard — Terms',
    body: `<div class="card"><h2>Terms of service</h2><div class="legal">
<h3>What the service is</h3>
<p>AdsGuard performs scheduled HTTP and Shopify Admin API checks on URLs you provide and sends alerts when a
check fails. It is a detection tool. It does not fix your store.</p>
<h3>What it does not promise</h3>
<p>We do not guarantee detection of every failure, nor any particular detection latency, nor any revenue
outcome. Checks can fail for reasons outside our control (your host, Shopify, DNS, our provider). The
"money at risk" figure is an estimate derived from inputs you supply, not a billing-grade record.</p>
<h3>Billing</h3>
<p>Billed through Shopify. Charges are capped at the plan price. There is no overage and no automatic upgrade.
Billing stops when the app is uninstalled.</p>
<h3>Cancellation and refunds</h3>
<p>Uninstall at any time from the Shopify admin. If a billing error occurs, contact support and we will correct
it through Shopify's billing API.</p>
<h3>Acceptable use</h3>
<p>Only add URLs you own or are authorised to monitor. We rate-limit and will remove watchpoints that target
third parties.</p>
</div></div>`,
  });
}

export default { dashboard, setup, signin, landing, pricing, privacy, terms };
