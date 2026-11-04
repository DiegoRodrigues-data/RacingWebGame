import type { ErrorCode, TracePoint } from '@tracado/shared';
import { TRACE_MAX_POINTS, TRACE_MAX_S_GAP, TRACE_MIN_POINTS } from '@tracado/shared';
import type { TrackGeometry } from './types';

const mod = (i: number, n: number) => ((i % n) + n) % n;
/** Margem lateral (m) entre a borda e o centro do carro. */
export const CAR_HALF_WIDTH = 1.2;
/** Mudança lateral máxima permitida em metros por metro percorrido. */
export const MAX_LATERAL_RATE = 0.6;

export interface Projection {
  s: number;
  d: number;
  /** Distância (m) do ponto ao eixo da pista. */
  distance: number;
  index: number;
}

/** Projeta um ponto do mundo na parametrização (s, d) da pista. d em [-1,1] dentro dos limites. */
export function projectToTrack(
  g: TrackGeometry,
  x: number,
  y: number,
  hintIndex?: number,
  window = 40,
): Projection {
  const n = g.count;
  let best = { dist2: Infinity, i: 0, t: 0 };
  const scan = (i: number) => {
    const ax = g.points[i * 2]!,
      ay = g.points[i * 2 + 1]!;
    const j = mod(i + 1, n);
    const bx = g.points[j * 2]!,
      by = g.points[j * 2 + 1]!;
    const vx = bx - ax,
      vy = by - ay;
    const len2 = vx * vx + vy * vy || 1;
    let t = ((x - ax) * vx + (y - ay) * vy) / len2;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + vx * t - x,
      qy = ay + vy * t - y;
    const d2 = qx * qx + qy * qy;
    if (d2 < best.dist2) best = { dist2: d2, i, t };
  };
  if (hintIndex !== undefined) for (let k = -window; k <= window; k++) scan(mod(hintIndex + k, n));
  else for (let i = 0; i < n; i++) scan(i);
  const i = best.i,
    j = mod(i + 1, n),
    t = best.t;
  const cx = g.points[i * 2]! + (g.points[j * 2]! - g.points[i * 2]!) * t;
  const cy = g.points[i * 2 + 1]! + (g.points[j * 2 + 1]! - g.points[i * 2 + 1]!) * t;
  const nx = g.normals[i * 2]! + (g.normals[j * 2]! - g.normals[i * 2]!) * t;
  const ny = g.normals[i * 2 + 1]! + (g.normals[j * 2 + 1]! - g.normals[i * 2 + 1]!) * t;
  const w = g.widths[i]! + (g.widths[j]! - g.widths[i]!) * t;
  const lat = (x - cx) * nx + (y - cy) * ny;
  const usable = Math.max(0.5, w / 2 - CAR_HALF_WIDTH);
  return { s: (i + t) / n, d: lat / usable, distance: Math.sqrt(best.dist2), index: i };
}

/** Converte (s, d) em coordenadas do mundo. */
export function traceToWorld(g: TrackGeometry, s: number, d: number): { x: number; y: number } {
  const n = g.count;
  const f = mod(s, 1) * n;
  const i = Math.floor(f) % n,
    j = (i + 1) % n,
    t = f - Math.floor(f);
  const lerp = (arr: number[], k: number) => arr[i * 2 + k]! + (arr[j * 2 + k]! - arr[i * 2 + k]!) * t;
  const w = g.widths[i]! + (g.widths[j]! - g.widths[i]!) * t;
  const usable = Math.max(0.5, w / 2 - CAR_HALF_WIDTH);
  return {
    x: lerp(g.points, 0) + lerp(g.normals, 0) * d * usable,
    y: lerp(g.points, 1) + lerp(g.normals, 1) * d * usable,
  };
}

export interface TraceValidation {
  ok: boolean;
  code?: Extract<ErrorCode, 'TRACE_OUT_OF_BOUNDS' | 'TRACE_INVALID'>;
  message?: string;
  /** Índices de pontos problemáticos (para destacar na UI). */
  indices?: number[];
}

