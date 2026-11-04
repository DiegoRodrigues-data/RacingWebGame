import { describe, expect, it } from 'vitest';
import { TRACE_MIN_POINTS } from '@tracado/shared';
import {
  enforceLateralRate,
  generateProceduralTrack,
  offsetsToTrace,
  projectToTrack,
  racingLine,
  strokeToOffsets,
  traceToOffsets,
  traceToWorld,
  validateTrace,
} from '../src';

const g = generateProceduralTrack('trace-tests', {
  length: 2500,
  complexity: 0.5,
  width: 12,
  terrain: 'asphalt',
});
const uniform = (n: number, d = 0) => Array.from({ length: n }, (_, i) => ({ s: i / n, d }));

describe('projeção (s, d)', () => {
  it('ida e volta mundo ⇄ pista', () => {
    for (const [s, d] of [
      [0.1, 0],
      [0.37, 0.8],
      [0.9, -0.5],
    ] as const) {
      const w = traceToWorld(g, s, d);
      const p = projectToTrack(g, w.x, w.y);
      expect(p.s).toBeCloseTo(s, 2);
      expect(p.d).toBeCloseTo(d, 1);
    }
  });
  it('ponto longe da pista tem |d| > 1', () => {
    const w = traceToWorld(g, 0.25, 0);
    const n = {
      x: g.normals[Math.floor(0.25 * g.count) * 2]!,
      y: g.normals[Math.floor(0.25 * g.count) * 2 + 1]!,
    };
    expect(Math.abs(projectToTrack(g, w.x + n.x * 40, w.y + n.y * 40).d)).toBeGreaterThan(1);
  });
});

describe('validação do traçado', () => {
  it('aceita a linha central', () => expect(validateTrace(g, uniform(256)).ok).toBe(true));
  it('rejeita pontos fora da pista com TRACE_OUT_OF_BOUNDS e indica os índices', () => {
    const pts = uniform(128);
    pts[10] = { s: pts[10]!.s, d: 1.4 };
    const r = validateTrace(g, pts);
    expect(r.code).toBe('TRACE_OUT_OF_BOUNDS');
    expect(r.indices).toEqual([10]);
  });
  it('rejeita traçado parcial (não cobre a volta)', () => {
    const pts = uniform(128).map((p) => ({ ...p, s: p.s * 0.5 }));
    expect(validateTrace(g, pts).code).toBe('TRACE_INVALID');
  });
  it('rejeita sentido invertido e quantidade insuficiente de pontos', () => {
    expect(validateTrace(g, uniform(128).reverse()).code).toBe('TRACE_INVALID');
    expect(validateTrace(g, uniform(TRACE_MIN_POINTS - 1)).code).toBe('TRACE_INVALID');
  });
  it('rejeita zigue-zague brusco', () => {
    const pts = uniform(512).map((p, i) => ({ ...p, d: i % 2 ? 0.9 : -0.9 }));
    expect(validateTrace(g, pts).code).toBe('TRACE_INVALID');
  });
});

describe('desenho → traçado', () => {
  it('um traço desenhado sobre a pista vira offsets e passa na validação após limitar a taxa lateral', () => {
    const stroke = [];
    for (let k = 0; k <= 400; k++) stroke.push(traceToWorld(g, (k / 400) * 0.999, Math.sin(k / 15) * 0.7));
    const { offsets, outside } = strokeToOffsets(g, new Float64Array(g.count), stroke);
    expect(outside).toBe(0);
    const trace = offsetsToTrace(enforceLateralRate(g, offsets), 256);
    expect(validateTrace(g, trace)).toEqual({ ok: true });
  });
  it('pontos fora da pista são limitados à borda', () => {
    const w = traceToWorld(g, 0.5, 3);
    const r = strokeToOffsets(g, new Float64Array(g.count), [w]);
    expect(r.outside).toBe(1);
    expect(Math.max(...r.offsets.map(Math.abs))).toBeLessThanOrEqual(1);
  });
  it('offsets e linha de corrida têm uma amostra por ponto da linha central', () => {
    const off = traceToOffsets(g, uniform(256, 0.5));
    expect(off.length).toBe(g.count);
    expect(racingLine(g, off).length).toBe(g.count * 2);
    expect(off[100]).toBeCloseTo(0.5, 5);
  });
});

describe('linha sugerida', () => {
  it('é válida e fica dentro dos limites', async () => {
    const { suggestedLine } = await import('../src');
    const off = suggestedLine(g);
    expect(Math.max(...off.map(Math.abs))).toBeLessThanOrEqual(1);
    expect(validateTrace(g, offsetsToTrace(off, 256))).toEqual({ ok: true });
  });
});
