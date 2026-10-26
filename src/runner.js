/**
 * Orchestration: fetch → check → gate → record → alert → resolve.
 *
 * This is the single writer of events, so de-duplication and the
 * consecutive-failure gate live in exactly one place.
 */
import config from './config.js';
import { logger } from './logger.js';
import { runChecks, riskPerHour } from './checks.js';
import { dispatch, shouldNotify } from './alerts.js';
import { PRICING } from './shopify.js';

/** Should this watchpoint be checked on this tick? */
export function isDue(item, now = Date.now()) {
  if (!item.lastCheckedAt) return true;
  const intervalMs = (item.checkIntervalMins || 10) * 60_000;
  return now - new Date(item.lastCheckedAt).getTime() >= intervalMs;
}

export async function runShop(store, domain, { force = false } = {}) {
  const shop = await store.getShop(domain);
  if (!shop) return { skipped: 'unknown_shop' };
  if (shop.uninstalledAt) return { skipped: 'uninstalled' };

  const plan = PRICING.plans[shop.plan] ?? PRICING.plans.free;
  const all = await store.listWatched(domain);
  const items = all.slice(0, plan.watchpoints).filter((w) => force || isDue(w));

  const result = { checked: 0, created: 0, resolved: 0, alerts: 0, suppressed: 0 };

  for (const item of items) {
    const failures = await runChecks(shop, item);
    result.checked += 1;

    if (!failures.length) {
      const closed = await store.resolveEvents(domain, { watchId: item.id });
      result.resolved += closed.length;
      await store.updateWatched(domain, item.id, {
        lastCheckedAt: new Date().toISOString(),
        lastStatus: 'healthy',
        consecutiveFailures: 0,
        baselinePrice: item.baselinePrice ?? null,
      });
      continue;
    }

    const consecutive = (item.consecutiveFailures || 0) + 1;
    await store.updateWatched(domain, item.id, {
      lastCheckedAt: new Date().toISOString(),
      lastStatus: 'failing',
      consecutiveFailures: consecutive,
    });

    const open = await store.activeEvents(domain);

    for (const f of failures) {
      const existing = open.find((e) => e.watchId === item.id && e.kind === f.kind);

      if (existing) {
        // Already open. The only thing left to do is "catch up": if it was
        // recorded during the flap gate and never paged, page it now that the
        // failure has persisted.
        if (!existing.alertedAt && consecutive >= config.scheduler.consecutiveFailures) {
          const lastAlertAt = open.reduce(
            (m, e) => Math.max(m, e.alertedAt ? new Date(e.alertedAt).getTime() : 0),
            0,
          );
          if (shouldNotify(shop, existing, open.filter((e) => e.id !== existing.id), { lastAlertAt })) {
            const attempts = await dispatch(shop, existing, store);
            if (attempts.some((a) => a.ok)) {
              await store.markAlerted(existing.id);
              result.alerts += 1;
            } else {
              result.suppressed += 1;
            }
          }
        }
        continue;
      }

      // Flap protection: record the event, but do not page until N consecutive.
      const gated = consecutive < config.scheduler.consecutiveFailures;

      const event = await store.addEvent({
        shop: domain,
        watchId: item.id,
        kind: f.kind,
        severity: f.severity,
        title: f.title,
        detail: f.detail,
        riskPerHour: f.riskPerHour ?? riskPerHour(item),
      });
      result.created += 1;

      if (gated) {
        result.suppressed += 1;
        logger.info('alert_suppressed_flap_gate', {
          shop: domain, watch: item.id, kind: f.kind, consecutive,
        });
        continue;
      }

      const lastAlertAt = open.reduce(
        (m, e) => Math.max(m, e.alertedAt ? new Date(e.alertedAt).getTime() : 0),
        0,
      );
      if (!shouldNotify(shop, event, open, { lastAlertAt })) {
        result.suppressed += 1;
        continue;
      }

      const attempts = await dispatch(shop, event, store);
      if (attempts.some((a) => a.ok)) {
        await store.markAlerted(event.id);
        result.alerts += 1;
      }
    }
  }

  return result;
}

/** Naive concurrency limiter — enough for a few hundred shops per tick. */
async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function runAll(store, { force = false } = {}) {
  const shops = await store.listActiveShops();
  const started = Date.now();
  const results = await mapLimit(shops, config.scheduler.concurrency, async (shop) => {
    try {
      return { shop: shop.domain, ...(await runShop(store, shop.domain, { force })) };
    } catch (err) {
      logger.error('shop_run_failed', { shop: shop.domain, err });
      return { shop: shop.domain, error: err.message };
    }
  });
  const totals = results.reduce(
    (acc, r) => {
      acc.checked += r.checked ?? 0;
      acc.created += r.created ?? 0;
      acc.resolved += r.resolved ?? 0;
      acc.alerts += r.alerts ?? 0;
      if (r.error) acc.errors += 1;
      return acc;
    },
    { checked: 0, created: 0, resolved: 0, alerts: 0, errors: 0 },
  );
  logger.info('sweep_complete', { shops: shops.length, durationMs: Date.now() - started, ...totals });
  return { shops: shops.length, ...totals, results };
}

/** Numbers the dashboard needs. Computed from events, never stored twice. */
export async function stats(store, domain) {
  const events = await store.recentEvents(domain, 1000);
  const now = new Date();
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);

  const savedMtd = events
    .filter((e) => e.cleared && e.resolvedAt && new Date(e.resolvedAt).getTime() >= monthStart)
    .reduce((s, e) => s + (Number(e.estimatedLoss) || 0), 0);

  const downMins = events.filter((e) => e.cleared).reduce((s, e) => s + (Number(e.durationMins) || 0), 0);
  const uptimePct = Math.max(0, Math.min(100, 100 - (downMins / (30 * 24 * 60)) * 100));

  const watched = await store.listWatched(domain);
  const lastRunAt = watched.map((w) => w.lastCheckedAt).filter(Boolean).sort().pop() || null;

  return {
    savedMtd: Number(savedMtd.toFixed(2)),
    uptimePct: Number(uptimePct.toFixed(2)),
    lastRunAt,
    totalEvents: events.length,
    openIncidents: events.filter((e) => !e.cleared).length,
    watchpoints: watched.length,
  };
}

export default { runShop, runAll, stats, isDue };
