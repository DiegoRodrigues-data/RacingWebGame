import { loadConfig, loadDotEnv } from '../config';
import { createDb } from './client';

loadDotEnv();
const cfg = loadConfig();
const h = await createDb({ url: cfg.DATABASE_URL, pgliteDir: cfg.PGLITE_DIR ?? '.data/pglite' });
await h.migrate();
console.log(`Migrações aplicadas (${h.kind}).`);
await h.close();
