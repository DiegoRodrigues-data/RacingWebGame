import {
  AppError,
  buildTimeline,
  phaseDeadline,
  ROOM,
  type CapacityDto,
  type CategoryConfig,
  DEFAULT_TRACK_WIDTH,
  type EntryDto,
  type RaceCreate,
  type RaceDetailDto,
  type RacePhase,
  type RaceSummaryDto,
  type RaceTimeline,
  type RaceWeather,
  type Weather,
} from '@tracado/shared';
import { weatherByLap } from '@tracado/sim';
import { createRng } from '@tracado/trackgen';
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import type { Ctx } from '../../context';
import type { Db, Tx } from '../../db/client';
import {
  botPersonas,
  categories,
  crazyGroups,
  entries,
  events,
  profiles,
  races,
  setups,
  traces,
  tracks,
  trackVersions,
  users,
} from '../../db/schema';
import type { AuthUser } from '../../lib/auth';
import { createProceduralVersion, newSeed } from '../tracks/service';

export type RaceRow = typeof races.$inferSelect;
type CategoryRow = typeof categories.$inferSelect;

export function timelineOf(r: RaceRow): RaceTimeline {
  return {
    registrationOpensAt: r.registrationOpensAt.getTime(),
    practiceAt: r.practiceAt.getTime(),
    traceWindowAt: r.traceWindowAt.getTime(),
    setupLockAt: r.setupLockAt.getTime(),
    qualifyingAt: r.qualifyingAt.getTime(),
    raceAt: r.raceAt.getTime(),
    raceEndsAt: r.raceEndsAt?.getTime() ?? null,
  };
}

export async function getCategory(db: Db | Tx, id: string): Promise<CategoryRow> {
  const [c] = await db.select().from(categories).where(eq(categories.id, id));
  if (!c) throw new AppError('NOT_FOUND', 'Categoria não encontrada.');
  return c;
}

export function defaultWeather(seed: string, cfg: CategoryConfig): RaceWeather {
  const r = createRng(`${seed}|wx`);
  return { base: r.pick(cfg.weathers), rainChance: cfg.rainChance, temperature: r.int(14, 34) };
}

export async function createRace(
  ctx: Ctx,
  input: RaceCreate,
  actorId: string | null,
  db: Db | Tx = ctx.db,
): Promise<RaceRow> {
  const now = ctx.clock.now();
  const cat = await getCategory(db, input.categoryId);
  const cfg = cat.config;
  const startAt = Date.parse(input.startAt);
  if (startAt <= now) throw new AppError('VALIDATION_ERROR', 'O início do treino precisa estar no futuro.');
  const seed = `${newSeed()}`;
  let trackVersionId: string;
  if (input.track.type === 'version') {
    const [v] = await db.select().from(trackVersions).where(eq(trackVersions.id, input.track.trackVersionId));
    if (!v) throw new AppError('NOT_FOUND', 'Versão de pista não encontrada.');
    if (v.status !== 'published')
      throw new AppError('TRACK_NOT_PUBLISHED', 'Apenas pistas publicadas podem ser usadas em corridas.');
    trackVersionId = v.id;
  } else {
    const tseed = input.track.seed ?? seed;
    const r = createRng(`${tseed}|params`);
    const p = input.track.params ?? {};
    const params = {
      length: p.length ?? Math.round(r.range(cfg.trackLength.min, cfg.trackLength.max) / 50) * 50,
      complexity: p.complexity ?? cfg.trackComplexity,
      width: p.width ?? DEFAULT_TRACK_WIDTH,
      terrain: p.terrain ?? r.pick(cfg.terrains),
    };
    trackVersionId = (await createProceduralVersion(db, tseed, params, actorId)).id;
  }
  const tl = buildTimeline({
    startAt,
    registrationLeadMs: input.registrationLeadMinutes * 60_000,
    practiceMs: input.practiceMinutes * 60_000,
    setupLockMs: input.setupLockSeconds * 1000,
    qualifyingMs: input.qualifyingSeconds * 1000,
    ...(input.traceWindowSeconds ? { traceWindowMs: input.traceWindowSeconds * 1000 } : {}),
  });
  const [row] = await db
    .insert(races)
    .values({
      name: input.name,
      eventId: input.eventId ?? null,
      categoryId: cat.id,
      trackVersionId,
      status: 'scheduled',
      ranked: input.ranked,
      capacity: input.capacity,
      waitlistMax: input.waitlistMax,
      laps: input.laps ?? cfg.laps,
      biome: input.biome ?? 'grass',
      weather: input.weather ?? defaultWeather(seed, cfg),
      seed,
      registrationOpensAt: new Date(tl.registrationOpensAt),
      practiceAt: new Date(tl.practiceAt),
      traceWindowAt: new Date(tl.traceWindowAt),
      setupLockAt: new Date(tl.setupLockAt),
      qualifyingAt: new Date(tl.qualifyingAt),
      raceAt: new Date(tl.raceAt),
      statusChangedAt: new Date(now),
      createdBy: actorId,
    })
    .returning();
  return row!;
}

