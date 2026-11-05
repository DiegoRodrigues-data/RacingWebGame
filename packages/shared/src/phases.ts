import { ARCHIVE_AFTER_MS, TRACE_WINDOW_MS } from './constants';

export const RACE_PHASES = [
  'scheduled',
  'registration_open',
  'practice',
  'trace_window',
  'setup_lock',
  'qualifying',
  'race',
  'finished',
  'archived',
  'cancelled',
] as const;
export type RacePhase = (typeof RACE_PHASES)[number];

export const PHASE_LABELS: Record<RacePhase, string> = {
  scheduled: 'Agendada',
  registration_open: 'Inscrições abertas',
  practice: 'Treino',
  trace_window: 'Janela de traçado',
  setup_lock: 'Parque fechado',
  qualifying: 'Classificação',
  race: 'Corrida',
  finished: 'Encerrada',
  archived: 'Arquivada',
  cancelled: 'Cancelada',
};

/** Transições permitidas. `cancelled` é alcançável a partir de qualquer fase anterior à corrida. */
export const ALLOWED_TRANSITIONS: Record<RacePhase, readonly RacePhase[]> = {
  scheduled: ['registration_open', 'cancelled'],
  registration_open: ['practice', 'cancelled'],
  practice: ['trace_window', 'cancelled'],
  trace_window: ['setup_lock', 'cancelled'],
  setup_lock: ['qualifying', 'cancelled'],
  qualifying: ['race', 'cancelled'],
  race: ['finished'],
  finished: ['archived'],
  archived: [],
  cancelled: [],
};

export function canTransition(from: RacePhase, to: RacePhase): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export const TERMINAL_PHASES: readonly RacePhase[] = ['archived', 'cancelled'];
export const SETUP_EDITABLE_PHASES: readonly RacePhase[] = ['registration_open', 'practice', 'trace_window'];
export const ENTRY_OPEN_PHASES: readonly RacePhase[] = ['registration_open'];
/** Inscrição tardia: com a corrida já no treino ou na janela de traçado, entra quem achar vaga até o parque fechado. */
export const LATE_ENTRY_PHASES: readonly RacePhase[] = ['practice', 'trace_window'];
export const WITHDRAW_PHASES: readonly RacePhase[] = ['registration_open', 'practice', 'trace_window'];
export const LIVE_PHASES: readonly RacePhase[] = [
  'practice',
  'trace_window',
  'setup_lock',
  'qualifying',
  'race',
];

/** Horários (epoch ms) de uma corrida; todos calculados no servidor na criação. */
export interface RaceTimeline {
  registrationOpensAt: number;
  practiceAt: number;
  traceWindowAt: number;
  setupLockAt: number;
  qualifyingAt: number;
  raceAt: number;
  /** Definido apenas quando a simulação da corrida termina (início da classificação). */
  raceEndsAt: number | null;
}

export interface TimelineInput {
  startAt: number; // início do treino
  registrationLeadMs: number; // quanto antes do treino as inscrições abrem
  practiceMs: number;
  setupLockMs: number;
  qualifyingMs: number;
  /** Janela de traçado; padrão TRACE_WINDOW_MS (configurável pelo admin). */
  traceWindowMs?: number;
}

export function buildTimeline(i: TimelineInput): RaceTimeline {
  const practiceAt = i.startAt;
  const traceWindowAt = practiceAt + i.practiceMs;
  const setupLockAt = traceWindowAt + (i.traceWindowMs ?? TRACE_WINDOW_MS);
  const qualifyingAt = setupLockAt + i.setupLockMs;
  const raceAt = qualifyingAt + i.qualifyingMs;
  return {
    registrationOpensAt: practiceAt - i.registrationLeadMs,
    practiceAt,
    traceWindowAt,
    setupLockAt,
    qualifyingAt,
    raceAt,
    raceEndsAt: null,
  };
}

/** Próxima transição automática a partir da fase atual, ou null se depender de algo ainda não definido. */
export function nextTransition(status: RacePhase, t: RaceTimeline): { to: RacePhase; at: number } | null {
  switch (status) {
    case 'scheduled':
      return { to: 'registration_open', at: t.registrationOpensAt };
    case 'registration_open':
      return { to: 'practice', at: t.practiceAt };
    case 'practice':
      return { to: 'trace_window', at: t.traceWindowAt };
    case 'trace_window':
      return { to: 'setup_lock', at: t.setupLockAt };
    case 'setup_lock':
      return { to: 'qualifying', at: t.qualifyingAt };
    case 'qualifying':
      return { to: 'race', at: t.raceAt };
    case 'race':
      return t.raceEndsAt == null ? null : { to: 'finished', at: t.raceEndsAt };
    case 'finished':
      return t.raceEndsAt == null ? null : { to: 'archived', at: t.raceEndsAt + ARCHIVE_AFTER_MS };
    default:
      return null;
  }
}

/** Prazo da fase atual (para contagem regressiva no cliente). */
export function phaseDeadline(status: RacePhase, t: RaceTimeline): number | null {
  return nextTransition(status, t)?.at ?? null;
}

/** Fase em que a corrida deveria estar em `now`, aplicando transições vencidas em sequência. */
export function duePhase(status: RacePhase, t: RaceTimeline, now: number): RacePhase {
  let cur = status;
  for (let guard = 0; guard < 16; guard++) {
    const n = nextTransition(cur, t);
    if (!n || n.at > now) return cur;
    cur = n.to;
  }
  return cur;
}

export function phaseIndex(p: RacePhase): number {
  return RACE_PHASES.indexOf(p);
}