/** Validação geométrica do traçado. A mesma função roda no cliente (feedback) e no servidor (autoridade). */
export function validateTrace(g: TrackGeometry, points: TracePoint[]): TraceValidation {
  if (points.length < TRACE_MIN_POINTS || points.length > TRACE_MAX_POINTS)
    return {
      ok: false,
      code: 'TRACE_INVALID',
      message: `O traçado precisa ter entre ${TRACE_MIN_POINTS} e ${TRACE_MAX_POINTS} pontos.`,
    };
  const out: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (!Number.isFinite(p.s) || !Number.isFinite(p.d))
      return { ok: false, code: 'TRACE_INVALID', message: 'Ponto inválido.', indices: [i] };
    if (Math.abs(p.d) > 1) out.push(i);
  }
  if (out.length)
    return {
      ok: false,
      code: 'TRACE_OUT_OF_BOUNDS',
      message: `${out.length} ponto(s) fora dos limites da pista.`,
      indices: out,
    };
  for (let i = 0; i < points.length; i++) {
    const s = points[i]!.s;
    if (s < 0 || s >= 1)
      return { ok: false, code: 'TRACE_INVALID', message: 's deve estar em [0, 1).', indices: [i] };
    if (i > 0 && s <= points[i - 1]!.s)
      return {
        ok: false,
        code: 'TRACE_INVALID',
        message: 'O traçado precisa seguir o sentido da pista.',
        indices: [i],
      };
  }
  const first = points[0]!.s,
    last = points[points.length - 1]!.s;
  const gaps: number[] = [];
  if (1 - last + first > TRACE_MAX_S_GAP) gaps.push(points.length - 1);
  for (let i = 1; i < points.length; i++) if (points[i]!.s - points[i - 1]!.s > TRACE_MAX_S_GAP) gaps.push(i);
  if (gaps.length)
    return {
      ok: false,
      code: 'TRACE_INVALID',
      message: 'O traçado precisa cobrir a volta completa.',
      indices: gaps,
    };
  const steep: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!,
      b = points[(i + 1) % points.length]!;
    let dsFrac = b.s - a.s;
    if (dsFrac <= 0) dsFrac += 1;
    const idx = Math.floor(a.s * g.count) % g.count;
    const usable = Math.max(0.5, g.widths[idx]! / 2 - CAR_HALF_WIDTH);
    const rate = (Math.abs(b.d - a.d) * usable) / (dsFrac * g.length);
    if (rate > MAX_LATERAL_RATE) steep.push(i);
  }
  if (steep.length)
    return {
      ok: false,
      code: 'TRACE_INVALID',
      message: 'Mudança lateral brusca demais em alguns trechos.',
      indices: steep,
    };
  return { ok: true };
}

/** Deslocamento lateral d por amostra da linha central (interpolação circular + suavização leve). */
export function traceToOffsets(g: TrackGeometry, points: TracePoint[] | null): Float64Array {
  const n = g.count;
  const out = new Float64Array(n);
  if (!points || points.length === 0) return out;
  const m = points.length;
  let k = 0;
  for (let i = 0; i < n; i++) {
    const s = i / n;
    while (k < m && points[k]!.s <= s) k++;
    const a = points[mod(k - 1, m)]!,
      b = points[mod(k, m)]!;
    let sa = a.s,
      sb = b.s,
      ss = s;
    if (k === 0) sa -= 1;
    if (k === m) sb += 1;
    if (sb - sa <= 0) sb += 1;
    if (ss < sa) ss += 1;
    const f = sb - sa > 0 ? (ss - sa) / (sb - sa) : 0;
    out[i] = Math.max(-1, Math.min(1, a.d + (b.d - a.d) * f));
  }
  const sm = new Float64Array(n);
  for (let i = 0; i < n; i++) sm[i] = (out[mod(i - 1, n)]! + 2 * out[i]! + out[mod(i + 1, n)]!) / 4;
  return sm;
}

/** Linha de corrida no mundo (x,y planos) com o mesmo número de amostras da linha central. */
export function racingLine(g: TrackGeometry, offsets: Float64Array): Float64Array {
  const n = g.count;
  const out = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    const usable = Math.max(0.5, g.widths[i]! / 2 - CAR_HALF_WIDTH);
    out[i * 2] = g.points[i * 2]! + g.normals[i * 2]! * offsets[i]! * usable;
    out[i * 2 + 1] = g.points[i * 2 + 1]! + g.normals[i * 2 + 1]! * offsets[i]! * usable;
  }
  return out;
}

/** Suavização de Chaikin para polilinhas abertas desenhadas à mão. */
export function chaikin(pts: { x: number; y: number }[], iterations = 2): { x: number; y: number }[] {
  let cur = pts;
  for (let it = 0; it < iterations; it++) {
    if (cur.length < 3) return cur;
    const next = [cur[0]!];
    for (let i = 0; i < cur.length - 1; i++) {
      const a = cur[i]!,
        b = cur[i + 1]!;
      next.push(
        { x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y },
        { x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y },
      );
    }
    next.push(cur[cur.length - 1]!);
    cur = next;
  }
  return cur;
}

