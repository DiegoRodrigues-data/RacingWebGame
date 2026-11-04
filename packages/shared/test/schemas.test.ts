import { describe, expect, it } from 'vitest';
import { carSetupSchema, DEFAULT_SETUP, registerSchema, traceSubmitSchema } from '../src';

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
