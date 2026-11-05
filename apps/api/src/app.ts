import compress from '@fastify/compress';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { AppError, ROOM, type ServerEvents } from '@tracado/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config';
import type { Ctx } from './context';
import type { DbHandle } from './db/client';
import { verifyAccessToken } from './lib/auth';
import type { Clock } from './lib/clock';
import { LogMailer } from './lib/mailer';
import { createMetrics } from './lib/metrics';
import { KeyedMutex } from './lib/mutex';
import type { Store } from './lib/store';
import { botRoutes } from './modules/bots/routes';
import { adminRoutes } from './modules/admin/routes';
import { authRoutes } from './modules/auth/routes';
import { crazyRoutes } from './modules/crazy/routes';
import { settingsRoutes } from './modules/settings/routes';
import { redeemWsTicket } from './modules/auth/service';
import { PhaseEngine } from './modules/engine/engine';
import { elapsedSim, loadReplay } from './modules/engine/runner';
import { devRoutes } from './modules/misc/dev';
import { miscRoutes } from './modules/misc/routes';
import { shareRoutes } from './modules/misc/share';
import { raceRoutes } from './modules/races/routes';
import { getRaceRow, listEntries, raceSummaries } from './modules/races/service';
import { WsHub } from './modules/ws/hub';

export interface BuildOptions {
  config: Config;
  dbHandle: DbHandle;
  store: Store;
  clock: Clock;
  logger?: boolean | object;
}

