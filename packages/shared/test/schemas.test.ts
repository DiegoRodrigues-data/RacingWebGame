import { describe, expect, it } from 'vitest';
import {
  carSetupSchema,
  categoryConfigSchema,
  checkSetupLimits,
  defaultPitStops,
  DEFAULT_SETUP,
  MIN_PIT_STOPS,
  registerSchema,
  traceSubmitSchema,
  type CategoryConfig,
} from '../src';

describe('schemas', () => {
  it('setup padrão é válido', () => expect(carSetupSchema.parse(DEFAULT_SETUP)).toEqual(DEFAULT_SETUP));
  it('rejeita aero fora do intervalo e paradas fora de ordem', () => {
    expect(carSetupSchema.safeParse({ ...DEFAULT_SETUP, aero: 11 }).success).toBe(false);
    expect(
      carSetupSchema.safeParse({
        ...DEFAULT_SETUP,
        pitStops: [
          { lap: 5, tyre: 'soft' },
          { lap: 3, tyre: 'hard' },
        ],
      }).success,
    ).toBe(false);
  });
  it('traçado exige entre 64 e 1024 pontos', () => {
    const pts = (n: number) => Array.from({ length: n }, (_, i) => ({ s: i / n, d: 0 }));
    expect(traceSubmitSchema.safeParse({ points: pts(63) }).success).toBe(false);
    expect(traceSubmitSchema.safeParse({ points: pts(64) }).success).toBe(true);
    expect(traceSubmitSchema.safeParse({ points: pts(1025) }).success).toBe(false);
  });
  it('cadastro normaliza e-mail e país', () => {
    const r = registerSchema.parse({
      email: ' A@B.COM ',
      password: '12345678',
      nickname: 'Piloto_1',
      country: 'br',
      region: 'SP',
      city: 'Campinas',
    });
    expect(r.email).toBe('a@b.com');
    expect(r.country).toBe('BR');
  });
});

describe('corridas longas e parada obrigatória', () => {
  const cfg = {
    setupLimits: {
      allowedTyres: ['soft', 'medium', 'hard', 'wet'],
      aero: { min: 1, max: 10 },
      allowedEngines: ['economy', 'balanced', 'power'],
      maxPitStops: 2,
    },
  } as CategoryConfig;
  it('categoria aceita só de 30 a 60 voltas e exige ao menos 1 parada permitida', () => {
    const base = categoryConfigSchema.shape;
    expect(base.laps.safeParse(29).success).toBe(false);
    expect(base.laps.safeParse(30).success).toBe(true);
    expect(base.laps.safeParse(60).success).toBe(true);
    expect(base.laps.safeParse(61).success).toBe(false);
    expect(base.setupLimits.shape.maxPitStops.safeParse(0).success).toBe(false);
  });
  it('setup sem parada é recusado', () => {
    expect(checkSetupLimits({ ...DEFAULT_SETUP, pitStops: [] }, cfg, 40).join()).toMatch(/obrigatória/);
    expect(checkSetupLimits({ ...DEFAULT_SETUP, pitStops: [{ lap: 20, tyre: 'hard' }] }, cfg, 40)).toEqual(
      [],
    );
  });
  it('paradas padrão cumprem a regra e ficam dentro da corrida', () => {
    for (const laps of [30, 45, 60]) {
      const stops = defaultPitStops(laps, cfg.setupLimits.allowedTyres);
      expect(stops).toHaveLength(MIN_PIT_STOPS);
      expect(checkSetupLimits({ ...DEFAULT_SETUP, pitStops: stops }, cfg, laps)).toEqual([]);
    }
    const two = defaultPitStops(60, ['soft', 'medium'], 2);
    expect(two.map((p) => p.lap)).toEqual([20, 40]);
    expect(two.every((p) => p.tyre === 'medium')).toBe(true);
  });
});

describe('paradas pela distância da corrida', () => {
  it('corridas longas liberam mais paradas que o limite da categoria (uma a cada 20 km, até 8)', async () => {
    const { maxPitStopsFor, checkSetupLimits } = await import('../src');
    expect(maxPitStopsFor({ maxPitStops: 1 }, 20, 1500)).toBe(2); // 30 km
    expect(maxPitStopsFor({ maxPitStops: 1 }, 20, 6000)).toBe(6); // 120 km
    expect(maxPitStopsFor({ maxPitStops: 3 }, 10, 1000)).toBe(3); // curta: vale a categoria
    expect(maxPitStopsFor({ maxPitStops: 1 }, 60, 5000)).toBe(8); // teto
    const cfg = {
      setupLimits: {
        allowedTyres: ['soft', 'medium', 'hard', 'wet'],
        aero: { min: 1, max: 10 },
        allowedEngines: ['economy', 'balanced', 'power'],
        maxPitStops: 1,
      },
    } as never;
    const setup = (stops: number) =>
      ({
        tyre: 'medium',
        pitStops: Array.from({ length: stops }, (_, i) => ({ lap: (i + 1) * 3, tyre: 'hard' })),
        tyrePressure: { front: 23, rear: 23 },
        aero: 5,
        engine: 'balanced',
        gearing: 5,
        terrainPrep: 'asphalt',
        weatherBet: 'dry',
      }) as never;
    expect(checkSetupLimits(setup(4), cfg, 20)).toContain('No máximo 1 parada(s).');
    expect(checkSetupLimits(setup(4), cfg, 20, 6000)).toEqual([]);
  });
});
