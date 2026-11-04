import type { EditorTrack, Terrain, TrackParams, TrackSource, TrackTerrain } from '@tracado/shared';
import { MAX_CARS_PER_RACE, TERRAINS } from '@tracado/shared';
import { createRng, q2, stableHash, type Rng } from './prng';
import { SpatialGrid } from './spatial';
import {
  catmullRomClosed,
  closedLength,
  convexHull,
  resampleClosed,
  signedArea,
  smoothClosed,
  type P,
} from './spline';
import {
  GENERATOR_VERSION,
  SAMPLE_SPACING,
  type Decoration,
  type GridSlot,
  type TrackGeometry,
  type ValidationIssue,
} from './types';

export const RULES = {
  minRadius: 12,
  edgeClearance: 6,
  minCorners: 4,
  cornerRadius: 60,
  startStraightBefore: 120,
  startStraightAfter: 30,
  startStraightMinRadius: 100,
  pitOffset: 10,
  pitClearance: 6,
  pitBefore: 150,
  pitAfter: 70,
  lengthTolerance: 0.12,
  minWidth: 8,
} as const;

const mod = (i: number, n: number) => ((i % n) + n) % n;

/** Uma "curva" é um trecho com raio abaixo deste limiar, que cresce com o tamanho da pista. */
export function cornerRadiusFor(length: number): number {
  return Math.max(RULES.cornerRadius, length / 35);
}

// ---------------------------------------------------------------------------------------------
// Geração procedural
// ---------------------------------------------------------------------------------------------

function proceduralControlPoints(rng: Rng, params: TrackParams): P[] {
  // Pistas curtas comportam menos detalhes: a complexidade efetiva é escalada pelo comprimento.
  const lengthFactor = Math.min(1, params.length / 2800);
  const complexity = params.complexity * lengthFactor;
  const k = Math.round(8 + complexity * 10);
  const raw: P[] = [];
  for (let i = 0; i < k; i++) raw.push({ x: rng.range(-1, 1), y: rng.range(-1, 1) });
  const hull = convexHull(raw);
  // Desloca pontos médios das arestas para dentro/fora (uma ou duas rodadas): cria curvas e variedade.
  const rounds = complexity > 0.55 ? 2 : 1;
  let pts: P[] = hull;
  for (let r = 0; r < rounds; r++) {
    const next: P[] = [];
    const disp = (0.3 + complexity * 0.45) / (r + 1);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!,
        b = pts[(i + 1) % pts.length]!;
      next.push(a);
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 0.2) continue;
      const nx = -(b.y - a.y) / len,
        ny = (b.x - a.x) / len;
      // Mais deslocamentos para dentro: gera curvas em "S" e grampos.
      const d = (rng.next() < 0.65 ? -1 : 1) * rng.range(0.2, 1) * disp * len;
      const t = rng.range(0.35, 0.65);
      next.push({ x: a.x + (b.x - a.x) * t + nx * d, y: a.y + (b.y - a.y) * t + ny * d });
    }
    pts = next;
  }
  // Afasta pontos muito próximos.
  const minDist = 0.18;
  for (let it = 0; it < 4; it++)
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++) {
        const p = pts[i]!,
          q = pts[j]!;
        const dx = q.x - p.x,
          dy = q.y - p.y,
          d = Math.hypot(dx, dy);
        if (d < minDist && d > 1e-9) {
          const push = (minDist - d) / 2;
          p.x -= (dx / d) * push;
          p.y -= (dy / d) * push;
          q.x += (dx / d) * push;
          q.y += (dy / d) * push;
        }
      }
  // Limita ângulos muito fechados entre segmentos de controle.
  for (let it = 0; it < 6; it++)
    for (let i = 0; i < pts.length; i++) {
      const a = pts[mod(i - 1, pts.length)]!,
        p = pts[i]!,
        b = pts[mod(i + 1, pts.length)]!;
      const v1x = p.x - a.x,
        v1y = p.y - a.y,
        v2x = b.x - p.x,
        v2y = b.y - p.y;
      const cos = (v1x * v2x + v1y * v2y) / (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1);
      if (cos < Math.cos((110 * Math.PI) / 180)) {
        p.x += 0.35 * ((a.x + b.x) / 2 - p.x);
        p.y += 0.35 * ((a.y + b.y) / 2 - p.y);
      }
    }
  return pts;
}