export async function buildApp(
  opts: BuildOptions,
): Promise<{ app: FastifyInstance; ctx: Ctx; engine: PhaseEngine }> {
  const { config } = opts;
  const app = Fastify({
    logger:
      opts.logger ??
      (config.NODE_ENV === 'development'
        ? {
            level: config.LOG_LEVEL,
            transport: {
              target: 'pino-pretty',
              options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
            },
          }
        : { level: config.LOG_LEVEL }),
    bodyLimit: 256 * 1024,
    trustProxy: true,
    genReqId: () => crypto.randomUUID(),
    requestIdHeader: 'x-request-id',
  });
  const metrics = createMetrics();
  const hub = new WsHub({ store: opts.store, clock: opts.clock, metrics, log: app.log });
  const ctx: Ctx = {
    config,
    db: opts.dbHandle.db,
    dbHandle: opts.dbHandle,
    store: opts.store,
    clock: opts.clock,
    metrics,
    log: app.log,
    mailer: new LogMailer(app.log),
    hub,
    mutex: new KeyedMutex(),
    engineErrors: [],
  };
  const engine = new PhaseEngine(ctx);

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
  await app.register(cors, {
    origin: config.WEB_ORIGIN.split(',').map((s) => s.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization', 'x-tracado-csrf', 'x-request-id'],
  });
  await app.register(cookie);
  await app.register(compress, { global: true, threshold: 2048, encodings: ['gzip', 'deflate'] });
  await app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    allowList: config.NODE_ENV === 'test' ? () => true : undefined,
    errorResponseBuilder: (_req, c) => ({
      statusCode: 429,
      error: { code: 'RATE_LIMITED', message: `Muitas requisições. Tente em ${Math.ceil(c.ttl / 1000)} s.` },
    }),
  });

  app.decorateRequest('user', null);
  app.decorateRequest('tokenError', false);
  app.addHook('onRequest', async (req) => {
    const h = req.headers.authorization;
    if (h?.startsWith('Bearer ')) {
      try {
        req.user = await verifyAccessToken(config.JWT_SECRET, h.slice(7), ctx.clock.now());
      } catch {
        req.tokenError = true;
      }
    }
  });
  app.addHook('onResponse', async (req, reply) => {
    metrics.httpDuration.observe(
      { method: req.method, route: req.routeOptions.url ?? 'unknown', status: String(reply.statusCode) },
      reply.elapsedTime / 1000,
    );
  });
  app.addHook('onSend', async (req, reply, payload) => {
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
    reply.header('x-request-id', req.id);
    return payload;
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      metrics.errors.inc({ code: err.code });
      if (err.status >= 500) req.log.error({ err }, err.message);
      return reply.code(err.status).send(err.toBody());
    }
    const e = err as { statusCode?: number; code?: string; message: string };
    if (e.statusCode === 429) {
      metrics.errors.inc({ code: 'RATE_LIMITED' });
      return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Muitas requisições.' } });
    }
    if (e.statusCode && e.statusCode < 500) {
      metrics.errors.inc({ code: 'VALIDATION_ERROR' });
      return reply
        .code(e.statusCode)
        .send({
          error: { code: e.statusCode === 413 ? 'VALIDATION_ERROR' : 'VALIDATION_ERROR', message: e.message },
        });
    }
    metrics.errors.inc({ code: 'INTERNAL' });
    req.log.error({ err }, 'Erro não tratado');
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Erro interno.' } });
  });
  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Rota não encontrada.' } }),
  );

  app.get('/health', async (_req, reply) => {
    const [db, store] = await Promise.all([opts.dbHandle.ping(), opts.store.ping()]);
    const ok = db && store;
    return reply
      .code(ok ? 200 : 503)
      .send({
        status: ok ? 'ok' : 'degraded',
        db,
        store,
        dbKind: opts.dbHandle.kind,
        storeKind: opts.store.kind,
        uptime: Math.round(process.uptime()),
        version: process.env.APP_VERSION ?? 'dev',
      });
  });
  app.get('/metrics', async (req, reply) => {
    if (config.METRICS_TOKEN && req.headers.authorization !== `Bearer ${config.METRICS_TOKEN}`)
      throw new AppError('UNAUTHORIZED');
    reply.header('content-type', metrics.registry.contentType);
    return metrics.registry.metrics();
  });

  authRoutes(app, ctx);
  raceRoutes(app, ctx);
  crazyRoutes(app, ctx, engine);
  settingsRoutes(app, ctx, engine);
  miscRoutes(app, ctx);
  shareRoutes(app, ctx);
  adminRoutes(app, ctx, engine);
  botRoutes(app, ctx);
  if (config.ENABLE_DEV_ROUTES && config.NODE_ENV !== 'production') devRoutes(app, ctx, engine);

  // ---------------------------------------------------------------- WebSocket
  hub.ticketRedeemer = (t) => redeemWsTicket(ctx, t);
  hub.snapshotProvider = async (room) => {
    if (!room.startsWith('race:')) return null;
    const raceId = room.slice(5);
    let race;
    try {
      race = await getRaceRow(ctx.db, raceId);
    } catch {
      return { type: 'error', payload: { code: 'NOT_FOUND', message: 'Corrida não encontrada.' } };
    }
    const [summary] = await raceSummaries(ctx.db, [race]);
    let live: ServerEvents['race.snapshot']['live'] = null;
    if (race.status === 'race') {
      const rep = await loadReplay(ctx, raceId);
      if (rep) {
        const el = elapsedSim(race, rep, ctx.clock.now());
        const upto = rep.frames.filter((f) => f.t <= el);
        live = {
          startedAt: race.raceAt.getTime() + 5000,
          durationMs: rep.durationMs,
          frameHz: rep.frameHz,
          playbackSpeed: rep.playbackSpeed,
          cars: rep.cars,
          frames: upto.slice(-8),
          incidents: rep.incidents.filter((i) => i.t <= el && i.kind !== 'overtake').slice(-30),
        };
      }
    }
    return {
      type: 'race.snapshot',
      payload: { race: summary!, entries: await listEntries(ctx.db, raceId), live },
    };
  };
  await hub.init();
  app.server.on('upgrade', (req, socket, head) => {
    const path = (req.url ?? '').split('?')[0];
    if (path === '/ws') hub.handleUpgrade(req, socket, head);
    else socket.destroy();
  });
  app.addHook('onClose', async () => {
    engine.stop();
    hub.close();
  });
  void ROOM;
  return { app, ctx, engine };
}
