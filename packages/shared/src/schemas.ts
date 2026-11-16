import { z } from 'zod';
import { driverProfileSchema, type DriverProfile } from './driver';
import {
  CAR_COLORS,
  CAR_MODELS,
  DEFAULT_PRACTICE_MINUTES,
  MAX_CARS_PER_RACE,
  MAX_PIT_STOPS,
  MIN_PIT_STOPS,
  RACE_LAPS_MAX,
  RACE_LAPS_MIN,
  TRACE_MAX_POINTS,
  TRACE_MIN_POINTS,
} from './constants';
import type { RaceCrazyDto } from './crazy';
import { RACE_PHASES, type RacePhase } from './phases';

// ---------- Básicos ----------
export const uuid = z.string().uuid();
export const isoDate = z.string().datetime({ offset: true });

export const ROLES = ['player', 'admin', 'track_editor'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

export const LEVELS = ['rookie', 'amateur', 'pro', 'elite'] as const;
export const levelSchema = z.enum(LEVELS);
export type Level = z.infer<typeof levelSchema>;
export const LEVEL_LABELS: Record<Level, string> = {
  rookie: 'Novato',
  amateur: 'Amador',
  pro: 'Profissional',
  elite: 'Elite',
};

export const TERRAINS = ['asphalt', 'dirt', 'sand'] as const;
export const terrainSchema = z.enum(TERRAINS);
export type Terrain = z.infer<typeof terrainSchema>;
export const TRACK_TERRAINS = [...TERRAINS, 'mixed'] as const;
export const trackTerrainSchema = z.enum(TRACK_TERRAINS);

/**
 * Cenário em volta da pista (só visual): autódromo de grama, deserto de areia ou cânion de terra. As cores e os
 * objetos vêm do Racing Pack. Um trecho da pista não pode sumir no fundo: pista de areia não vai para o deserto e
 * pista de terra não vai para o cânion.
 */
export const BIOMES = ['grass', 'desert', 'canyon'] as const;
export const biomeSchema = z.enum(BIOMES);
export type Biome = z.infer<typeof biomeSchema>;
export const BIOME_LABEL: Record<Biome, string> = { grass: 'Autódromo', desert: 'Deserto', canyon: 'Cânion' };
const BIOME_CLASHES: Record<Biome, readonly string[]> = { grass: [], desert: ['sand'], canyon: ['dirt'] };
export const biomeFits = (b: Biome, terrain: string) => !BIOME_CLASHES[b].includes(terrain);
/** Sorteio ponderado de cenário compatível com o terreno da pista (u em [0, 1)). */
export function pickBiome(w: Record<Biome, number>, terrain: string, u: number): Biome {
  const keys = BIOMES.filter((b) => w[b] > 0 && biomeFits(b, terrain));
  if (!keys.length) return 'grass';
  const total = keys.reduce((a, k) => a + w[k], 0);
  let x = u * total;
  for (const k of keys) {
    x -= w[k];
    if (x < 0) return k;
  }
  return keys[keys.length - 1]!;
}
export type TrackTerrain = z.infer<typeof trackTerrainSchema>;

export const WEATHERS = ['dry', 'cloudy', 'light_rain', 'rain'] as const;
export const weatherSchema = z.enum(WEATHERS);
export type Weather = z.infer<typeof weatherSchema>;

export const racePhaseSchema = z.enum(RACE_PHASES);

// ---------- Auth ----------
const nickname = z
  .string()
  .trim()
  .min(3)
  .max(20)
  .regex(/^[A-Za-z0-9_\-À-ÿ]+$/u, 'Use letras, números, _ ou -');
const password = z.string().min(8).max(128);
const country = z
  .string()
  .length(2)
  .transform((s) => s.toUpperCase());
const region = z.string().trim().min(2).max(40);
const city = z.string().trim().min(2).max(60);

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password,
  nickname,
  country,
  region,
  city,
});
export type RegisterInput = z.infer<typeof registerSchema>;

