/** Regras globais do jogo. O servidor é a autoridade; o cliente usa os mesmos valores apenas para UX. */
export const MAX_CARS_PER_RACE = 22;
export const DEFAULT_WAITLIST_MAX = 10;
/** Janela de traçado: fixa em 2 minutos (era 5; encurtada para o espectador não esperar à toa). */
export const TRACE_WINDOW_MS = 2 * 60 * 1000;
/** Duração padrão do treino. */
export const DEFAULT_PRACTICE_MINUTES = 2;
export const DEFAULT_SETUP_LOCK_MS = 30 * 1000;
export const DEFAULT_QUALIFYING_MS = 60 * 1000;
export const DEFAULT_PRACTICE_MS = 10 * 60 * 1000;
export const ARCHIVE_AFTER_MS = 24 * 60 * 60 * 1000;
/** Duração das corridas em voltas (categorias e corridas avulsas). */
export const RACE_LAPS_MIN = 30;
export const RACE_LAPS_MAX = 60;
/** Toda corrida exige ao menos esta quantidade de paradas nos boxes. */
export const MIN_PIT_STOPS = 1;
/** Traçado enviado pelo cliente. */
export const TRACE_MIN_POINTS = 64;
export const TRACE_MAX_POINTS = 1024;
export const TRACE_SUBMIT_MIN_INTERVAL_MS = 2000;
/** Maior salto de s entre dois pontos consecutivos (fração da volta). */
export const TRACE_MAX_S_GAP = 0.05;
/** Penalidade de ritmo para quem corre sem traçado válido (fração do tempo de volta). */
export const NO_TRACE_PACE_PENALTY = 0.015;
/** Inscrições confirmadas simultâneas em corridas com horários sobrepostos. */
export const MAX_OVERLAPPING_ENTRIES = 1;
export const ACCESS_TOKEN_TTL_S = 15 * 60;
export const REFRESH_TOKEN_TTL_S = 30 * 24 * 60 * 60;
export const WS_TICKET_TTL_S = 60;
export const WS_PROTOCOL_VERSION = 1;
export const RANKING_MIN_RACES_DEFAULT = 1;
export const CAR_COLORS = ['red', 'blue', 'green', 'yellow', 'black'] as const;
export const CAR_MODELS = [1, 2, 3, 4, 5] as const;
export type CarColor = (typeof CAR_COLORS)[number];
