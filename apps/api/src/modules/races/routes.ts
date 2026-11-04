import { AppError, DEFAULT_SETUP, LIVE_PHASES, RACE_PHASES, ROOM, type RacePhase } from '@tracado/shared';
import { estimateLap } from '@tracado/sim';
import { offsetsToTrace, suggestedLine } from '@tracado/trackgen';
import { and, asc, desc, eq, gte, inArray, notInArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../../context';
import {
  entries,
  profiles,
  qualifyingResults,
  raceResults,
  races,
  rankingEntries,
  seasonMemberships,
  trackVersions,
  tracks,
} from '../../db/schema';
import { requireAuth } from '../../lib/auth';
import { parse } from '../../lib/validate';
import { elapsedSim, loadReplay, resultRows } from '../engine/runner';
import { currentSeason, getRanking, scopeKeys } from '../rankings/service';
import { getGeometry } from '../tracks/service';
import { cancel, chooseCar, register } from './entries';
import { getMySetup, getMyTrace, saveSetup, submitTrace } from './prep';
import {
  getCategory,
  getDetail,
  getRaceRow,
  getSummary,
  listEntries,
  listRaces,
  raceSummaries,
  timelineOf,
} from './service';

const idParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  from: z.coerce.number().optional(),
  to: z.coerce.number().optional(),
  category: z.string().uuid().optional(),
  status: z
    .string()
    .optional()
    .transform((s) =>
      s
        ? (s.split(',').filter((x) => (RACE_PHASES as readonly string[]).includes(x)) as RacePhase[])
        : undefined,
    ),
  ranked: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  limit: z.coerce.number().int().min(1).max(300).optional(),
  /** Corridas teste: "false" (padrão) esconde, "true" mostra só elas, "all" mostra tudo. */
  test: z.enum(['true', 'false', 'all']).optional(),
});