/** `login`: o e-mail ou o apelido da conta (`email` continua aceito, de clientes antigos). */
export const loginSchema = z
  .object({
    login: z.string().trim().min(1).max(254).optional(),
    email: z.string().trim().min(1).max(254).optional(),
    password: z.string().min(1).max(128),
  })
  .transform((b) => ({ login: (b.login ?? b.email ?? '').toLowerCase(), password: b.password }))
  .refine((b) => b.login.length > 0, { message: 'Informe o e-mail ou o apelido.', path: ['login'] });
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email: z.string().trim().toLowerCase().email() });
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(200), password });
export const verifyEmailSchema = z.object({ token: z.string().min(20).max(200) });
/** Sem `currentPassword` só para quem ainda não tem senha (conta criada pelo Google). */
export const changePasswordSchema = z.object({
  currentPassword: z.string().max(128).optional(),
  newPassword: password,
});

export const updateProfileSchema = z.object({
  nickname: nickname.optional(),
  country: country.optional(),
  region: region.optional(),
  city: city.optional(),
  carColor: z.enum(['red', 'blue', 'green', 'yellow', 'black']).optional(),
  reducedMotion: z.boolean().optional(),
  emailReminders: z.boolean().optional(),
  /** Perfil do piloto (ataque, defesa, ritmo) usado em todas as corridas. */
  driver: driverProfileSchema.optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/** Escolha do carro na corrida: cor e modelo do racing_pack, únicos entre os confirmados. */
export const carChoiceSchema = z.object({
  carColor: z.enum(CAR_COLORS),
  carModel: z.number().int().min(1).max(CAR_MODELS.length),
});
export type CarChoiceInput = z.infer<typeof carChoiceSchema>;

export interface MeDto {
  id: string;
  email: string;
  emailVerified: boolean;
  roles: Role[];
  profile: ProfileDto;
  /** Convidado da Corrida Maluca (entrou só com apelido, sem e-mail nem senha). */
  guest: boolean;
  /** A conta tem senha própria (a criada pelo Google não tem até a pessoa criar uma). */
  hasPassword: boolean;
  /** Conta vinculada ao Google. */
  google: boolean;
  /** Master: o admin definido por ADMIN_EMAIL/ADMIN_PASSWORD (a senha muda só pela variável). */
  master: boolean;
}
export interface ProfileDto {
  userId: string;
  nickname: string;
  country: string;
  region: string;
  city: string;
  carColor: string;
  level: Level;
  xp: number;
  reducedMotion: boolean;
  emailReminders: boolean;
  careerRaces: number;
  /** Perfil do piloto; sem escolha salva, o sorteado pelo id (`driverProfileFor`). */
  driver: DriverProfile;
  /** O jogador já salvou o perfil (senão `driver` é o sorteado). */
  driverChosen: boolean;
}
export interface AuthResponse {
  accessToken: string;
  expiresIn: number;
  me: MeDto;
}

// ---------- Configuração do carro ----------
export const TYRES = ['soft', 'medium', 'hard', 'wet'] as const;
export const tyreSchema = z.enum(TYRES);
export type Tyre = z.infer<typeof tyreSchema>;
export const TYRE_LABELS: Record<Tyre, string> = {
  soft: 'Macio',
  medium: 'Médio',
  hard: 'Duro',
  wet: 'Chuva',
};

export const ENGINE_MAPS = ['economy', 'balanced', 'power'] as const;
export const engineSchema = z.enum(ENGINE_MAPS);
export type EngineMap = z.infer<typeof engineSchema>;

export const WEATHER_BETS = ['dry', 'mixed', 'wet'] as const;
export const weatherBetSchema = z.enum(WEATHER_BETS);

export const carSetupSchema = z.object({
  /** Composto da largada. */
  tyre: tyreSchema,
  /** Estratégia de troca: em que volta parar e qual composto colocar. */
  pitStops: z
    .array(z.object({ lap: z.number().int().min(1).max(200), tyre: tyreSchema }))
    .max(MAX_PIT_STOPS)
    .refine(
      (a) => a.every((s, i) => i === 0 || s.lap > a[i - 1]!.lap),
      'Voltas das paradas devem ser crescentes',
    ),
  /** Calibragem em psi. */
  tyrePressure: z.object({ front: z.number().min(18).max(28), rear: z.number().min(18).max(28) }),
  /** Pressão aerodinâmica 1 (mínima) a 10 (máxima). */
  aero: z.number().int().min(1).max(10),
  engine: engineSchema,
  /** Câmbio: 1 relações curtas (aceleração) a 10 longas (velocidade final). */
  gearing: z.number().int().min(1).max(10),
  /** Preparação da suspensão para o terreno. */
  terrainPrep: terrainSchema,
  /** Aposta de clima: ajusta arrefecimento e acerto para seco ou chuva. */
  weatherBet: weatherBetSchema,
  /** Ajuste do perfil do piloto só para esta corrida (sem ele, vale o perfil do jogador). */
  driver: driverProfileSchema.optional(),
});
export type CarSetup = z.infer<typeof carSetupSchema>;

export const DEFAULT_SETUP: CarSetup = {
  tyre: 'medium',
  pitStops: [],
  tyrePressure: { front: 23, rear: 23 },
  aero: 5,
  engine: 'balanced',
  gearing: 5,
  terrainPrep: 'asphalt',
  weatherBet: 'mixed',
};

// ---------- Traçado ----------
export const tracePointSchema = z.object({ s: z.number().finite(), d: z.number().finite() });
export const traceSubmitSchema = z.object({
  points: z.array(tracePointSchema).min(TRACE_MIN_POINTS).max(TRACE_MAX_POINTS),
});
export type TracePoint = z.infer<typeof tracePointSchema>;
export type TraceSubmit = z.infer<typeof traceSubmitSchema>;

// ---------- Categorias ----------
export const scoringSchema = z.object({
  points: z.array(z.number().int().min(0)).min(1).max(MAX_CARS_PER_RACE),
  fastestLapBonus: z.number().int().min(0).max(10),
  multiplier: z.number().min(0).max(5),
});
export type Scoring = z.infer<typeof scoringSchema>;
export const DEFAULT_SCORING: Scoring = {
  points: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
  fastestLapBonus: 1,
  multiplier: 1,
};

export const categoryConfigSchema = z.object({
  laps: z.number().int().min(RACE_LAPS_MIN).max(RACE_LAPS_MAX),
  trackLength: z.object({ min: z.number().min(800).max(8000), max: z.number().min(800).max(8000) }),
  trackComplexity: z.number().min(0).max(1),
  terrains: z.array(trackTerrainSchema).min(1),
  weathers: z.array(weatherSchema).min(1),
  rainChance: z.number().min(0).max(1),
  randomEvents: z.object({ safetyCar: z.boolean(), oil: z.boolean(), mechanical: z.boolean() }),
  setupLimits: z.object({
    allowedTyres: z.array(tyreSchema).min(1),
    aero: z.object({ min: z.number().int().min(1).max(10), max: z.number().int().min(1).max(10) }),
    allowedEngines: z.array(engineSchema).min(1),
    maxPitStops: z.number().int().min(MIN_PIT_STOPS).max(3),
  }),
  scoring: scoringSchema,
  entryRequirement: z.object({ minLevel: levelSchema, minRaces: z.number().int().min(0) }),
  playbackSpeed: z.number().min(0.5).max(8),
});
export type CategoryConfig = z.infer<typeof categoryConfigSchema>;

export const categoryCreateSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/),
  name: z.string().min(2).max(60),
  level: levelSchema,
  description: z.string().max(500).default(''),
  config: categoryConfigSchema,
  active: z.boolean().default(true),
});
export type CategoryCreate = z.infer<typeof categoryCreateSchema>;
export interface CategoryDto extends CategoryCreate {
  id: string;
}