export async function getRaceRow(db: Db | Tx, id: string, lock = false): Promise<RaceRow> {
  const q = db.select().from(races).where(eq(races.id, id));
  const [r] = lock ? await q.for('update') : await q;
  if (!r) throw new AppError('NOT_FOUND', 'Corrida não encontrada.');
  return r;
}

export async function capacityOf(
  db: Db | Tx,
  race: Pick<RaceRow, 'id' | 'capacity' | 'waitlistMax'>,
): Promise<CapacityDto> {
  const rows = await db
    .select({ status: entries.status, n: sql<number>`count(*)::int` })
    .from(entries)
    .where(and(eq(entries.raceId, race.id), inArray(entries.status, ['confirmed', 'waitlisted'])))
    .groupBy(entries.status);
  const confirmed = rows.find((r) => r.status === 'confirmed')?.n ?? 0;
  const waitlisted = rows.find((r) => r.status === 'waitlisted')?.n ?? 0;
  return {
    raceId: race.id,
    capacity: race.capacity,
    confirmed,
    waitlisted,
    waitlistMax: race.waitlistMax,
    free: Math.max(0, race.capacity - confirmed),
  };
}

export async function raceSummaries(db: Db | Tx, rows: RaceRow[]): Promise<RaceSummaryDto[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [cats, evs, tvs, caps, crazy] = await Promise.all([
    db
      .select()
      .from(categories)
      .where(inArray(categories.id, [...new Set(rows.map((r) => r.categoryId))])),
    rows.some((r) => r.eventId)
      ? db
          .select()
          .from(events)
          .where(
            inArray(
              events.id,
              rows.map((r) => r.eventId).filter((x): x is string => !!x),
            ),
          )
      : Promise.resolve([]),
    db
      .select({ v: trackVersions, t: tracks })
      .from(trackVersions)
      .innerJoin(tracks, eq(tracks.id, trackVersions.trackId))
      .where(inArray(trackVersions.id, [...new Set(rows.map((r) => r.trackVersionId))])),
    db
      .select({ raceId: entries.raceId, status: entries.status, n: sql<number>`count(*)::int` })
      .from(entries)
      .where(and(inArray(entries.raceId, ids), inArray(entries.status, ['confirmed', 'waitlisted'])))
      .groupBy(entries.raceId, entries.status),
    rows.some((r) => r.crazyGroupId)
      ? db
          .select()
          .from(crazyGroups)
          .where(
            inArray(
              crazyGroups.id,
              rows.map((r) => r.crazyGroupId).filter((x): x is string => !!x),
            ),
          )
      : Promise.resolve([]),
  ]);
  return rows.map((r) => {
    const cg = crazy.find((g) => g.id === r.crazyGroupId);
    const c = cats.find((x) => x.id === r.categoryId)!;
    const e = evs.find((x) => x.id === r.eventId);
    const tv = tvs.find((x) => x.v.id === r.trackVersionId)!;
    const confirmed = caps.find((x) => x.raceId === r.id && x.status === 'confirmed')?.n ?? 0;
    const waitlisted = caps.find((x) => x.raceId === r.id && x.status === 'waitlisted')?.n ?? 0;
    const tl = timelineOf(r);
    const iso = (n: number | null) => (n == null ? null : new Date(n).toISOString());
    const deadline = phaseDeadline(r.status, tl);
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      ranked: r.ranked,
      annulled: r.annulled,
      test: !!r.flags?.autoTest,
      category: { id: c.id, slug: c.slug, name: c.name, level: c.level },
      event: e ? { id: e.id, name: e.name } : null,
      timeline: {
        registrationOpensAt: iso(tl.registrationOpensAt)!,
        practiceAt: iso(tl.practiceAt)!,
        traceWindowAt: iso(tl.traceWindowAt)!,
        setupLockAt: iso(tl.setupLockAt)!,
        qualifyingAt: iso(tl.qualifyingAt)!,
        raceAt: iso(tl.raceAt)!,
        raceEndsAt: iso(tl.raceEndsAt),
      },
      phaseDeadline: iso(deadline),
      laps: r.laps,
      weather: r.weather,
      capacity: {
        raceId: r.id,
        capacity: r.capacity,
        confirmed,
        waitlisted,
        waitlistMax: r.waitlistMax,
        free: Math.max(0, r.capacity - confirmed),
      },
      track: {
        versionId: tv.v.id,
        name: tv.t.name,
        length: tv.v.length,
        terrain: tv.v.terrain,
        biome: r.biome,
      },
      crazy: cg
        ? {
            groupId: cg.id,
            groupName: cg.name,
            round: r.crazyRound ?? 1,
            rounds: cg.raceCount,
            ownerId: cg.ownerId,
          }
        : null,
    };
  });
}