/**
 * Converte o desenho do jogador (pontos de mundo) em um traçado (s, d) com `samples` pontos uniformes,
 * mesclando sobre um traçado base (trechos não desenhados mantêm o valor anterior).
 * Retorna também os índices que precisaram ser limitados à pista.
 */
export function strokeToOffsets(
  g: TrackGeometry,
  base: Float64Array,
  stroke: { x: number; y: number }[],
  opts: { clamp: boolean } = { clamp: true },
): { offsets: Float64Array; clamped: number; outside: number } {
  const n = g.count;
  const offsets = new Float64Array(base);
  let clamped = 0,
    outside = 0;
  let hint: number | undefined;
  let prevIdx: number | null = null;
  let prevD = 0;
  for (const p of stroke) {
    const pr = projectToTrack(g, p.x, p.y, hint);
    hint = pr.index;
    let d = pr.d;
    if (Math.abs(d) > 1) {
      outside++;
      if (opts.clamp) {
        d = Math.sign(d);
        clamped++;
      }
    }
    const idx = Math.round(pr.s * n) % n;
    if (prevIdx !== null) {
      // Preenche amostras entre projeções consecutivas (no sentido mais curto).
      let span = mod(idx - prevIdx, n);
      if (span > n / 2) span = span - n;
      const steps = Math.abs(span);
      if (steps > 0 && steps < n / 4)
        for (let k = 1; k <= steps; k++)
          offsets[mod(prevIdx + Math.sign(span) * k, n)] = prevD + ((d - prevD) * k) / steps;
    }
    offsets[idx] = d;
    prevIdx = idx;
    prevD = d;
  }
  return { offsets, clamped, outside };
}

/** Amostra offsets em `samples` pontos (s uniforme) para envio ao servidor. */
export function offsetsToTrace(offsets: Float64Array, samples = 256): TracePoint[] {
  const n = offsets.length;
  const out: TracePoint[] = [];
  for (let k = 0; k < samples; k++) {
    const s = k / samples;
    const f = s * n,
      i = Math.floor(f),
      t = f - i;
    const d = offsets[i % n]! + (offsets[(i + 1) % n]! - offsets[i % n]!) * t;
    out.push({ s: Math.round(s * 1e6) / 1e6, d: Math.round(Math.max(-1, Math.min(1, d)) * 1e4) / 1e4 });
  }
  return out;
}

/** Limita a taxa de mudança lateral para que o traçado sempre passe na validação. */
export function enforceLateralRate(g: TrackGeometry, offsets: Float64Array): Float64Array {
  const n = g.count;
  const out = new Float64Array(offsets);
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const usable = Math.max(0.5, g.widths[i]! / 2 - CAR_HALF_WIDTH);
      const maxDelta = (MAX_LATERAL_RATE * 0.9 * g.ds) / usable;
      const delta = out[j]! - out[i]!;
      if (Math.abs(delta) > maxDelta) {
        const fix = (Math.abs(delta) - maxDelta) / 2;
        out[i] = out[i]! + Math.sign(delta) * fix;
        out[j] = out[j]! - Math.sign(delta) * fix;
      }
    }
  }
  return out;
}

/**
 * Linha sugerida (heurística "fora–dentro–fora"): aproxima do lado interno no ápice e abre antes e depois
 * da curva. Não é ótima; serve de ponto de partida no editor de traçado e para pilotos de demonstração.
 */
export function suggestedLine(g: TrackGeometry, aggressiveness = 0.85): Float64Array {
  const n = g.count;
  const k = new Float64Array(n);
  const win = Math.max(2, Math.round(15 / g.ds));
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = -win; j <= win; j++) s += g.curvature[mod(i + j, n)]!;
    k[i] = s / (2 * win + 1);
  }
  const lead = Math.max(3, Math.round(45 / g.ds));
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const apex = k[i]! * 45;
    const around = (k[mod(i + lead, n)]! + k[mod(i - lead, n)]!) * 45 * 0.75;
    out[i] = Math.max(-1, Math.min(1, (apex - around) * aggressiveness));
  }
  for (let pass = 0; pass < 3; pass++) {
    const prev = new Float64Array(out);
    for (let i = 0; i < n; i++) out[i] = (prev[mod(i - 1, n)]! + 2 * prev[i]! + prev[mod(i + 1, n)]!) / 4;
  }
  return enforceLateralRate(g, out);
}
