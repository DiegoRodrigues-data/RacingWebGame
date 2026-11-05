import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  CarSetup,
  CategoryConfig,
  EditorTrack,
  Biome,
  EntryStatus,
  GameSettings,
  Level,
  NotificationType,
  RacePhase,
  RaceWeather,
  RankingScope,
  Role,
  TracePoint,
  TrackSource,
  TrackTerrain,
  TrackVersionStatus,
} from '@tracado/shared';

const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => 'bytea',
  fromDriver: (v) => (Buffer.isBuffer(v) ? v : Buffer.from(v)),
});
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

// ---------------------------------------------------------------- Usuários
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    roles: jsonb('roles').$type<Role[]>().notNull().default(['player']),
    emailVerified: boolean('email_verified').notNull().default(false),
    isBot: boolean('is_bot').notNull().default(false),
    failedLogins: integer('failed_logins').notNull().default(0),
    lockedUntil: ts('locked_until'),
    signupIp: text('signup_ip'),
    flaggedForReview: boolean('flagged_for_review').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
    lastLoginAt: ts('last_login_at'),
    /** Conta Google vinculada (claim `sub`), para o login pelo Google. */
    googleSub: text('google_sub'),
    /** Convidado da Corrida Maluca: entrou pelo link só com apelido (e-mail fictício, sem senha utilizável). */
    isGuest: boolean('is_guest').notNull().default(false),
  },
  (t) => [
    uniqueIndex('users_email_uq').on(t.email),
    uniqueIndex('users_google_sub_uq').on(t.googleSub),
    index('users_signup_ip_idx').on(t.signupIp, t.createdAt),
  ],
);

export const profiles = pgTable(
  'profiles',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    nickname: text('nickname').notNull(),
    country: text('country').notNull(),
    region: text('region').notNull(),
    city: text('city').notNull(),
    carColor: text('car_color').notNull().default('red'),
    level: text('level').$type<Level>().notNull().default('rookie'),
    xp: integer('xp').notNull().default(0),
    careerRaces: integer('career_races').notNull().default(0),
    reducedMotion: boolean('reduced_motion').notNull().default(false),
    emailReminders: boolean('email_reminders').notNull().default(false),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('profiles_nickname_uq').on(sql`lower(${t.nickname})`)],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    familyId: uuid('family_id').notNull(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    replacedBy: uuid('replaced_by'),
    createdAt: ts('created_at').notNull().defaultNow(),
    ip: text('ip'),
  },
  (t) => [
    uniqueIndex('refresh_tokens_hash_uq').on(t.tokenHash),
    index('refresh_tokens_family_idx').on(t.familyId),
  ],
);

export const oneTimeTokens = pgTable(
  'one_time_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'password_reset' | 'email_verify' | 'guest_login'>().notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('ott_hash_uq').on(t.tokenHash)],
);