function scaleToLength(pts: P[], target: number): P[] {
  const L = closedLength(pts);
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const f = target / L;
  return pts.map((p) => ({ x: (p.x - cx) * f, y: (p.y - cy) * f }));
}

export function stableParams(p: TrackParams): string {
  return `${q2(p.length)}|${q2(p.complexity)}|${q2(p.width)}|${p.terrain}`;
}

export class TrackGenerationError extends Error {
  constructor(readonly issues: ValidationIssue[]) {
    super(`Não foi possível gerar pista válida: ${issues.map((i) => i.code).join(', ')}`);
  }
}

export const MAX_ATTEMPTS = 60;
/** Degraus de redução da complexidade efetiva quando as tentativas se esgotam (garante uma pista válida). */
const COMPLEXITY_STEPS = [1, 0.7, 0.4, 0] as const;
const ATTEMPTS_PER_STEP = [30, 12, 10, 8] as const;

/** Mesma seed + params + versão do gerador ⇒ mesma pista (mesmo hash) em qualquer servidor. */
export function generateProceduralTrack(seed: string, params: TrackParams): TrackGeometry {
  let lastIssues: ValidationIssue[] = [];
  let attempt = -1;
  for (let step = 0; step < COMPLEXITY_STEPS.length; step++)
    for (let k = 0; k < ATTEMPTS_PER_STEP[step]!; k++) {
      attempt++;
      const rng = createRng(`${seed}|${stableParams(params)}|v${GENERATOR_VERSION}|${attempt}`);
      const ctrl = proceduralControlPoints(rng, {
        ...params,
        complexity: params.complexity * COMPLEXITY_STEPS[step]!,
      });
      const widths = ctrl.map(() => params.width);
      const dense = catmullRomClosed(ctrl, widths, 24);
      const count = Math.max(64, Math.round(params.length / SAMPLE_SPACING));
      const phase = rng.range(0, Math.PI * 2);
      const waves = rng.int(2, 4);
      const terrainPlan = planTerrain(rng, params.terrain, count);
      const source: TrackSource = { type: 'procedural', seed, params, generatorVersion: GENERATOR_VERSION };
      // Se apenas o raio mínimo falhar, suaviza progressivamente antes de descartar a tentativa.
      for (let extra = 0; extra <= 4; extra++) {
        let pts = scaleToLength(dense.pts, params.length);
        pts = smoothClosed(pts, (params.length < 2500 ? 3 : 2) + extra * 3);
        pts = scaleToLength(pts, params.length);
        const rs = resampleClosed(pts, dense.w, count);
        const w = rs.w.map(
          (base, i) => base * (1 + 0.1 * Math.sin((i / count) * Math.PI * 2 * waves + phase)),
        );
        const geom = finalize({
          pts: rs.pts,
          widths: w,
          source,
          baseTerrain: params.terrain,
          terrainPlan,
          startIndex: null,
          decoRng: createRng(`${seed}|deco|${attempt}`),
          attempt,
        });
        const issues = validateGeometry(geom, { targetLength: params.length });
        if (issues.length === 0) return geom;
        lastIssues = issues;
        if (!issues.every((i) => i.code === 'MIN_RADIUS')) break;
      }
    }
  throw new TrackGenerationError(lastIssues);
}

