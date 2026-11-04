import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import pg from 'pg';
import * as schema from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface DbHandle {
  db: Db;
  kind: 'postgres' | 'pglite';
  migrate(): Promise<void>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

function migrationsFolder(): string {
  if (process.env.MIGRATIONS_DIR) return process.env.MIGRATIONS_DIR;
  const here = dirname(fileURLToPath(import.meta.url));
  for (const c of [
    resolve(here, '../../drizzle'),
    resolve(here, '../drizzle'),
    resolve(here, 'drizzle'),
    resolve(process.cwd(), 'drizzle'),
  ])
    if (existsSync(resolve(c, 'meta/_journal.json'))) return c;
  throw new Error('Pasta de migrações não encontrada (defina MIGRATIONS_DIR).');
}

/** Postgres real quando DATABASE_URL existe; caso contrário PGlite (Postgres em WASM) em disco ou memória. */
export async function createDb(opts: { url?: string; pgliteDir?: string }): Promise<DbHandle> {
  if (opts.url) {
    const pool = new pg.Pool({ connectionString: opts.url, max: 20 });
    const db = drizzlePg(pool, { schema }) as unknown as Db;
    return {
      db,
      kind: 'postgres',
      migrate: async () => {
        // Lock consultivo evita duas instâncias migrando ao mesmo tempo.
        const client = await pool.connect();
        try {
          await client.query('select pg_advisory_lock(727274)');
          await migratePg(drizzlePg(client, { schema }), { migrationsFolder: migrationsFolder() });
        } finally {
          await client.query('select pg_advisory_unlock(727274)').catch(() => undefined);
          client.release();
        }
      },
      ping: async () => {
        try {
          await db.execute(sql`select 1`);
          return true;
        } catch {
          return false;
        }
      },
      close: () => pool.end(),
    };
  }
  if (opts.pgliteDir) mkdirSync(opts.pgliteDir, { recursive: true });
  const client = opts.pgliteDir ? new PGlite(opts.pgliteDir) : new PGlite();
  await client.waitReady;
  const db = drizzlePglite(client, { schema }) as unknown as Db;
  return {
    db,
    kind: 'pglite',
    migrate: async () => {
      await migratePglite(drizzlePglite(client, { schema }), { migrationsFolder: migrationsFolder() });
    },
    ping: async () => {
      try {
        await client.query('select 1');
        return true;
      } catch {
        return false;
      }
    },
    close: () => client.close(),
  };
}
