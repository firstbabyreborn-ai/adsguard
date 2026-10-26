/**
 * Storage factory. One interface, two drivers.
 * Everything above this line is driver-agnostic, which is what makes the
 * Cloudflare/Postgres/JSON story a 40-line change instead of a rewrite.
 */
import config from '../config.js';
import { JsonStore } from './json.js';
import { PgStore } from './pg.js';

let instance = null;

export async function getStore() {
  if (instance) return instance;

  if (config.storage.driver === 'pg') {
    instance = await new PgStore({
      databaseUrl: config.storage.databaseUrl,
      poolMax: config.storage.poolMax,
    }).init();
  } else {
    instance = await new JsonStore({ dataDir: config.storage.dataDir }).init();
  }
  return instance;
}

export async function closeStore() {
  await instance?.close();
  instance = null;
}

export default { getStore, closeStore };
