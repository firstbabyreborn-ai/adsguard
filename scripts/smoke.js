/**
 * End-to-end smoke test against a running server.
 * Usage: node scripts/smoke.js [baseUrl]
 */
import crypto from 'node:crypto';
import { config } from '../src/config.js';

const base = process.argv[2] || 'http://localhost:3000';
// Must match the server's secret, otherwise every form post is (correctly) 403.
const SECRET = config.shopify.apiSecret || 'dev';
const SHOP = 'demo-store.myshopify.com';

const results = [];
const check = async (name, fn) => {
  try {
    const r = await fn();
    results.push({ name, ok: !!r.ok, detail: r.detail });
  } catch (e) {
    results.push({ name, ok: false, detail: e.message });
  }
};

const formToken = (shop) => {
  const ts = Date.now();
  const mac = crypto.createHmac('sha256', SECRET).update(`${shop}:${ts}`).digest('base64url');
  return `${ts}.${mac}`;
};

/* ------------------------------ pages ------------------------------ */
await check('GET / (landing)', async () => {
  const r = await fetch(base + '/');
  const t = await r.text();
  return { ok: r.ok && t.includes('uptime monitor is lying'), detail: r.status };
});
await check('GET /pricing', async () => {
  const r = await fetch(base + '/pricing');
  const t = await r.text();
  return { ok: r.ok && t.includes('$19'), detail: r.status };
});
await check('GET /privacy', async () => (await fetch(base + '/privacy')).ok ? { ok: true, detail: 200 } : { ok: false });
await check('GET /terms', async () => (await fetch(base + '/terms')).ok ? { ok: true, detail: 200 } : { ok: false });
await check('GET /app (dashboard)', async () => {
  const r = await fetch(base + '/app');
  const t = await r.text();
  return { ok: r.ok && t.includes('Money at risk'), detail: r.status };
});

/* --------------------------- infrastructure ------------------------ */
await check('GET /healthz', async () => {
  const r = await fetch(base + '/healthz');
  const j = await r.json();
  return { ok: r.ok && j.ok === true, detail: `shops=${j.shops} storage=${j.storage}` };
});
await check('GET /metrics (prometheus)', async () => {
  const r = await fetch(base + '/metrics');
  const t = await r.text();
  return { ok: r.ok && t.includes('adsguard_shops_active'), detail: r.status };
});
await check('GET /api/state', async () => {
  const r = await fetch(base + '/api/state');
  const j = await r.json();
  return { ok: r.ok && j.stats !== undefined, detail: `open=${j.stats?.openIncidents}` };
});
await check('POST /api/watch rejects a bad url', async () => {
  const r = await fetch(base + '/api/watch', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'ftp://nope' }),
  });
  return { ok: r.status === 400, detail: r.status };
});
await check('POST /webhooks rejects a non-shop domain', async () => {
  const r = await fetch(base + '/webhooks', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-shopify-topic': 'products/update', 'x-shopify-shop-domain': 'evil.com' },
    body: '{}',
  });
  return { ok: r.status === 400 || r.status === 401, detail: r.status };
});
await check('unknown path returns 404', async () => {
  const r = await fetch(base + '/nope');
  return { ok: r.status === 404, detail: r.status };
});

/* ------------------------- forms (no-JS path) ---------------------- */
await check('GET /app renders the add-watchpoint form', async () => {
  const r = await fetch(base + '/app');
  const t = await r.text();
  return { ok: r.ok && t.includes('Add a watchpoint') && t.includes('name="csrf"'), detail: r.status };
});
await check('GET /app/setup (onboarding)', async () => {
  const r = await fetch(base + '/app/setup');
  const t = await r.text();
  return { ok: r.ok && t.includes('Three minutes'), detail: r.status };
});
await check('POST /app/watch rejects a forged CSRF token', async () => {
  const r = await fetch(base + '/app/watch', {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ shop: SHOP, csrf: 'bogus', url: 'https://example.com/x' }),
  });
  return { ok: r.status === 403, detail: r.status };
});
await check('POST /app/watch adds a watchpoint (303 redirect)', async () => {
  const r = await fetch(base + '/app/watch', {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      shop: SHOP, csrf: formToken(SHOP), url: 'https://example.com/products/smoke',
      label: 'Smoke test', adSpend30d: '720', sessions30d: '1000',
      conversionRatePct: '2', aov: '50', checkIntervalMins: '60',
    }),
  });
  const ok = r.status === 303;
  const state = await fetch(base + '/api/state').then((x) => x.json()).catch(() => ({}));
  return { ok, detail: r.status };
});
await check('DELETE /api/watch removes it again', async () => {
  const list = await fetch(base + '/api/watch').then((x) => x.json()).catch(() => ({ watchpoints: [] }));
  const target = (list.watchpoints || []).find((w) => w.label === 'Smoke test');
  if (!target) return { ok: true, detail: 'nothing to clean' };
  const r = await fetch(base + '/api/watch/' + target.id, { method: 'DELETE' });
  return { ok: r.ok, detail: r.status };
});
await check('POST /app/settings saves alert config', async () => {
  const r = await fetch(base + '/app/settings', {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ shop: SHOP, csrf: formToken(SHOP), alertEmail: 'a@b.co', minRiskToAlert: '20' }),
  });
  return { ok: r.status === 303, detail: r.status };
});
await check('POST /cron/run (dev, no secret required)', async () => {
  const r = await fetch(base + '/cron/run', { method: 'POST' });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok && j.ok === true, detail: `checked=${j.checked ?? '?'}` };
});

/* ------------------------------ summary ---------------------------- */
let fail = 0;
for (const r of results) {
  if (!r.ok) fail++;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(46)} ${r.detail ?? ''}`);
}
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
