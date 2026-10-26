/**
 * AdsGuard HTTP surface.
 *
 * Auth model (production): embedded app, App Bridge **session token** on every
 * /api/* call. `?shop=` query params are only used for the OAuth handshake.
 * A missing/invalid token is a 401 — never a silent anonymous read.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { URL } from 'node:url';

import config, { validate } from './config.js';
import { logger, asyncRoute } from './logger.js';
import { getStore, closeStore } from './storage/index.js';
import views from './views.js';
import runner from './runner.js';
import scheduler from './scheduler.js';
import shopify, { PRICING } from './shopify.js';

const errors = validate();
if (errors.length) {
  for (const e of errors) process.stderr.write(`config error: ${e}\n`);
  if (config.isProd) process.exit(1);
}

const json = (res, code, obj) => {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
};
const html = (res, code, body) => {
  res.writeHead(code, {
    'content-type': 'text/html; charset=utf-8',
    // Shopify embeds the app in an iframe.
    'content-security-policy': "frame-ancestors https://*.myshopify.com https://admin.shopify.com 'self'",
    'cache-control': 'no-store',
  });
  res.end(body);
};

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Embedded auth: Bearer session token -> shop. Falls back to ?shop= in dev only. */
function authenticate(req, url, store) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;

  if (token) {
    const verified = shopify.verifySessionToken(token);
    if (!verified) return { error: 'invalid_session_token', code: 401 };
    return { shop: verified.shop };
  }
  // Dev convenience only: never allowed in production.
  if (!config.isProd) {
    const q = url.searchParams.get('shop');
    if (q && shopify.isValidShopDomain(q)) return { shop: q, dev: true };
    return { shop: null, dev: true };
  }
  return { error: 'missing_session_token', code: 401 };
}

/** Parse application/x-www-form-urlencoded (server-rendered forms). */
async function readForm(req) {
  const raw = await readBody(req, 200_000);
  const params = Object.fromEntries(new URLSearchParams(raw.toString('utf8')).entries());
  return params;
}

const redirect = (res, location, notice) => {
  const q = notice ? `?${new URLSearchParams(notice).toString()}${location.includes('?') ? '&' : '?'}` : '';
  res.writeHead(303, { location: q ? `${location}${q}` : location });
  return res.end();
};

let startedAt = Date.now();
let counters = { sweeps: 0, checks: 0, alerts: 0 };

