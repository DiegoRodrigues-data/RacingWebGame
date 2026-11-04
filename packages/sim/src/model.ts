import type { CarSetup, RaceWeather, Terrain, Tyre, Weather } from '@tracado/shared';
import { CAR_HALF_WIDTH, type TrackGeometry } from '@tracado/trackgen';

/**
 * Modelo de desempenho simplificado e determinístico. Não busca realismo físico, e sim trade-offs claros:
 * nenhuma opção é estritamente melhor; cada ganho tem um custo em outra situação.
 * Coeficientes ajustados com `pnpm balance` (ver scripts/balance.ts).
 */
export const COEF = {
  g: 9.81,
  baseMu: 1.6,
  baseTop: 80,
  baseAccel: 9,
  baseBrake: 13,
  terrainGrip: { asphalt: 1, dirt: 0.8, sand: 0.7 } as Record<Terrain, number>,
  terrainTop: { asphalt: 1, dirt: 0.93, sand: 0.88 } as Record<Terrain, number>,
  /** Aderência do composto no seco e no molhado. */
  compound: {
    soft: { dry: 1.1, wet: 0.66 },
    medium: { dry: 1.045, wet: 0.65 },
    hard: { dry: 1.0, wet: 0.63 },
    wet: { dry: 0.9, wet: 0.97 },
  } as Record<Tyre, { dry: number; wet: number }>,
  /** Desgaste total do composto ao longo de uma corrida completa (1 = vida útil). */
  raceWear: { soft: 1.2, medium: 0.98, hard: 0.6, wet: 0.7 } as Record<Tyre, number>,
  wetTyreOnDryWear: 2.2,
  wearLinearLoss: 0.1,
  cliffAt: 0.75,
  cliffSlope: 1.4,
  pressure: {
    optimalDry: 23,
    optimalWet: 21,
    gripLoss: 0.007,
    topGain: 0.0025,
    wearLoss: 0.03,
    balanceTolerance: 2,
  },
  aero: { grip: 0.055, gripWetBonus: 0.5, top: 0.07, wear: 0.04 },
  engine: {
    economy: { top: 0.98, accel: 0.97, wear: 0.86, failure: 0 },
    balanced: { top: 1, accel: 1, wear: 1, failure: 0.0012 },
    power: { top: 1.03, accel: 1.05, wear: 1.12, failure: 0.012 },
  },
  gearing: { accel: 0.08, top: 0.045 },
  /**
   * Desgaste do motor ao longo de uma corrida completa (1 = fim da vida útil). Marcha curta gira mais alto e gasta
   * até `gearingWear` a mais. A chance de quebra por volta do mapa (`engine.*.failure`) é multiplicada por
   * `failBase + failSlope × desgaste`: motor novo quase não quebra, motor gasto quebra mais.
   */
  engineWear: { economy: 0.45, balanced: 0.7, power: 1 } as Record<CarSetup['engine'], number>,
  engineGearingWear: 0.1,
  engineFail: { base: 0.4, slope: 1.2 },
  /**
   * Variação sorteada do desgaste dos pneus: cada stint de cada carro recebe um fator uniforme em ±spread, de
   * `stable` (seco, temperatura amena) a `unstable` (chuva provável ou temperatura extrema), e cada volta
   * oscila mais ±lapJitter. Segue determinístico pela seed da corrida.
   */
  wearSpread: { stable: 0.08, unstable: 0.2, lapJitter: 0.03 },
  weatherBet: { dryGain: 0.015, wrongPenalty: 0.05 },
  pitLossBase: 6,
  pitLossScaled: 10,
  spinBase: 0.003,
  spinLowGrip: 0.06,
} as const;

export const WETNESS: Record<Weather, number> = { dry: 0, cloudy: 0, light_rain: 0.5, rain: 1 };

export interface Conditions {
  /** 0 = pista seca, 1 = encharcada. */
  wetness: number;
  temperature: number;
}

export interface CarModifiers {
  mu: Float64Array; // aderência lateral por amostra (coeficiente)
  top: Float64Array; // velocidade máxima por amostra (m/s)
  accel: number;
  brakeScale: number;
  wearPerRace: number;
  engineWearPerRace: number;
  failurePerLap: number;
  /** Aderência relativa ao ideal para a condição (para risco de rodada). */
  gripRatio: number;
}

export function tyreGrip(tyre: Tyre, wetness: number): number {
  const c = COEF.compound[tyre];
  return c.dry * (1 - wetness) + c.wet * wetness;
}

