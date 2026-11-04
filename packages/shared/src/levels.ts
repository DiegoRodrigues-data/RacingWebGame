import type { Level } from './schemas';
import { LEVELS } from './schemas';

/** XP mínimo de carreira para cada nível (progressão visível). Promoção/rebaixamento formal ocorre no fim da temporada. */
export const LEVEL_XP: Record<Level, number> = { rookie: 0, amateur: 300, pro: 1200, elite: 3000 };

export function levelRank(l: Level): number {
  return LEVELS.indexOf(l);
}
export function meetsLevel(user: Level, required: Level): boolean {
  return levelRank(user) >= levelRank(required);
}
export function xpForRace(position: number, finished: boolean, ranked: boolean): number {
  const base = finished ? 20 : 5;
  const podium = position === 1 ? 30 : position <= 3 ? 15 : 0;
  return Math.round((base + podium) * (ranked ? 1 : 0.5));
}
export function nextLevel(l: Level): Level | null {
  return LEVELS[levelRank(l) + 1] ?? null;
}
export function prevLevel(l: Level): Level | null {
  const i = levelRank(l);
  return i > 0 ? LEVELS[i - 1]! : null;
}
