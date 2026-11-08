import {
  NEUTRAL_DRIVER,
  SETUP_EDITABLE_PHASES,
  type CarSetup,
  type CategoryConfig,
  type DriverProfile,
  type RacePhase,
  type TracePoint,
  type Weather,
} from '@tracado/shared';
import { useSession } from '../../lib/session';

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

export const isSetupEditable = (status: RacePhase, setupLockAt: string, now: number) =>
  SETUP_EDITABLE_PHASES.includes(status) && now < Date.parse(setupLockAt);

/**
 * Perfil do piloto valendo nesta corrida (o que a simulação usa): o ajuste do box, senão o do jogador (o servidor
 * já manda o sorteado pelo id para quem nunca escolheu).
 */
export function useRaceDriver(setup: CarSetup): DriverProfile {
  const saved = useSession((s) => s.me?.profile.driver);
  return setup.driver ?? saved ?? NEUTRAL_DRIVER;
}
