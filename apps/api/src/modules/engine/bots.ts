import {
  CAR_COLORS,
  ENGINE_MAPS,
  MIN_PIT_STOPS,
  TERRAINS,
  type CarSetup,
  type CategoryConfig,
  type Tyre,
} from '@tracado/shared';
import { createRng, offsetsToTrace, suggestedLine, enforceLateralRate } from '@tracado/trackgen';
import { and, eq, notInArray, sql } from 'drizzle-orm';
import type { Ctx } from '../../context';
import { crazyGroups, entries, profiles, setups, traces, users } from '../../db/schema';
import { broadcastRace, getCategory, getRaceRow } from '../races/service';
import { getGeometry } from '../tracks/service';

/** Pilotos de demonstração: preenchem o grid (quantos, por tipo de corrida, vem das configurações do jogo). */
export async function fillBots(ctx: Ctx, raceId: string, count: number) {
  if (count <= 0) return 0;
  const race = await getRaceRow(ctx.db, raceId);
  const taken = (
    await ctx.db.select({ u: entries.userId }).from(entries).where(eq(entries.raceId, raceId))
  ).map((r) => r.u);
  const bots = await ctx.db
    .select({ id: users.id, color: profiles.carColor })
    .from(users)
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(and(eq(users.isBot, true), taken.length ? notInArray(users.id, taken) : undefined))
    .limit(Math.min(count, race.capacity - 1));
  const r = createRng(`${race.seed}|bots`);
  const used = new Set<string>();
  let n = 0;
  for (const b of bots) {
    let color: string = b.color,
      model = 1;
    while (used.has(`${color}-${model}`)) {
      model++;
      if (model > 5) {
        model = 1;
        color = r.pick(CAR_COLORS);
      }
    }
    used.add(`${color}-${model}`);
    n++;
    await ctx.db
      .insert(entries)
      .values({
        raceId,
        userId: b.id,
        status: 'confirmed',
        carColor: color,
        carModel: model,
        carNumber: 50 + n,
        confirmedAt: new Date(ctx.clock.now() + n),
      })
      .onConflictDoNothing();
  }
  await broadcastRace(ctx, raceId);
  return n;
}

function botSetup(seed: string, cfg: CategoryConfig, laps: number, wet: boolean): CarSetup {
  const r = createRng(seed);
  const allowed = cfg.setupLimits.allowedTyres;
  const dry = allowed.filter((t) => t !== 'wet');
  const tyre: Tyre = wet && allowed.includes('wet') ? 'wet' : r.pick(dry.length ? dry : allowed);
  // Cumpre a parada obrigatória; às vezes arrisca uma parada a mais, espaçando as trocas.
  const max = Math.max(MIN_PIT_STOPS, cfg.setupLimits.maxPitStops);
  const stops = Math.min(max, MIN_PIT_STOPS + (r.chance(0.35) ? 1 : 0));
  const pitStops: CarSetup['pitStops'] = [];
  for (let k = 1; k <= stops; k++) {
    const prev = pitStops.at(-1)?.lap ?? 0;
    const lap = Math.min(laps - 1, Math.max(prev + 1, Math.round((laps * k) / (stops + 1)) + r.int(-2, 2)));
    if (lap > prev) pitStops.push({ lap, tyre: r.pick(dry.length ? dry : allowed) });
  }
  return {
    tyre,
    pitStops,
    tyrePressure: { front: r.int(21, 25), rear: r.int(21, 25) },
    aero: Math.max(cfg.setupLimits.aero.min, Math.min(cfg.setupLimits.aero.max, r.int(3, 8))),
    engine: r.pick(cfg.setupLimits.allowedEngines.length ? cfg.setupLimits.allowedEngines : ENGINE_MAPS),
    gearing: r.int(3, 8),
    terrainPrep: r.chance(0.7) ? 'asphalt' : r.pick(TERRAINS),
    weatherBet: wet ? 'wet' : r.pick(['dry', 'mixed'] as const),
  };
}

/**
 * Grupo da Corrida Maluca com bots liberados: completa o grid até `botFill` carros quando faltar gente.
 * Roda na abertura da janela de traçado, depois de os amigos terem tido o treino inteiro para entrar.
 */
export async function fillCrazyBots(ctx: Ctx, race: { id: string; crazyGroupId: string | null }) {
  if (!race.crazyGroupId) return 0;
  const [g] = await ctx.db
    .select({ n: crazyGroups.botFill })
    .from(crazyGroups)
    .where(eq(crazyGroups.id, race.crazyGroupId));
  if (!g?.n) return 0;
  const [c] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(entries)
    .where(and(eq(entries.raceId, race.id), eq(entries.status, 'confirmed')));
  return fillBots(ctx, race.id, g.n - (c?.n ?? 0));
}

/** Na abertura da janela de traçado, cada bot grava um traçado (linha sugerida com variação) e um setup. */
export async function prepareBots(ctx: Ctx, raceId: string) {
  const race = await getRaceRow(ctx.db, raceId);
  const bots = await ctx.db
    .select({ id: users.id })
    .from(entries)
    .innerJoin(users, eq(users.id, entries.userId))
    .where(and(eq(entries.raceId, raceId), eq(entries.status, 'confirmed'), eq(users.isBot, true)));
  if (!bots.length) return;
  const g = await getGeometry(ctx, race.trackVersionId);
  const cat = await getCategory(ctx.db, race.categoryId);
  const base = suggestedLine(g);
  const wet = race.weather.base === 'rain';
  for (const b of bots) {
    const r = createRng(`${race.seed}|bot|${b.id}`);
    const aggr = r.range(0.4, 1.1);
    const off = enforceLateralRate(
      g,
      base.map((d, i) => Math.max(-1, Math.min(1, d * aggr + Math.sin(i / 23 + r.range(0, 6)) * 0.08))),
    );
    const now = new Date(ctx.clock.now());
    await ctx.db
      .insert(traces)
      .values({ raceId, userId: b.id, points: offsetsToTrace(off, 256), version: 1, submittedAt: now })
      .onConflictDoNothing();
    await ctx.db
      .insert(setups)
      .values({
        raceId,
        userId: b.id,
        setup: botSetup(`${race.seed}|setup|${b.id}`, cat.config, race.laps, wet),
        updatedAt: now,
      })
      .onConflictDoNothing();
  }
}
