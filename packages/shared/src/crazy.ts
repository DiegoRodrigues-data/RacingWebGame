import { z } from 'zod';
import { CAR_COLORS, MAX_CARS_PER_RACE } from './constants';
import type { RaceSummaryDto } from './schemas';

/**
 * Corrida Maluca: grupo fechado de amigos (convite por link) com uma corrida avulsa ou um campeonato de até
 * 10 corridas. Não vale ranking oficial; o clima é de resenha, com troféus de zoeira a cada corrida.
 */
/** Teto técnico; o limite em vigor vem das configurações do jogo (`crazy.maxRaces`). */
export const CRAZY_MAX_RACES = 20;
export const CRAZY_MAX_MEMBERS = 22;
export const CRAZY_LAPS_MIN = 3;
export const CRAZY_LAPS_MAX = 30;
export const CRAZY_DEFAULT_LAPS = 8;
/** Intervalo mínimo entre o início de duas corridas do grupo (treino + traçado + classificação + corrida). */
export const CRAZY_MIN_INTERVAL_MIN = 15;
export const CRAZY_MAX_INTERVAL_MIN = 7 * 24 * 60;
/** Pontos do campeonato pela posição entre os amigos (bots não contam). Todo mundo que larga ganha ao menos 1. */
/**
 * Fases de preparo que podem ser puladas (todos prontos ou o organizador mandou largar). Sem treino (padrão), o
 * preparo é com as inscrições abertas; nesse caso só vale para a próxima etapa do grupo.
 */
export const CRAZY_SKIPPABLE_PHASES = ['registration_open', 'practice', 'trace_window'] as const;
/** Parque fechado depois de pular o preparo: só o tempo de a tela trocar. */
export const CRAZY_SKIP_LOCK_MS = 10_000;
/** "Largar agora" do organizador exige pelo menos esta fração da turma pronta. */
export const CRAZY_START_MIN_READY = 0.5;
export const crazyStartAllowed = (ready: number, humans: number) =>
  humans > 0 && ready >= Math.ceil(humans * CRAZY_START_MIN_READY);

export const CRAZY_POINTS = [10, 8, 6, 5, 4, 3, 2] as const;
export const crazyPointsFor = (pos: number) => CRAZY_POINTS[pos - 1] ?? 1;

const nickname = z
  .string()
  .trim()
  .min(3)
  .max(20)
  .regex(/^[A-Za-z0-9_\-À-ÿ]+$/u, 'Use letras, números, _ ou -');

export const crazyCreateSchema = z.object({
  name: z.string().trim().min(3).max(40),
  races: z.number().int().min(1).max(CRAZY_MAX_RACES),
  laps: z.number().int().min(CRAZY_LAPS_MIN).max(CRAZY_LAPS_MAX).default(CRAZY_DEFAULT_LAPS),
  /** Início do treino da primeira corrida. */
  startAt: z.string().datetime({ offset: true }),
  intervalMinutes: z.number().int().min(CRAZY_MIN_INTERVAL_MIN).max(CRAZY_MAX_INTERVAL_MIN).default(20),
  /** Modo caos: óleo na pista, safety car e quebras mecânicas ligados. */
  chaos: z.boolean().default(true),
  /** 0 = sem bots. N = completa o grid com bots até N carros quando faltar gente. */
  botFill: z.number().int().min(0).max(MAX_CARS_PER_RACE).default(0),
});
export type CrazyCreateInput = z.infer<typeof crazyCreateSchema>;

/** Entrada pelo link de convite sem conta: só o apelido e a cor do carro. */
export const guestJoinSchema = z.object({
  inviteCode: z.string().trim().min(6).max(32),
  nickname,
  carColor: z.enum(CAR_COLORS).default('red'),
});
export type GuestJoinInput = z.infer<typeof guestJoinSchema>;

export const guestResumeSchema = z.object({ key: z.string().min(20).max(200) });

