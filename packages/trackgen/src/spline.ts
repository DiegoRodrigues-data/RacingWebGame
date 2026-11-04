export interface P {
  x: number;
  y: number;
}

export function convexHull(points: P[]): P[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: P, a: P, b: P) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: P[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: P[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0)
      upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Catmull-Rom centrípeta fechada (Barry–Goldman). Retorna polilinha densa e larguras interpoladas. */
export function catmullRomClosed(ctrl: P[], widths: number[], perSeg = 24): { pts: P[]; w: number[] } {
  const n = ctrl.length;
  const out: P[] = [];
  const ow: number[] = [];
  const tj = (ti: number, a: P, b: P) => ti + Math.max(Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)), 1e-4);
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n]!,
      p1 = ctrl[i]!,
      p2 = ctrl[(i + 1) % n]!,
      p3 = ctrl[(i + 2) % n]!;
    const w1 = widths[i]!,
      w2 = widths[(i + 1) % n]!;
    const t0 = 0,
      t1 = tj(t0, p0, p1),
      t2 = tj(t1, p1, p2),
      t3 = tj(t2, p2, p3);
    for (let k = 0; k < perSeg; k++) {
      const u = k / perSeg;
      const t = t1 + (t2 - t1) * u;
      const lerp = (a: P, b: P, ta: number, tb: number): P => {
        const f = (t - ta) / (tb - ta);
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      };
      const a1 = lerp(p0, p1, t0, t1),
        a2 = lerp(p1, p2, t1, t2),
        a3 = lerp(p2, p3, t2, t3);
      const b1 = lerp(a1, a2, t0, t2),
        b2 = lerp(a2, a3, t1, t3);
      out.push(lerp(b1, b2, t1, t2));
      ow.push(w1 + (w2 - w1) * (0.5 - 0.5 * Math.cos(Math.PI * u)));
    }
  }
  return { pts: out, w: ow };
}

export function closedLength(pts: P[]): number {
  let L = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!,
      b = pts[(i + 1) % pts.length]!;
    L += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return L;
}

/** Reamostra uma polilinha fechada em `count` pontos equidistantes. */
export function resampleClosed(pts: P[], w: number[], count: number): { pts: P[]; w: number[] } {
  const n = pts.length;
  const cum = [0];
  for (let i = 0; i < n; i++) {
    const a = pts[i]!,
      b = pts[(i + 1) % n]!;
    cum.push(cum[i]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const L = cum[n]!;
  const out: P[] = [];
  const ow: number[] = [];
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const target = (k / count) * L;
    while (seg < n - 1 && cum[seg + 1]! < target) seg++;
    const a = pts[seg]!,
      b = pts[(seg + 1) % n]!;
    const segLen = cum[seg + 1]! - cum[seg]!;
    const f = segLen > 0 ? (target - cum[seg]!) / segLen : 0;
    out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
    ow.push(w[seg]! + (w[(seg + 1) % n]! - w[seg]!) * f);
  }
  return { pts: out, w: ow };
}

/** Suavização laplaciana em polilinha fechada. */
export function smoothClosed(pts: P[], iterations: number, factor = 0.5): P[] {
  let cur = pts;
  const n = pts.length;
  for (let it = 0; it < iterations; it++) {
    cur = cur.map((p, i) => {
      const a = cur[(i - 1 + n) % n]!,
        b = cur[(i + 1) % n]!;
      return { x: p.x + factor * ((a.x + b.x) / 2 - p.x), y: p.y + factor * ((a.y + b.y) / 2 - p.y) };
    });
  }
  return cur;
}

export function signedArea(pts: P[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!,
      q = pts[(i + 1) % pts.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}