export function wearGripFactor(wear: number): number {
  const cliff = wear > COEF.cliffAt ? (wear - COEF.cliffAt) * COEF.cliffSlope : 0;
  return Math.max(0.35, 1 - COEF.wearLinearLoss * wear - cliff);
}

/** Quanto o desgaste dos pneus pode variar (± fração) com a previsão do tempo: clima instável, mais incerteza. */
export function wearSpread(w: RaceWeather): number {
  const raining = w.base === 'light_rain' || w.base === 'rain' ? 0.6 : 0;
  const heat = Math.max(0, Math.abs(w.temperature - 22) - 8) / 10;
  const instability = Math.min(1, Math.max(raining, w.rainChance * 1.4) + heat);
  const { stable, unstable } = COEF.wearSpread;
  return Math.round((stable + (unstable - stable) * instability) * 100) / 100;
}

/** Multiplicador da chance de quebra do motor para um desgaste acumulado (0 = novo, 1 = fim da vida útil). */
export function engineFailFactor(engineWear: number): number {
  return COEF.engineFail.base + COEF.engineFail.slope * engineWear;
}

export function optimalPressure(c: Conditions): number {
  const base = COEF.pressure.optimalDry * (1 - c.wetness) + COEF.pressure.optimalWet * c.wetness;
  return base + (25 - c.temperature) * 0.04;
}

/** Modificadores de desempenho por amostra da pista para um carro em uma volta. */
export function carModifiers(
  g: TrackGeometry,
  setup: CarSetup,
  tyre: Tyre,
  wear: number,
  cond: Conditions,
  gripZones: { from: number; to: number; factor: number }[] = [],
): CarModifiers {
  const n = g.count;
  const w = cond.wetness;
  const opt = optimalPressure(cond);
  const pAvg = (setup.tyrePressure.front + setup.tyrePressure.rear) / 2;
  const pDev = (Math.abs(setup.tyrePressure.front - opt) + Math.abs(setup.tyrePressure.rear - opt)) / 2;
  const pBalance = Math.max(
    0,
    Math.abs(setup.tyrePressure.front - setup.tyrePressure.rear) - COEF.pressure.balanceTolerance,
  );
  const pressureGrip = 1 - COEF.pressure.gripLoss * Math.pow(pDev, 1.4) - 0.01 * pBalance;
  const pressureTop = 1 + COEF.pressure.topGain * (pAvg - opt);
  const ax = (setup.aero - 5.5) / 4.5;
  const aeroGrip = 1 + COEF.aero.grip * ax * (1 + COEF.aero.gripWetBonus * w);
  const aeroTop = 1 - COEF.aero.top * ax;
  const eng = COEF.engine[setup.engine];
  const gx = (setup.gearing - 5.5) / 4.5;
  const gearAccel = 1 - COEF.gearing.accel * gx;
  const gearTop = 1 + COEF.gearing.top * gx;
  const bet = setup.weatherBet;
  const betGrip =
    bet === 'dry'
      ? 1 + COEF.weatherBet.dryGain * (1 - w) - COEF.weatherBet.wrongPenalty * w
      : bet === 'wet'
        ? 1 - COEF.weatherBet.dryGain * 1.3 * (1 - w) + COEF.weatherBet.wrongPenalty * w
        : 1;
  const tyreMu = tyreGrip(tyre, w) * wearGripFactor(wear);
  const idealTyreMu = Math.max(tyreGrip('soft', w), tyreGrip('wet', w));

  const mu = new Float64Array(n);
  const top = new Float64Array(n);
  let terrainMismatch = 0;
  for (let i = 0; i < n; i++) {
    const t = g.terrain[i]!;
    let prepGrip = 1,
      prepTop = 1;
    if (setup.terrainPrep !== t) {
      terrainMismatch++;
      if (setup.terrainPrep === 'asphalt') prepGrip = 0.92;
      else if (t === 'asphalt') {
        prepGrip = setup.terrainPrep === 'dirt' ? 0.96 : 0.95;
        prepTop = setup.terrainPrep === 'dirt' ? 0.985 : 0.975;
      } else prepGrip = 0.97;
    }
    let zone = 1;
    for (const z of gripZones) if (i >= z.from && i <= z.to) zone *= z.factor;
    const wetTerrain = t === 'asphalt' ? 1 : 1 - 0.1 * w; // terra/areia sofrem menos com chuva relativa
    mu[i] =
      COEF.baseMu *
      COEF.terrainGrip[t] *
      tyreMu *
      pressureGrip *
      aeroGrip *
      betGrip *
      prepGrip *
      zone *
      wetTerrain;
    top[i] =
      COEF.baseTop *
      COEF.terrainTop[t] *
      eng.top *
      gearTop *
      aeroTop *
      pressureTop *
      prepTop *
      (1 - 0.06 * w);
  }
  let wearMul =
    eng.wear *
    (1 - COEF.aero.wear * ax) *
    (1 + COEF.pressure.wearLoss * pDev) *
    (1 + 0.1 * (terrainMismatch / n));
  if (tyre === 'wet') wearMul *= 1 + (COEF.wetTyreOnDryWear - 1) * (1 - w);
  else wearMul *= 1 - 0.25 * w; // pista molhada esfria pneus de seco
  return {
    mu,
    top,
    accel: COEF.baseAccel * eng.accel * gearAccel,
    brakeScale: Math.min(1.15, tyreMu * pressureGrip),
    wearPerRace: COEF.raceWear[tyre] * wearMul,
    engineWearPerRace: COEF.engineWear[setup.engine] * (1 - COEF.engineGearingWear * gx),
    failurePerLap: eng.failure,
    gripRatio: (tyreMu * pressureGrip * betGrip) / idealTyreMu,
  };
}

