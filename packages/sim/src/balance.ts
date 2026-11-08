import type { CarSetup, DriverRules, RaceWeather, TrackTerrain, Tyre } from '@tracado/shared';
import {
  DEFAULT_DRIVER_RULES,
  DEFAULT_TRACK_WIDTH,
  ENGINE_MAPS,
  MIN_PIT_STOPS,
  TERRAINS,
  TYRES,
  WEATHER_BETS,
} from '@tracado/shared';
import { createRng, generateProceduralTrack, q2, type Rng } from '@tracado/trackgen';
import { simulateRace } from './race';

export function randomSetup(rng: Rng, laps: number): CarSetup {
  const tyre = rng.pick(TYRES);
  // Como no jogo: pelo menos a parada obrigatória.
  const stops = rng.int(MIN_PIT_STOPS, 3);
  const pitStops: { lap: number; tyre: Tyre }[] = [];
  // Paradas em voltas plausíveis (espaçadas igualmente, com variação), para comparar estratégias de forma justa.
  for (let k = 1; k <= stops; k++) {
    const lap = Math.round((laps * k) / (stops + 1)) + rng.int(-1, 1);
    const prev = pitStops[pitStops.length - 1]?.lap ?? 0;
    if (lap > prev && lap < laps) pitStops.push({ lap, tyre: rng.pick(TYRES) });
  }
  return {
    tyre,
    pitStops,
    tyrePressure: { front: rng.int(19, 27), rear: rng.int(19, 27) },
    aero: rng.int(1, 10),
    engine: rng.pick(ENGINE_MAPS),
    gearing: rng.int(1, 10),
    terrainPrep: rng.pick(TERRAINS),
    weatherBet: rng.pick(WEATHER_BETS),
    // Perfil do piloto uniforme em 0..100, para medir os extremos também.
    driver: { attack: rng.int(0, 100), defense: rng.int(0, 100), pace: rng.int(0, 100) },
  };
}

const band = (v: number | undefined) => ((v ?? 50) < 34 ? 'low' : (v ?? 50) > 66 ? 'high' : 'mid');

export type Feature = (s: CarSetup) => string;
export const FEATURES: Record<string, Feature> = {
  tyre: (s) => s.tyre,
  stops: (s) => String(s.pitStops.length),
  aero: (s) => (s.aero <= 3 ? 'low' : s.aero <= 7 ? 'mid' : 'high'),
  engine: (s) => s.engine,
  gearing: (s) => (s.gearing <= 3 ? 'short' : s.gearing <= 7 ? 'mid' : 'long'),
  terrainPrep: (s) => s.terrainPrep,
  weatherBet: (s) => s.weatherBet,
  strategy: (s) => [s.tyre, ...s.pitStops.map((p) => p.tyre)].join('>'),
  attack: (s) => band(s.driver?.attack),
  defense: (s) => band(s.driver?.defense),
  pace: (s) => band(s.driver?.pace),
};

export interface Scenario {
  name: string;
  terrain: TrackTerrain;
  length: number;
  complexity: number;
  weather: RaceWeather;
  laps: number;
}

export const SCENARIOS: Scenario[] = [
  {
    name: 'asfalto seco rápido',
    terrain: 'asphalt',
    length: 4000,
    complexity: 0.2,
    weather: { base: 'dry', rainChance: 0, temperature: 28 },
    laps: 8,
  },
  {
    name: 'asfalto seco travado',
    terrain: 'asphalt',
    length: 2200,
    complexity: 1,
    weather: { base: 'dry', rainChance: 0, temperature: 22 },
    laps: 14,
  },
  {
    name: 'asfalto chuva',
    terrain: 'asphalt',
    length: 3000,
    complexity: 0.5,
    weather: { base: 'rain', rainChance: 0.6, temperature: 16 },
    laps: 10,
  },
  {
    name: 'clima instável',
    terrain: 'asphalt',
    length: 3000,
    complexity: 0.5,
    weather: { base: 'cloudy', rainChance: 0.7, temperature: 20 },
    laps: 10,
  },
  {
    name: 'terra',
    terrain: 'dirt',
    length: 2500,
    complexity: 0.6,
    weather: { base: 'dry', rainChance: 0.2, temperature: 25 },
    laps: 12,
  },
  {
    name: 'areia',
    terrain: 'sand',
    length: 2500,
    complexity: 0.4,
    weather: { base: 'dry', rainChance: 0.1, temperature: 32 },
    laps: 12,
  },
  {
    name: 'misto',
    terrain: 'mixed',
    length: 3200,
    complexity: 0.6,
    weather: { base: 'cloudy', rainChance: 0.3, temperature: 24 },
    laps: 9,
  },
];

export interface BalanceReport {
  races: number;
  /** Por cenário: valor de cada característica com maior taxa de vitória. */
  winnersByScenario: Record<string, Record<string, string>>;
  /** lift = (vitórias com o valor / vitórias) ÷ (carros com o valor / carros). 1 = neutro. */
  lift: Record<string, Record<string, number>>;
  maxLift: { feature: string; value: string; lift: number };
  topStrategyWinShare: number;
  /** Médias por corrida (22 carros). */
  perRace: { overtakes: number; collisions: number; collisionDnfs: number; damagePits: number; dnfs: number };
  /** Posição média de chegada por faixa de cada característica do perfil (11,5 = neutro com 22 carros). */
  avgPosition: Record<string, Record<string, number>>;
  /** Maior diferença de posição média entre as faixas de uma mesma característica do perfil. */
  profileSpread: number;
}

