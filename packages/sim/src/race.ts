import type {
  CarSetup,
  RaceIncidentDto,
  RaceWeather,
  ReplayFrame,
  TracePoint,
  Tyre,
  Weather,
} from '@tracado/shared';
import { CAR_FRAME_STRIDE, CAR_STATUS, NO_TRACE_PACE_PENALTY, tyreCode } from '@tracado/shared';
import {
  createRng,
  racingLine,
  stableHash,
  traceToOffsets,
  type Rng,
  type TrackGeometry,
} from '@tracado/trackgen';
import {
  carModifiers,
  COEF,
  engineFailFactor,
  lapProfile,
  lateralMeters,
  pathCurvature,
  WETNESS,
  wearSpread,
  type Conditions,
  type LapProfile,
} from './model';

/** 2: desgaste de pneu com variação sorteada por stint, desgaste do motor e os dois nos frames. */
export const SIM_VERSION = 2;
export const FRAME_HZ = 4;
const DT = 0.25;

export interface SimCar {
  id: string;
  setup: CarSetup;
  trace: TracePoint[] | null;
}

export interface RandomEventsConfig {
  safetyCar: boolean;
  oil: boolean;
  mechanical: boolean;
}

export interface RaceSimInput {
  geometry: TrackGeometry;
  /** Em ordem de grid (posição 1 primeiro). */
  cars: SimCar[];
  laps: number;
  seed: string;
  weather: RaceWeather;
  randomEvents: RandomEventsConfig;
}

export interface CarResult {
  id: string;
  position: number;
  status: 'finished' | 'dnf';
  totalTimeMs: number | null;
  bestLapMs: number | null;
  lapsCompleted: number;
  pitStops: number;
  lapTimesMs: number[];
  dnfReason?: string;
  usedDefaultTrace: boolean;
}

export interface RaceSimOutput {
  simVersion: number;
  inputHash: string;
  resultHash: string;
  durationMs: number;
  frameHz: number;
  frames: ReplayFrame[];
  incidents: RaceIncidentDto[];
  weatherByLap: Weather[];
  results: CarResult[];
  fastestLap: { id: string; ms: number } | null;
}

/** Previsão de clima por volta: cadeia de Markov semeada. Pública para o jogador antes da corrida (com incerteza). */
export function weatherByLap(seed: string, w: RaceWeather, laps: number): Weather[] {
  const rng = createRng(`${seed}|weather`);
  const order: Weather[] = ['dry', 'cloudy', 'light_rain', 'rain'];
  let idx = order.indexOf(w.base);
  const out: Weather[] = [];
  for (let lap = 0; lap < laps; lap++) {
    out.push(order[idx]!);
    const r = rng.next();
    if (r < w.rainChance * 0.35) idx = Math.min(3, idx + 1);
    else if (r > 1 - (1 - w.rainChance) * 0.25) idx = Math.max(0, idx - 1);
  }
  return out;
}

interface CarState {
  car: SimCar;
  idx: number;
  offsets: Float64Array;
  path: Float64Array;
  curvature: Float64Array;
  profile: LapProfile;
  total: number; // progresso em amostras (pode ser negativo atrás da linha)
  v: number;
  tyre: Tyre;
  wear: number;
  wearPerLap: number;
  /** Fator sorteado do stint atual (±wearSpread). */
  wearFactor: number;
  engineWear: number;
  engineWearPerLap: number;
  failurePerLap: number;
  gripRatio: number;
  lapStart: number;
  lapTimes: number[];
  pitStops: number;
  pitUntil: number;
  stoppedUntil: number;
  status: 'running' | 'pit' | 'dnf' | 'finished';
  finishTime: number | null;
  dnfReason?: string;
  dnfAt?: number;
  pendingStops: { lap: number; tyre: Tyre }[];
  spinAtFrac: number | null;
  failAtFrac: number | null;
  gridLat: number;
  lastAttempt: number;
}

function pitLoss(laps: number): number {
  return COEF.pitLossBase + COEF.pitLossScaled * Math.min(1, laps / 10);
}

export function hashInput(input: RaceSimInput): string {
  return stableHash(
    JSON.stringify({
      v: SIM_VERSION,
      track: input.geometry.hash,
      laps: input.laps,
      seed: input.seed,
      weather: input.weather,
      ev: input.randomEvents,
      cars: input.cars.map((c) => [c.id, c.setup, c.trace]),
    }),
  );
}

