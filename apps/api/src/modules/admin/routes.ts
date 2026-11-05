import {
  AppError,
  buildTimeline,
  canTransition,
  categoryCreateSchema,
  editorTrackSchema,
  eventCreateSchema,
  raceBatchSchema,
  raceCreateSchema,
  raceUpdateSchema,
  roleSchema,
  ROOM,
  trackParamsSchema,
  DEFAULT_SETUP,
} from '@tracado/shared';
import { estimateLap } from '@tracado/sim';
import { offsetsToTrace, suggestedLine, TrackGenerationError } from '@tracado/trackgen';
import { and, desc, eq, gte, ilike, inArray, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../../context';
import {
  adminAuditLog,
  categories,
  entries,
  events,
  profiles,
  raceResults,
  races,
  seasons,
  trackVersions,
  users,
} from '../../db/schema';
import { requireRole, type AuthUser } from '../../lib/auth';
import { parse } from '../../lib/validate';
import { setRoles } from '../auth/service';
import type { PhaseEngine } from '../engine/engine';
import { reprocess } from '../engine/runner';
import { notify } from '../notifications/service';
import { closeSeason, rebuildSeason } from '../rankings/service';
import { capacityOf, createRace, getRaceRow, getSummary, raceSummaries } from '../races/service';
import { getSettings } from '../settings/service';
import * as tracksSvc from '../tracks/service';

const idParam = z.object({ id: z.string().uuid() });

export async function audit(
  ctx: Ctx,
  actor: AuthUser,
  action: string,
  targetType: string,
  targetId: string | null,
  diff: Record<string, unknown> = {},
) {
  await ctx.db
    .insert(adminAuditLog)
    .values({ actorId: actor.id, action, targetType, targetId, diff, createdAt: new Date(ctx.clock.now()) });
}

export function adminRoutes(app: FastifyInstance, ctx: Ctx, engine: PhaseEngine) {
  const admin = (req: Parameters<typeof requireRole>[0]) => requireRole(req, 'admin');
  const editor = (req: Parameters<typeof requireRole>[0]) => requireRole(req, 'admin', 'track_editor');

  // ------------------------------------------------------------ Dashboard e auditoria
  app.get('/admin/dashboard', async (req) => {
    admin(req);
    const now = ctx.clock.now();
    const dayStart = new Date(now - 12 * 3600_000),
      dayEnd = new Date(now + 12 * 3600_000);
    const byStatus = await ctx.db
      .select({ status: races.status, n: sql<number>`count(*)::int` })
      .from(races)
      .where(and(gte(races.practiceAt, dayStart), sql`${races.practiceAt} <= ${dayEnd}`))
      .groupBy(races.status);
    for (const s of byStatus) ctx.metrics.racesByStatus.set({ status: s.status }, s.n);
    const [ent] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(entries)
      .where(gte(entries.createdAt, new Date(now - 86_400_000)));
    const [flagged] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(users)
      .where(eq(users.flaggedForReview, true));
    const liveRows = await ctx.db
      .select()
      .from(races)
      .where(inArray(races.status, ['practice', 'trace_window', 'setup_lock', 'qualifying', 'race']));
    return {
      serverTime: now,
      racesToday: Object.fromEntries(byStatus.map((s) => [s.status, s.n])),
      entriesLast24h: ent?.n ?? 0,
      flaggedUsers: flagged?.n ?? 0,
      wsConnections: ctx.hub.connectionCount,
      live: await raceSummaries(ctx.db, liveRows),
      engineErrors: [...ctx.engineErrors].reverse().slice(0, 20),
      store: ctx.store.kind,
      db: ctx.dbHandle.kind,
    };
  });
  /** Números do jogo para o painel: jogadores, corridas por dia e por terreno, grupos e próximas corridas. */
  app.get('/admin/stats', async (req) => {
    admin(req);
    const now = ctx.clock.now();
    const d7 = new Date(now - 7 * 86_400_000);
    const d14 = new Date(now - 14 * 86_400_000);
    const [pl] = await ctx.db
      .select({
        total: sql<number>`count(*) filter (where not ${users.isBot} and not ${users.isGuest})::int`,
        guests: sql<number>`count(*) filter (where ${users.isGuest})::int`,
        bots: sql<number>`count(*) filter (where ${users.isBot})::int`,
        new7d: sql<number>`count(*) filter (where not ${users.isBot} and ${users.createdAt} >= ${d7})::int`,
      })
      .from(users);
    const [act] = await ctx.db
      .select({ n: sql<number>`count(distinct ${entries.userId})::int` })
      .from(entries)
      .innerJoin(users, eq(users.id, entries.userId))
      .where(and(gte(entries.createdAt, d7), eq(users.isBot, false)));
    // Dia no fuso de Brasília (UTC-3, sem horário de verão).
    const day = sql<string>`to_char(${races.practiceAt} - interval '3 hours', 'YYYY-MM-DD')`;
    const perDay = await ctx.db
      .select({ day, status: races.status, n: sql<number>`count(*)::int` })
      .from(races)
      .where(and(gte(races.practiceAt, d14), sql`${races.practiceAt} <= ${new Date(now)}`))
      .groupBy(day, races.status);
    const byTerrain = await ctx.db
      .select({ terrain: trackVersions.terrain, n: sql<number>`count(*)::int` })
      .from(races)
      .innerJoin(trackVersions, eq(trackVersions.id, races.trackVersionId))
      .where(gte(races.practiceAt, d14))
      .groupBy(trackVersions.terrain);
    const [crazy] = await ctx.db
      .select({ groups: sql<number>`count(distinct ${races.crazyGroupId})::int` })
      .from(races)
      .where(
        and(
          sql`${races.crazyGroupId} is not null`,
          inArray(races.status, [
            'scheduled',
            'registration_open',
            'practice',
            'trace_window',
            'setup_lock',
            'qualifying',
            'race',
          ]),
        ),
      );
    const upcomingRows = await ctx.db
      .select()
      .from(races)
      .where(
        and(inArray(races.status, ['scheduled', 'registration_open']), gte(races.practiceAt, new Date(now))),
      )
      .orderBy(races.practiceAt)
      .limit(8);
    const days: Record<string, { finished: number; cancelled: number; other: number }> = {};
    for (const r of perDay) {
      const d = (days[r.day] ??= { finished: 0, cancelled: 0, other: 0 });
      if (r.status === 'finished' || r.status === 'archived') d.finished += r.n;
      else if (r.status === 'cancelled') d.cancelled += r.n;
      else d.other += r.n;
    }
    return {
      players: { ...pl!, active7d: act?.n ?? 0 },
      racesPerDay: Object.entries(days)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([d, v]) => ({ day: d, ...v })),
      byTerrain: Object.fromEntries(byTerrain.map((t) => [t.terrain, t.n])),
      crazyActiveGroups: crazy?.groups ?? 0,
      upcoming: await raceSummaries(ctx.db, upcomingRows),
    };
  });

  app.get('/admin/audit', async (req) => {
    admin(req);
    const rows = await ctx.db
      .select({ a: adminAuditLog, nick: profiles.nickname })
      .from(adminAuditLog)
      .leftJoin(profiles, eq(profiles.userId, adminAuditLog.actorId))
      .orderBy(desc(adminAuditLog.createdAt))
      .limit(200);
    return rows.map(({ a, nick }) => ({ ...a, actor: nick, createdAt: a.createdAt.toISOString() }));
  });

  // ------------------------------------------------------------ Categorias
  app.get('/admin/categories', async (req) => {
    admin(req);
    return ctx.db.select().from(categories);
  });
  app.post('/admin/categories', async (req, reply) => {
    const u = admin(req);
    const b = parse(categoryCreateSchema, req.body);
    const [c] = await ctx.db
      .insert(categories)
      .values(b)
      .returning()
      .catch((e: Error) => {
        if (e.message.includes('slug')) throw new AppError('CONFLICT', 'Slug já existe.');
        throw e;
      });
    await audit(ctx, u, 'category.create', 'category', c!.id, b);
    return reply.code(201).send(c);
  });
  app.patch('/admin/categories/:id', async (req) => {
    const u = admin(req);
    const { id } = parse(idParam, req.params);
    const b = parse(categoryCreateSchema.partial(), req.body);
    const [before] = await ctx.db.select().from(categories).where(eq(categories.id, id));
    if (!before) throw new AppError('NOT_FOUND');
    const [c] = await ctx.db.update(categories).set(b).where(eq(categories.id, id)).returning();
    await audit(ctx, u, 'category.update', 'category', id, { before, after: b });
    return c;
  });

  // ------------------------------------------------------------ Eventos
  app.get('/admin/events', async (req) => {
    admin(req);
    return ctx.db.select().from(events).orderBy(desc(events.startsAt)).limit(200);
  });
  app.get('/events', async () =>
    ctx.db
      .select()
      .from(events)
      .where(eq(events.status, 'published'))
      .orderBy(desc(events.startsAt))
      .limit(100),
  );
  app.post('/admin/events', async (req, reply) => {
    const u = admin(req);
    const b = parse(eventCreateSchema, req.body);
    const [e] = await ctx.db
      .insert(events)
      .values({ ...b, startsAt: new Date(b.startsAt), endsAt: new Date(b.endsAt), createdBy: u.id })
      .returning();
    await audit(ctx, u, 'event.create', 'event', e!.id, b);
    return reply.code(201).send(e);
  });
  app.patch('/admin/events/:id', async (req) => {
    const u = admin(req);
    const { id } = parse(idParam, req.params);
    const b = parse(eventCreateSchema.partial(), req.body);
    const { startsAt, endsAt, ...rest } = b;
    const [e] = await ctx.db
      .update(events)
      .set({
        ...rest,
        ...(startsAt ? { startsAt: new Date(startsAt) } : {}),
        ...(endsAt ? { endsAt: new Date(endsAt) } : {}),
      })
      .where(eq(events.id, id))
      .returning();
    if (!e) throw new AppError('NOT_FOUND');
    await audit(ctx, u, 'event.update', 'event', id, b);
    return e;
  });

  // ------------------------------------------------------------ Corridas
  app.post('/admin/races', async (req, reply) => {
    const u = admin(req);
    const b = parse(raceCreateSchema, req.body);
    b.traceWindowSeconds ??= (await getSettings(ctx)).phases.traceWindowSec;
    const r = await createRace(ctx, b, u.id).catch((e) => {
      if (e instanceof TrackGenerationError) throw new AppError('TRACK_INVALID', e.message, e.issues);
      throw e;
    });
    await audit(ctx, u, 'race.create', 'race', r.id, b);
    const s = await getSummary(ctx.db, r.id);
    await ctx.hub.publish(ROOM.lobby, 'lobby.race', { race: s });
    return reply.code(201).send(s);
  });

  /** Gera corridas em lote: ex. 3 por dia às 12h, 18h e 21h entre duas datas. */
  app.post('/admin/races/batch', async (req, reply) => {
    const u = admin(req);
    const b = parse(raceBatchSchema, req.body);
    const traceWindowSeconds = b.traceWindowSeconds ?? (await getSettings(ctx)).phases.traceWindowSec;
    const from = Date.parse(`${b.fromDate}T00:00:00Z`),
      to = Date.parse(`${b.toDate}T00:00:00Z`);
    if (to < from) throw new AppError('VALIDATION_ERROR', 'Data final antes da inicial.');
    if ((to - from) / 86_400_000 > 60) throw new AppError('VALIDATION_ERROR', 'No máximo 60 dias por lote.');
    const created: string[] = [];
    const now = ctx.clock.now();
    await ctx.db.transaction(async (tx) => {
      for (let d = from; d <= to; d += 86_400_000) {
        for (const t of b.times) {
          const [hh, mm] = t.split(':').map(Number);
          const at = d + (hh! * 60 + mm!) * 60_000 - b.timezoneOffsetMinutes * 60_000;
          if (at <= now) continue;
          const { namePrefix, fromDate: _f, toDate: _t, times: _x, timezoneOffsetMinutes: _z, ...rest } = b;
          const label = new Date(at + b.timezoneOffsetMinutes * 60_000)
            .toISOString()
            .slice(0, 16)
            .replace('T', ' ');
          const r = await createRace(
            ctx,
            {
              ...rest,
              traceWindowSeconds,
              name: `${namePrefix} ${label}`,
              startAt: new Date(at).toISOString(),
            },
            u.id,
            tx,
          );
          created.push(r.id);
        }
      }
    });
    await audit(ctx, u, 'race.batch', 'race', null, { count: created.length, ...b });
    return reply.code(201).send({ created: created.length, ids: created });
  });

  app.patch('/admin/races/:id', async (req) => {
    const u = admin(req);
    const { id } = parse(idParam, req.params);
    const b = parse(raceUpdateSchema, req.body);
    const res = await ctx.mutex.run(`race:${id}`, () =>
      ctx.db.transaction(async (tx) => {
        const race = await getRaceRow(tx, id, true);
        if (race.status !== 'scheduled' && race.status !== 'registration_open')
          throw new AppError(
            'INVALID_TRANSITION',
            'Só é possível editar corridas agendadas ou com inscrições abertas.',
          );
        const cap = await capacityOf(tx, race);
        if (b.capacity !== undefined && b.capacity < cap.confirmed)
          throw new AppError('VALIDATION_ERROR', `Já há ${cap.confirmed} confirmados.`);
        const set: Partial<typeof races.$inferInsert> = {};
        for (const k of ['name', 'ranked', 'capacity', 'waitlistMax', 'laps', 'weather'] as const)
          if (b[k] !== undefined) (set as Record<string, unknown>)[k] = b[k];
        if (b.startAt) {
          const startAt = Date.parse(b.startAt);
          if (startAt <= ctx.clock.now())
            throw new AppError('VALIDATION_ERROR', 'Novo início precisa estar no futuro.');
          const tl = buildTimeline({
            startAt,
            registrationLeadMs: race.practiceAt.getTime() - race.registrationOpensAt.getTime(),
            practiceMs: race.traceWindowAt.getTime() - race.practiceAt.getTime(),
            setupLockMs: race.qualifyingAt.getTime() - race.setupLockAt.getTime(),
            qualifyingMs: race.raceAt.getTime() - race.qualifyingAt.getTime(),
          });
          Object.assign(set, {
            registrationOpensAt: new Date(tl.registrationOpensAt),
            practiceAt: new Date(tl.practiceAt),
            traceWindowAt: new Date(tl.traceWindowAt),
            setupLockAt: new Date(tl.setupLockAt),
            qualifyingAt: new Date(tl.qualifyingAt),
            raceAt: new Date(tl.raceAt),
          });
        }
        await tx.update(races).set(set).where(eq(races.id, id));
        return { before: race, set };
      }),
    );
    await audit(ctx, u, 'race.update', 'race', id, { changes: b });
    const s = await getSummary(ctx.db, id);
    await ctx.hub.publish(ROOM.lobby, 'lobby.race', { race: s });
    void res;
    return s;
  });

  app.post('/admin/races/:id/cancel', async (req) => {
    const u = admin(req);
    const { id } = parse(idParam, req.params);
    const { reason } = parse(z.object({ reason: z.string().min(3).max(300) }), req.body);
    const race = await getRaceRow(ctx.db, id);
    if (!canTransition(race.status, 'cancelled'))
      throw new AppError('INVALID_TRANSITION', 'Esta corrida não pode mais ser cancelada.');
    await engine.cancelRace(id, reason);
    await audit(ctx, u, 'race.cancel', 'race', id, { reason, from: race.status });
    return getSummary(ctx.db, id);
  });

  /** Anula o resultado: zera pontos, retira dos rankings (reconstrução idempotente) e avisa os participantes. */
  app.post('/admin/races/:id/annul', async (req) => {
    const u = admin(req);
    const { id } = parse(idParam, req.params);
    const { reason } = parse(z.object({ reason: z.string().min(3).max(300) }), req.body);
    const race = await getRaceRow(ctx.db, id);
    if (race.status !== 'finished' && race.status !== 'archived')
      throw new AppError('INVALID_TRANSITION', 'Só resultados publicados podem ser anulados.');
    if (race.annulled) throw new AppError('CONFLICT', 'Resultado já anulado.');
    await ctx.db.transaction(async (tx) => {
      await tx.update(races).set({ annulled: true }).where(eq(races.id, id));
      await tx.update(raceResults).set({ points: 0, ranked: false }).where(eq(raceResults.raceId, id));
    });
    if (race.seasonId) await rebuildSeason(ctx, race.seasonId);
    const ids = (
      await ctx.db.select({ u: raceResults.userId }).from(raceResults).where(eq(raceResults.raceId, id))
    ).map((r) => r.u);
    await notify(ctx, ids, 'result_annulled', { raceId: id, raceName: race.name, reason });
    await audit(ctx, u, 'race.annul', 'race', id, { reason });
    return { ok: true };
  });

  app.post('/admin/races/:id/reprocess', async (req) => {
    const u = admin(req);
    const { id } = parse(idParam, req.params);
    const r = await reprocess(ctx, id);
    if (!r) throw new AppError('NOT_FOUND', 'Sem dados de simulação.');
    await audit(ctx, u, 'race.reprocess', 'race', id, r);
    return r;
  });

  // ------------------------------------------------------------ Pistas
  app.get('/admin/tracks', async (req) => {
    editor(req);
    const q = parse(z.object({ kind: z.enum(['special', 'procedural']).optional() }), req.query);
    return tracksSvc.listTracks(ctx, q.kind);
  });
  const previewBody = z.union([
    z.object({ editor: editorTrackSchema }),
    z.object({ seed: z.string().min(1).max(64), params: trackParamsSchema }),
  ]);
  app.post('/admin/tracks/preview', async (req) => {
    editor(req);
    const b = parse(previewBody, req.body);
    try {
      const { geometry, issues } =
        'editor' in b ? tracksSvc.previewEditor(b.editor) : tracksSvc.previewProcedural(b.seed, b.params);
      let estimate = null;
      if (!issues.length) {
        const lap = estimateLap(
          geometry,
          DEFAULT_SETUP,
          offsetsToTrace(suggestedLine(geometry), 256),
          'dry',
          25,
          5,
        );
        estimate = { lapTimeMs: lap.lapTimeMs, sectorMs: lap.sectorMs, topSpeedKmh: lap.topSpeedKmh };
      }
      return { geometry, issues, estimate };
    } catch (e) {
      if (e instanceof TrackGenerationError) throw new AppError('TRACK_INVALID', e.message, e.issues);
      throw e;
    }
  });
  app.post('/admin/tracks', async (req, reply) => {
    const u = editor(req);
    const b = parse(z.object({ name: z.string().min(2).max(60), editor: editorTrackSchema }), req.body);
    const r = await tracksSvc.createSpecialTrack(ctx, b.name, b.editor, u.id);
    await audit(ctx, u, 'track.create', 'track', r.track.id, { name: b.name });
    return reply.code(201).send(tracksSvc.versionDto(r.version, r.track));
  });
  app.post('/admin/tracks/:id/versions', async (req, reply) => {
    const u = editor(req);
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ editor: editorTrackSchema }), req.body);
    const v = await tracksSvc.newDraftVersion(ctx, id, b.editor, u.id);
    await audit(ctx, u, 'track.version.create', 'track_version', v.id, { trackId: id, version: v.version });
    return reply.code(201).send(v);
  });
  app.patch('/admin/tracks/versions/:id', async (req) => {
    const u = editor(req);
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ editor: editorTrackSchema }), req.body);
    const v = await tracksSvc.updateDraft(ctx, id, b.editor);
    await audit(ctx, u, 'track.version.update', 'track_version', id);
    return v;
  });
  app.post('/admin/tracks/versions/:id/:action', async (req) => {
    const { id, action } = parse(
      z.object({ id: z.string().uuid(), action: z.enum(['submit', 'publish', 'deprecate', 'reject']) }),
      req.params,
    );
    // track_editor cria e submete rascunhos; apenas admin publica, rejeita ou descontinua.
    const u = action === 'submit' ? editor(req) : admin(req);
    const v = await tracksSvc.changeStatus(ctx, id, action, u.id);
    await audit(ctx, u, `track.version.${action}`, 'track_version', id);
    return v;
  });

  // ------------------------------------------------------------ Temporadas e rankings
  app.post('/admin/seasons', async (req, reply) => {
    const u = admin(req);
    const b = parse(
      z.object({
        name: z.string().min(2).max(60),
        startsAt: z.string().datetime({ offset: true }),
        endsAt: z.string().datetime({ offset: true }),
      }),
      req.body,
    );
    const [s] = await ctx.db
      .insert(seasons)
      .values({ name: b.name, startsAt: new Date(b.startsAt), endsAt: new Date(b.endsAt) })
      .returning();
    await audit(ctx, u, 'season.create', 'season', s!.id, b);
    return reply.code(201).send(s);
  });
  app.post('/admin/seasons/:id/close', async (req) => {
    const u = admin(req);
    const { id } = parse(idParam, req.params);
    const changes = await closeSeason(ctx, id);
    await audit(ctx, u, 'season.close', 'season', id, { changes: changes.length });
    return { changes };
  });
  app.post('/admin/rankings/rebuild', async (req) => {
    const u = admin(req);
    const { seasonId } = parse(z.object({ seasonId: z.string().uuid() }), req.body);
    await rebuildSeason(ctx, seasonId);
    await audit(ctx, u, 'ranking.rebuild', 'season', seasonId);
    return { ok: true };
  });

  // ------------------------------------------------------------ Usuários
  app.get('/admin/users', async (req) => {
    admin(req);
    const q = parse(
      z.object({ q: z.string().max(100).optional(), flagged: z.enum(['true', 'false']).optional() }),
      req.query,
    );
    const rows = await ctx.db
      .select({ u: users, p: profiles })
      .from(users)
      .innerJoin(profiles, eq(profiles.userId, users.id))
      .where(
        and(
          q.q ? or(ilike(users.email, `%${q.q}%`), ilike(profiles.nickname, `%${q.q}%`)) : undefined,
          q.flagged === 'true' ? eq(users.flaggedForReview, true) : undefined,
        ),
      )
      .orderBy(desc(users.createdAt))
      .limit(100);
    return rows.map(({ u, p }) => ({
      id: u.id,
      email: u.email,
      nickname: p.nickname,
      roles: u.roles,
      isBot: u.isBot,
      flagged: u.flaggedForReview,
      verified: u.emailVerified,
      level: p.level,
      createdAt: u.createdAt.toISOString(),
      signupIp: u.signupIp,
    }));
  });
  app.patch('/admin/users/:id', async (req) => {
    const u = admin(req);
    const { id } = parse(idParam, req.params);
    const b = parse(
      z.object({ roles: z.array(roleSchema).min(1).optional(), flagged: z.boolean().optional() }),
      req.body,
    );
    if (b.roles) {
      if (id === u.id && !b.roles.includes('admin'))
        throw new AppError('VALIDATION_ERROR', 'Você não pode remover o próprio acesso de administrador.');
      await setRoles(ctx, id, b.roles);
    }
    if (b.flagged !== undefined)
      await ctx.db.update(users).set({ flaggedForReview: b.flagged }).where(eq(users.id, id));
    await audit(ctx, u, 'user.update', 'user', id, b);
    return { ok: true };
  });

  void trackVersions;
}