export async function getSummary(db: Db | Tx, id: string): Promise<RaceSummaryDto> {
  return (await raceSummaries(db, [await getRaceRow(db, id)]))[0]!;
}

export async function listEntries(db: Db | Tx, raceId: string): Promise<EntryDto[]> {
  const [race] = await db.select({ status: races.status }).from(races).where(eq(races.id, raceId));
  const hideGrid = race?.status === 'qualifying';
  const rows = await db
    .select({
      e: entries,
      p: profiles,
      // Pilotos simulados (com persona) aparecem como gente; só os bots de demonstração levam a marca.
      bot: sql<boolean>`${users.isBot} and not exists (select 1 from ${botPersonas} where ${botPersonas.userId} = ${users.id})`,
      hasTrace: sql<boolean>`exists (select 1 from ${traces} where ${traces.raceId} = ${entries.raceId} and ${traces.userId} = ${entries.userId})`,
      hasSetup: sql<boolean>`exists (select 1 from ${setups} where ${setups.raceId} = ${entries.raceId} and ${setups.userId} = ${entries.userId})`,
    })
    .from(entries)
    .innerJoin(profiles, eq(profiles.userId, entries.userId))
    .innerJoin(users, eq(users.id, entries.userId))
    .where(
      and(
        eq(entries.raceId, raceId),
        inArray(entries.status, ['confirmed', 'waitlisted', 'withdrawn', 'dnf']),
      ),
    )
    .orderBy(asc(entries.createdAt));
  let wl = 0;
  const out = rows.map(({ e, p, bot, hasTrace, hasSetup }) => ({
    userId: e.userId,
    nickname: p.nickname,
    country: p.country,
    status: e.status,
    carColor: e.carColor,
    carModel: e.carModel,
    carNumber: e.carNumber,
    gridSlot: hideGrid ? null : e.gridSlot,
    waitlistPosition: e.status === 'waitlisted' ? ++wl : null,
    createdAt: e.createdAt.toISOString(),
    hasTrace: !!hasTrace,
    hasSetup: !!hasSetup,
    ready: !!e.readyAt,
    bot,
  }));
  return out.sort((a, b) => {
    const rank = (x: EntryDto) => (x.status === 'confirmed' ? 0 : x.status === 'waitlisted' ? 1 : 2);
    return (
      rank(a) - rank(b) || (a.gridSlot ?? 99) - (b.gridSlot ?? 99) || a.createdAt.localeCompare(b.createdAt)
    );
  });
}

/**
 * Previsão por volta exibida antes da corrida: acerta o clima real com 75% de chance por volta;
 * caso contrário mostra um estado vizinho. Mantém a decisão de pneus/aposta de clima interessante.
 */