// ---------------------------------------------------------------- Categorias, temporadas, eventos
export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  level: text('level').$type<Level>().notNull(),
  description: text('description').notNull().default(''),
  config: jsonb('config').$type<CategoryConfig>().notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const seasons = pgTable('seasons', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  startsAt: ts('starts_at').notNull(),
  endsAt: ts('ends_at').notNull(),
  status: text('status').$type<'active' | 'closed'>().notNull().default('active'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    ranked: boolean('ranked').notNull().default(true),
    status: text('status').$type<'draft' | 'published' | 'cancelled'>().notNull().default('draft'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('events_starts_idx').on(t.startsAt)],
);

// ---------------------------------------------------------------- Pistas
export const tracks = pgTable('tracks', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  kind: text('kind').$type<'procedural' | 'special'>().notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const trackVersions = pgTable(
  'track_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    trackId: uuid('track_id')
      .notNull()
      .references(() => tracks.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    status: text('status').$type<TrackVersionStatus>().notNull().default('draft'),
    source: jsonb('source').$type<TrackSource>().notNull(),
    geometryHash: text('geometry_hash').notNull(),
    length: real('length').notNull(),
    terrain: text('terrain').$type<TrackTerrain>().notNull(),
    corners: integer('corners').notNull(),
    issues: jsonb('issues').$type<{ code: string; message: string }[]>().notNull().default([]),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
    publishedAt: ts('published_at'),
    publishedBy: uuid('published_by').references(() => users.id),
  },
  (t) => [uniqueIndex('track_versions_track_version_uq').on(t.trackId, t.version)],
);

// ---------------------------------------------------------------- Corridas
export const races = pgTable(
  'races',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    eventId: uuid('event_id').references(() => events.id),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id),
    trackVersionId: uuid('track_version_id')
      .notNull()
      .references(() => trackVersions.id),
    status: text('status').$type<RacePhase>().notNull().default('scheduled'),
    ranked: boolean('ranked').notNull().default(true),
    annulled: boolean('annulled').notNull().default(false),
    capacity: integer('capacity').notNull().default(22),
    waitlistMax: integer('waitlist_max').notNull().default(10),
    laps: integer('laps').notNull(),
    weather: jsonb('weather').$type<RaceWeather>().notNull(),
    seed: text('seed').notNull(),
    registrationOpensAt: ts('registration_opens_at').notNull(),
    practiceAt: ts('practice_at').notNull(),
    traceWindowAt: ts('trace_window_at').notNull(),
    setupLockAt: ts('setup_lock_at').notNull(),
    qualifyingAt: ts('qualifying_at').notNull(),
    raceAt: ts('race_at').notNull(),
    raceEndsAt: ts('race_ends_at'),
    statusChangedAt: ts('status_changed_at').notNull().defaultNow(),
    flags: jsonb('flags').$type<Record<string, boolean>>().notNull().default({}),
    cancelReason: text('cancel_reason'),
    seasonId: uuid('season_id').references(() => seasons.id),
    /** Cenário em volta da pista (só visual). */
    biome: text('biome').$type<Biome>().notNull().default('grass'),
    /** Corrida de um grupo da Corrida Maluca (etapa `crazyRound`). */
    crazyGroupId: uuid('crazy_group_id').references(() => crazyGroups.id, { onDelete: 'cascade' }),
    crazyRound: integer('crazy_round'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('races_status_idx').on(t.status),
    index('races_crazy_idx').on(t.crazyGroupId),
    index('races_practice_idx').on(t.practiceAt),
    index('races_category_idx').on(t.categoryId, t.practiceAt),
  ],
);

export const entries = pgTable(
  'entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    raceId: uuid('race_id')
      .notNull()
      .references(() => races.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    status: text('status').$type<EntryStatus>().notNull(),
    carColor: text('car_color').notNull(),
    carModel: integer('car_model').notNull(),
    carNumber: integer('car_number').notNull(),
    gridSlot: integer('grid_slot'),
    createdAt: ts('created_at').notNull().defaultNow(),
    confirmedAt: ts('confirmed_at'),
    /** Corrida Maluca: o piloto marcou "Estou pronto" (todos prontos pulam o resto do preparo). */
    readyAt: ts('ready_at'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('entries_race_user_uq').on(t.raceId, t.userId),
    index('entries_race_status_idx').on(t.raceId, t.status),
    index('entries_user_idx').on(t.userId, t.status),
  ],
);

export const traces = pgTable(
  'traces',
  {
    raceId: uuid('race_id')
      .notNull()
      .references(() => races.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    points: jsonb('points').$type<TracePoint[]>().notNull(),
    version: integer('version').notNull().default(1),
    submittedAt: ts('submitted_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.raceId, t.userId] })],
);

export const setups = pgTable(
  'setups',
  {
    raceId: uuid('race_id')
      .notNull()
      .references(() => races.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    setup: jsonb('setup').$type<CarSetup>().notNull(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.raceId, t.userId] })],
);

export const qualifyingResults = pgTable(
  'qualifying_results',
  {
    raceId: uuid('race_id')
      .notNull()
      .references(() => races.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    position: integer('position').notNull(),
    lapTimeMs: integer('lap_time_ms').notNull(),
    usedDefaultSetup: boolean('used_default_setup').notNull(),
    usedDefaultTrace: boolean('used_default_trace').notNull(),
  },
  (t) => [primaryKey({ columns: [t.raceId, t.userId] })],
);

export const raceReplays = pgTable('race_replays', {
  raceId: uuid('race_id')
    .primaryKey()
    .references(() => races.id, { onDelete: 'cascade' }),
  simVersion: integer('sim_version').notNull(),
  inputHash: text('input_hash').notNull(),
  resultHash: text('result_hash').notNull(),
  trackHash: text('track_hash').notNull(),
  durationMs: integer('duration_ms').notNull(),
  frameHz: integer('frame_hz').notNull(),
  playbackSpeed: real('playback_speed').notNull(),
  frames: bytea('frames').notNull(),
  incidents: jsonb('incidents').notNull(),
  weatherByLap: jsonb('weather_by_lap').notNull(),
  cars: jsonb('cars').notNull(),
  simResults: jsonb('sim_results').notNull(),
  /** Entradas exatas da simulação (setups/traçados/ordem do grid) para reprocessamento e auditoria. */
  simInput: jsonb('sim_input').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const raceResults = pgTable(
  'race_results',
  {
    raceId: uuid('race_id')
      .notNull()
      .references(() => races.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    seasonId: uuid('season_id').references(() => seasons.id),
    position: integer('position').notNull(),
    status: text('status').$type<'finished' | 'dnf'>().notNull(),
    totalTimeMs: integer('total_time_ms'),
    bestLapMs: integer('best_lap_ms'),
    lapsCompleted: integer('laps_completed').notNull(),
    pitStops: integer('pit_stops').notNull(),
    points: integer('points').notNull().default(0),
    fastestLap: boolean('fastest_lap').notNull().default(false),
    ranked: boolean('ranked').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.raceId, t.userId] }),
    index('race_results_user_idx').on(t.userId, t.createdAt),
    index('race_results_season_idx').on(t.seasonId),
  ],
);

// ---------------------------------------------------------------- Rankings
export const seasonMemberships = pgTable(
  'season_memberships',
  {
    seasonId: uuid('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    country: text('country').notNull(),
    region: text('region').notNull(),
    city: text('city').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.seasonId, t.userId] })],
);

export const rankingEntries = pgTable(
  'ranking_entries',
  {
    seasonId: uuid('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'cascade' }),
    scope: text('scope').$type<RankingScope>().notNull(),
    scopeKey: text('scope_key').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    points: integer('points').notNull().default(0),
    races: integer('races').notNull().default(0),
    wins: integer('wins').notNull().default(0),
    podiums: integer('podiums').notNull().default(0),
    fastestLaps: integer('fastest_laps').notNull().default(0),
    joinedAt: ts('joined_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.seasonId, t.scope, t.scopeKey, t.userId] }),
    index('ranking_order_idx').on(t.seasonId, t.scope, t.scopeKey, t.points, t.wins, t.podiums),
  ],
);

// ---------------------------------------------------------------- Notificações e auditoria
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').$type<NotificationType>().notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    readAt: ts('read_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)],
);

export const adminAuditLog = pgTable(
  'admin_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => users.id),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    diff: jsonb('diff').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('audit_created_idx').on(t.createdAt)],
);

// ---------------------------------------------------------------- Corrida Maluca
export const crazyGroups = pgTable(
  'crazy_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    inviteCode: text('invite_code').notNull(),
    raceCount: integer('race_count').notNull(),
    laps: integer('laps').notNull(),
    intervalMinutes: integer('interval_minutes').notNull(),
    chaos: boolean('chaos').notNull().default(true),
    /** 0 = sem bots; N = completa o grid com bots até N carros. */
    botFill: integer('bot_fill').notNull().default(0),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('crazy_groups_invite_uq').on(t.inviteCode),
    index('crazy_groups_owner_idx').on(t.ownerId),
  ],
);

export const crazyMembers = pgTable(
  'crazy_members',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => crazyGroups.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    joinedAt: ts('joined_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] }), index('crazy_members_user_idx').on(t.userId)],
);

// ---------------------------------------------------------------- Configurações do jogo (admin)
export const gameSettings = pgTable('game_settings', {
  id: text('id').primaryKey(),
  value: jsonb('value').$type<GameSettings>().notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id),
});

export type EditorTrackJson = EditorTrack;