export function simulateRace(input: RaceSimInput): RaceSimOutput {
  const g = input.geometry;
  const n = g.count;
  const laps = input.laps;
  const rng = createRng(`${input.seed}|race`);
  const weather = weatherByLap(input.seed, input.weather, laps + 1);
  const incidents: RaceIncidentDto[] = [];
  const frames: ReplayFrame[] = [];
  let wetness = WETNESS[weather[0]!];
  const cond = (): Conditions => ({ wetness, temperature: input.weather.temperature });
  const gripZones: { from: number; to: number; factor: number; untilLap: number }[] = [];
  const spread = wearSpread(input.weather);
  const stintFactor = (id: string, stint: number) =>
    createRng(`${input.seed}|wear|${id}|${stint}`).range(1 - spread, 1 + spread);

  const buildProfile = (s: CarState) => {
    const m = carModifiers(g, s.car.setup, s.tyre, s.wear, cond(), gripZones);
    s.wearPerLap = m.wearPerRace / laps;
    s.engineWearPerLap = m.engineWearPerRace / laps;
    s.failurePerLap = m.failurePerLap;
    s.gripRatio = m.gripRatio;
    s.profile = lapProfile(s.path, s.curvature, m, s.car.trace ? 0 : NO_TRACE_PACE_PENALTY);
  };

  const cars: CarState[] = input.cars.map((car, idx) => {
    const offsets = traceToOffsets(g, car.trace);
    const path = racingLine(g, offsets);
    const slot = g.grid[idx]!;
    const back = 10 + Math.floor(idx / 2) * 8 + (idx % 2) * 4;
    const s: CarState = {
      car,
      idx,
      offsets,
      path,
      curvature: pathCurvature(path),
      profile: null as unknown as LapProfile,
      total: -back / g.ds,
      v: 0,
      tyre: car.setup.tyre,
      wear: 0,
      wearPerLap: 0,
      wearFactor: stintFactor(car.id, 0),
      engineWear: 0,
      engineWearPerLap: 0,
      failurePerLap: 0,
      gripRatio: 1,
      lapStart: 0,
      lapTimes: [],
      pitStops: 0,
      pitUntil: 0,
      stoppedUntil: 0,
      status: 'running',
      finishTime: null,
      pendingStops: [...car.setup.pitStops].filter((p) => p.lap < laps),
      spinAtFrac: null,
      failAtFrac: null,
      gridLat: (idx % 2 === 0 ? 1 : -1) * (g.widths[n - 1]! / 4),
      lastAttempt: -10,
    };
    void slot;
    buildProfile(s);
    return s;
  });

  const planLapEvents = (s: CarState, lap: number) => {
    const r = createRng(`${input.seed}|car|${s.car.id}|${lap}`);
    const spinP =
      COEF.spinBase + COEF.spinLowGrip * Math.max(0, 0.92 - s.gripRatio) + (s.wear > 1 ? 0.05 : 0);
    s.spinAtFrac = r.chance(spinP) ? r.range(0.1, 0.9) : null;
    const failP = s.failurePerLap * engineFailFactor(s.engineWear);
    s.failAtFrac = input.randomEvents.mechanical && r.chance(failP) ? r.range(0.05, 0.95) : null;
  };
  cars.forEach((c) => planLapEvents(c, 0));

  let time = 0;
  let leaderFinished = false;
  let scUntilLap: number | null = null;
  let leaderLap = 0;
  let fastest: { id: string; ms: number } | null = null;
  const maxTime = (cars[0]?.profile.lapTime ?? 120) * laps * 4 + 120;
  let nextFrame = 0;

  const speedAt = (s: CarState, f: number) => {
    const i = Math.floor(f) % n,
      j = (i + 1) % n,
      t = f - Math.floor(f);
    return s.profile.v[i]! + (s.profile.v[j]! - s.profile.v[i]!) * t;
  };
  const order = () =>
    [...cars].sort((a, b) => {
      const fa = a.status === 'dnf' ? -1e12 + (a.dnfAt ?? 0) : a.total;
      const fb = b.status === 'dnf' ? -1e12 + (b.dnfAt ?? 0) : b.total;
      return fb - fa || a.idx - b.idx;
    });

  const recordFrame = () => {
    const c: number[] = [];
    for (const s of cars) {
      const f = ((s.total % n) + n) % n;
      const i = Math.floor(f),
        j = (i + 1) % n,
        t = f - i;
      const lerp = (arr: number[], k: number) => arr[i * 2 + k]! + (arr[j * 2 + k]! - arr[i * 2 + k]!) * t;
      const traceLat = lateralMeters(g, i, s.offsets[i]! + (s.offsets[j]! - s.offsets[i]!) * t);
      let lat = traceLat;
      if (s.total < 12) {
        const back = (10 + Math.floor(s.idx / 2) * 8 + (s.idx % 2) * 4) / g.ds;
        const a = Math.max(0, Math.min(1, (s.total + back) / (back + 12)));
        lat = s.gridLat * (1 - a) + traceLat * a;
      }
      let x = lerp(g.points, 0) + lerp(g.normals, 0) * lat;
      let y = lerp(g.points, 1) + lerp(g.normals, 1) * lat;
      let heading = Math.atan2(
        g.points[j * 2 + 1]! - g.points[i * 2 + 1]!,
        g.points[j * 2]! - g.points[i * 2]!,
      );
      if (s.status === 'pit') {
        // Parado no box, ao lado da linha de largada.
        const k = Math.round((n - g.pit.entryIndex) % n) * 2;
        x = g.pit.lane[k] ?? x;
        y = g.pit.lane[k + 1] ?? y;
        heading = Math.atan2(g.points[3]! - g.points[1]!, g.points[2]! - g.points[0]!);
      }
      const status = CAR_STATUS[s.status];
      c.push(
        Math.round(x * 10) / 10,
        Math.round(y * 10) / 10,
        Math.round(heading * 100) / 100,
        Math.round((s.total / n) * 1000) / 1000,
        tyreCode(s.tyre),
        status,
        Math.round(s.wear * 100),
        Math.round(s.engineWear * 100),
      );
    }
    frames.push({ t: Math.round(time * 1000), c });
  };

  const finishCar = (s: CarState, at: number) => {
    s.status = 'finished';
    s.finishTime = at;
  };

  const onLapComplete = (s: CarState, completed: number, crossTime: number) => {
    const lapTime = crossTime - s.lapStart;
    s.lapStart = crossTime;
    s.lapTimes.push(lapTime);
    const ms = Math.round(lapTime * 1000);
    // A primeira volta (largada parada) não conta para volta mais rápida.
    if (completed >= 2 && (!fastest || ms < fastest.ms)) {
      fastest = { id: s.car.id, ms };
      incidents.push({
        t: Math.round(crossTime * 1000),
        userId: s.car.id,
        kind: 'fastest_lap',
        lap: completed,
        detail: String(ms),
      });
    }
    const jitter = COEF.wearSpread.lapJitter;
    s.wear +=
      s.wearPerLap *
      s.wearFactor *
      createRng(`${input.seed}|wearlap|${s.car.id}|${completed}`).range(1 - jitter, 1 + jitter);
    s.engineWear += s.engineWearPerLap;
    if (completed > leaderLap) {
      leaderLap = completed;
      // Clima evolui por volta do líder; a umidade da pista acompanha com atraso.
      const target = WETNESS[weather[Math.min(weather.length - 1, completed)]!];
      const before = wetness;
      wetness = wetness + (target - wetness) * 0.6;
      if (Math.abs(target - WETNESS[weather[completed - 1] ?? 'dry']) > 0.01)
        incidents.push({
          t: Math.round(time * 1000),
          userId: null,
          kind: 'weather',
          lap: completed,
          detail: weather[completed],
        });
      void before;
      if (scUntilLap !== null && completed >= scUntilLap) {
        scUntilLap = null;
        incidents.push({ t: Math.round(time * 1000), userId: null, kind: 'safety_car_end', lap: completed });
      }
      const ev = createRng(`${input.seed}|events|${completed}`);
      if (input.randomEvents.safetyCar && scUntilLap === null && completed < laps - 1 && ev.chance(0.04)) {
        scUntilLap = completed + 1;
        incidents.push({ t: Math.round(time * 1000), userId: null, kind: 'safety_car', lap: completed + 1 });
      }
      if (input.randomEvents.oil && completed < laps - 1 && ev.chance(0.06)) {
        const from = ev.int(10, n - 20);
        gripZones.push({ from, to: from + 8, factor: 0.72, untilLap: completed + 2 });
        incidents.push({
          t: Math.round(time * 1000),
          userId: null,
          kind: 'oil',
          lap: completed + 1,
          detail: String(from),
        });
      }
      for (let k = gripZones.length - 1; k >= 0; k--)
        if (gripZones[k]!.untilLap <= completed) gripZones.splice(k, 1);
    }
    if (leaderFinished || completed >= laps) {
      finishCar(s, crossTime);
      if (!leaderFinished) leaderFinished = true;
      return;
    }
    // Furo por desgaste extremo: parada forçada.
    const r = createRng(`${input.seed}|puncture|${s.car.id}|${completed}`);
    let forced = false;
    if (s.wear > 1.05 && r.chance(0.3)) {
      forced = true;
      incidents.push({ t: Math.round(time * 1000), userId: s.car.id, kind: 'puncture', lap: completed });
    }
    const planned = s.pendingStops[0]?.lap === completed ? s.pendingStops.shift()! : null;
    if (planned || forced) {
      const loss = pitLoss(laps) + r.range(-1.2, 1.2) + (r.chance(0.08) ? 4 : 0) + (forced ? 8 : 0);
      s.status = 'pit';
      s.pitUntil = time + loss;
      s.pitStops++;
      s.tyre = planned ? planned.tyre : s.tyre;
      s.wear = 0;
      s.wearFactor = stintFactor(s.car.id, s.pitStops);
      s.v = 0;
      incidents.push({
        t: Math.round(time * 1000),
        userId: s.car.id,
        kind: 'pit',
        lap: completed,
        detail: s.tyre,
      });
    }
    buildProfile(s);
    planLapEvents(s, completed);
  };

  recordFrame();
  while (time < maxTime) {
    time += DT;
    const ord = order();
    for (let k = 0; k < ord.length; k++) {
      const s = ord[k]!;
      if (s.status === 'dnf') continue;
      if (s.status === 'pit') {
        if (time >= s.pitUntil) {
          s.status = 'running';
          s.v = 15;
        } else continue;
      }
      if (time < s.stoppedUntil) continue;
      const f = ((s.total % n) + n) % n;
      let target = speedAt(s, f);
      if (s.status === 'finished') target *= 0.45;
      // Safety car: líder limitado, sem ultrapassagens, pelotão se aproxima.
      if (scUntilLap !== null && s.status === 'running' && k === 0) target = Math.min(target, 30);
      const a = Math.max(0.3, COEF.baseAccel * (1 - Math.pow(s.v / 85, 2)));
      s.v = Math.min(target, s.v + a * DT);
      let adv = (s.v * DT) / g.ds;
      // Interação com o carro à frente na ordem de corrida.
      const ahead = k > 0 ? ord[k - 1]! : null;
      if (
        ahead &&
        ahead.status !== 'dnf' &&
        ahead.status !== 'pit' &&
        s.status === 'running' &&
        ahead.status !== 'finished'
      ) {
        const gap = ahead.total - s.total;
        const newGap = gap - adv + (ahead.v * DT) / g.ds;
        const minGap = 6 / g.ds;
        if (newGap < minGap && gap >= 0) {
          const lapped =
            ahead.total < s.total - n * 0.5 || Math.floor(ahead.total / n) < Math.floor(s.total / n);
          let pass = lapped;
          if (!pass && scUntilLap === null && time - s.lastAttempt > 2 && s.total > 0) {
            s.lastAttempt = time;
            const fi = Math.floor(f);
            const straight = Math.abs(s.curvature[fi]!) < 1 / 150 ? 1 : 0;
            const lateralSep = Math.abs(s.offsets[fi]! - ahead.offsets[fi]!);
            const dv = (s.v - ahead.v) / Math.max(10, ahead.v);
            const p = Math.max(
              0.04,
              Math.min(
                0.85,
                0.08 + dv * 2.5 + lateralSep * 0.25 + straight * 0.2 + (ahead.wear - s.wear) * 0.3,
              ),
            );
            pass = rng.chance(p);
            if (pass)
              incidents.push({
                t: Math.round(time * 1000),
                userId: s.car.id,
                kind: 'overtake',
                lap: Math.max(1, Math.floor(s.total / n) + 1),
                detail: ahead.car.id,
              });
          }
          if (!pass) {
            adv = Math.max(0, gap + (ahead.v * DT) / g.ds - minGap);
            s.v = Math.min(s.v, ahead.v);
          }
        }
      }
      const prevLap = Math.floor(s.total / n);
      const prevFrac = (s.total - prevLap * n) / n;
      s.total += adv;
      const curLap = Math.floor(s.total / n);
      const curFrac = (s.total - curLap * n) / n;
      if (s.status === 'running' && curLap === prevLap && curLap >= 0) {
        if (s.spinAtFrac !== null && prevFrac < s.spinAtFrac && curFrac >= s.spinAtFrac) {
          const r = createRng(`${input.seed}|spin|${s.car.id}|${curLap}`);
          s.stoppedUntil = time + r.range(2.5, 6);
          s.v = 0;
          s.spinAtFrac = null;
          incidents.push({ t: Math.round(time * 1000), userId: s.car.id, kind: 'spin', lap: curLap + 1 });
        }
        if (s.failAtFrac !== null && prevFrac < s.failAtFrac && curFrac >= s.failAtFrac) {
          s.status = 'dnf';
          s.dnfReason = 'mechanical';
          s.dnfAt = time;
          s.failAtFrac = null;
          incidents.push({
            t: Math.round(time * 1000),
            userId: s.car.id,
            kind: 'mechanical',
            lap: curLap + 1,
          });
        }
      }
      if (curLap > prevLap && curLap >= 1 && s.status === 'running') {
        // Instante exato do cruzamento da linha, interpolado dentro do passo.
        const over = adv > 0 ? (s.total - curLap * n) / adv : 0;
        onLapComplete(s, curLap, time - DT * Math.min(1, Math.max(0, over)));
      }
    }
    if (time >= nextFrame / FRAME_HZ) {
      recordFrame();
      nextFrame++;
    }
    if (cars.every((c) => c.status === 'finished' || c.status === 'dnf')) break;
  }
  // Quem não terminou dentro do limite de tempo é classificado como abandono.
  for (const s of cars)
    if (s.status !== 'finished' && s.status !== 'dnf') {
      s.status = 'dnf';
      s.dnfReason = 'timeout';
      s.dnfAt = time;
    }
  if (frames[frames.length - 1]!.t < Math.round(time * 1000)) recordFrame();

  const finished = cars
    .filter((c) => c.status === 'finished')
    .sort((a, b) => b.lapTimes.length - a.lapTimes.length || a.finishTime! - b.finishTime! || a.idx - b.idx);
  const dnf = cars
    .filter((c) => c.status === 'dnf')
    .sort(
      (a, b) => b.lapTimes.length - a.lapTimes.length || (b.dnfAt ?? 0) - (a.dnfAt ?? 0) || a.idx - b.idx,
    );
  const results: CarResult[] = [...finished, ...dnf].map((s, i) => ({
    id: s.car.id,
    position: i + 1,
    status: s.status === 'finished' ? 'finished' : 'dnf',
    totalTimeMs: s.finishTime != null ? Math.round(s.finishTime * 1000) : null,
    bestLapMs: s.lapTimes.length
      ? Math.round(Math.min(...s.lapTimes.slice(s.lapTimes.length > 1 ? 1 : 0)) * 1000)
      : null,
    lapsCompleted: s.lapTimes.length,
    pitStops: s.pitStops,
    lapTimesMs: s.lapTimes.map((t) => Math.round(t * 1000)),
    ...(s.dnfReason ? { dnfReason: s.dnfReason } : {}),
    usedDefaultTrace: s.car.trace == null,
  }));
  const durationMs = Math.round(time * 1000);
  const fl = fastest as { id: string; ms: number } | null;
  const resultHash = stableHash(
    JSON.stringify({ results, durationMs, frames: frames.length, last: frames[frames.length - 1] }),
  );
  return {
    simVersion: SIM_VERSION,
    inputHash: hashInput(input),
    resultHash,
    durationMs,
    frameHz: FRAME_HZ,
    frames,
    incidents,
    weatherByLap: weather.slice(0, laps),
    results,
    fastestLap: fl,
  };
}