// ---------- Pistas ----------
export const trackParamsSchema = z.object({
  length: z.number().min(800).max(8000),
  complexity: z.number().min(0).max(1),
  width: z.number().min(8).max(20),
  terrain: trackTerrainSchema,
});
export type TrackParams = z.infer<typeof trackParamsSchema>;

export const editorTrackSchema = z.object({
  controlPoints: z
    .array(z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().min(8).max(24) }))
    .min(4)
    .max(80),
  terrainSegments: z
    .array(z.object({ from: z.number().min(0).max(1), to: z.number().min(0).max(1), terrain: terrainSchema }))
    .max(20)
    .default([]),
  baseTerrain: terrainSchema,
  startAt: z.number().min(0).max(1).default(0),
  decorationSeed: z.string().max(64).default('editor'),
});
export type EditorTrack = z.infer<typeof editorTrackSchema>;

export const trackSourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('procedural'),
    seed: z.string().min(1).max(64),
    params: trackParamsSchema,
    generatorVersion: z.number().int(),
  }),
  z.object({ type: z.literal('editor'), editor: editorTrackSchema, generatorVersion: z.number().int() }),
]);
export type TrackSource = z.infer<typeof trackSourceSchema>;

export const TRACK_VERSION_STATUSES = ['draft', 'review', 'published', 'deprecated'] as const;
export type TrackVersionStatus = (typeof TRACK_VERSION_STATUSES)[number];

