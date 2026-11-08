import { z } from 'zod';

/**
 * Perfil do piloto: o jeito de correr de cada jogador. Fica no perfil do usuário (vale para todas as corridas) e
 * pode ser ajustado em cada corrida, junto com o setup. Nenhum extremo é melhor em tudo:
 * - Ataque: tenta ultrapassar mais vezes e com mais sucesso, mas bate mais e gasta mais pneu nas tentativas.
 * - Defesa: segura melhor a posição, mas perde tempo fechando a porta e aumenta o risco de toque.
 * - Ritmo: anda mais rápido, mas gasta mais pneu e erra mais (rodadas, erro na volta de classificação).
 */
export const driverProfileSchema = z.object({
  attack: z.number().int().min(0).max(100),
  defense: z.number().int().min(0).max(100),
  pace: z.number().int().min(0).max(100),
});
export type DriverProfile = z.infer<typeof driverProfileSchema>;

export const NEUTRAL_DRIVER: DriverProfile = { attack: 50, defense: 50, pace: 50 };

export const DRIVER_TRAITS = [
  {
    key: 'attack',
    label: 'Ataque',
    low: 'Paciente: espera a reta para tentar',
    high: 'Agressivo: mergulha em qualquer brecha',
  },
  {
    key: 'defense',
    label: 'Defesa',
    low: 'Deixa passar sem briga',
    high: 'Fecha a porta, mesmo perdendo tempo',
  },
  {
    key: 'pace',
    label: 'Ritmo',
    low: 'Poupa pneus e quase não erra',
    high: 'No limite: mais rápido, gasta pneu e erra mais',
  },
] as const satisfies readonly { key: keyof DriverProfile; label: string; low: string; high: string }[];

/** Sorteio de um perfil com `u()` uniforme em [0, 1): valores mais comuns no meio, extremos possíveis. */
export function randomDriverProfile(u: () => number): DriverProfile {
  const v = () => Math.round(Math.max(0, Math.min(100, 50 + ((u() + u() + u()) / 3 - 0.5) * 170)));
  return { attack: v(), defense: v(), pace: v() };
}

/** Hash 32 bits estável (FNV-1a com mistura final), sem depender do gerador da pista. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

/**
 * Perfil sorteado a partir do id do usuário: quem nunca escolheu um perfil corre sempre com o mesmo, e é esse que
 * aparece na tela de perfil até ele salvar outro.
 */
export function driverProfileFor(userId: string): DriverProfile {
  let k = 0;
  return randomDriverProfile(() => hash32(`${userId}|piloto|${k++}`) / 4294967296);
}

/** Nome curto do estilo, para mostrar no perfil e no box. */
export function driverStyle(p: DriverProfile): string {
  const { attack: a, defense: d, pace: r } = p;
  if (a >= 70 && d >= 70) return 'Brigão';
  if (a >= 70 && r >= 65) return 'Kamikaze';
  if (a >= 70) return 'Agressivo';
  if (d >= 70 && a <= 40) return 'Muralha';
  if (d >= 70) return 'Casca-grossa';
  if (r >= 70) return 'Voador';
  if (r <= 30 && a <= 40) return 'Estrategista';
  if (a <= 30) return 'Paciente';
  return 'Equilibrado';
}

/**
 * Regras da simulação para o perfil do piloto e as colisões (configurações do jogo → pilotos e colisões).
 * Ficam gravadas na entrada de cada corrida simulada, então o reprocessamento usa as mesmas.
 */
export const driverRulesSchema = z.object({
  /** Toques entre carros nas disputas de posição. */
  collisions: z.boolean(),
  /** Multiplicador da chance de toque (1 = padrão). */
  collisionRate: z.number().min(0).max(3),
  /** Chance de um toque causar dano (ida obrigatória aos boxes ou abandono). */
  damageRate: z.number().min(0).max(1),
  /** Peso de cada característica do perfil (0 = não faz efeito, 1 = padrão, 2 = o dobro). */
  attackEffect: z.number().min(0).max(2),
  defenseEffect: z.number().min(0).max(2),
  paceEffect: z.number().min(0).max(2),
});
export type DriverRules = z.infer<typeof driverRulesSchema>;

export const DEFAULT_DRIVER_RULES: DriverRules = {
  collisions: true,
  collisionRate: 1,
  damageRate: 0.3,
  attackEffect: 1,
  defenseEffect: 1,
  paceEffect: 1,
};
