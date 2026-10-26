/**
 * Storage adapter — PostgreSQL (production).
 *
 * Uses the pure-JS `pg` driver. Every statement is parameterised; there is no
 * string interpolation of user data anywhere in this file.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const num = (v, d = 0) => (v == null ? d : Number(v));

function toShop(row) {
  if (!row) return null;
  return {
    domain: row.domain,
    accessToken: row.access_token,
    installedAt: row.installed_at?.toISOString?.() ?? row.installed_at,
    uninstalledAt: row.uninstalled_at?.toISOString?.() ?? row.uninstalled_at,
    plan: row.plan,
    settings: row.settings ?? {},
    billing: row.billing ?? {},
  };
}

function toWatched(r) {
  return {
    id: r.id,
    shop: r.shop,
    url: r.url,
    productId: r.product_id,
    variantIds: r.variant_ids ?? [],
    label: r.label,
    adSpend30d: num(r.ad_spend_30d),
    sessions30d: num(r.sessions_30d),
    conversionRate: num(r.conversion_rate),
    aov: num(r.aov),
    expectText: r.expect_text,
    expectInStock: r.expect_in_stock,
    maxPriceChangePct: num(r.max_price_change_pct, 15),
    baselinePrice: r.baseline_price == null ? null : num(r.baseline_price),
    checkIntervalMins: num(r.check_interval_mins, 10),
    lastCheckedAt: r.last_checked_at?.toISOString?.() ?? r.last_checked_at,
    lastStatus: r.last_status,
    consecutiveFailures: num(r.consecutive_failures),
    createdAt: r.created_at?.toISOString?.() ?? r.created_at,
  };
}

function toEvent(r) {
  return {
    id: r.id,
    shop: r.shop,
    watchId: r.watch_id,
    kind: r.kind,
    severity: r.severity,
    title: r.title,
    detail: r.detail,
    riskPerHour: num(r.risk_per_hour),
    at: r.at?.toISOString?.() ?? r.at,
    cleared: r.cleared,
    resolvedAt: r.resolved_at?.toISOString?.() ?? r.resolved_at,
    durationMins: r.duration_mins,
    estimatedLoss: r.estimated_loss == null ? null : num(r.estimated_loss),
    alertedAt: r.alerted_at?.toISOString?.() ?? r.alerted_at,
  };
}

export class PgStore {
  constructor({ databaseUrl, poolMax, migrationsDir }) {
    this.databaseUrl = databaseUrl;
    this.poolMax = poolMax;
    this.migrationsDir = migrationsDir || path.join(__dirname, '..', '..', 'migrations');
    this.pool = null;
  }

  async init() {
    const { default: pg } = await import('pg');
    this.pool = new pg.Pool({
      connectionString: this.databaseUrl,
      max: this.poolMax,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      // Most managed Postgres needs SSL; local docker does not.
      /**
       * SSL rules, in order:
       *   ?sslmode=disable          -> off
       *   ?sslmode=require/verify   -> on
       *   hostname without a dot    -> off (Render/Fly internal DNS names)
       *   otherwise                 -> on, without CA pinning
       */
      ssl: (() => {
        const url = this.databaseUrl;
        if (/sslmode=disable/.test(url)) return false;
        if (/sslmode=(require|verify-ca|verify-full)/.test(url)) return { rejectUnauthorized: false };
        try {
          const host = new URL(url).hostname;
          if (!host.includes('.')) return false; // internal service DNS
        } catch {
          /* fall through to the safe default */
        }
        return { rejectUnauthorized: false };
      })(),
    });
    await this.pool.query('SELECT 1');
    await this.migrate();
    return this;
  }

  async migrate() {
    const files = (await fs.readdir(this.migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
    await this.pool.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const { rows } = await this.pool.query('SELECT version FROM schema_migrations');
    const done = new Set(rows.map((r) => r.version));
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await fs.readFile(path.join(this.migrationsDir, f), 'utf8');
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [f]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${f} failed: ${err.message}`);
      } finally {
        client.release();
      }
    }
  }

  async close() {
    await this.pool?.end();
  }

  /* ------------------------------- shops ------------------------------- */

  async upsertShop(shop) {
    const { rows } = await this.pool.query(
      `INSERT INTO shops (domain, access_token, plan, settings, billing)
       VALUES ($1, $2, COALESCE($3,'free'), COALESCE($4,'{}'::jsonb), COALESCE($5,'{}'::jsonb))
       ON CONFLICT (domain) DO UPDATE SET
         access_token = COALESCE(EXCLUDED.access_token, shops.access_token),
         plan         = COALESCE(EXCLUDED.plan, shops.plan),
         settings     = shops.settings || EXCLUDED.settings,
         billing      = CASE WHEN EXCLUDED.billing = '{}'::jsonb THEN shops.billing ELSE EXCLUDED.billing END,
         uninstalled_at = NULL
       RETURNING *`,
      [shop.domain, shop.accessToken ?? null, shop.plan ?? null, JSON.stringify(shop.settings ?? {}), JSON.stringify(shop.billing ?? {})],
    );
    return toShop(rows[0]);
  }

  async getShop(domain) {
    const { rows } = await this.pool.query('SELECT * FROM shops WHERE domain = $1', [domain]);
    return toShop(rows[0]);
  }

  async listShops() {
    const { rows } = await this.pool.query('SELECT * FROM shops ORDER BY installed_at DESC');
    return rows.map(toShop);
  }

  async listActiveShops() {
    const { rows } = await this.pool.query('SELECT * FROM shops WHERE uninstalled_at IS NULL');
    return rows.map(toShop);
  }

  async markUninstalled(domain) {
    const { rows } = await this.pool.query(
      `UPDATE shops SET uninstalled_at = now(),
        billing = billing || jsonb_build_object('stoppedAt', now())
       WHERE domain = $1 RETURNING *`,
      [domain],
    );
    return toShop(rows[0]);
  }

  async redactShop(domain) {
    await this.pool.query('DELETE FROM shops WHERE domain = $1', [domain]);
    return true;
  }

  /* ----------------------------- watchpoints ---------------------------- */

  async addWatched(domain, item) {
    const id = item.id || `w_${Math.random().toString(36).slice(2, 10)}`;
    const { rows } = await this.pool.query(
      `INSERT INTO watchpoints
        (id, shop, url, product_id, variant_ids, label, ad_spend_30d, sessions_30d,
         conversion_rate, aov, expect_text, expect_in_stock, max_price_change_pct,
         baseline_price, check_interval_mins)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        id, domain, item.url, item.productId ?? null, item.variantIds ?? [],
        item.label || item.url, Number(item.adSpend30d) || 0, Number(item.sessions30d) || 0,
        Number(item.conversionRate) || 0.02, Number(item.aov) || 0,
        item.expectText ?? null, item.expectInStock !== false,
        item.maxPriceChangePct ?? 15, item.baselinePrice ?? null,
        item.checkIntervalMins || 10,
      ],
    );
    return toWatched(rows[0]).id;
  }

  async listWatched(domain) {
    const { rows } = await this.pool.query(
      'SELECT * FROM watchpoints WHERE shop = $1 ORDER BY created_at ASC',
      [domain],
    );
    return rows.map(toWatched);
  }

  async getWatched(id) {
    const { rows } = await this.pool.query('SELECT * FROM watchpoints WHERE id = $1', [id]);
    return rows[0] ? toWatched(rows[0]) : null;
  }

  async updateWatched(domain, id, patch) {
    const map = {
      lastCheckedAt: 'last_checked_at',
      lastStatus: 'last_status',
      consecutiveFailures: 'consecutive_failures',
      baselinePrice: 'baseline_price',
      expectText: 'expect_text',
      expectInStock: 'expect_in_stock',
      maxPriceChangePct: 'max_price_change_pct',
      checkIntervalMins: 'check_interval_mins',
      adSpend30d: 'ad_spend_30d',
      sessions30d: 'sessions_30d',
      conversionRate: 'conversion_rate',
      aov: 'aov',
      label: 'label',
      url: 'url',
      productId: 'product_id',
    };
    const sets = [];
    const vals = [];
    let i = 1;
    for (const [k, col] of Object.entries(map)) {
      if (patch[k] === undefined) continue;
      sets.push(`${col} = $${i++}`);
      vals.push(patch[k]);
    }
    if (!sets.length) return this.getWatched(id);
    vals.push(id, domain);
    const { rows } = await this.pool.query(
      `UPDATE watchpoints SET ${sets.join(', ')} WHERE id = $${i++} AND shop = $${i} RETURNING *`,
      vals,
    );
    return rows[0] ? toWatched(rows[0]) : null;
  }

  async removeWatched(domain, id) {
    const { rowCount } = await this.pool.query('DELETE FROM watchpoints WHERE id = $1 AND shop = $2', [id, domain]);
    return rowCount > 0;
  }

  /* -------------------------------- events ------------------------------- */

  async addEvent(e) {
    const id = e.id || `e_${Math.random().toString(36).slice(2, 10)}`;
    const { rows } = await this.pool.query(
      `INSERT INTO events (id, shop, watch_id, kind, severity, title, detail, risk_per_hour, at, cleared, resolved_at, duration_mins, estimated_loss)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9, now()),COALESCE($10,false),$11,$12,$13)
       RETURNING *`,
      [
        id, e.shop, e.watchId ?? null, e.kind, e.severity || 'warning',
        e.title, e.detail || '', Number(e.riskPerHour) || 0,
        e.at ?? null, e.cleared ?? false, e.resolvedAt ?? null,
        e.durationMins ?? null, e.estimatedLoss ?? null,
      ],
    );
    return toEvent(rows[0]);
  }

  async markAlerted(eventId) {
    const { rows } = await this.pool.query('UPDATE events SET alerted_at = now() WHERE id = $1 RETURNING *', [eventId]);
    return rows[0] ? toEvent(rows[0]) : null;
  }

  async activeEvents(domain) {
    const { rows } = await this.pool.query(
      'SELECT * FROM events WHERE shop = $1 AND cleared = false ORDER BY at DESC',
      [domain],
    );
    return rows.map(toEvent);
  }

  async recentEvents(domain, limit = 50) {
    const { rows } = await this.pool.query(
      'SELECT * FROM events WHERE shop = $1 ORDER BY at DESC LIMIT $2',
      [domain, limit],
    );
    return rows.map(toEvent);
  }

  async resolveEvents(domain, { watchId, kind } = {}) {
    const { rows } = await this.pool.query(
      `UPDATE events SET
         cleared = true,
         resolved_at = now(),
         duration_mins = GREATEST(0, ROUND(EXTRACT(EPOCH FROM (now() - at)) / 60)::int),
         estimated_loss = ROUND(risk_per_hour * (GREATEST(0, EXTRACT(EPOCH FROM (now() - at)) / 3600)), 2)
       WHERE shop = $1 AND cleared = false
         AND ($2::text IS NULL OR watch_id = $2)
         AND ($3::text IS NULL OR kind = $3)
       RETURNING *`,
      [domain, watchId ?? null, kind ?? null],
    );
    return rows.map(toEvent);
  }

  async recordDelivery(eventId, channel, ok, detail = {}) {
    await this.pool.query(
      'INSERT INTO alert_deliveries (event_id, channel, ok, detail) VALUES ($1,$2,$3,$4)',
      [eventId, channel, ok, JSON.stringify(detail)],
    );
    return true;
  }

  async deliveryHealth() {
    const { rows } = await this.pool.query(
      `SELECT channel, ok, count(*)::int AS n
       FROM alert_deliveries WHERE at >= now() - interval '24 hours'
       GROUP BY channel, ok`,
    );
    const out = { last24h: 0, failedLast24h: 0, byChannel: {} };
    for (const r of rows) {
      out.last24h += r.n;
      if (!r.ok) out.failedLast24h += r.n;
      out.byChannel[r.channel] ??= { sent: 0, failed: 0 };
      out.byChannel[r.channel].sent += r.n;
      if (!r.ok) out.byChannel[r.channel].failed += r.n;
    }
    return out;
  }
}

export default PgStore;