function planTerrain(rng: Rng, base: TrackTerrain, count: number): (startOffset: number) => Terrain[] {
  if (base !== 'mixed') return () => new Array<Terrain>(count).fill(base);
  const segs = rng.int(4, 6);
  const cuts = Array.from({ length: segs - 1 }, () => rng.range(0.1, 0.9)).sort((a, b) => a - b);
  const kinds: Terrain[] = Array.from({ length: segs }, (_, i) => (i === 0 ? 'asphalt' : rng.pick(TERRAINS)));
  return (startOffset) => {
    const out: Terrain[] = [];
    for (let i = 0; i < count; i++) {
      // Reta de largada sempre em asfalto.
      if (i < 10 || i > count - 30) {
        out.push('asphalt');
        continue;
      }
      const f = mod(i + startOffset, count) / count;
      let k = 0;
      while (k < cuts.length && f > cuts[k]!) k++;
      out.push(kinds[k]!);
    }
    return out;
  };
}

// ---------------------------------------------------------------------------------------------
// Pistas do editor
// ---------------------------------------------------------------------------------------------

export function buildEditorTrack(editor: EditorTrack): TrackGeometry {
  const ctrl = editor.controlPoints.map((c) => ({ x: c.x, y: c.y }));
  const dense = catmullRomClosed(
    ctrl,
    editor.controlPoints.map((c) => c.width),
    24,
  );
  const L = closedLength(dense.pts);
  const count = Math.max(64, Math.round(L / SAMPLE_SPACING));
  const rs = resampleClosed(dense.pts, dense.w, count);
  const source: TrackSource = { type: 'editor', editor, generatorVersion: GENERATOR_VERSION };
  const terrainPlan = (startOffset: number): Terrain[] => {
    const out: Terrain[] = [];
    for (let i = 0; i < count; i++) {
      const f = mod(i + startOffset, count) / count;
      const seg = editor.terrainSegments.find((s) =>
        s.from <= s.to ? f >= s.from && f < s.to : f >= s.from || f < s.to,
      );
      out.push(seg ? seg.terrain : editor.baseTerrain);
    }
    return out;
  };
  return finalize({
    pts: rs.pts,
    widths: rs.w,
    source,
    baseTerrain: editor.baseTerrain,
    terrainPlan,
    startIndex: Math.round(editor.startAt * count) % count,
    decoRng: createRng(`editor|${editor.decorationSeed}`),
    attempt: 0,
  });
}

export function geometryFromSource(source: TrackSource): TrackGeometry {
  return source.type === 'procedural'
    ? generateProceduralTrack(source.seed, source.params)
    : buildEditorTrack(source.editor);
}

// ---------------------------------------------------------------------------------------------
// Finalização: orientação, largada, grid, boxes, bordas, decoração, hash
// ---------------------------------------------------------------------------------------------

interface FinalizeInput {
  pts: P[];
  widths: number[];
  source: TrackSource;
  baseTerrain: TrackTerrain;
  terrainPlan: (startOffset: number) => Terrain[];
  startIndex: number | null;
  decoRng: Rng;
  attempt: number;
}

export function computeFrame(pts: P[]): { normals: number[]; curvature: number[] } {
  const n = pts.length;
  const normals: number[] = [];
  const curvature: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[mod(i - 1, n)]!,
      b = pts[mod(i + 1, n)]!;
    const tx = b.x - a.x,
      ty = b.y - a.y,
      tl = Math.hypot(tx, ty) || 1;
    normals.push(-ty / tl, tx / tl);
    const p = pts[mod(i - 2, n)]!,
      c = pts[i]!,
      r = pts[mod(i + 2, n)]!;
    const ax = c.x - p.x,
      ay = c.y - p.y,
      bx = r.x - c.x,
      by = r.y - c.y,
      cx = r.x - p.x,
      cy = r.y - p.y;
    const cross = ax * by - ay * bx;
    const den = Math.hypot(ax, ay) * Math.hypot(bx, by) * Math.hypot(cx, cy);
    curvature.push(den > 1e-9 ? (2 * cross) / den : 0);
  }
  return { normals, curvature };
}

