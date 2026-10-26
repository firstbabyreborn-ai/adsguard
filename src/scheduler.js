/**
 * In-process scheduler.
 *
 * Why not an external cron: a Shopify app must keep checking even when nobody
 * opens the dashboard, and a single-process cron with a lease is the cheapest
 * correct thing for a solo operator. On a multi-instance deploy, only the
 * instance that wins the advisory lock runs the sweep (see `withLease`).
 */
import config from './config.js';
import { logger } from './logger.js';
import { runAll } from './runner.js';

let timer = null;
let running = false;

/** Prevent overlapping sweeps when a tick runs long. */
async function tick(store, state) {
  if (running) {
    logger.warn('sweep_skipped_overlap');
    return;
  }
  running = true;
  try {
    const res = await runAll(store);
    state.lastSweepAt = new Date().toISOString();
    state.lastSweep = { shops: res.shops, checked: res.checked, created: res.created, alerts: res.alerts };
  } catch (err) {
    logger.error('sweep_failed', { err });
    state.lastError = { at: new Date().toISOString(), message: err.message };
  } finally {
    running = false;
  }
}

export function start(store) {
  if (!config.scheduler.enabled) {
    logger.info('scheduler_disabled');
    return { stop() {} };
  }
  const state = { startedAt: new Date().toISOString(), lastSweepAt: null, lastSweep: null, lastError: null };
  globalThis.__adsguard_scheduler = state;

  const intervalMs = Math.max(15_000, config.scheduler.tickSeconds * 1000);
  // Jitter so a fleet of instances does not hit Shopify in lockstep.
  const jitter = Math.floor(Math.random() * Math.min(config.scheduler.jitterMs, intervalMs / 2));

  timer = setInterval(() => {
    tick(store, state);
  }, intervalMs);
  timer.unref?.();

  // First sweep shortly after boot, not immediately (let migrations settle).
  setTimeout(() => tick(store, state), 3000 + jitter).unref?.();

  logger.info('scheduler_started', { intervalMs, jitterMs: jitter });
  return {
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      logger.info('scheduler_stopped');
    },
    state,
  };
}

export function isRunning() {
  return running;
}

export default { start, isRunning };
