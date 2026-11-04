import { loadConfig, loadDotEnv } from '../config';
import { SystemClock } from '../lib/clock';
import { createDb } from './client';
import { seedDemo } from './seed';

loadDotEnv();
const cfg = loadConfig();
const h = await createDb({ url: cfg.DATABASE_URL, pgliteDir: cfg.PGLITE_DIR ?? '.data/pglite' });
await h.migrate();
await seedDemo(h.db, cfg, new SystemClock(), console.log);
await h.close();