function bestStartIndex(curv: number[], ds: number): number {
  const n = curv.length;
  const before = Math.round(RULES.startStraightBefore / ds) + 6,
    after = Math.round(RULES.startStraightAfter / ds);
  let best = 0,
    bestScore = Infinity;
  for (let i = 0; i < n; i++) {
    let mx = 0;
    for (let k = -before; k <= after; k++) mx = Math.max(mx, Math.abs(curv[mod(i + k, n)]!));
    if (mx < bestScore) {
      bestScore = mx;
      best = i;
    }
  }
  return best;
}

function rotate<T>(arr: T[], start: number): T[] {
  return arr.slice(start).concat(arr.slice(0, start));
}

function finalize(input: FinalizeInput): TrackGeometry {
  let pts = input.pts;
  let widths = input.widths;
  // Sentido anti-horário consistente (área positiva).
  if (signedArea(pts) < 0) {
    pts = [...pts].reverse();
    widths = [...widths].reverse();
  }
  const n = pts.length;
  const length = closedLength(pts);
  const ds = length / n;
  let frame = computeFrame(pts);
  const start = input.startIndex ?? bestStartIndex(frame.curvature, ds);
  pts = rotate(pts, start);
  widths = rotate(widths, start);
  frame = computeFrame(pts);
  const terrain = input.terrainPlan(start);

  const cx = (i: number) => pts[mod(i, n)]!.x;
  const cy = (i: number) => pts[mod(i, n)]!.y;
  const nx = (i: number) => frame.normals[mod(i, n) * 2]!;
  const ny = (i: number) => frame.normals[mod(i, n) * 2 + 1]!;
  const w = (i: number) => widths[mod(i, n)]!;

  // Grid de largada: duas colunas escalonadas atrás da linha.
  const grid: GridSlot[] = [];
  for (let k = 0; k < MAX_CARS_PER_RACE; k++) {
    const row = Math.floor(k / 2),
      col = k % 2;
    const back = 10 + row * 8 + col * 4;
    const fi = n - back / ds;
    const i0 = Math.floor(fi),
      f = fi - i0;
    const x = cx(i0) + (cx(i0 + 1) - cx(i0)) * f,
      y = cy(i0) + (cy(i0 + 1) - cy(i0)) * f;
    const lat = (col === 0 ? 1 : -1) * (w(i0) / 4);
    const heading = Math.atan2(cy(i0 + 1) - cy(i0), cx(i0 + 1) - cx(i0));
    grid.push({ x: q2(x + nx(i0) * lat), y: q2(y + ny(i0) * lat), heading: q2(heading), index: k });
  }

  // Boxes: faixa paralela à reta, no lado com mais espaço livre.
  const entryIndex = mod(-Math.round(RULES.pitBefore / ds), n);
  const exitIndex = Math.round(RULES.pitAfter / ds);
  const grid2 = new SpatialGrid(
    pts.flatMap((p) => [p.x, p.y]),
    40,
  );
  const laneFor = (side: 1 | -1): { lane: number[]; margin: number } => {
    const lane: number[] = [];
    let margin = Infinity;
    const total = Math.round(RULES.pitBefore / ds) + exitIndex;
    const ramp = 8;
    for (let k = 0; k <= total; k++) {
      const i = entryIndex + k;
      const blend = Math.min(1, k / ramp, (total - k) / ramp);
      const off = (w(i) / 2) * (1 - blend) + (w(i) / 2 + RULES.pitOffset) * blend;
      const x = cx(i) + nx(i) * off * side,
        y = cy(i) + ny(i) * off * side;
      lane.push(q2(x), q2(y));
      if (blend >= 1) {
        for (const j of grid2.query(x, y, 60)) {
          const di = Math.min(mod(j - mod(i, n), n), mod(mod(i, n) - j, n));
          if (di * ds < 60) continue;
          margin = Math.min(margin, Math.hypot(cx(j) - x, cy(j) - y) - w(j) / 2);
        }
      }
    }
    return { lane, margin };
  };
  const right = laneFor(-1),
    left = laneFor(1);
  const pitSide: 1 | -1 = right.margin >= left.margin ? -1 : 1;
  const chosen = pitSide === -1 ? right : left;

  // Bordas.
  const leftB: number[] = [],
    rightB: number[] = [];
  for (let i = 0; i < n; i++) {
    leftB.push(q2(cx(i) + nx(i) * (w(i) / 2)), q2(cy(i) + ny(i) * (w(i) / 2)));
    rightB.push(q2(cx(i) - nx(i) * (w(i) / 2)), q2(cy(i) - ny(i) * (w(i) / 2)));
  }

  // Setores, curvas e raio mínimo.
  const sectors = [0, Math.round(n / 3), Math.round((2 * n) / 3)];
  let corners = 0,
    inCorner = false,
    run = 0,
    minRadius = Infinity;
  for (let i = 0; i < n; i++) {
    const k = Math.abs(frame.curvature[i]!);
    if (k > 1e-9) minRadius = Math.min(minRadius, 1 / k);
    if (k > 1 / cornerRadiusFor(length)) {
      run++;
      if (!inCorner && run * ds >= 10) {
        corners++;
        inCorner = true;
      }
    } else {
      run = 0;
      inCorner = false;
    }
  }

  const decorations = placeDecorations(input.decoRng, pts, widths, frame, grid2, ds, pitSide, chosen.lane);

  const flatPts = pts.flatMap((p) => [q2(p.x), q2(p.y)]);
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (let i = 0; i < flatPts.length; i += 2) {
    minX = Math.min(minX, flatPts[i]!);
    maxX = Math.max(maxX, flatPts[i]!);
    minY = Math.min(minY, flatPts[i + 1]!);
    maxY = Math.max(maxY, flatPts[i + 1]!);
  }
  const terrainSegments: TrackGeometry['terrainSegments'] = [];
  for (let i = 0; i < n; i++) {
    const last = terrainSegments[terrainSegments.length - 1];
    if (last && last.terrain === terrain[i]) last.to = i;
    else terrainSegments.push({ from: i, to: i, terrain: terrain[i]! });
  }

  const geom: TrackGeometry = {
    generatorVersion: GENERATOR_VERSION,
    source: input.source,
    length: q2(length),
    count: n,
    ds: q2(ds),
    points: flatPts,
    normals: frame.normals.map((v) => Math.round(v * 1e5) / 1e5),
    widths: widths.map(q2),
    curvature: frame.curvature.map((v) => Math.round(v * 1e6) / 1e6),
    terrain,
    terrainSegments,
    baseTerrain: input.baseTerrain,
    sectors,
    grid,
    pit: { side: pitSide, entryIndex, exitIndex, lane: chosen.lane, boxIndex: 0 },
    left: leftB,
    right: rightB,
    decorations,
    bounds: { minX, minY, maxX, maxY },
    corners,
    minRadius: q2(minRadius === Infinity ? 99999 : minRadius),
    attempt: input.attempt,
    hash: '',
  };
  geom.hash = hashGeometry(geom);
  return geom;
}

