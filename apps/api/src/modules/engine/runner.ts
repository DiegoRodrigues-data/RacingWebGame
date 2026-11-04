import { gunzipSync, gzipSync } from 'node:zlib';
import {
  DEFAULT_SETUP,
  checkSetupLimits,
  defaultPitStops,
  xpForRace,
  type CarSetup,
  type CategoryConfig,
  type LiveCarDto,
  type QualifyingRowDto,
  type RaceIncidentDto,
  type ReplayFrame,
  type ResultRowDto,
  type Weather,
} from '@tracado/shared';
import {
  SIM_VERSION,
  simulateQualifying,
  simulateRace,
  type CarResult,
  type RaceSimInput,
  type SimCar,
} from '@tracado/sim';
import { validateTrace } from '@tracado/trackgen';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Ctx } from '../../context';
import type { Tx } from '../../db/client';
import {
  entries,
  profiles,
  qualifyingResults,
  raceReplays,
  raceResults,
  races,
  setups,
  traces,
} from '../../db/schema';
import { applyResults, computePoints, ensureActiveSeason } from '../rankings/service';
import { getCategory, type RaceRow } from '../races/service';
import { getGeometry } from '../tracks/service';

/** Contagem do semáforo antes de as luzes apagarem (ms reais). */
export const START_LIGHTS_MS = 5000;
const END_BUFFER_MS = 2000;

/**
 * Setup padrão ajustado aos limites da categoria (usado por quem não configurou o carro
 * ou mandou um setup inválido). Já cumpre a parada obrigatória.
 */
export function defaultSetupFor(cfg: CategoryConfig, laps: number): CarSetup {
  const lim = cfg.setupLimits;
  return {
    ...DEFAULT_SETUP,
    tyre: lim.allowedTyres.includes('medium') ? 'medium' : lim.allowedTyres[0]!,
    engine: lim.allowedEngines.includes('balanced') ? 'balanced' : lim.allowedEngines[0]!,
    aero: Math.max(lim.aero.min, Math.min(lim.aero.max, DEFAULT_SETUP.aero)),
    pitStops: defaultPitStops(laps, lim.allowedTyres),
  };
}

export interface LoadedReplay {
  raceId: string;
  frames: ReplayFrame[];
  incidents: RaceIncidentDto[];
  cars: LiveCarDto[];
  durationMs: number;
  frameHz: number;
  playbackSpeed: number;
  weatherByLap: Weather[];
}

/**
 * Replays decodificados em memória. Uma corrida de 60 voltas com 22 carros passa de 20 mil
 * frames (dezenas de MB depois do JSON.parse), então o cache fica pequeno.
 */
const REPLAY_CACHE_MAX = 6;
const replayCache = new Map<string, LoadedReplay>();

export async function loadReplay(ctx: Pick<Ctx, 'db'>, raceId: string): Promise<LoadedReplay | null> {
  const hit = replayCache.get(raceId);
  if (hit) return hit;
  const [r] = await ctx.db.select().from(raceReplays).where(eq(raceReplays.raceId, raceId));
  if (!r) return null;
  const loaded: LoadedReplay = {
    raceId,
    frames: JSON.parse(gunzipSync(r.frames).toString('utf8')) as ReplayFrame[],
    incidents: r.incidents as RaceIncidentDto[],
    cars: r.cars as LiveCarDto[],
    durationMs: r.durationMs,
    frameHz: r.frameHz,
    playbackSpeed: r.playbackSpeed,
    weatherByLap: r.weatherByLap as Weather[],
  };
  if (replayCache.size >= REPLAY_CACHE_MAX) replayCache.delete(replayCache.keys().next().value!);
  replayCache.set(raceId, loaded);
  return loaded;
}
export function forgetReplay(raceId: string) {
  replayCache.delete(raceId);
}

/** Tempo simulado decorrido (ms) em `now` para uma corrida em andamento. */
export function elapsedSim(
  race: Pick<RaceRow, 'raceAt'>,
  replay: Pick<LoadedReplay, 'playbackSpeed'>,
  now: number,
): number {
  return Math.max(0, now - race.raceAt.getTime() - START_LIGHTS_MS) * replay.playbackSpeed;
}

/**
 * Executado na transição para a classificação: trava entradas (setups/traçados), simula a volta de
 * classificação e a corrida inteira de forma determinística e persiste tudo para replay e auditoria.
 */
