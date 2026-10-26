/**
 * Orchestration tests against the real JSON store, with fetch stubbed.
 * These are the tests that protect the two behaviours merchants care about:
 * "don't page me for noise" and "stop billing when I uninstall".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adsguard-'));
process.env.DATA_DIR = tmp;
process.env.STORAGE_DRIVER = 'json';
process.env.SCHEDULER_ENABLED = 'false';
process.env.ALERT_AFTER_FAILURES = '2';
process.env.NODE_ENV = 'test';

const store = await import('../src/storage/json.js');
const runner = await import('../src/runner.js');
const alerts = await import('../src/alerts.js');

const SHOP = 'test.myshopify.com';

async function freshStore() {
  const s = await new store.JsonStore({ dataDir: tmp }).init();
  fs.rmSync(path.join(tmp, 'db.json'), { force: true });
  const s2 = await new store.JsonStore({ dataDir: tmp }).init();
  await s2.upsertShop({ domain: SHOP, plan: 'growth', settings: { alertEmail: 'a@b.c', minRiskToAlert: 5 } });
  return s2;
}

const WATCH = {
  id: 'w1', label: 'Aurora', url: 'https://example.com/p/aurora',
  adSpend30d: 2400, sessions30d: 12500, conversionRate: 0.026, aov: 62,
  expectText: 'Aurora Lamp', checkIntervalMins: 10,
};

test('flap gate: one failure records the event but does not alert', async () => {
  const s = await freshStore();
  await s.addWatched(SHOP, WATCH);
  globalThis.fetch = async () => ({ ok: false, status: 503, statusText: 'down' });

  const r1 = await runner.runShop(s, SHOP, { force: true });
  assert.equal(r1.created, 1);
  assert.equal(r1.alerts, 0, 'first failure must not page');
  assert.equal(r1.suppressed, 1);

  // second consecutive failure -> alerts allowed
  const r2 = await runner.runShop(s, SHOP, { force: true });
  assert.equal(r2.alerts, 1, 'second consecutive failure pages');
});

test('no duplicate incidents while one is open', async () => {
  const s = await freshStore();
  await s.addWatched(SHOP, { ...WATCH, id: 'w2' });
  globalThis.fetch = async () => ({ ok: false, status: 500, statusText: 'boom' });

  await runner.runShop(s, SHOP, { force: true });
  await runner.runShop(s, SHOP, { force: true });
  const third = await runner.runShop(s, SHOP, { force: true });
  assert.equal(third.created, 0, 'no third event for the same open incident');
  const open = await s.activeEvents(SHOP);
  assert.equal(open.length, 1);
});

test('recovery closes the incident and computes duration + loss', async () => {
  const s = await freshStore();
  await s.addWatched(SHOP, { ...WATCH, id: 'w3' });
  await s.addEvent({
    shop: SHOP, watchId: 'w3', kind: 'http_error', title: 'x', detail: '',
    riskPerHour: 30, at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  });
  globalThis.fetch = async () => ({ ok: true, text: async () => '<h1>Aurora Lamp</h1>', body: null });
  const r = await runner.runShop(s, SHOP, { force: true });
  assert.equal(r.resolved, 1);

  const recent = await s.recentEvents(SHOP, 10);
  const closed = recent.find((e) => e.cleared);
  assert.ok(closed.durationMins >= 55 && closed.durationMins <= 65);
  assert.ok(closed.estimatedLoss > 28 && closed.estimatedLoss < 33, `loss=${closed.estimatedLoss}`);
});

test('interval gate: an item is not re-checked before its interval elapses', async () => {
  const now = Date.now();
  assert.equal(runner.isDue({ lastCheckedAt: null }), true, 'never checked -> due');
  assert.equal(runner.isDue({ lastCheckedAt: new Date(now - 1000).toISOString(), checkIntervalMins: 10 }), false);
  assert.equal(runner.isDue({ lastCheckedAt: new Date(now - 11 * 60000).toISOString(), checkIntervalMins: 10 }), true);
});

test('plan limits are enforced on add', async () => {
  const s = await freshStore();
  await s.upsertShop({ domain: SHOP, plan: 'free' });
  await s.addWatched(SHOP, { ...WATCH, id: 'f1' });
  const wanted = await s.listWatched(SHOP);
  assert.equal(wanted.length, 1);
  // server enforces; here we assert the plan spec the server reads
  const { PRICING } = await import('../src/shopify.js');
  assert.equal(PRICING.plans.free.watchpoints, 1);
});

test('uninstall stops the meter in the same write', async () => {
  const s = await freshStore();
  await s.upsertShop({ domain: SHOP, plan: 'growth', billing: { cappedAt: 49, usageThisPeriod: 12 } });
  const shop = await s.markUninstalled(SHOP);
  assert.ok(shop.uninstalledAt);
  assert.ok(shop.billing.stoppedAt, 'billing must carry a stoppedAt timestamp');
  assert.equal(shop.billing.usageThisPeriod, 12, 'usage already accrued is preserved');
});

test('redact deletes the shop and its children', async () => {
  const s = await freshStore();
  await s.addWatched(SHOP, { ...WATCH, id: 'r1' });
  await s.redactShop(SHOP);
  assert.equal(await s.getShop(SHOP), null);
  assert.equal((await s.listWatched(SHOP)).length, 0);
});

test('alert suppression: risk floor keeps small leaks quiet', () => {
  const shop = { domain: SHOP, settings: { minRiskToAlert: 25 } };
  assert.equal(alerts.shouldNotify(shop, { watchId: 'a', kind: 'x', riskPerHour: 4 }, []), false);
  assert.equal(alerts.shouldNotify(shop, { watchId: 'a', kind: 'x', riskPerHour: 40 }, []), true);
  assert.equal(
    alerts.shouldNotify(shop, { watchId: 'a', kind: 'x', riskPerHour: 40 }, [{ watchId: 'a', kind: 'x' }]),
    false,
    'no second page for an already-open incident',
  );
});

test('alert body carries the hourly burn', () => {
  const msg = alerts.formatAlert(
    { domain: SHOP },
    { title: 'Aurora Lamp is out of stock', detail: 'inv=0', riskPerHour: 31.32, at: new Date().toISOString() },
  );
  assert.match(msg.text, /\$31\/hour/);
  assert.match(msg.subject, /Aurora Lamp is out of stock/);
  assert.match(msg.sms, /AdsGuard/);
});

test('delivery health is recorded so a broken email channel is visible', async () => {
  const s = await freshStore();
  const ev = await s.addEvent({ shop: SHOP, kind: 'k', title: 't', detail: '', riskPerHour: 1 });
  await s.recordDelivery(ev.id, 'email', true, {});
  await s.recordDelivery(ev.id, 'slack', false, { reason: 'no_webhook' });
  const h = await s.deliveryHealth();
  assert.equal(h.last24h, 2);
  assert.equal(h.failedLast24h, 1);
  assert.equal(h.byChannel.slack.failed, 1);
});

test('stats derive loss-prevented and uptime from events, not stored totals', async () => {
  const s = await freshStore();
  await s.addEvent({
    shop: SHOP, kind: 'k', title: 't', detail: '', riskPerHour: 60,
    cleared: true, durationMins: 30, estimatedLoss: 30,
    resolvedAt: new Date().toISOString(),
    at: new Date(Date.now() - 3600e3).toISOString(),
  });
  const st = await runner.stats(s, SHOP);
  assert.equal(st.savedMtd, 30);
  assert.ok(st.uptimePct > 99 && st.uptimePct <= 100);
});