export function hashGeometry(g: TrackGeometry): string {
  const parts = [
    `v${g.generatorVersion}`,
    g.points.join(','),
    g.widths.join(','),
    g.terrainSegments.map((s) => `${s.from}-${s.to}-${s.terrain}`).join(';'),
    g.sectors.join(','),
    g.pit.side,
    g.pit.lane.join(','),
    g.grid.map((s) => `${s.x},${s.y}`).join(';'),
    g.decorations.map((d) => `${d.kind}${d.x},${d.y}`).join(';'),
  ];
  return stableHash(parts.join('|'));
}

function placeDecorations(
  rng: Rng,
  pts: P[],
  widths: number[],
  frame: { normals: number[]; curvature: number[] },
  grid: SpatialGrid,
  ds: number,
  pitSide: 1 | -1,
  pitLane: number[],
): Decoration[] {
  const n = pts.length;
  const out: Decoration[] = [];
  const maxW = Math.max(...widths);
  const laneGrid = new SpatialGrid(pitLane, 40);
  const free = (x: number, y: number, margin: number): boolean => {
    for (const j of grid.query(x, y, maxW / 2 + margin)) {
      if (Math.hypot(pts[j]!.x - x, pts[j]!.y - y) < widths[j]! / 2 + margin) return false;
    }
    if (laneGrid.query(x, y, margin + 4).length > 0) return false;
    for (const d of out) if (Math.hypot(d.x - x, d.y - y) < margin * 0.8) return false;
    return true;
  };
  const tangentAngle = (i: number) => {
    const a = pts[mod(i - 1, n)]!,
      b = pts[mod(i + 1, n)]!;
    return Math.atan2(b.y - a.y, b.x - a.x);
  };
  // Arquibancadas ao longo da reta, do lado oposto aos boxes.
  for (const back of [40, 90]) {
    const i = mod(-Math.round(back / ds), n);
    const side = -pitSide;
    const off = widths[i]! / 2 + 14;
    const x = pts[i]!.x + frame.normals[i * 2]! * off * side,
      y = pts[i]!.y + frame.normals[i * 2 + 1]! * off * side;
    if (free(x, y, 10))
      out.push({
        kind: rng.chance(0.7) ? 'tribune_full' : 'tribune_empty',
        x: q2(x),
        y: q2(y),
        rot: q2(tangentAngle(i) + (side === 1 ? Math.PI : 0)),
        scale: 1,
      });
  }
  // Tendas atrás dos boxes.
  for (const back of [10, 45]) {
    const i = mod(-Math.round(back / ds), n);
    const off = widths[i]! / 2 + 26;
    const x = pts[i]!.x + frame.normals[i * 2]! * off * pitSide,
      y = pts[i]!.y + frame.normals[i * 2 + 1]! * off * pitSide;
    if (free(x, y, 8))
      out.push({
        kind: back === 10 ? 'tent_red' : 'tent_blue',
        x: q2(x),
        y: q2(y),
        rot: q2(tangentAngle(i)),
        scale: 1,
      });
  }
  // Pneus e barreiras no lado de fora das curvas fortes.
  for (let i = 0; i < n; i += 3) {
    const k = frame.curvature[i]!;
    if (Math.abs(k) < 1 / 45) continue;
    const side = k > 0 ? -1 : 1; // fora da curva
    const off = widths[i]! / 2 + 4;
    const x = pts[i]!.x + frame.normals[i * 2]! * off * side,
      y = pts[i]!.y + frame.normals[i * 2 + 1]! * off * side;
    if (free(x, y, 3))
      out.push({ kind: rng.chance(0.5) ? 'tires_red' : 'tires_white', x: q2(x), y: q2(y), rot: 0, scale: 1 });
  }
  // Árvores, pedras e cones espalhados.
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const area = (maxX - minX + 160) * (maxY - minY + 160);
  const tries = Math.min(400, Math.round(area / 4000));
  for (let t = 0; t < tries; t++) {
    const x = rng.range(minX - 80, maxX + 80),
      y = rng.range(minY - 80, maxY + 80);
    const r = rng.next();
    const kind: Decoration['kind'] =
      r < 0.45
        ? 'tree_large'
        : r < 0.8
          ? 'tree_small'
          : r < 0.9
            ? 'rock1'
            : r < 0.95
              ? 'rock2'
              : 'barrel_red';
    const margin = kind.startsWith('tree') ? 14 : 6;
    if (free(x, y, margin))
      out.push({
        kind,
        x: q2(x),
        y: q2(y),
        rot: q2(rng.range(0, Math.PI * 2)),
        scale: q2(rng.range(0.8, 1.25)),
      });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Validação (idêntica para pistas procedurais e do editor)
// ---------------------------------------------------------------------------------------------

export function validateGeometry(g: TrackGeometry, opts: { targetLength?: number } = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const n = g.count;
  const px = (i: number) => g.points[mod(i, n) * 2]!;
  const py = (i: number) => g.points[mod(i, n) * 2 + 1]!;
  const at = (i: number) => ({ x: px(i), y: py(i) });
  if (n < 64) issues.push({ code: 'POINTS', message: 'Pista curta demais para amostragem.' });
  if (g.length < 800 || g.length > 8000)
    issues.push({ code: 'LENGTH', message: `Comprimento ${Math.round(g.length)} m fora de 800–8000 m.` });
  if (opts.targetLength && Math.abs(g.length - opts.targetLength) / opts.targetLength > RULES.lengthTolerance)
    issues.push({
      code: 'LENGTH',
      message: `Comprimento ${Math.round(g.length)} m distante do alvo ${opts.targetLength} m.`,
    });
  const minW = Math.min(...g.widths);
  if (minW < RULES.minWidth)
    issues.push({ code: 'WIDTH', message: `Largura mínima ${minW.toFixed(1)} m < ${RULES.minWidth} m.` });
  for (let i = 0; i < n; i++) {
    const k = Math.abs(g.curvature[i]!);
    if (k > 1 / RULES.minRadius) {
      issues.push({
        code: 'MIN_RADIUS',
        message: `Curva com raio ${(1 / k).toFixed(1)} m (< ${RULES.minRadius} m).`,
        at: at(i),
      });
      break;
    }
  }
  // Proximidade entre trechos não adjacentes (cobre autointerseção).
  const maxW = Math.max(...g.widths);
  const grid = new SpatialGrid(g.points, 40);
  const skip = (3 * maxW) / g.ds;
  outer: for (let i = 0; i < n; i++) {
    for (const j of grid.query(px(i), py(i), maxW + RULES.edgeClearance)) {
      const di = Math.min(mod(j - i, n), mod(i - j, n));
      if (di <= skip) continue;
      const d = Math.hypot(px(j) - px(i), py(j) - py(i));
      if (d < (g.widths[i]! + g.widths[j]!) / 2 + RULES.edgeClearance) {
        issues.push({ code: 'PROXIMITY', message: 'Trechos da pista se tocam ou se cruzam.', at: at(i) });
        break outer;
      }
    }
  }
  if (g.corners < RULES.minCorners)
    issues.push({ code: 'CORNERS', message: `Apenas ${g.corners} curvas (mínimo ${RULES.minCorners}).` });
  const before = Math.round(RULES.startStraightBefore / g.ds),
    after = Math.round(RULES.startStraightAfter / g.ds);
  for (let k = -before; k <= after; k++) {
    if (Math.abs(g.curvature[mod(k, n)]!) > 1 / RULES.startStraightMinRadius) {
      issues.push({
        code: 'START_STRAIGHT',
        message: 'A área do grid de largada precisa ser uma reta (raio ≥ 100 m).',
        at: at(0),
      });
      break;
    }
  }
  // Boxes livres de outros trechos.
  const lane = g.pit.lane;
  for (let k = 0; k < lane.length; k += 2) {
    const x = lane[k]!,
      y = lane[k + 1]!;
    let bad = false;
    for (const j of grid.query(x, y, maxW / 2 + RULES.pitClearance)) {
      const li = mod(g.pit.entryIndex + k / 2, n);
      const di = Math.min(mod(j - li, n), mod(li - j, n));
      if (di * g.ds < 60) continue;
      if (Math.hypot(px(j) - x, py(j) - y) < g.widths[j]! / 2 + RULES.pitClearance) bad = true;
    }
    if (bad) {
      issues.push({
        code: 'PIT_CLEARANCE',
        message: 'A faixa dos boxes invade outro trecho da pista.',
        at: { x, y },
      });
      break;
    }
  }
  return issues;
}
