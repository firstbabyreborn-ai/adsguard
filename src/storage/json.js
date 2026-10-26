/**
 * Storage adapter — JSON.
 *
 * Development and single-shop use only. Production must use Postgres; the
 * process refuses to boot with STORAGE_DRIVER=json when NODE_ENV=production.
 *
 * Writes are atomic (tmp file + rename) and the whole file is read under a
 * promise-chain mutex so two concurrent checks cannot interleave a write.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const EMPTY = { shops: {}, watchpoints: [], events: [], alertDeliveries: [] };

export class JsonStore {
  constructor({ dataDir }) {
    this.dir = dataDir;
    this.file = path.join(dataDir, 'db.json');
    this._chain = Promise.resolve();
  }

  async init() {
    await fs.mkdir(this.dir, { recursive: true });
    try {
      await fs.access(this.file);
    } catch {
      await this._persist(structuredClone(EMPTY));
    }
    return this;
  }

  async close() {}

  async _load() {
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const db = JSON.parse(raw);
      return { ...structuredClone(EMPTY), ...db };
    } catch {
      return structuredClone(EMPTY);
    }
  }

  async _persist(db) {
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(db, null, 2));
    await fs.rename(tmp, this.file);
  }

  /** Serialises read-modify-write cycles. */
  _tx(fn) {
    const run = this._chain.then(async () => {
      const db = await this._load();
      const out = await fn(db);
      await this._persist(db);
      return out;
    });
    this._chain = run.catch(() => {});
    return run;
  }

  /* ------------------------------- shops ------------------------------- */

  async upsertShop(shop) {
    return this._tx((db) => {
      const now = new Date().toISOString();
      const prev = db.shops[shop.domain];
      db.shops[shop.domain] = {
        domain: shop.domain,
        accessToken: shop.accessToken ?? prev?.accessToken ?? null,
        installedAt: prev?.installedAt ?? now,
        uninstalledAt: shop.uninstalledAt ?? prev?.uninstalledAt ?? null,
        plan: shop.plan ?? prev?.plan ?? 'free',
        billing: shop.billing ?? prev?.billing ?? { cappedAt: 49, usageThisPeriod: 0, periodStart: now },
        settings: { ...(prev?.settings ?? {}), ...(shop.settings ?? {}) },
      };
      return db.shops[shop.domain];
    });
  }

  async getShop(domain) {
    const db = await this._load();
    return db.shops[domain] ?? null;
  }

  async listShops() {
    const db = await this._load();
    return Object.values(db.shops);
  }

  async listActiveShops() {
    return (await this.listShops()).filter((s) => !s.uninstalledAt);
  }

  async markUninstalled(domain) {
    return this._tx((db) => {
      const s = db.shops[domain];
      if (!s) return null;
      s.uninstalledAt = new Date().toISOString();
      // Fair billing: the meter stops in the same transaction that records the uninstall.
      s.billing = { ...s.billing, stoppedAt: s.uninstalledAt };
      return s;
    });
  }

  /** GDPR shop/redact: delete everything for this domain. */
  async redactShop(domain) {
    return this._tx((db) => {
      delete db.shops[domain];
      db.watchpoints = db.watchpoints.filter((w) => w.shop !== domain);
      db.events = db.events.filter((e) => e.shop !== domain);
      return true;
    });
  }

  /* ----------------------------- watchpoints ---------------------------- */

  async addWatched(domain, item) {
    return this._tx((db) => {
      if (!db.shops[domain]) throw new Error(`unknown shop ${domain}`);
      const id = item.id || `w_${Math.random().toString(36).slice(2, 10)}`;
      db.watchpoints.push({
        id,
        shop: domain,
        url: item.url,
        productId: item.productId || null,
        variantIds: item.variantIds || [],
        label: item.label || item.url,
        adSpend30d: Number(item.adSpend30d) || 0,
        sessions30d: Number(item.sessions30d) || 0,
        conversionRate: Number(item.conversionRate) || 0.02,
        aov: Number(item.aov) || 0,
        expectText: item.expectText || null,
        expectInStock: item.expectInStock !== false,
        maxPriceChangePct: item.maxPriceChangePct ?? 15,
        baselinePrice: item.baselinePrice ?? null,
        checkIntervalMins: item.checkIntervalMins || 10,
        lastCheckedAt: null,
        lastStatus: 'unknown',
        consecutiveFailures: 0,
        createdAt: new Date().toISOString(),
      });
      return id;
    });
  }

  async listWatched(domain) {
    const db = await this._load();
    return db.watchpoints.filter((w) => w.shop === domain);
  }

  async getWatched(id) {
    const db = await this._load();
    return db.watchpoints.find((w) => w.id === id) ?? null;
  }

  async updateWatched(domain, id, patch) {
    return this._tx((db) => {
      const w = db.watchpoints.find((x) => x.id === id && x.shop === domain);
      if (!w) return null;
      Object.assign(w, patch);
      return w;
    });
  }

  async removeWatched(domain, id) {
    return this._tx((db) => {
      const before = db.watchpoints.length;
      db.watchpoints = db.watchpoints.filter((w) => !(w.id === id && w.shop === domain));
      return db.watchpoints.length < before;
    });
  }

  /* -------------------------------- events ------------------------------- */

  async addEvent(e) {
    return this._tx((db) => {
      const ev = {
        id: `e_${Math.random().toString(36).slice(2, 10)}`,
        at: new Date().toISOString(),
        resolvedAt: null,
        durationMins: null,
        estimatedLoss: null,
        cleared: false,
        alertedAt: null,
        severity: 'warning',
        detail: '',
        riskPerHour: 0,
        watchId: null,
        ...e,
      };
      db.events.unshift(ev);
      db.events = db.events.slice(0, 5000);
      return ev;
    });
  }

  async markAlerted(eventId) {
    return this._tx((db) => {
      const e = db.events.find((x) => x.id === eventId);
      if (e) e.alertedAt = new Date().toISOString();
      return e ?? null;
    });
  }

  async activeEvents(domain) {
    const db = await this._load();
    return db.events.filter((e) => e.shop === domain && !e.cleared);
  }

  async recentEvents(domain, limit = 50) {
    const db = await this._load();
    return db.events.filter((e) => e.shop === domain).slice(0, limit);
  }

  async resolveEvents(domain, { watchId, kind } = {}) {
    return this._tx((db) => {
      const closed = [];
      for (const e of db.events) {
        if (e.shop !== domain || e.cleared) continue;
        if (watchId && e.watchId !== watchId) continue;
        if (kind && e.kind !== kind) continue;
        e.cleared = true;
        e.resolvedAt = new Date().toISOString();
        e.durationMins = Math.max(0, Math.round((new Date(e.resolvedAt) - new Date(e.at)) / 60000));
        e.estimatedLoss = Number((e.riskPerHour * (e.durationMins / 60)).toFixed(2));
        closed.push(e);
      }
      return closed;
    });
  }

  async recordDelivery(eventId, channel, ok, detail = {}) {
    return this._tx((db) => {
      db.alertDeliveries.push({ eventId, channel, ok, detail, at: new Date().toISOString() });
      db.alertDeliveries = db.alertDeliveries.slice(-2000);
      return true;
    });
  }

  async deliveryHealth() {
    const db = await this._load();
    const since = Date.now() - 24 * 3600e3;
    const recent = db.alertDeliveries.filter((d) => new Date(d.at).getTime() >= since);
    return {
      last24h: recent.length,
      failedLast24h: recent.filter((d) => !d.ok).length,
      byChannel: recent.reduce((acc, d) => {
        acc[d.channel] ??= { sent: 0, failed: 0 };
        acc[d.channel].sent += 1;
        if (!d.ok) acc[d.channel].failed += 1;
        return acc;
      }, {}),
    };
  }
}

export default JsonStore;
