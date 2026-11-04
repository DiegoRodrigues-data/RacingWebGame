import { buildApp } from './app';
import { loadConfig, loadDotEnv } from './config';
import { ensureAdmin } from './db/bootstrap';
import { createDb } from './db/client';
import { seedDemo } from './db/seed';
import { OffsetClock, SystemClock } from './lib/clock';
import { createStore } from './lib/store';
import { initTelemetry } from './telemetry';

loadDotEnv();
const config = loadConfig();
await initTelemetry(config, (m) => console.log(m));
const clock =
  config.ENABLE_DEV_ROUTES && config.NODE_ENV !== 'production' ? new OffsetClock() : new SystemClock();
const dbHandle = await createDb({ url: config.DATABASE_URL, pgliteDir: config.PGLITE_DIR ?? '.data/pglite' });
await dbHandle.migrate();
await ensureAdmin(dbHandle.db, config);
if (config.SEED_DEMO) await seedDemo(dbHandle.db, config, clock, (m) => console.log(m));
const store = createStore(config.REDIS_URL, () => clock.now());
const { app, engine } = await buildApp({ config, dbHandle, store, clock });

await app.listen({ port: config.PORT, host: config.HOST });
app.log.info(
  `API Traçado em http://${config.HOST}:${config.PORT} (db=${dbHandle.kind}, store=${store.kind})`,
);
if (config.ENGINE_ENABLED) engine.start();

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  app.log.info(`Recebido ${signal}; encerrando com segurança...`);
  engine.stop();
  await app.close();
  await store.close();
  await dbHandle.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