// ---------------------------------------------------------------------------------------------
// Classificação e treino
// ---------------------------------------------------------------------------------------------

export interface LapEstimate {
  lapTimeMs: number;
  sectorMs: number[];
  topSpeedKmh: number;
  wearPerLap: number;
  /** Voltas até o "penhasco" de desgaste, na média (sem a variação sorteada). */
  lapsToCliff: number;
  /** Desgaste do motor por volta (1 = vida útil inteira). */
  engineWearPerLap: number;
  profile: Float64Array;
}

export interface TyreLife {
  /** Voltas até o penhasco de desgaste na média e nos extremos da variação sorteada. */
  avg: number;
  min: number;
  max: number;
  /** ± fração da variação sorteada para esta previsão do tempo. */
  spread: number;
}

/** Quantas voltas o pneu rende antes do penhasco, com a faixa de variação que o clima previsto traz. */
export function tyreLife(wearPerLap: number, weather: RaceWeather, fromWear = 0): TyreLife {
  const spread = wearSpread(weather);
  const left = Math.max(0, COEF.cliffAt - fromWear);
  const laps = (f: number) => Math.floor(left / (wearPerLap * f));
  return { avg: laps(1), min: laps(1 + spread), max: laps(1 - spread), spread };
}

/** Chance de o motor quebrar em algum momento da corrida (eventos mecânicos ligados). */
export function engineRaceRisk(setup: CarSetup, laps: number): { risk: number; wearAtEnd: number } {
  const m = COEF.engine[setup.engine];
  const gx = (setup.gearing - 5.5) / 4.5;
  const perRace = COEF.engineWear[setup.engine] * (1 - COEF.engineGearingWear * gx);
  let ok = 1;
  for (let lap = 0; lap < laps; lap++) ok *= 1 - m.failure * engineFailFactor((perRace * lap) / laps);
  return { risk: 1 - ok, wearAtEnd: perRace };
}