export interface LapProfile {
  /** Velocidade (m/s) em cada amostra da linha do carro. */
  v: Float64Array;
  /** Tempo acumulado (s) até a amostra i; t[n] = tempo de volta. */
  t: Float64Array;
  /** Comprimento de cada segmento i → i+1 (m). */
  seg: Float64Array;
  lapTime: number;
  topSpeed: number;
}

/** Curvatura (1/m) de uma polilinha fechada pelo círculo circunscrito. */
export function pathCurvature(path: Float64Array): Float64Array {
  const n = path.length / 2;
  const out = new Float64Array(n);
  const P = (i: number, k: number) => path[(((i % n) + n) % n) * 2 + k]!;
  for (let i = 0; i < n; i++) {
    const ax = P(i, 0) - P(i - 2, 0),
      ay = P(i, 1) - P(i - 2, 1);
    const bx = P(i + 2, 0) - P(i, 0),
      by = P(i + 2, 1) - P(i, 1);
    const cx = P(i + 2, 0) - P(i - 2, 0),
      cy = P(i + 2, 1) - P(i - 2, 1);
    const den = Math.hypot(ax, ay) * Math.hypot(bx, by) * Math.hypot(cx, cy);
    out[i] = den > 1e-9 ? Math.abs((2 * (ax * by - ay * bx)) / den) : 0;
  }
  return out;
}

/** Perfil de velocidade de uma volta lançada (passes para frente e para trás com limites de aceleração/frenagem). */
export function lapProfile(
  path: Float64Array,
  curvature: Float64Array,
  m: CarModifiers,
  pacePenalty = 0,
): LapProfile {
  const n = curvature.length;
  const seg = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    seg[i] = Math.hypot(path[j * 2]! - path[i * 2]!, path[j * 2 + 1]! - path[i * 2 + 1]!) || 0.01;
  }
  const vc = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const k = Math.max(curvature[i]!, 1e-6);
    vc[i] = Math.min(m.top[i]!, Math.sqrt((m.mu[i]! * COEF.g) / k));
  }
  const v = new Float64Array(vc);
  for (let pass = 0; pass < 2; pass++)
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = Math.max(0.3, m.accel * (1 - Math.pow(v[i]! / m.top[i]!, 2)));
      v[j] = Math.min(v[j]!, Math.sqrt(v[i]! * v[i]! + 2 * a * seg[i]!));
    }
  for (let pass = 0; pass < 2; pass++)
    for (let i = n - 1; i >= 0; i--) {
      const j = (i + 1) % n;
      const b = COEF.baseBrake * m.brakeScale;
      v[i] = Math.min(v[i]!, Math.sqrt(v[j]! * v[j]! + 2 * b * seg[i]!));
    }
  const scale = 1 / (1 + pacePenalty);
  const t = new Float64Array(n + 1);
  let top = 0;
  for (let i = 0; i < n; i++) {
    v[i] = v[i]! * scale;
    top = Math.max(top, v[i]!);
  }
  for (let i = 0; i < n; i++) t[i + 1] = t[i]! + seg[i]! / ((v[i]! + v[(i + 1) % n]!) / 2);
  return { v, t, seg, lapTime: t[n]!, topSpeed: top };
}

/** Deslocamento lateral em metros a partir do offset normalizado. */
export function lateralMeters(g: TrackGeometry, i: number, d: number): number {
  return d * Math.max(0.5, g.widths[i]! / 2 - CAR_HALF_WIDTH);
}
