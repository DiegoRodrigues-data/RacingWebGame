import type { FastifyBaseLogger } from 'fastify';
import type { Config } from './config';
import type { Db, DbHandle } from './db/client';
import type { Clock } from './lib/clock';
import type { Mailer } from './lib/mailer';
import type { Metrics } from './lib/metrics';
import { KeyedMutex } from './lib/mutex';
import type { Store } from './lib/store';
import type { WsHub } from './modules/ws/hub';

export interface Ctx {
  config: Config;
  db: Db;
  dbHandle: DbHandle;
  store: Store;
  clock: Clock;
  metrics: Metrics;
  log: FastifyBaseLogger;
  mailer: Mailer;
  hub: WsHub;
  mutex: KeyedMutex;
  /** Ring buffer de erros recentes do motor (painel admin). */
  engineErrors: { at: number; message: string; raceId?: string }[];
}
