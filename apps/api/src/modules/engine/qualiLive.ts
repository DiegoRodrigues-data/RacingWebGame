import type { LiveCarDto, QualifyingRowDto } from '@tracado/shared';
import { qualifyingSession, type QualifyingSession, type SimCar } from '@tracado/sim';
import { asc, eq } from 'drizzle-orm';
import type { Ctx } from '../../context';
import { profiles, qualifyingResults, raceReplays } from '../../db/schema';
import type { RaceRow } from '../races/service';
import { getGeometry } from '../tracks/service';

/** Os carros saem para a pista um pouco depois do início da fase (dá tempo de a tela abrir). */
export const QUALI_LEAD_MS = 2000;
/**
 * Folga no fim da fase: cobre o atraso de exibição do cliente (2,5 s) e deixa o "grid definido" na tela uns
 * segundos antes das luzes da largada.
 */
const QUALI_TAIL_MS = 7000;

export interface QualiLive {
  session: QualifyingSession;
  /** Carros na ordem de saída (a mesma dos frames). */
  cars: LiveCarDto[];
  rows: QualifyingRowDto[];
  startedAt: number;
  playbackSpeed: number;
}

const cache = new Map<string, QualiLive>();
const CACHE_MAX = 6;

/**
 * Sessão de classificação para transmissão, recalculada (determinística) a partir das entradas gravadas na
 * transição para a classificação. A velocidade da transmissão é escolhida para a sessão caber na fase.
 */
export async function loadQualiLive(ctx: Pick<Ctx, 'db' | 'log'>, race: RaceRow): Promise<QualiLive | null> {
  const hit = cache.get(race.id);
  if (hit) return hit;
  const [rep] = await ctx.db.select().from(raceReplays).where(eq(raceReplays.raceId, race.id));
  if (!rep) return null;
  const rows = await qualifyingRows(ctx, race.id);
  if (!rows.length) return null;
  const si = rep.simInput as { cars: SimCar[]; trackVersionId: string };
  const g = await getGeometry(ctx, si.trackVersionId);
  const session = qualifyingSession(
    g,
    si.cars,
    rows.map((r) => ({ id: r.userId, lapTimeMs: r.lapTimeMs })),
    race.seed,
    race.weather,
  );
  const byId = new Map((rep.cars as LiveCarDto[]).map((c) => [c.userId, c]));
  const window = race.raceAt.getTime() - race.qualifyingAt.getTime() - QUALI_LEAD_MS - QUALI_TAIL_MS;
  const live: QualiLive = {
    session,
    cars: session.runs.map((r) => byId.get(r.id)!).filter(Boolean),
    rows,
    startedAt: race.qualifyingAt.getTime() + QUALI_LEAD_MS,
    playbackSpeed: Math.max(1, Math.round((session.durationMs / Math.max(5000, window)) * 100) / 100),
  };
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(race.id, live);
  return live;
}

/** Resultado oficial da classificação (grid), do pole ao último. */
export async function qualifyingRows(ctx: Pick<Ctx, 'db'>, raceId: string): Promise<QualifyingRowDto[]> {
  const q = await ctx.db
    .select({ q: qualifyingResults, p: profiles })
    .from(qualifyingResults)
    .innerJoin(profiles, eq(profiles.userId, qualifyingResults.userId))
    .where(eq(qualifyingResults.raceId, raceId))
    .orderBy(asc(qualifyingResults.position));
  const pole = q[0]?.q.lapTimeMs ?? 0;
  return q.map(({ q: r, p }) => ({
    position: r.position,
    userId: r.userId,
    nickname: p.nickname,
    lapTimeMs: r.lapTimeMs,
    gapMs: r.lapTimeMs - pole,
    usedDefaultSetup: r.usedDefaultSetup,
    usedDefaultTrace: r.usedDefaultTrace,
  }));
}

export function forgetQualiLive(raceId: string) {
  cache.delete(raceId);
}

/** Tempo simulado (ms) da sessão em `now`; infinito depois da fase de classificação. */
export function qualiElapsed(race: RaceRow, live: QualiLive, now: number): number {
  if (race.status !== 'qualifying') return Infinity;
  return Math.max(0, now - live.startedAt) * live.playbackSpeed;
}

export interface QualiRunDto {
  userId: string;
  /** Saída para a volta lançada (ms simulados). */
  startMs: number;
  /** Setores já completados (ms). */
  sectorMs: number[];
  /** Tempo da volta, só depois de completada. */
  lapTimeMs: number | null;
}

/** O que já aconteceu na sessão até `elapsed`: saídas, parciais e voltas fechadas (nada do futuro). */
export function revealedRuns(live: QualiLive, elapsed: number): QualiRunDto[] {
  return live.session.runs
    .filter((r) => r.startMs <= elapsed)
    .map((r) => {
      const sectorMs: number[] = [];
      let acc = r.startMs;
      for (const s of r.sectorMs) {
        acc += s;
        if (acc <= elapsed) sectorMs.push(s);
        else break;
      }
      return {
        userId: r.id,
        startMs: r.startMs,
        sectorMs,
        lapTimeMs: r.startMs + r.lapTimeMs <= elapsed ? r.lapTimeMs : null,
      };
    });
}

/** Classificação provisória: só as voltas já fechadas, ordenadas pelo tempo. */
export function provisionalRows(live: QualiLive, elapsed: number): QualifyingRowDto[] {
  const done = new Set(
    revealedRuns(live, elapsed)
      .filter((r) => r.lapTimeMs != null)
      .map((r) => r.userId),
  );
  const rows = live.rows.filter((r) => done.has(r.userId));
  const pole = rows[0]?.lapTimeMs ?? 0;
  return rows.map((r, i) => ({ ...r, position: i + 1, gapMs: r.lapTimeMs - pole }));
}