/** Convidado que resolve criar conta: ganha e-mail e senha e mantém apelido e histórico. */
export const guestUpgradeSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(128),
});

export const CRAZY_AWARDS = {
  rocket: { emoji: '🚀', title: 'O Foguete', what: 'volta mais rápida' },
  turtle: { emoji: '🐢', title: 'Lanterninha', what: 'o mais lento da turma' },
  bus: { emoji: '🚌', title: 'Volta do Busão', what: 'a pior volta da corrida' },
  beetle: { emoji: '💥', title: 'Motor de Fusca', what: 'o motor que mais sofreu' },
  rubber: { emoji: '🛞', title: 'Borrachudo', what: 'quem mais torrou pneu' },
  brain: { emoji: '🧠', title: 'Estrategista', what: 'quem mais ganhou posições do grid à chegada' },
  couch: { emoji: '🛋️', title: 'Piloto de Sofá', what: 'correu com setup e traçado padrão' },
  pit: { emoji: '🔧', title: 'Rei do Box', what: 'quem mais parou nos boxes' },
} as const;
export type CrazyAwardKey = keyof typeof CRAZY_AWARDS;

export interface CrazyAwardDto {
  key: CrazyAwardKey;
  userId: string;
  nickname: string;
  /** Número que justifica o troféu (ex.: "1:23.456", "+4 posições", "92% de motor"). */
  detail: string;
  /** Frase de zoeira. */
  line: string;
}

export interface CrazyMemberDto {
  userId: string;
  nickname: string;
  carColor: string;
  guest: boolean;
  owner: boolean;
  joinedAt: string;
}

export interface CrazyRaceDto {
  round: number;
  raceId: string;
  name: string;
  status: string;
  practiceAt: string;
  raceAt: string;
  laps: number;
  trackName: string;
  /** Pódio entre os amigos e troféus, depois da bandeirada. */
  podium: { userId: string; nickname: string; position: number }[];
  awards: CrazyAwardDto[];
  race: RaceSummaryDto;
}

export interface CrazyStandingDto {
  position: number;
  userId: string;
  nickname: string;
  carColor: string;
  points: number;
  races: number;
  wins: number;
  podiums: number;
  /** Troféus de zoeira acumulados por tipo. */
  trophies: Partial<Record<CrazyAwardKey, number>>;
}

export interface CrazyGroupSummaryDto {
  id: string;
  name: string;
  ownerNickname: string;
  races: number;
  finishedRaces: number;
  members: number;
  nextRaceAt: string | null;
  status: 'upcoming' | 'running' | 'finished';
  /** Corrida em destaque no card (a atual ou a próxima; a última se acabou), para a miniatura da pista. */
  featured: RaceSummaryDto | null;
}

export interface CrazyGroupDto extends CrazyGroupSummaryDto {
  laps: number;
  intervalMinutes: number;
  chaos: boolean;
  botFill: number;
  isMember: boolean;
  isOwner: boolean;
  /** Só para membros. */
  inviteCode: string | null;
  memberList: CrazyMemberDto[];
  schedule: CrazyRaceDto[];
  standings: CrazyStandingDto[];
  /** Títulos de honra do campeonato: quem mais levou cada troféu (só com o campeonato encerrado). */
  honors: { key: CrazyAwardKey; userId: string; nickname: string; count: number }[];
}

export interface CrazyInviteDto {
  id: string;
  name: string;
  ownerNickname: string;
  races: number;
  members: string[];
  nextRaceAt: string | null;
  status: CrazyGroupSummaryDto['status'];
  isMember: boolean;
  full: boolean;
}

/** Vínculo de uma corrida com o grupo (aparece no resumo da corrida). */
export interface RaceCrazyDto {
  groupId: string;
  groupName: string;
  round: number;
  rounds: number;
  /** Quem criou o grupo (pode mandar largar antes do fim do preparo). */
  ownerId: string;
}