export function raceRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/races', async (req) => {
    const q = parse(listQuery, req.query);
    const now = ctx.clock.now();
    return listRaces(ctx, {
      from: q.from ?? now - 6 * 3600_000,
      to: q.to ?? now + 7 * 86_400_000,
      ...(q.category ? { categoryId: q.category } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.ranked !== undefined ? { ranked: q.ranked } : {}),
      ...(q.limit ? { limit: q.limit } : {}),
      ...(q.test === 'all' ? {} : { test: q.test === 'true' }),
    });
  });

  app.get('/races/:id', async (req) => getDetail(ctx, parse(idParam, req.params).id, req.user));

  app.post(
    '/races/:id/entries',
    { config: { rateLimit: { max: ctx.config.ENTRY_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { id } = parse(idParam, req.params);
      const r = await register(ctx, id, requireAuth(req));
      return reply.code(201).send({ ...r, capacity: (await getSummary(ctx.db, id)).capacity });
    },
  );
  app.delete('/races/:id/entries/me', async (req) => {
    const { id } = parse(idParam, req.params);
    const r = await cancel(ctx, id, requireAuth(req));
    return { ...r, capacity: (await getSummary(ctx.db, id)).capacity };
  });
  app.get('/races/:id/entries', async (req) => listEntries(ctx.db, parse(idParam, req.params).id));
  app.put('/races/:id/car', async (req) =>
    chooseCar(ctx, parse(idParam, req.params).id, requireAuth(req), req.body),
  );

  app.put('/races/:id/trace', { bodyLimit: 128 * 1024 }, async (req) =>
    submitTrace(ctx, parse(idParam, req.params).id, requireAuth(req), req.body),
  );
  app.get('/races/:id/trace', async (req) =>
    getMyTrace(ctx, parse(idParam, req.params).id, requireAuth(req).id),
  );
  app.put('/races/:id/setup', async (req) => ({
    setup: await saveSetup(ctx, parse(idParam, req.params).id, requireAuth(req), req.body),
  }));
  app.get('/races/:id/setup', async (req) =>
    getMySetup(ctx, parse(idParam, req.params).id, requireAuth(req).id),
  );

  /** Referências do treino: tempo com a linha sugerida e com a linha central, ambos com o setup padrão. */
  app.get('/races/:id/practice', async (req) => {
    const race = await getRaceRow(ctx.db, parse(idParam, req.params).id);
    const g = await getGeometry(ctx, race.trackVersionId);
    const cat = await getCategory(ctx.db, race.categoryId);
    const suggested = offsetsToTrace(suggestedLine(g), 256);
    const wx = race.weather.base;
    return {
      laps: race.laps,
      weather: race.weather,
      limits: cat.config.setupLimits,
      suggestedTrace: suggested,
      reference: {
        suggestedLapMs: estimateLap(g, DEFAULT_SETUP, suggested, wx, race.weather.temperature, race.laps)
          .lapTimeMs,
        centerlineLapMs: estimateLap(
          g,
          DEFAULT_SETUP,
          offsetsToTrace(new Float64Array(g.count), 256),
          wx,
          race.weather.temperature,
          race.laps,
        ).lapTimeMs,
      },
    };
  });

  app.get('/races/:id/qualifying', async (req) => {
    const id = parse(idParam, req.params).id;
    const race = await getRaceRow(ctx.db, id);
    if (['scheduled', 'registration_open', 'practice', 'trace_window', 'setup_lock'].includes(race.status))
      throw new AppError('CONFLICT', 'Classificação ainda não disputada.');
    const rows = await ctx.db
      .select({ q: qualifyingResults, p: profiles })
      .from(qualifyingResults)
      .innerJoin(profiles, eq(profiles.userId, qualifyingResults.userId))
      .where(eq(qualifyingResults.raceId, id))
      .orderBy(asc(qualifyingResults.position));
    const pole = rows[0]?.q.lapTimeMs ?? 0;
    return rows.map(({ q, p }) => ({
      position: q.position,
      userId: q.userId,
      nickname: p.nickname,
      lapTimeMs: q.lapTimeMs,
      gapMs: q.lapTimeMs - pole,
      usedDefaultSetup: q.usedDefaultSetup,
      usedDefaultTrace: q.usedDefaultTrace,
    }));
  });

  app.get('/races/:id/results', async (req) => {
    const id = parse(idParam, req.params).id;
    const race = await getRaceRow(ctx.db, id);
    if (race.status !== 'finished' && race.status !== 'archived')
      throw new AppError('CONFLICT', 'Resultado ainda não publicado.');
    return { annulled: race.annulled, ranked: race.ranked, rows: await resultRows(ctx, id) };
  });

  /** Replay: durante a corrida só até o instante atual; completo após o fim. */
  app.get('/races/:id/replay', async (req, reply) => {
    const id = parse(idParam, req.params).id;
    // `tail`: só os últimos N frames (mini mapa dos cards ao vivo). O resto chega pelo WebSocket.
    const { tail } = parse(z.object({ tail: z.coerce.number().int().min(1).max(40).optional() }), req.query);
    const race = await getRaceRow(ctx.db, id);
    if (!['race', 'finished', 'archived'].includes(race.status))
      throw new AppError('CONFLICT', 'A corrida ainda não começou.');
    const rep = await loadReplay(ctx, id);
    if (!rep) throw new AppError('NOT_FOUND', 'Replay indisponível.');
    const done = race.status !== 'race';
    const elapsed = done ? Infinity : elapsedSim(race, rep, ctx.clock.now());
    if (done && !tail) reply.header('cache-control', 'public, max-age=3600');
    let frames = rep.frames.filter((f) => f.t <= elapsed);
    let fromFrame = 0;
    if (tail) {
      fromFrame = Math.max(0, frames.length - tail);
      frames = frames.slice(fromFrame);
    }
    return {
      raceId: id,
      complete: done,
      durationMs: rep.durationMs,
      frameHz: rep.frameHz,
      playbackSpeed: rep.playbackSpeed,
      startedAt: race.raceAt.getTime() + 5000,
      cars: rep.cars,
      fromFrame,
      frames,
      incidents: tail ? [] : rep.incidents.filter((i) => i.t <= elapsed),
      weatherByLap: done ? rep.weatherByLap : [],
    };
  });

  app.get('/tracks/versions/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const [row] = await ctx.db
      .select()
      .from(trackVersions)
      .innerJoin(tracks, eq(tracks.id, trackVersions.trackId))
      .where(eq(trackVersions.id, id));
    if (!row) throw new AppError('NOT_FOUND');
    return {
      id,
      name: row.tracks.name,
      kind: row.tracks.kind,
      version: row.track_versions.version,
      status: row.track_versions.status,
      hash: row.track_versions.geometryHash,
    };
  });
  app.get('/tracks/versions/:id/geometry', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const [row] = await ctx.db
      .select({ status: trackVersions.status })
      .from(trackVersions)
      .where(eq(trackVersions.id, id));
    if (!row) throw new AppError('NOT_FOUND');
    if (
      row.status !== 'published' &&
      row.status !== 'deprecated' &&
      !req.user?.roles.some((r) => r === 'admin' || r === 'track_editor')
    )
      throw new AppError('FORBIDDEN', 'Pista não publicada.');
    const g = await getGeometry(ctx, id);
    // Versões são imutáveis: cache longo é seguro.
    if (row.status === 'published' || row.status === 'deprecated')
      reply.header('cache-control', 'public, max-age=31536000, immutable');
    return g;
  });

  app.get('/time', async () => ({ serverTime: ctx.clock.now() }));

  /** Portal público + lobby: corridas ao vivo, próximas, resultados recentes e destaques do ranking. */
  app.get('/lobby', async (req) => {
    const now = ctx.clock.now();
    // "Acontecendo agora": corridas em andamento, incluindo as corridas teste (com bots) em andamento e a
    // próxima corrida teste com inscrições abertas, para sempre haver uma para entrar.
    const nextTest = await listRaces(ctx, {
      status: ['registration_open'],
      from: now - 3600_000,
      limit: 1,
      test: true,
    });
    const live = [...(await listRaces(ctx, { status: [...LIVE_PHASES], limit: 20 })), ...nextTest];
    const upcoming = await listRaces(ctx, {
      status: ['scheduled', 'registration_open'],
      from: now - 3600_000,
      limit: 12,
      test: false,
    });
    const recentRows = await ctx.db
      .select()
      .from(races)
      .where(and(inArray(races.status, ['finished']), sql`not (${races.flags} ? 'autoTest')`))
      .orderBy(desc(races.raceEndsAt))
      .limit(6);
    const recent = await Promise.all(
      (await raceSummaries(ctx.db, recentRows)).map(async (r) => ({
        race: r,
        podium: (await resultRows(ctx, r.id)).slice(0, 3),
      })),
    );
    let top: Awaited<ReturnType<typeof getRanking>>['rows'] = [];
    try {
      top = (await getRanking(ctx, { scope: 'world', page: 1, pageSize: 5 }, null)).rows;
    } catch {
      top = [];
    }
    const [players] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(profiles);
    let mine: Awaited<ReturnType<typeof raceSummaries>> = [];
    if (req.user) {
      const rows = await ctx.db
        .select({ r: races })
        .from(entries)
        .innerJoin(races, eq(races.id, entries.raceId))
        .where(
          and(
            eq(entries.userId, req.user.id),
            inArray(entries.status, ['confirmed', 'waitlisted']),
            notInArray(races.status, ['archived', 'cancelled']),
            gte(races.practiceAt, new Date(now - 86_400_000)),
          ),
        )
        .orderBy(asc(races.practiceAt))
        .limit(10);
      mine = await raceSummaries(
        ctx.db,
        rows.map((r) => r.r),
      );
    }
    return {
      live,
      upcoming,
      recent,
      top,
      mine,
      stats: {
        players: players?.n ?? 0,
        liveRaces: live.filter((r) => r.status === 'race').length,
        online: ctx.hub.connectionCount,
      },
    };
  });

  app.get('/users/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const [p] = await ctx.db.select().from(profiles).where(eq(profiles.userId, id));
    if (!p) throw new AppError('NOT_FOUND');
    const [agg] = await ctx.db
      .select({
        races: sql<number>`count(*)::int`,
        wins: sql<number>`count(*) filter (where ${raceResults.position} = 1 and ${raceResults.status} = 'finished')::int`,
        podiums: sql<number>`count(*) filter (where ${raceResults.position} <= 3 and ${raceResults.status} = 'finished')::int`,
        fastestLaps: sql<number>`count(*) filter (where ${raceResults.fastestLap})::int`,
        points: sql<number>`coalesce(sum(${raceResults.points}), 0)::int`,
      })
      .from(raceResults)
      .where(eq(raceResults.userId, id));
    const recent = await ctx.db
      .select({ r: raceResults, race: races })
      .from(raceResults)
      .innerJoin(races, eq(races.id, raceResults.raceId))
      .where(eq(raceResults.userId, id))
      .orderBy(desc(raceResults.createdAt))
      .limit(10);
    const season = await currentSeason(ctx.db, ctx.clock.now());
    const positions: Record<string, number | null> = {};
    if (season) {
      const [m] = await ctx.db
        .select()
        .from(seasonMemberships)
        .where(and(eq(seasonMemberships.seasonId, season.id), eq(seasonMemberships.userId, id)));
      for (const k of scopeKeys(m ?? p)) {
        const [mine] = await ctx.db
          .select()
          .from(rankingEntries)
          .where(
            and(
              eq(rankingEntries.seasonId, season.id),
              eq(rankingEntries.scope, k.scope),
              eq(rankingEntries.scopeKey, k.key),
              eq(rankingEntries.userId, id),
            ),
          );
        if (!mine) {
          positions[k.scope] = null;
          continue;
        }
        const [ahead] = await ctx.db
          .select({ n: sql<number>`count(*)::int` })
          .from(rankingEntries)
          .where(
            and(
              eq(rankingEntries.seasonId, season.id),
              eq(rankingEntries.scope, k.scope),
              eq(rankingEntries.scopeKey, k.key),
              sql`(${rankingEntries.points}, ${rankingEntries.wins}, ${rankingEntries.podiums}) > (${mine.points}, ${mine.wins}, ${mine.podiums})`,
            ),
          );
        positions[k.scope] = (ahead?.n ?? 0) + 1;
      }
    }
    return {
      profile: {
        userId: p.userId,
        nickname: p.nickname,
        country: p.country,
        region: p.region,
        city: p.city,
        carColor: p.carColor,
        level: p.level,
        xp: p.xp,
      },
      stats: agg,
      season: season ? { id: season.id, name: season.name } : null,
      positions,
      recent: recent.map(({ r, race }) => ({
        raceId: race.id,
        raceName: race.name,
        at: (race.raceEndsAt ?? race.raceAt).toISOString(),
        position: r.position,
        status: r.status,
        points: r.points,
        bestLapMs: r.bestLapMs,
        annulled: race.annulled,
      })),
    };
  });

  void ROOM;
  void timelineOf;
}