export function estimateLap(
  g: TrackGeometry,
  setup: CarSetup,
  trace: TracePoint[] | null,
  weather: Weather,
  temperature: number,
  laps: number,
  wear = 0,
): LapEstimate {
  const offsets = traceToOffsets(g, trace);
  const path = racingLine(g, offsets);
  const curv = pathCurvature(path);
  const m = carModifiers(g, setup, setup.tyre, wear, { wetness: WETNESS[weather], temperature });
  const p = lapProfile(path, curv, m, trace ? 0 : NO_TRACE_PACE_PENALTY);
  const sectorMs = g.sectors.map((from, k) => {
    const to = g.sectors[k + 1] ?? g.count;
    return Math.round((p.t[to]! - p.t[from]!) * 1000);
  });
  const wearPerLap = m.wearPerRace / laps;
  return {
    lapTimeMs: Math.round(p.lapTime * 1000),
    sectorMs,
    topSpeedKmh: Math.round(p.topSpeed * 3.6),
    wearPerLap,
    lapsToCliff: Math.max(0, Math.floor((COEF.cliffAt - wear) / wearPerLap)),
    engineWearPerLap: m.engineWearPerRace / laps,
    profile: p.v,
  };
}

export interface QualifyingRow {
  id: string;
  position: number;
  lapTimeMs: number;
}