export async function runSimulation(
  ctx: Ctx,
  tx: Tx,
  race: RaceRow,
): Promise<{ rows: QualifyingRowDto[]; raceEndsAt: Date } | null> {
  const t0 = performance.now();
  // Dentro da transação: a consulta precisa usar o tx (no PGlite, ctx.db aqui travaria esperando o próprio tx).
  const g = await getGeometry({ db: tx, log: ctx.log }, race.trackVersionId);
  const cat = await getCategory(tx, race.categoryId);
  const confirmed = await tx
    .select({ e: entries, p: profiles })
    .from(entries)
    .innerJoin(profiles, eq(profiles.userId, entries.userId))
    .where(and(eq(entries.raceId, race.id), eq(entries.status, 'confirmed')))
    .orderBy(asc(entries.confirmedAt), asc(entries.createdAt));
  if (!confirmed.length) return null;
  const setupRows = await tx.select().from(setups).where(eq(setups.raceId, race.id));
  const traceRows = await tx.select().from(traces).where(eq(traces.raceId, race.id));
  const fallback = defaultSetupFor(cat.config, race.laps);
  const flags = new Map<string, { defSetup: boolean; defTrace: boolean }>();
  const cars: SimCar[] = confirmed.map(({ e }) => {
    let setup = setupRows.find((s) => s.userId === e.userId)?.setup;
    if (setup && checkSetupLimits(setup, cat.config, race.laps).length) setup = undefined;
    let trace = traceRows.find((t) => t.userId === e.userId)?.points ?? null;
    if (trace && !validateTrace(g, trace).ok) trace = null; // revalidação defensiva
    flags.set(e.userId, { defSetup: !setup, defTrace: !trace });
    return { id: e.userId, setup: setup ?? fallback, trace };
  });
  const quali = simulateQualifying(g, cars, race.seed, race.weather, race.laps);
  const byId = new Map(cars.map((c) => [c.id, c]));
  const gridCars = quali.map((q) => byId.get(q.id)!);
  const input: RaceSimInput = {
    geometry: g,
    cars: gridCars,
    laps: race.laps,
    seed: race.seed,
    weather: race.weather,
    randomEvents: cat.config.randomEvents,
  };
  const out = simulateRace(input);
  ctx.metrics.simDuration.observe((performance.now() - t0) / 1000);

  const nick = new Map(confirmed.map(({ e, p }) => [e.userId, { p, e }]));
  const pole = quali[0]!.lapTimeMs;
  const rows: QualifyingRowDto[] = quali.map((q) => ({
    position: q.position,
    userId: q.id,
    nickname: nick.get(q.id)!.p.nickname,
    lapTimeMs: q.lapTimeMs,
    gapMs: q.lapTimeMs - pole,
    usedDefaultSetup: flags.get(q.id)!.defSetup,
    usedDefaultTrace: flags.get(q.id)!.defTrace,
  }));
  await tx
    .insert(qualifyingResults)
    .values(
      rows.map((r) => ({
        raceId: race.id,
        userId: r.userId,
        position: r.position,
        lapTimeMs: r.lapTimeMs,
        usedDefaultSetup: r.usedDefaultSetup,
        usedDefaultTrace: r.usedDefaultTrace,
      })),
    );
  for (const r of rows)
    await tx
      .update(entries)
      .set({ gridSlot: r.position })
      .where(and(eq(entries.raceId, race.id), eq(entries.userId, r.userId)));
  const liveCars: LiveCarDto[] = gridCars.map((c, i) => {
    const { p, e } = nick.get(c.id)!;
    return {
      userId: c.id,
      nickname: p.nickname,
      carColor: e.carColor,
      carModel: e.carModel,
      carNumber: e.carNumber,
      gridSlot: i + 1,
    };
  });
  const playbackSpeed = cat.config.playbackSpeed;
  await tx
    .insert(raceReplays)
    .values({
      raceId: race.id,
      simVersion: out.simVersion,
      inputHash: out.inputHash,
      resultHash: out.resultHash,
      trackHash: g.hash,
      durationMs: out.durationMs,
      frameHz: out.frameHz,
      playbackSpeed,
      frames: gzipSync(JSON.stringify(out.frames)),
      incidents: out.incidents,
      weatherByLap: out.weatherByLap,
      cars: liveCars,
      simResults: { results: out.results, fastestLap: out.fastestLap },
      simInput: {
        cars: gridCars,
        laps: race.laps,
        seed: race.seed,
        weather: race.weather,
        randomEvents: cat.config.randomEvents,
        trackVersionId: race.trackVersionId,
      },
    });
  const raceEndsAt = new Date(
    race.raceAt.getTime() + START_LIGHTS_MS + Math.ceil(out.durationMs / playbackSpeed) + END_BUFFER_MS,
  );
  await tx.update(races).set({ raceEndsAt }).where(eq(races.id, race.id));
  return { rows, raceEndsAt };
}

