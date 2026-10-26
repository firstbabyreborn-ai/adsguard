/** Pure-logic tests: the money math and the four checks. */
import test from 'node:test';
import assert from 'node:assert/strict';
import checks from '../src/checks.js';

const item = {
  label: 'Aurora Lamp',
  url: 'https://example.com/products/aurora',
  adSpend30d: 2400, sessions30d: 12500, conversionRate: 0.026, aov: 62,
  expectText: 'Aurora Lamp', baselinePrice: 62, maxPriceChangePct: 10,
};

test('riskPerHour = ad burn + unearnable revenue', () => {
  const expected = Number((2400 / 720 + (12500 / 720) * 0.026 * 62).toFixed(2));
  assert.equal(checks.riskPerHour(item), expected);
  assert.equal(expected, 31.32);
});

test('riskPerHour is zero-safe with no data', () => {
  assert.equal(checks.riskPerHour({ adSpend30d: 0, sessions30d: 0 }), 0);
  assert.equal(checks.riskPerHour({}), 0);
});

test('riskPerHour handles string inputs (form posts, CSV import)', () => {
  assert.equal(
    checks.riskPerHour({ adSpend30d: '720', sessions30d: '0', conversionRate: '0', aov: '0' }),
    1,
  );
});

test('content check catches what an uptime monitor cannot see', () => {
  assert.equal(checks.checkContent(item, '<h1>Aurora Lamp</h1>').ok, true);
  const broken = checks.checkContent(item, '<body>This store is unavailable</body>');
  assert.equal(broken.ok, false);
  assert.equal(broken.kind, 'content_missing');
  assert.equal(broken.severity, 'critical');
});

test('content check is case-insensitive and tolerant of missing expectText', () => {
  assert.equal(checks.checkContent(item, '<H1>AURORA LAMP</H1>').ok, true);
  assert.equal(checks.checkContent({ label: 'x' }, 'anything').ok, true);
});

test('stock: published + inventory is healthy', () => {
  const r = checks.checkStock(item, {
    title: 'Aurora Lamp', status: 'ACTIVE', totalInventory: 12,
    variants: { nodes: [{ availableForSale: true, price: '62.00' }] },
  });
  assert.equal(r.ok, true);
});

test('stock: zero inventory is critical', () => {
  const r = checks.checkStock(item, {
    title: 'Aurora Lamp', status: 'ACTIVE', totalInventory: 0,
    variants: { nodes: [{ availableForSale: false, price: '62.00' }] },
  });
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'out_of_stock');
});

test('stock: unpublished product is not buyable', () => {
  const r = checks.checkStock(item, {
    title: 'Aurora Lamp', status: 'DRAFT', totalInventory: 50,
    variants: { nodes: [{ availableForSale: true, price: '62.00' }] },
  });
  assert.equal(r.ok, false);
});

test('stock: deleted product is reported as missing', () => {
  const r = checks.checkStock(item, null);
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'product_missing');
});

test('stock: expectInStock=false inverts the assertion (clearance pages)', () => {
  const r = checks.checkStock({ ...item, expectInStock: false }, {
    title: 'X', status: 'ACTIVE', totalInventory: 0, variants: { nodes: [{ availableForSale: false, price: '1' }] },
  });
  assert.equal(r.ok, true);
});

test('price drift respects the per-item threshold', () => {
  assert.equal(checks.checkPrice(item, { variants: { nodes: [{ price: '65.00' }] } }).ok, true); // +4.8%
  const over = checks.checkPrice(item, { variants: { nodes: [{ price: '75.00' }] } });
  assert.equal(over.ok, false);
  assert.equal(over.severity, 'warning'); // a rise, not a crash
});

test('a price crash is critical, not a warning', () => {
  const drop = checks.checkPrice(item, { variants: { nodes: [{ price: '40.00' }] } });
  assert.equal(drop.ok, false);
  assert.equal(drop.severity, 'critical');
});

test('http check surfaces a 503 as critical', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503, statusText: 'Service Unavailable' });
  const r = await checks.checkHttp(item);
  globalThis.fetch = orig;
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'http_error');
  assert.equal(r.severity, 'critical');
});

test('http check treats a network failure as unreachable and never throws', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
  const r = await checks.checkHttp(item);
  globalThis.fetch = orig;
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'unreachable');
});

test('http check reports a timeout as timeout, not unreachable', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => { const e = new Error('timeout'); e.name = 'AbortError'; throw e; };
  const r = await checks.checkHttp(item);
  globalThis.fetch = orig;
  assert.equal(r.kind, 'timeout');
});