/** Uma volta lançada por carro, pneus novos do composto de largada, com ruído semeado pequeno (±0,3%). */
export function simulateQualifying(
  g: TrackGeometry,
  cars: SimCar[],
  seed: string,
  weather: RaceWeather,
  laps: number,
): QualifyingRow[] {
  const w = weatherByLap(seed, weather, 1)[0]!;
  const rows = cars.map((c, order) => {
    const est = estimateLap(g, c.setup, c.trace, w, weather.temperature, laps);
    const r: Rng = createRng(`${seed}|quali|${c.id}`);
    const noise = 1 + r.normal() * 0.0015;
    return { id: c.id, order, lapTimeMs: Math.round(est.lapTimeMs * noise) };
  });
  // Empate: quem confirmou a inscrição antes (ordem de entrada) fica à frente.
  rows.sort((a, b) => a.lapTimeMs - b.lapTimeMs || a.order - b.order);
  return rows.map((r, i) => ({ id: r.id, position: i + 1, lapTimeMs: r.lapTimeMs }));
}

/** Decodifica um frame em objetos (útil no cliente e em testes). */
export function decodeFrame(
  frame: ReplayFrame,
): {
  x: number;
  y: number;
  heading: number;
  progress: number;
  tyre: number;
  status: number;
  tyreWear: number;
  engineWear: number;
}[] {
  const out = [];
  for (let i = 0; i < frame.c.length; i += CAR_FRAME_STRIDE)
    out.push({
      x: frame.c[i]!,
      y: frame.c[i + 1]!,
      heading: frame.c[i + 2]!,
      progress: frame.c[i + 3]!,
      tyre: frame.c[i + 4]!,
      status: frame.c[i + 5]!,
      tyreWear: frame.c[i + 6]!,
      engineWear: frame.c[i + 7]!,
    });
  return out;
}
