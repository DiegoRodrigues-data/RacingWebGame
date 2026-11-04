import type { CategoryConfig, TracePoint, Weather } from '@tracado/shared';

export interface PracticeInfo {
  laps: number;
  weather: { base: Weather; rainChance: number; temperature: number };
  limits: CategoryConfig['setupLimits'];
  suggestedTrace: TracePoint[];
  reference: { suggestedLapMs: number; centerlineLapMs: number };
}

export const draftKey = (raceId: string, kind: 'trace' | 'setup') => `tracado:draft:${kind}:${raceId}`;
export const loadDraft = <T>(k: string): T | null => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
};
export const saveDraft = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* armazenamento indisponível: rascunho só em memória */
  }
};

/** Cor por velocidade (azul lento → amarelo → vermelho rápido) para cada segmento da linha. */
export function speedColors(v: Float64Array): number[] {
  let mn = Infinity,
    mx = 0;
  for (const s of v) {
    mn = Math.min(mn, s);
    mx = Math.max(mx, s);
  }
  return Array.from(v, (s) => {
    const t = (s - mn) / Math.max(1, mx - mn);
    const r = Math.round(255 * Math.min(1, t * 2)),
      g = Math.round(200 * (1 - Math.abs(t - 0.5) * 2) + 40),
      b = Math.round(255 * Math.max(0, 1 - t * 2));
    return (r << 16) | (g << 8) | b;
  });
}

export const isSetupEditable = (status: string, setupLockAt: string, now: number) =>
  ['registration_open', 'practice', 'trace_window'].includes(status) && now < Date.parse(setupLockAt);