export interface TrackVersionDto {
  id: string;
  trackId: string;
  trackName: string;
  kind: 'procedural' | 'special';
  version: number;
  status: TrackVersionStatus;
  source: TrackSource;
  geometryHash: string;
  meta: { length: number; terrain: TrackTerrain; corners: number; sectors: number };
  createdAt: string;
  publishedAt: string | null;
}

// ---------- Eventos e corridas ----------
export const raceWeatherSchema = z.object({
  base: weatherSchema,
  rainChance: z.number().min(0).max(1),
  temperature: z.number().min(-5).max(45),
});
export type RaceWeather = z.infer<typeof raceWeatherSchema>;

export const raceCreateSchema = z.object({
  name: z.string().min(2).max(80),
  categoryId: uuid,
  eventId: uuid.nullable().optional(),
  ranked: z.boolean().default(true),
  /** Início do treino. */
  startAt: isoDate,
  registrationLeadMinutes: z
    .number()
    .int()
    .min(1)
    .max(60 * 24 * 14)
    .default(60),
  practiceMinutes: z.number().min(0).max(120).default(DEFAULT_PRACTICE_MINUTES),
  setupLockSeconds: z.number().int().min(5).max(600).default(30),
  /** Janela de traçado depois do treino (s); ausente = padrão das configurações do jogo (0 = sem janela). */
  traceWindowSeconds: z.number().int().min(0).max(900).optional(),
  qualifyingSeconds: z.number().int().min(10).max(1800).default(60),
  capacity: z.number().int().min(2).max(MAX_CARS_PER_RACE).default(MAX_CARS_PER_RACE),
  waitlistMax: z.number().int().min(0).max(50).default(10),
  laps: z.number().int().min(RACE_LAPS_MIN).max(RACE_LAPS_MAX).optional(),
  weather: raceWeatherSchema.optional(),
  /** Cenário em volta da pista (padrão: autódromo). */
  biome: biomeSchema.optional(),
  /** Pista: uma versão publicada (especial) ou geração procedural com seed. */
  track: z.discriminatedUnion('type', [
    z.object({ type: z.literal('version'), trackVersionId: uuid }),
    z.object({
      type: z.literal('procedural'),
      seed: z.string().min(1).max(64).optional(),
      params: trackParamsSchema.partial().optional(),
    }),
  ]),
});
export type RaceCreate = z.infer<typeof raceCreateSchema>;

