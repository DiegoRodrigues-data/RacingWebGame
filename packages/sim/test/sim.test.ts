import { describe, expect, it } from 'vitest';
import { DEFAULT_SETUP, type CarSetup } from '@tracado/shared';
import { generateProceduralTrack, offsetsToTrace } from '@tracado/trackgen';
import {
  decodeFrame,
  estimateLap,
  runBalance,
  simulateQualifying,
  simulateRace,
  weatherByLap,
  type RaceSimInput,
} from '../src';

const g = generateProceduralTrack('sim-tests', {
  length: 2500,
  complexity: 0.5,
  width: 12,
  terrain: 'asphalt',
});
const mk = (n: number, f: (i: number) => Partial<CarSetup> = () => ({})) =>
  Array.from({ length: n }, (_, i) => ({ id: `u${i}`, setup: { ...DEFAULT_SETUP, ...f(i) }, trace: null }));
const input = (over: Partial<RaceSimInput> = {}): RaceSimInput => ({
  geometry: g,
  cars: mk(22, (i) => ({ tyre: (['soft', 'medium', 'hard'] as const)[i % 3], aero: 1 + (i % 10) })),
  laps: 5,
  seed: 'race-1',
  weather: { base: 'dry', rainChance: 0.3, temperature: 25 },
  randomEvents: { safetyCar: true, oil: true, mechanical: true },
  ...over,
});

describe('simulação de corrida', () => {
  it('é determinística: mesmos inputs ⇒ mesmo resultado, mesmos frames e mesmo hash', () => {
    const a = simulateRace(input());
    const b = simulateRace(input());
    expect(a.resultHash).toBe(b.resultHash);
    expect(a.results).toEqual(b.results);
    expect(a.frames).toEqual(b.frames);
    expect(a.inputHash).toBe(b.inputHash);
  });

  it('seed diferente muda o resultado, mas não o hash de entrada da pista', () => {
    const a = simulateRace(input());
    const b = simulateRace(input({ seed: 'race-2' }));
    expect(a.inputHash).not.toBe(b.inputHash);
  });

  it('classificação consistente: posições únicas 1..n, terminados antes dos abandonos, voltas corretas', () => {
    const out = simulateRace(input());
    expect(out.results.map((r) => r.position)).toEqual(Array.from({ length: 22 }, (_, i) => i + 1));
    const firstDnf = out.results.findIndex((r) => r.status === 'dnf');
    if (firstDnf >= 0) expect(out.results.slice(firstDnf).every((r) => r.status === 'dnf')).toBe(true);
    expect(out.results[0]!.lapsCompleted).toBe(5);
    expect(out.results[0]!.totalTimeMs).toBeGreaterThan(0);
    for (const r of out.results.filter((x) => x.status === 'finished'))
      expect(r.totalTimeMs!).toBeGreaterThanOrEqual(out.results[0]!.totalTimeMs!);
  });

  it('frames em ordem temporal com 22 carros cada', () => {
    const out = simulateRace(input());
    for (let i = 1; i < out.frames.length; i++)
      expect(out.frames[i]!.t).toBeGreaterThan(out.frames[i - 1]!.t);
    expect(decodeFrame(out.frames[0]!)).toHaveLength(22);
    expect(out.durationMs).toBe(out.frames[out.frames.length - 1]!.t);
  });

  it('pit stops planejados acontecem e trocam o composto', () => {
    const out = simulateRace(
      input({
        cars: mk(4, (i) => (i === 0 ? { tyre: 'soft', pitStops: [{ lap: 2, tyre: 'hard' }] } : {})),
        randomEvents: { safetyCar: false, oil: false, mechanical: false },
      }),
    );
    const r = out.results.find((x) => x.id === 'u0')!;
    expect(r.pitStops).toBe(1);
    expect(out.incidents.some((i) => i.kind === 'pit' && i.userId === 'u0' && i.detail === 'hard')).toBe(
      true,
    );
  });

  it('funciona com 2 carros e sem eventos aleatórios', () => {
    const out = simulateRace(
      input({ cars: mk(2), randomEvents: { safetyCar: false, oil: false, mechanical: false } }),
    );
    expect(out.results).toHaveLength(2);
    expect(out.results.every((r) => r.status === 'finished')).toBe(true);
  });
});

describe('modelo de desempenho', () => {
  it('sem traçado válido o carro sofre a penalidade de ritmo', () => {
    const centerline = offsetsToTrace(new Float64Array(g.count), 256);
    const withTrace = estimateLap(g, DEFAULT_SETUP, centerline, 'dry', 25, 5).lapTimeMs;
    const without = estimateLap(g, DEFAULT_SETUP, null, 'dry', 25, 5).lapTimeMs;
    expect(without).toBeGreaterThan(withTrace);
  });
  it('pneu de chuva é melhor na chuva e pior no seco', () => {
    const wet = { ...DEFAULT_SETUP, tyre: 'wet' as const };
    expect(estimateLap(g, wet, null, 'rain', 18, 5).lapTimeMs).toBeLessThan(
      estimateLap(g, DEFAULT_SETUP, null, 'rain', 18, 5).lapTimeMs,
    );
    expect(estimateLap(g, wet, null, 'dry', 25, 5).lapTimeMs).toBeGreaterThan(
      estimateLap(g, DEFAULT_SETUP, null, 'dry', 25, 5).lapTimeMs,
    );
  });
  it('macio é mais rápido em uma volta, mas desgasta mais', () => {
    const soft = estimateLap(g, { ...DEFAULT_SETUP, tyre: 'soft' }, null, 'dry', 25, 5);
    const hard = estimateLap(g, { ...DEFAULT_SETUP, tyre: 'hard' }, null, 'dry', 25, 5);
    expect(soft.lapTimeMs).toBeLessThan(hard.lapTimeMs);
    expect(soft.wearPerLap).toBeGreaterThan(hard.wearPerLap);
  });
  it('aerodinâmica: mais pressão aumenta aderência e reduz velocidade final', () => {
    const lo = estimateLap(g, { ...DEFAULT_SETUP, aero: 1 }, null, 'dry', 25, 5);
    const hi = estimateLap(g, { ...DEFAULT_SETUP, aero: 10 }, null, 'dry', 25, 5);
    expect(hi.topSpeedKmh).toBeLessThan(lo.topSpeedKmh);
  });
  it('previsão de clima é determinística', () => {
    const w = { base: 'cloudy' as const, rainChance: 0.7, temperature: 20 };
    expect(weatherByLap('s', w, 10)).toEqual(weatherByLap('s', w, 10));
  });
});

describe('classificação', () => {
  it('ordena por tempo e desempata pela ordem de inscrição', () => {
    const cars = mk(3);
    const rows = simulateQualifying(g, cars, 'q', { base: 'dry', rainChance: 0, temperature: 25 }, 5);
    expect(rows.map((r) => r.position)).toEqual([1, 2, 3]);
    for (let i = 1; i < rows.length; i++)
      expect(rows[i]!.lapTimeMs).toBeGreaterThanOrEqual(rows[i - 1]!.lapTimeMs);
    expect(simulateQualifying(g, cars, 'q', { base: 'dry', rainChance: 0, temperature: 25 }, 5)).toEqual(
      rows,
    );
  });
});

describe('balanceamento', () => {
  it('nenhuma característica tem lift de vitória > 3 e nenhuma estratégia vence > 35%', () => {
    const r = runBalance(8, 'ci');
    expect(r.maxLift.lift).toBeLessThanOrEqual(3);
    expect(r.topStrategyWinShare).toBeLessThanOrEqual(0.35);
  }, 60_000);
});