export function forecast(seed: string, w: RaceWeather, laps: number): { lap: number; weather: Weather }[] {
  const real = weatherByLap(seed, w, laps);
  const order: Weather[] = ['dry', 'cloudy', 'light_rain', 'rain'];
  const r = createRng(`${seed}|forecast`);
  return real.map((wx, i) => {
    if (r.chance(0.75)) return { lap: i + 1, weather: wx };
    const k = order.indexOf(wx) + (r.chance(0.5) ? 1 : -1);
    return { lap: i + 1, weather: order[Math.max(0, Math.min(3, k))]! };
  });
}

export async function getDetail(ctx: Ctx, id: string, user: AuthUser | null): Promise<RaceDetailDto> {
  const row = await getRaceRow(ctx.db, id);
  const [summary] = await raceSummaries(ctx.db, [row]);
  const list = await listEntries(ctx.db, id);
  let me: RaceDetailDto['me'] = null;
  if (user) {
    const entry = list.find((e) => e.userId === user.id && e.status !== 'cancelled') ?? null;
    const [t] = await ctx.db
      .select({ at: traces.submittedAt })
      .from(traces)
      .where(and(eq(traces.raceId, id), eq(traces.userId, user.id)));
    const [s] = await ctx.db
      .select({ at: setups.updatedAt })
      .from(setups)
      .where(and(eq(setups.raceId, id), eq(setups.userId, user.id)));
    me = { entry, hasTrace: !!t, traceSubmittedAt: t?.at.toISOString() ?? null, hasSetup: !!s };
  }
  return { ...summary!, entries: list, me, forecast: forecast(row.seed, row.weather, row.laps) };
}

export interface ListQuery {
  from?: number;
  to?: number;
  categoryId?: string;
  status?: RacePhase[];
  ranked?: boolean;
  /** true: só corridas teste; false: sem elas; ausente: todas. */
  test?: boolean;
  /** Corridas dos grupos da Corrida Maluca ficam fora das listas públicas, a menos que pedidas. */
  crazy?: boolean;
  limit?: number;
  order?: 'asc' | 'desc';
}

export async function listRaces(ctx: Ctx, q: ListQuery): Promise<RaceSummaryDto[]> {
  const conds: SQL[] = [];
  if (q.from !== undefined) conds.push(gte(races.practiceAt, new Date(q.from)));
  if (q.to !== undefined) conds.push(lte(races.practiceAt, new Date(q.to)));
  if (q.categoryId) conds.push(eq(races.categoryId, q.categoryId));
  if (q.status?.length) conds.push(inArray(races.status, q.status));
  if (q.ranked !== undefined) conds.push(eq(races.ranked, q.ranked));
  if (q.test === true) conds.push(sql`${races.flags} ? 'autoTest'`);
  if (q.test === false) conds.push(sql`not (${races.flags} ? 'autoTest')`);
  if (!q.crazy) conds.push(isNull(races.crazyGroupId));
  const rows = await ctx.db
    .select()
    .from(races)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(q.order === 'desc' ? desc(races.practiceAt) : asc(races.practiceAt))
    .limit(Math.min(q.limit ?? 100, 300));
  return raceSummaries(ctx.db, rows);
}

/** Envia capacidade, lista de inscritos e resumo atualizados para quem acompanha a corrida e o lobby. */
/** Lista de inscritos para quem está na sala da corrida (ex.: piloto salvou o primeiro traçado). */
export async function publishEntries(ctx: Ctx, raceId: string) {
  await ctx.hub.publish(ROOM.race(raceId), 'race.entries', {
    raceId,
    entries: await listEntries(ctx.db, raceId),
  });
}

export async function broadcastRace(ctx: Ctx, raceId: string) {
  const row = await getRaceRow(ctx.db, raceId);
  const [summary] = await raceSummaries(ctx.db, [row]);
  await ctx.hub.publish(ROOM.race(raceId), 'race.capacity', summary!.capacity);
  await ctx.hub.publish(ROOM.race(raceId), 'race.entries', {
    raceId,
    entries: await listEntries(ctx.db, raceId),
  });
  await ctx.hub.publish(ROOM.lobby, 'lobby.race', { race: summary! });
}