export const raceBatchSchema = raceCreateSchema.omit({ startAt: true, name: true }).extend({
  namePrefix: z.string().min(2).max(60),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  times: z
    .array(z.string().regex(/^\d{2}:\d{2}$/))
    .min(1)
    .max(24),
  timezoneOffsetMinutes: z.number().int().min(-720).max(840).default(-180),
});
export type RaceBatch = z.infer<typeof raceBatchSchema>;

export const raceUpdateSchema = raceCreateSchema
  .pick({ name: true, ranked: true, capacity: true, waitlistMax: true, laps: true, weather: true })
  .partial()
  .extend({ startAt: isoDate.optional() });

export const eventCreateSchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(1000).default(''),
  categoryId: uuid,
  startsAt: isoDate,
  endsAt: isoDate,
  ranked: z.boolean().default(true),
  status: z.enum(['draft', 'published', 'cancelled']).default('draft'),
});
export type EventCreate = z.infer<typeof eventCreateSchema>;

/** Evento para o jogador: datas, categoria e as corridas ligadas a ele. */
export interface EventDto {
  id: string;
  name: string;
  description: string;
  startsAt: string;
  endsAt: string;
  ranked: boolean;
  category: { id: string; name: string };
  /** Corridas do evento ainda por acontecer (ou em andamento) e já encerradas. */
  upcomingRaces: number;
  finishedRaces: number;
  nextRaceAt: string | null;
}
export interface EventDetailDto extends EventDto {
  races: RaceSummaryDto[];
}

export const ENTRY_STATUSES = ['confirmed', 'waitlisted', 'cancelled', 'withdrawn', 'dnf'] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export interface CapacityDto {
  raceId: string;
  capacity: number;
  confirmed: number;
  waitlisted: number;
  waitlistMax: number;
  free: number;
}

export interface RaceSummaryDto {
  id: string;
  name: string;
  status: (typeof RACE_PHASES)[number];
  ranked: boolean;
  annulled: boolean;
  /** Corrida teste automática (curta, com bots); fica fora das listas normais. */
  test: boolean;
  category: { id: string; slug: string; name: string; level: Level };
  event: { id: string; name: string } | null;
  timeline: {
    registrationOpensAt: string;
    practiceAt: string;
    traceWindowAt: string;
    setupLockAt: string;
    qualifyingAt: string;
    raceAt: string;
    raceEndsAt: string | null;
  };
  phaseDeadline: string | null;
  laps: number;
  weather: RaceWeather;
  capacity: CapacityDto;
  track: { versionId: string; name: string; length: number; terrain: TrackTerrain; biome: Biome };
  /** Corrida de um grupo da Corrida Maluca (fechada, fora das listas públicas). */
  crazy: RaceCrazyDto | null;
}

export interface EntryDto {
  userId: string;
  nickname: string;
  country: string;
  status: EntryStatus;
  carColor: string;
  carModel: number;
  carNumber: number;
  /** Posição no grid; oculta durante a sessão de classificação para não estragar a transmissão. */
  gridSlot: number | null;
  waitlistPosition: number | null;
  createdAt: string;
  /** Preparação visível ao espectador (só se já salvou, nunca o conteúdo). */
  hasTrace: boolean;
  hasSetup: boolean;
  /** Corrida Maluca: marcou "Estou pronto". */
  ready: boolean;
  bot: boolean;
}

export interface RaceDetailDto extends RaceSummaryDto {
  entries: EntryDto[];
  me: {
    entry: EntryDto | null;
    hasTrace: boolean;
    traceSubmittedAt: string | null;
    hasSetup: boolean;
  } | null;
  forecast: { lap: number; weather: Weather }[] | null;
}

export interface QualifyingRowDto {
  position: number;
  userId: string;
  nickname: string;
  lapTimeMs: number;
  gapMs: number;
  usedDefaultSetup: boolean;
  usedDefaultTrace: boolean;
}

