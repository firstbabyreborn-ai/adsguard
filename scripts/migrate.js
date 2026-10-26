/** Run Postgres migrations only. Usage: DATABASE_URL=... node scripts/migrate.js */
import config from '../src/config.js';
import { PgStore } from '../src/storage/pg.js';

const store = await new PgStore({
  databaseUrl: config.storage.databaseUrl,
  poolMax: 2,
}).init();
console.log('migrations applied');
await store.close();