export function runBalance(
  racesPerScenario = 25,
  seed = 'balance',
  rules: DriverRules = DEFAULT_DRIVER_RULES,
  scenarios: Scenario[] = SCENARIOS,
): BalanceReport {
  const tally = { overtakes: 0, collisions: 0, collisionDnfs: 0, damagePits: 0, dnfs: 0 };
  const posSum: Record<string, Record<string, [number, number]>> = {};
  const wins: Record<string, Record<string, number>> = {};
  const picks: Record<string, Record<string, number>> = {};
  const podium: Record<string, Record<string, Record<string, number>>> = {};
  let totalWins = 0,
    totalCars = 0,
    races = 0;
  const stratWins: Record<string, number> = {};
  for (const sc of scenarios) {
    podium[sc.name] = {};
    for (let r = 0; r < racesPerScenario; r++) {
      const rng = createRng(`${seed}|${sc.name}|${r}`);
      const g = generateProceduralTrack(`${seed}-${sc.name}-${r}`, {
        length: sc.length,
        complexity: sc.complexity,
        width: DEFAULT_TRACK_WIDTH,
        terrain: sc.terrain,
      });
      const cars = Array.from({ length: 22 }, (_, i) => {
        const setup = randomSetup(rng, sc.laps);
        return { id: `c${i}`, setup, trace: null, driver: setup.driver };
      });
      const out = simulateRace({
        geometry: g,
        cars,
        laps: sc.laps,
        seed: `${seed}|${r}`,
        weather: sc.weather,
        randomEvents: { safetyCar: true, oil: true, mechanical: true },
        rules,
      });
      races++;
      for (const i of out.incidents) {
        if (i.kind === 'overtake') tally.overtakes++;
        else if (i.kind === 'collision') tally.collisions++;
        else if (i.kind === 'damage') tally[i.detail === 'dnf' ? 'collisionDnfs' : 'damagePits']++;
      }
      tally.dnfs += out.results.filter((x) => x.status === 'dnf').length;
      const byId = new Map(cars.map((c) => [c.id, c.setup]));
      for (const res of out.results) {
        const st = byId.get(res.id)!;
        for (const f of ['attack', 'defense', 'pace'] as const) {
          const b = FEATURES[f]!(st);
          posSum[f] ??= {};
          const cell = (posSum[f][b] ??= [0, 0]);
          cell[0] += res.position;
          cell[1]++;
        }
      }
      for (const c of cars) {
        totalCars++;
        for (const [f, fn] of Object.entries(FEATURES)) {
          picks[f] ??= {};
          picks[f][fn(c.setup)] = (picks[f][fn(c.setup)] ?? 0) + 1;
        }
      }
      for (const res of out.results.slice(0, 3)) {
        const s = byId.get(res.id)!;
        for (const [f, fn] of Object.entries(FEATURES)) {
          podium[sc.name]![f] ??= {};
          podium[sc.name]![f]![fn(s)] = (podium[sc.name]![f]![fn(s)] ?? 0) + 1;
        }
      }
      const winner = byId.get(out.results[0]!.id)!;
      totalWins++;
      stratWins[FEATURES.strategy!(winner)] = (stratWins[FEATURES.strategy!(winner)] ?? 0) + 1;
      for (const [f, fn] of Object.entries(FEATURES)) {
        wins[f] ??= {};
        wins[f][fn(winner)] = (wins[f][fn(winner)] ?? 0) + 1;
      }
    }
  }
  const lift: BalanceReport['lift'] = {};
  let maxLift = { feature: '', value: '', lift: 0 };
  for (const f of Object.keys(FEATURES)) {
    if (f === 'strategy') continue;
    lift[f] = {};
    for (const [v, p] of Object.entries(picks[f]!)) {
      const l = (wins[f]?.[v] ?? 0) / totalWins / (p / totalCars);
      lift[f][v] = Math.round(l * 100) / 100;
      if (l > maxLift.lift) maxLift = { feature: f, value: v, lift: Math.round(l * 100) / 100 };
    }
  }
  const winnersByScenario: BalanceReport['winnersByScenario'] = {};
  for (const [sc, feats] of Object.entries(podium)) {
    winnersByScenario[sc] = {};
    for (const [f, counts] of Object.entries(feats)) {
      if (f === 'strategy') continue;
      winnersByScenario[sc][f] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]![0];
    }
  }
  const topStrategyWinShare = Math.max(...Object.values(stratWins)) / totalWins;
  const perRace = Object.fromEntries(
    Object.entries(tally).map(([k, v]) => [k, q2(v / Math.max(1, races))]),
  ) as BalanceReport['perRace'];
  const avgPosition: BalanceReport['avgPosition'] = {};
  for (const [f, bands] of Object.entries(posSum))
    avgPosition[f] = Object.fromEntries(Object.entries(bands).map(([b, [sum, n]]) => [b, q2(sum / n)]));
  const profileSpread = q2(
    Math.max(
      0,
      ...Object.values(avgPosition).map((b) => Math.max(...Object.values(b)) - Math.min(...Object.values(b))),
    ),
  );
  return {
    races,
    winnersByScenario,
    lift,
    maxLift,
    topStrategyWinShare,
    perRace,
    avgPosition,
    profileSpread,
  };
}