export function createServer(store) {
  return http.createServer(asyncRoute(async (req, res) => {
    const url = new URL(req.url, config.appUrl);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    /* ---------------------------- infra ---------------------------- */
    if (path === '/healthz') {
      const shops = await store.listActiveShops();
      return json(res, 200, {
        ok: true,
        env: config.env,
        storage: config.storage.driver,
        shops: shops.length,
        uptimeSec: Math.round((Date.now() - startedAt) / 1000),
        scheduler: globalThis.__adsguard_scheduler ?? null,
      });
    }

    if (path === '/metrics') {
      const health = await store.deliveryHealth();
      const shops = await store.listActiveShops();
      const lines = [
        '# AdsGuard operational metrics',
        `adsguard_shops_active ${shops.length}`,
        `adsguard_uptime_seconds ${Math.round((Date.now() - startedAt) / 1000)}`,
        `adsguard_sweeps_total ${counters.sweeps}`,
        `adsguard_checks_total ${counters.checks}`,
        `adsguard_alerts_total ${counters.alerts}`,
        `adsguard_alert_deliveries_24h ${health.last24h}`,
        `adsguard_alert_failures_24h ${health.failedLast24h}`,
        ...Object.entries(health.byChannel).flatMap(([ch, v]) => [
          `adsguard_deliveries_24h{channel="${ch}"} ${v.sent}`,
          `adsguard_delivery_failures_24h{channel="${ch}"} ${v.failed}`,
        ]),
      ];
      res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
      return res.end(lines.join('\n') + '\n');
    }

    /* ---------------- cron endpoint (for hobby/serverless) ----------- */
    if (path === '/cron/run' && (req.method === 'GET' || req.method === 'POST')) {
      const secret = process.env.CRON_SECRET || '';
      const given = req.headers['x-cron-secret'] || url.searchParams.get('secret') || '';
      if (config.isProd && (!secret || given !== secret)) return json(res, 401, { error: 'bad_cron_secret' });
      const res2 = await runner.runAll(store);
      counters.sweeps += 1;
      counters.checks += res2.checked ?? 0;
      counters.alerts += res2.alerts ?? 0;
      return json(res, 200, { ok: true, ...res2, results: undefined });
    }

    /* --------------------------- marketing -------------------------- */
    if (req.method === 'GET' && (path === '/' || path === '/home')) return html(res, 200, views.landing());
    if (req.method === 'GET' && path === '/pricing') return html(res, 200, views.pricing());
    if (req.method === 'GET' && path === '/privacy') return html(res, 200, views.privacy());
    if (req.method === 'GET' && path === '/terms') return html(res, 200, views.terms());

    /* --------------------------- dashboard -------------------------- */
    if (req.method === 'GET' && (path === '/app' || path === '/dashboard')) {
      const auth = authenticate(req, url, store);
      if (auth.error && config.isProd) return html(res, auth.code, '<p>Session token required. Open this app from the Shopify admin.</p>');

      const domain = auth.shop || url.searchParams.get('shop') || (await store.listActiveShops())[0]?.domain;
      const shop = domain ? await store.getShop(domain) : null;
      if (!shop) {
        return html(res, 200, views.dashboard({
          shop: { domain: 'not-installed', plan: 'free' },
          watchlist: [], active: [], recent: [],
          stats: { savedMtd: 0, uptimePct: 100, lastRunAt: null },
          plan: PRICING.plans.free,
        }));
      }
      const [watchlist, active, recent, stats] = await Promise.all([
        store.listWatched(domain),
        store.activeEvents(domain),
        store.recentEvents(domain, 12),
        runner.stats(store, domain),
      ]);
      const notice = url.searchParams.get('msg')
        ? { ok: url.searchParams.get('ok') === '1', msg: url.searchParams.get('msg') }
        : null;
      return html(res, 200, views.dashboard({
        shop, watchlist, active, recent, stats,
        plan: PRICING.plans[shop.plan] ?? PRICING.plans.free,
        csrf: shopify.signFormToken(domain),
        notice,
      }));
    }

    /* -------------------------- onboarding page ---------------------- */
    if (req.method === 'GET' && path === '/app/setup') {
      const auth = authenticate(req, url, store);
      const domain = auth.shop || url.searchParams.get('shop') || (await store.listActiveShops())[0]?.domain;
      const shop = domain ? await store.getShop(domain) : null;
      if (!shop) return html(res, 200, views.setup({ shop: { domain: 'not-installed', plan: 'free' }, csrf: '', plan: PRICING.plans.free }));
      const notice = url.searchParams.get('msg')
        ? { ok: url.searchParams.get('ok') === '1', msg: url.searchParams.get('msg') }
        : null;
      return html(res, 200, views.setup({
        shop, csrf: shopify.signFormToken(domain),
        plan: PRICING.plans[shop.plan] ?? PRICING.plans.free, notice,
      }));
    }

    /* ------------------------- forms (no JS needed) ------------------- */
    if (req.method === 'POST' && (path === '/app/watch' || path === '/app/settings' || path.startsWith('/app/watch/'))) {
      const body = await readForm(req);
      const domain = body.shop;
      if (!shopify.isValidShopDomain(domain)) return html(res, 400, '<p>Bad shop.</p>');
      if (!shopify.verifyFormToken(domain, body.csrf)) return html(res, 403, '<p>Expired form. Reload the page.</p>');

      const shop = await store.getShop(domain);
      if (!shop) return html(res, 404, '<p>Shop not installed.</p>');
      const back = body.redirect === '/app' ? '/app' : '/app';

      // ---- delete ----
      const delMatch = /^\/app\/watch\/([^/]+)\/delete$/.exec(path);
      if (delMatch) {
        await store.removeWatched(domain, delMatch[1]);
        return redirect(res, back, { ok: '1', msg: 'Watchpoint removed. No further checks or charges for it.' });
      }

      // ---- settings ----
      if (path === '/app/settings') {
        const settings = {
          ...shop.settings,
          alertEmail: (body.alertEmail || '').trim() || null,
          slackWebhook: (body.slackWebhook || '').trim() || null,
          alertPhone: (body.alertPhone || '').trim() || null,
          minRiskToAlert: Math.max(0, Number(body.minRiskToAlert) || 0),
        };
        await store.upsertShop({ domain, settings });
        return redirect(res, back, { ok: '1', msg: 'Alert settings saved.' });
      }

      // ---- add ----
      if (path === '/app/watch') {
        if (!body.url || !/^https?:\/\//.test(body.url)) {
          return redirect(res, back, { ok: '0', msg: 'URL must start with http:// or https://' });
        }
        const spec = PRICING.plans[shop.plan] ?? PRICING.plans.free;
        const existing = await store.listWatched(domain);
        if (existing.length >= spec.watchpoints) {
          return redirect(res, back, { ok: '0', msg: `Your ${shop.plan} plan allows ${spec.watchpoints} watchpoint(s). Remove one or upgrade.` });
        }
        await store.addWatched(domain, {
          url: body.url.trim(),
          label: (body.label || '').trim() || body.url.trim(),
          productId: (body.productId || '').trim() || null,
          adSpend30d: Number(body.adSpend30d) || 0,
          sessions30d: Number(body.sessions30d) || 0,
          conversionRate: (Number(body.conversionRatePct) || 2) / 100,
          aov: Number(body.aov) || 0,
          expectText: (body.expectText || '').trim() || null,
          checkIntervalMins: Math.max(1, Number(body.checkIntervalMins) || spec.intervalMins),
        });
        // Run one check immediately so the merchant sees a number, not an empty table.
        runner.runShop(store, domain, { force: true }).catch((e) => logger.error('post_add_run_failed', { shop: domain, err: e }));
        return redirect(res, back, { ok: '1', msg: 'Watchpoint added. First check is running now — refresh in a few seconds.' });
      }
    }

    /* ------------------------------ api ----------------------------- */
    if (path.startsWith('/api/')) {
      const auth = authenticate(req, url, store);
      if (auth.error) return json(res, auth.code, { error: auth.error });
      const domain = auth.shop || url.searchParams.get('shop') || (await store.listActiveShops())[0]?.domain;
      if (!domain) return json(res, 400, { error: 'no_shop' });

      if (path === '/api/state' && req.method === 'GET') {
        const shop = await store.getShop(domain);
        if (!shop) return json(res, 404, { error: 'shop_not_found' });
        const [active, recent, stats] = await Promise.all([
          store.activeEvents(domain), store.recentEvents(domain, 30), runner.stats(store, domain),
        ]);
        return json(res, 200, { shop: { ...shop, accessToken: undefined }, active, recent, stats });
      }

      if (path === '/api/run' && req.method === 'POST') {
        counters.sweeps += 1;
        const result = await runner.runShop(store, domain, { force: url.searchParams.get('force') === '1' });
        counters.checks += result.checked ?? 0;
        counters.alerts += result.alerts ?? 0;
        return json(res, 200, { ok: true, ...result, stats: await runner.stats(store, domain) });
      }

      if (path === '/api/watch' && (req.method === 'POST' || req.method === 'GET')) {
        if (req.method === 'GET') return json(res, 200, { watchpoints: await store.listWatched(domain) });
        const payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        if (!payload.url || !/^https?:\/\//.test(payload.url)) return json(res, 400, { error: 'url_required' });

        const shop = await store.getShop(domain);
        const spec = PRICING.plans[shop.plan] ?? PRICING.plans.free;
        const existing = await store.listWatched(domain);
        if (existing.length >= spec.watchpoints) {
          return json(res, 402, { error: 'plan_limit', limit: spec.watchpoints, plan: shop.plan });
        }
        const id = await store.addWatched(domain, payload);
        return json(res, 201, { ok: true, id });
      }

      if (path.startsWith('/api/watch/') && req.method === 'DELETE') {
        const id = path.split('/').pop();
        return json(res, (await store.removeWatched(domain, id)) ? 200 : 404, { ok: true });
      }

      if (path === '/api/settings' && req.method === 'POST') {
        const payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        const shop = await store.getShop(domain);
        const settings = {
          ...shop.settings,
          alertEmail: payload.alertEmail ?? shop.settings.alertEmail,
          slackWebhook: payload.slackWebhook ?? shop.settings.slackWebhook,
          alertPhone: payload.alertPhone ?? shop.settings.alertPhone,
          minRiskToAlert: payload.minRiskToAlert ?? shop.settings.minRiskToAlert,
        };
        await store.upsertShop({ domain, settings });
        return json(res, 200, { ok: true, settings });
      }

      if (path === '/api/billing' && req.method === 'POST') {
        const payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        const shop = await store.getShop(domain);
        if (!shop?.accessToken) return json(res, 400, { error: 'not_installed' });
        const charge = await shopify.createRecurringCharge(domain, shop.accessToken, {
          plan: payload.plan,
          returnUrl: `${config.appUrl}/app?shop=${encodeURIComponent(domain)}`,
        });
        return json(res, 200, charge);
      }

      return json(res, 404, { error: 'unknown_endpoint' });
    }

    /* ----------------------------- oauth ---------------------------- */
    if (path === '/auth' && req.method === 'GET') {
      const shop = url.searchParams.get('shop');
      if (!shopify.isValidShopDomain(shop)) return html(res, 400, '<p>Missing or invalid ?shop= parameter.</p>');
      const state = crypto.randomBytes(16).toString('hex');
      const target = shopify.buildAuthUrl({ shop, state });
      res.writeHead(302, {
        'set-cookie': `ag_state=${state}; HttpOnly; Secure; Path=/; Max-Age=600; SameSite=Lax`,
        location: target,
      });
      return res.end();
    }

    if (path === '/auth/callback' && req.method === 'GET') {
      const shop = url.searchParams.get('shop');
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!shopify.isValidShopDomain(shop) || !code) return html(res, 400, '<p>Bad OAuth callback.</p>');

      if (config.isProd) {
        if (!shopify.verifyOAuthHmac(url.search)) return html(res, 401, '<p>Invalid HMAC.</p>');
        const cookieState = /(?:^|;\s*)ag_state=([^;]+)/.exec(req.headers.cookie || '')?.[1];
        if (!cookieState || cookieState !== state) return html(res, 401, '<p>Invalid state (CSRF).</p>');
      }

      const token = await shopify.exchangeToken({ shop, code });
      await store.upsertShop({ domain: shop, accessToken: token.access_token });
      const hooks = await shopify.registerWebhooks(shop, token.access_token).catch((err) => {
        logger.error('webhook_registration_failed', { shop, err });
        return [];
      });
      logger.info('installed', { shop, hooks: hooks.filter((h) => h.ok).length });
      res.writeHead(302, { location: `/app?shop=${encodeURIComponent(shop)}`, 'set-cookie': 'ag_state=; Max-Age=0; Path=/' });
      return res.end();
    }

    /* ---------------------------- webhooks -------------------------- */
    if (path === '/webhooks' && req.method === 'POST') {
      const raw = await readBody(req);
      const topic = String(req.headers['x-shopify-topic'] || '');
      const shopDomain = String(req.headers['x-shopify-shop-domain'] || '');
      const hmac = req.headers['x-shopify-hmac-sha256'];

      if (config.isProd && !shopify.verifyWebhookHmac(raw, hmac)) {
        logger.warn('webhook_bad_hmac', { topic, shop: shopDomain });
        return json(res, 401, { error: 'invalid_hmac' });
      }
      if (!shopify.isValidShopDomain(shopDomain)) return json(res, 400, { error: 'invalid_shop' });

      let payload = {};
      try { payload = JSON.parse(raw.toString('utf8') || '{}'); } catch { return json(res, 400, { error: 'invalid_json' }); }

      // ---- mandatory compliance webhooks ----
      if (topic === 'customers/data_request' || topic === 'customers/redact') {
        // We store no customer PII, so there is nothing to return or erase.
        logger.info('gdpr_customer', { topic, shop: shopDomain });
        return json(res, 200, { ok: true, note: 'no_customer_data_stored' });
      }
      if (topic === 'shop/redact') {
        await store.redactShop(shopDomain);
        logger.info('gdpr_shop_redact', { shop: shopDomain });
        return json(res, 200, { ok: true });
      }

      // ---- lifecycle ----
      if (topic === 'app/uninstalled') {
        await store.markUninstalled(shopDomain);
        logger.info('uninstalled', { shop: shopDomain });
        return json(res, 200, { ok: true });
      }

      // ---- fast re-check on product/inventory changes ----
      if (['products/update', 'products/delete', 'inventory_levels/update'].includes(topic)) {
        const shop = await store.getShop(shopDomain);
        if (!shop) return json(res, 200, { ok: true, ignored: 'unknown_shop' });
        const gid = payload.admin_graphql_api_id;
        const watched = await store.listWatched(shopDomain);
        const affected = watched.filter((w) => w.productId && (w.productId === String(payload.id) || w.productId === gid));
        if (affected.length) {
          runner.runShop(store, shopDomain, { force: true }).catch((err) => logger.error('webhook_run_failed', { shop: shopDomain, err }));
        }
        // Must respond within 5s — the run above is intentionally not awaited.
        return json(res, 200, { ok: true, matched: affected.length });
      }

      return json(res, 200, { ok: true, ignored: topic });
    }

    return json(res, 404, { error: 'not_found', path });
  }));
}

/* ------------------------------ bootstrap ------------------------------ */

export async function boot() {
  const store = await getStore();
  logger.info('storage_ready', { driver: config.storage.driver });
  const server = createServer(store);
  const sched = scheduler.start(store);

  await new Promise((resolve) => server.listen(config.port, config.host, resolve));
  startedAt = Date.now();
  logger.info('listening', { port: config.port, host: config.host, appUrl: config.appUrl, env: config.env });

  const shutdown = async (signal) => {
    logger.info('shutdown', { signal });
    sched.stop();
    server.close();
    await closeStore();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return { server, store, sched };
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) boot().catch((err) => {
  logger.error('boot_failed', { err });
  process.exit(1);
});

export default { boot, createServer };