/** Reexecuta a simulação a partir das entradas gravadas e compara o hash (auditoria). */
export async function reprocess(ctx: Ctx, raceId: string) {
  const [r] = await ctx.db.select().from(raceReplays).where(eq(raceReplays.raceId, raceId));
  if (!r) return null;
  // Outra versão da simulação dá outro resultado por definição: não é divergência, só não dá para conferir.
  if (r.simVersion !== SIM_VERSION)
    return {
      match: false,
      outdated: true,
      simVersion: r.simVersion,
      currentSimVersion: SIM_VERSION,
      storedHash: r.resultHash,
      recomputedHash: null,
      trackHash: r.trackHash,
    };
  const si = r.simInput as Omit<RaceSimInput, 'geometry'> & { trackVersionId: string };
  const g = await getGeometry(ctx, si.trackVersionId);
  const out = simulateRace({ ...si, geometry: g });
  return {
    match: out.resultHash === r.resultHash && g.hash === r.trackHash,
    storedHash: r.resultHash,
    recomputedHash: out.resultHash,
    trackHash: g.hash,
  };
}

export async function resultRows(ctx: Pick<Ctx, 'db'>, raceId: string): Promise<ResultRowDto[]> {
  const rows = await ctx.db
    .select({ r: raceResults, p: profiles, e: entries })
    .from(raceResults)
    .innerJoin(profiles, eq(profiles.userId, raceResults.userId))
    .innerJoin(entries, and(eq(entries.raceId, raceResults.raceId), eq(entries.userId, raceResults.userId)))
    .where(eq(raceResults.raceId, raceId))
    .orderBy(asc(raceResults.position));
  const winner = rows[0]?.r.totalTimeMs ?? null;
  return rows.map(({ r, p, e }) => ({
    position: r.position,
    userId: r.userId,
    nickname: p.nickname,
    country: p.country,
    status: r.status,
    totalTimeMs: r.totalTimeMs,
    gapMs: r.totalTimeMs != null && winner != null ? r.totalTimeMs - winner : null,
    bestLapMs: r.bestLapMs,
    lapsCompleted: r.lapsCompleted,
    pitStops: r.pitStops,
    points: r.points,
    fastestLap: r.fastestLap,
    carColor: e.carColor,
    carModel: e.carModel,
    carNumber: e.carNumber,
  }));
}

/** Publica o resultado: grava classificação final, pontos, XP e rankings na mesma transação da mudança de fase. */
export async function publishResults(ctx: Ctx, tx: Tx, race: RaceRow) {
  const [rep] = await tx
    .select({ sr: raceReplays.simResults })
    .from(raceReplays)
    .where(eq(raceReplays.raceId, race.id));
  if (!rep) return;
  const { results, fastestLap } = rep.sr as { results: CarResult[]; fastestLap: { id: string } | null };
  const cat = await getCategory(tx, race.categoryId);
  const now = ctx.clock.now();
  const season = await ensureActiveSeason(tx, now);
  const ranked = race.ranked && !race.annulled;
  const scored = results.map((r) => {
    const fl = fastestLap?.id === r.id && r.status === 'finished';
    return {
      r,
      fl,
      points: ranked ? computePoints(cat.config.scoring, r.position, r.status === 'finished', fl) : 0,
    };
  });
  await tx
    .insert(raceResults)
    .values(
      scored.map(({ r, fl, points }) => ({
        raceId: race.id,
        userId: r.id,
        seasonId: season.id,
        position: r.position,
        status: r.status,
        totalTimeMs: r.totalTimeMs,
        bestLapMs: r.bestLapMs,
        lapsCompleted: r.lapsCompleted,
        pitStops: r.pitStops,
        points,
        fastestLap: fl,
        ranked,
        createdAt: new Date(now),
      })),
    );
  for (const { r } of scored) {
    if (r.status === 'dnf')
      await tx
        .update(entries)
        .set({ status: 'dnf' })
        .where(and(eq(entries.raceId, race.id), eq(entries.userId, r.id)));
    await tx
      .update(profiles)
      .set({
        xp: sql`${profiles.xp} + ${xpForRace(r.position, r.status === 'finished', ranked)}`,
        careerRaces: sql`${profiles.careerRaces} + 1`,
      })
      .where(eq(profiles.userId, r.id));
  }
  if (ranked)
    await applyResults(
      tx,
      season.id,
      scored.map(({ r, fl, points }) => ({
        userId: r.id,
        position: r.position,
        finished: r.status === 'finished',
        points,
        fastestLap: fl,
      })),
      new Date(now),
    );
  await tx.update(races).set({ seasonId: season.id }).where(eq(races.id, race.id));
  return scored.map(({ r, points }) => ({ userId: r.id, position: r.position, points }));
}
