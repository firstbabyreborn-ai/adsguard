/**
 * Demo data: a realistic small DTC store (~33k sessions/month across four paid
 * channels). Every dollar on the dashboard is derived from these inputs.
 * Usage: STORAGE_DRIVER=json node scripts/seed.js
 */
import config from '../src/config.js';
import { getStore, closeStore } from '../src/storage/index.js';

const SHOP = 'demo-store.myshopify.com';
const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const daysAgo = (d) => new Date(Date.now() - d * 86400e3).toISOString();

const ITEMS = [
  { id: 'w_aurora', label: 'Aurora Lamp — Meta Ads', url: 'https://demo-store.com/products/aurora-lamp',
    adSpend30d: 2400, sessions30d: 12500, conversionRate: 0.026, aov: 62,
    expectText: 'Aurora Lamp', baselinePrice: 62, maxPriceChangePct: 10 },
  { id: 'w_deskmat', label: 'Desk Mat — Google PMax', url: 'https://demo-store.com/products/desk-mat',
    adSpend30d: 1400, sessions30d: 9200, conversionRate: 0.034, aov: 45,
    expectText: 'Desk Mat', baselinePrice: 45, maxPriceChangePct: 8 },
  { id: 'w_bottle', label: 'Trail Bottle — TikTok', url: 'https://demo-store.com/products/trail-bottle',
    adSpend30d: 900, sessions30d: 6100, conversionRate: 0.018, aov: 34,
    expectText: 'Trail Bottle', baselinePrice: 34, maxPriceChangePct: 15 },
  { id: 'w_bundle', label: 'Starter Bundle — Email', url: 'https://demo-store.com/products/starter-bundle',
    adSpend30d: 0, sessions30d: 3100, conversionRate: 0.041, aov: 96,
    expectText: 'Bundle', baselinePrice: 96, maxPriceChangePct: 20 },
  { id: 'w_gift', label: 'Gift Guide — Ads + Organic', url: 'https://demo-store.com/pages/gift-guide',
    adSpend30d: 350, sessions30d: 2400, conversionRate: 0.029, aov: 58, expectText: 'Gift Guide' },
];

const OPEN = [
  { watchId: 'w_aurora', kind: 'out_of_stock', severity: 'critical',
    title: 'Aurora Lamp is out of stock while you are paying for traffic',
    detail: 'totalInventory=0, status=ACTIVE. Meta has spent $240 in the last 3 days sending 1,980 clicks to a product nobody can buy.',
    riskPerHour: 31.32, at: hoursAgo(3.2) },
  { watchId: 'w_deskmat', kind: 'price_drift', severity: 'warning',
    title: 'Price moved +18.0% on Desk Mat — Google PMax',
    detail: 'Baseline 45.00 → now 53.10. Your PMax feed, ad copy and checkout are now quoting three different numbers.',
    riskPerHour: 21.49, at: hoursAgo(0.7) },
];

const RESOLVED = [
  { watchId: 'w_bottle', kind: 'content_missing', severity: 'critical',
    title: '"Trail Bottle" was missing from Trail Bottle — TikTok',
    detail: 'Page returned 200 but the buy block was gone. A theme update dropped the product template section.',
    riskPerHour: 6.43, at: daysAgo(4), durationMins: 214 },
  { watchId: 'w_aurora', kind: 'http_error', severity: 'critical',
    title: 'HTTP 503 on Aurora Lamp — Meta Ads',
    detail: 'Origin returned 503 for 41 minutes during peak. 610 paid clicks hit an error page.',
    riskPerHour: 31.32, at: daysAgo(9), durationMins: 41 },
  { watchId: 'w_bundle', kind: 'out_of_stock', severity: 'critical',
    title: 'Starter Bundle sold out during a campaign send',
    detail: 'Email campaign went out at 09:00; inventory hit zero at 11:12. Caught 3 hours later.',
    riskPerHour: 16.95, at: daysAgo(16), durationMins: 188 },
  { watchId: 'w_gift', kind: 'content_missing', severity: 'warning',
    title: 'Gift Guide returned a 404 after a URL change',
    detail: 'Collection handle was renamed; the ad link kept pointing at the old one.',
    riskPerHour: 6.09, at: daysAgo(22), durationMins: 97 },
];

async function main() {
  const store = await getStore();
  await store.upsertShop({
    domain: SHOP,
    accessToken: null, // demo: HTTP checks run, Admin API checks are skipped
    plan: 'growth',
    settings: { alertEmail: 'founder@demo-store.com', minRiskToAlert: 15 },
    billing: { cappedAt: 49, usageThisPeriod: 49, periodStart: daysAgo(12) },
  });

  const existing = await store.listWatched(SHOP);
  for (const it of ITEMS) {
    if (!existing.find((w) => w.id === it.id)) await store.addWatched(SHOP, it);
    await store.updateWatched(SHOP, it.id, {
      lastCheckedAt: hoursAgo(Math.random() * 0.15),
      lastStatus: ['w_aurora', 'w_deskmat'].includes(it.id) ? 'failing' : 'healthy',
      consecutiveFailures: ['w_aurora', 'w_deskmat'].includes(it.id) ? 3 : 0,
    });
  }

  const open = await store.activeEvents(SHOP);
  for (const o of OPEN) if (!open.find((e) => e.title === o.title)) await store.addEvent({ shop: SHOP, ...o });

  const recent = await store.recentEvents(SHOP, 500);
  for (const r of RESOLVED) {
    if (recent.find((e) => e.title === r.title)) continue;
    const start = new Date(r.at).getTime();
    await store.addEvent({
      shop: SHOP, ...r, cleared: true,
      resolvedAt: new Date(start + r.durationMins * 60000).toISOString(),
      durationMins: r.durationMins,
      estimatedLoss: Number((r.riskPerHour * (r.durationMins / 60)).toFixed(2)),
    });
  }

  console.log(`seeded ${SHOP}`);
  for (const it of ITEMS) {
    const risk = it.adSpend30d / 720 + (it.sessions30d / 720) * it.conversionRate * it.aov;
    console.log(`  ${it.label.padEnd(30)} $${risk.toFixed(2)}/hr`);
  }
  await closeStore();
}

main().catch((e) => { console.error(e); process.exit(1); });
