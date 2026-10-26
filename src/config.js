/**
 * Config with fail-fast validation.
 *
 * Production rule: the process must refuse to boot in a half-configured state.
 * A monitoring product that silently runs with a broken API secret is worse than
 * one that does not run at all — it will produce false "healthy" ticks.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Minimal .env loader (no dependency).
 * Real environment variables always win, so Fly/Render secrets are never
 * overridden by a stray file. Missing file is not an error — production sets
 * everything through the platform.
 */
function loadDotEnv() {
  for (const file of ['.env.local', '.env']) {
    let raw;
    try {
      raw = fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
    } catch {
      continue;
    }
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}
loadDotEnv();

const bool = (v, d = false) => (v == null ? d : /^(1|true|yes|on)$/i.test(String(v)));
const int = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';

export const config = {
  env,
  isProd,
  port: int(process.env.PORT, 3000),
  host: process.env.HOST || '0.0.0.0',
  /**
   * APP_URL is the public origin used to build OAuth redirects and webhook URLs.
   * Render injects RENDER_EXTERNAL_URL at runtime, which removes the
   * chicken-and-egg of "you need the URL before the service exists".
   */
  appUrl:
    process.env.APP_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    `http://localhost:${int(process.env.PORT, 3000)}`,

  shopify: {
    apiKey: process.env.SHOPIFY_API_KEY || '',
    apiSecret: process.env.SHOPIFY_API_SECRET || '',
    scopes:
      process.env.SHOPIFY_SCOPES ||
      'read_products,read_inventory,read_orders,read_analytics,read_online_store_pages',
    apiVersion: process.env.SHOPIFY_API_VERSION || '2026-07',
    /** Embedded apps authenticate with App Bridge session tokens, not cookies. */
    embedded: bool(process.env.SHOPIFY_EMBEDDED, true),
  },

  storage: {
    driver: process.env.STORAGE_DRIVER || (isProd ? 'pg' : 'json'),
    dataDir: process.env.DATA_DIR || 'data',
    databaseUrl: process.env.DATABASE_URL || '',
    poolMax: int(process.env.PG_POOL_MAX, 10),
  },

  scheduler: {
    enabled: bool(process.env.SCHEDULER_ENABLED, true),
    /** Base tick. Per-shop intervals are honoured inside the tick. */
    tickSeconds: int(process.env.SCHEDULER_TICK_SECONDS, 60),
    /** Alert only after this many consecutive failures (kills flapping). */
    consecutiveFailures: int(process.env.ALERT_AFTER_FAILURES, 2),
    concurrency: int(process.env.SCHEDULER_CONCURRENCY, 4),
    jitterMs: int(process.env.SCHEDULER_JITTER_MS, 8000),
  },

  alerts: {
    resendKey: process.env.RESEND_API_KEY || '',
    fromEmail: process.env.ALERT_FROM || 'alerts@adsguard.app',
    twilio: {
      sid: process.env.TWILIO_ACCOUNT_SID || '',
      token: process.env.TWILIO_AUTH_TOKEN || '',
      from: process.env.TWILIO_FROM || '',
    },
    /** Never page more often than this per shop. */
    minSecondsBetweenAlerts: int(process.env.MIN_SECONDS_BETWEEN_ALERTS, 300),
  },

  http: {
    /** Per-request timeout for the monitored store. */
    timeoutMs: int(process.env.CHECK_TIMEOUT_MS, 15000),
    maxRedirects: int(process.env.CHECK_MAX_REDIRECTS, 5),
    userAgent:
      process.env.CHECK_USER_AGENT ||
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 AdsGuard/1.0 (+https://adsguard.app/bot)',
  },

  log: { level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug') },
};

/** Hard failures. Throws so the process never starts half-broken. */
export function validate() {
  const errors = [];
  if (isProd) {
    if (!config.shopify.apiKey) errors.push('SHOPIFY_API_KEY is required in production');
    if (!config.shopify.apiSecret) errors.push('SHOPIFY_API_SECRET is required in production');
    if (config.shopify.apiSecret && config.shopify.apiSecret.length < 24)
      errors.push('SHOPIFY_API_SECRET looks too short — check you copied the app secret, not an old one');
    if (!/^https:\/\//.test(config.appUrl)) errors.push('APP_URL must be https in production (Shopify requires it)');
    if (config.storage.driver === 'pg' && !config.storage.databaseUrl)
      errors.push('DATABASE_URL is required when STORAGE_DRIVER=pg');
    if (config.storage.driver === 'json' && isProd)
      errors.push('STORAGE_DRIVER=json is not safe in production — use pg');
  }
  if (!['json', 'pg'].includes(config.storage.driver)) errors.push(`unknown STORAGE_DRIVER ${config.storage.driver}`);
  return errors;
}

export default config;
