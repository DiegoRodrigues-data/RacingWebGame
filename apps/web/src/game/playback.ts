import { CAR_FRAME_STRIDE, type ReplayFrame } from '@tracado/shared';

export interface CarState {
  x: number;
  y: number;
  heading: number;
  progress: number;
  tyre: number;
  status: number;
}

/** Buffer de frames com interpolação linear (posição) e angular (direção). */
export class FrameBuffer {
  frames: ReplayFrame[] = [];
  put(from: number, list: ReplayFrame[]) {
    for (let i = 0; i < list.length; i++) this.frames[from + i] = list[i]!;
  }
  setAll(list: ReplayFrame[]) {
    this.frames = [...list];
  }
  get lastT(): number {
    for (let i = this.frames.length - 1; i >= 0; i--) if (this.frames[i]) return this.frames[i]!.t;
    return 0;
  }
  /** Estado de cada carro no tempo simulado t (ms). */
  sample(t: number, cars: number): CarState[] | null {
    const f = this.frames;
    if (!f.length) return null;
    let lo = 0,
      hi = f.length - 1;
    while (hi > 0 && !f[hi]) hi--;
    while (lo < hi && !f[lo]) lo++;
    if (!f[lo]) return null;
    if (t <= f[lo]!.t) return decode(f[lo]!, cars);
    if (t >= f[hi]!.t) return decode(f[hi]!, cars);
    while (hi - lo > 1) {
      let mid = (lo + hi) >> 1;
      if (!f[mid]) {
        // Buraco no buffer: usa o frame existente mais próximo entre lo e hi (se houver).
        let k = mid - 1;
        while (k > lo && !f[k]) k--;
        if (k > lo) mid = k;
        else {
          k = mid + 1;
          while (k < hi && !f[k]) k++;
          if (k < hi) mid = k;
          else break; // só há lo e hi: interpola entre eles
        }
      }
      if (f[mid]!.t <= t) lo = mid;
      else hi = mid;
    }
    const a = f[lo]!,
      b = f[hi]!;
    const k = (t - a.t) / Math.max(1, b.t - a.t);
    const da = decode(a, cars),
      db = decode(b, cars);
    return da.map((s, i) => {
      const e = db[i]!;
      if (s.status === 1 || e.status === 1) return k < 0.5 ? s : e;
      let dh = e.heading - s.heading;
      if (dh > Math.PI) dh -= Math.PI * 2;
      if (dh < -Math.PI) dh += Math.PI * 2;
      return {
        ...e,
        x: s.x + (e.x - s.x) * k,
        y: s.y + (e.y - s.y) * k,
        heading: s.heading + dh * k,
        progress: s.progress + (e.progress - s.progress) * k,
      };
    });
  }
}

export function decode(f: ReplayFrame, cars: number): CarState[] {
  const out: CarState[] = [];
  for (let i = 0; i < cars; i++) {
    const o = i * CAR_FRAME_STRIDE;
    out.push({
      x: f.c[o]!,
      y: f.c[o + 1]!,
      heading: f.c[o + 2]!,
      progress: f.c[o + 3]!,
      tyre: f.c[o + 4]!,
      status: f.c[o + 5]!,
    });
  }
  return out;
}