export interface ResultRowDto {
  position: number;
  userId: string;
  nickname: string;
  country: string;
  status: 'finished' | 'dnf';
  totalTimeMs: number | null;
  gapMs: number | null;
  bestLapMs: number | null;
  lapsCompleted: number;
  pitStops: number;
  points: number;
  fastestLap: boolean;
  carColor: string;
  carModel: number;
  carNumber: number;
}

// ---------- Rankings ----------
export const RANKING_SCOPES = ['local', 'regional', 'national', 'world'] as const;
export const rankingScopeSchema = z.enum(RANKING_SCOPES);
export type RankingScope = z.infer<typeof rankingScopeSchema>;
export const RANKING_SCOPE_LABELS: Record<RankingScope, string> = {
  local: 'Local',
  regional: 'Regional',
  national: 'Nacional',
  world: 'Mundial',
};

export const rankingQuerySchema = z.object({
  scope: rankingScopeSchema.default('world'),
  key: z.string().max(120).optional(),
  season: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export interface RankingRowDto {
  position: number;
  userId: string;
  nickname: string;
  country: string;
  region: string;
  city: string;
  level: Level;
  points: number;
  races: number;
  wins: number;
  podiums: number;
  fastestLaps: number;
}

export interface RankingPageDto {
  season: { id: string; name: string; startsAt: string; endsAt: string; status: string };
  scope: RankingScope;
  key: string;
  total: number;
  page: number;
  pageSize: number;
  rows: RankingRowDto[];
  me: RankingRowDto | null;
}

// ---------- Notificações ----------
export const NOTIFICATION_TYPES = [
  'entry_confirmed',
  'entry_waitlisted',
  'entry_promoted',
  'trace_window_open',
  'trace_window_closing',
  'qualifying_ready',
  'race_started',
  'result_published',
  'race_cancelled',
  'result_annulled',
  'level_changed',
  'track_changed',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

// ---------- Pistas do dia (admin) ----------
export interface TrackDayTrackDto {
  versionId: string;
  name: string;
  kind: 'special' | 'procedural';
  terrain: TrackTerrain;
  length: number;
  corners: number;
  /** Seed da pista gerada (null nas especiais). */
  seed: string | null;
}
/** De onde veio a pista da corrida: gerada, sorteada do rodízio de especiais ou escolhida pelo admin. */
export type TrackDaySource = 'auto' | 'pool' | 'admin';
export interface TrackDaySlotDto {
  /** Início do horário (ISO). */
  at: string;
  /** Horário da grade automática (false = corrida criada pelo admin nesse dia). */
  grid: boolean;
  category: { slug: string; name: string } | null;
  race: { id: string; name: string; status: RacePhase; confirmed: number; capacity: number } | null;
  track: TrackDayTrackDto | null;
  biome: Biome | null;
  source: TrackDaySource | null;
  /** Pista reservada para um horário que ainda não virou corrida. */
  plan: TrackDayTrackDto | null;
  /** Dá para trocar a pista (corrida antes do parque fechado ou horário futuro ainda sem corrida). */
  editable: boolean;
}
export interface TrackDayDto {
  /** Dia no horário de Brasília (AAAA-MM-DD). */
  day: string;
  slots: TrackDaySlotDto[];
  /** Pistas especiais publicadas, com quantas vezes entram no dia. */
  specials: (TrackDayTrackDto & { inPool: boolean; today: number })[];
  /** Chance de uma corrida da grade sortear uma especial do rodízio em vez de gerar. */
  poolChance: number;
  /** Até quando a grade já está criada (o resto do dia aceita reservas). */
  createdUntil: string | null;
}
/** Pista de um horário: uma especial publicada, ou null para a geração automática. */
export const trackChoiceSchema = z.object({ trackVersionId: z.string().uuid().nullable() });
