/** Regras globais do jogo. O servidor é a autoridade; o cliente usa os mesmos valores apenas para UX. */
/** Largura padrão das pistas geradas (m). 14 m dá para dois carros lado a lado nas disputas de posição. */
export const DEFAULT_TRACK_WIDTH = 14;
export const MAX_CARS_PER_RACE = 22;
export const DEFAULT_WAITLIST_MAX = 10;
/**
 * Janela de traçado depois do treino: desligada (0). O traçado é salvo e editado da inscrição até o parque fechado,
 * então a janela só fazia todo mundo esperar. Corridas antigas guardam a delas nos horários e continuam funcionando.
 */
export const TRACE_WINDOW_MS = 0;
/** Duração padrão do treino: sem treino (pedido de 07/11/2026). A preparação vai da inscrição ao parque fechado. */
export const DEFAULT_PRACTICE_MINUTES = 0;
export const DEFAULT_SETUP_LOCK_MS = 30 * 1000;
export const DEFAULT_QUALIFYING_MS = 60 * 1000;
export const DEFAULT_PRACTICE_MS = 10 * 60 * 1000;
export const ARCHIVE_AFTER_MS = 24 * 60 * 60 * 1000;
/** Duração das corridas em voltas (categorias e corridas avulsas). */
export const RACE_LAPS_MIN = 30;
export const RACE_LAPS_MAX = 60;
/** Toda corrida exige ao menos esta quantidade de paradas nos boxes. */
export const MIN_PIT_STOPS = 1;
/** Teto de paradas de qualquer corrida (as longas liberam mais que o limite da categoria). */
export const MAX_PIT_STOPS = 8;
/** A cada tantos km de corrida, uma parada a mais liberada (o pneu gasta por distância). */
export const PIT_STOP_KM = 20;
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
