import { DEFAULT_SCORING, type CategoryConfig, type EditorTrack, type Level } from '@tracado/shared';
import { createRng } from '@tracado/trackgen';
import { eq, sql } from 'drizzle-orm';
import type { Config } from '../config';
import type { Ctx } from '../context';
import type { Clock } from '../lib/clock';
import { hashPassword } from '../lib/crypto';
import { createRace } from '../modules/races/service';
import { ensureActiveSeason } from '../modules/rankings/service';
import { changeStatus, createSpecialTrack } from '../modules/tracks/service';
import { ensureAdmin } from './bootstrap';
import type { Db } from './client';
import { categories, profiles, users } from './schema';

const base = (
  o: Partial<CategoryConfig> & Pick<CategoryConfig, 'laps' | 'entryRequirement'>,
): CategoryConfig => ({
  trackLength: { min: 1800, max: 2600 },
  trackComplexity: 0.5,
  terrains: ['asphalt'],
  weathers: ['dry', 'cloudy'],
  rainChance: 0.15,
  randomEvents: { safetyCar: true, oil: true, mechanical: true },
  setupLimits: {
    allowedTyres: ['soft', 'medium', 'hard', 'wet'],
    aero: { min: 1, max: 10 },
    allowedEngines: ['economy', 'balanced', 'power'],
    maxPitStops: 2,
  },
  scoring: DEFAULT_SCORING,
  playbackSpeed: 2,
  ...o,
});

export const SEED_CATEGORIES: {
  slug: string;
  name: string;
  level: Level;
  description: string;
  config: CategoryConfig;
}[] = [
  {
    slug: 'copa-novatos',
    name: 'Copa Novatos',
    level: 'rookie',
    description: 'Corridas curtas em asfalto para aprender a traçar e acertar o carro.',
    config: base({
      laps: 3,
      trackLength: { min: 1400, max: 2000 },
      trackComplexity: 0.3,
      rainChance: 0.1,
      randomEvents: { safetyCar: false, oil: false, mechanical: false },
      setupLimits: {
        allowedTyres: ['soft', 'medium', 'hard', 'wet'],
        aero: { min: 1, max: 10 },
        allowedEngines: ['economy', 'balanced', 'power'],
        maxPitStops: 1,
      },
      entryRequirement: { minLevel: 'rookie', minRaces: 0 },
      playbackSpeed: 2,
    }),
  },
  {
    slug: 'liga-amadora',
    name: 'Liga Amadora',
    level: 'amateur',
    description: 'Pistas maiores, terra no caminho e safety car.',
    config: base({
      laps: 5,
      trackLength: { min: 2000, max: 3000 },
      terrains: ['asphalt', 'mixed'],
      weathers: ['dry', 'cloudy', 'light_rain'],
      rainChance: 0.25,
      randomEvents: { safetyCar: true, oil: true, mechanical: false },
      scoring: { ...DEFAULT_SCORING, multiplier: 1.2 },
      entryRequirement: { minLevel: 'amateur', minRaces: 0 },
      playbackSpeed: 2,
    }),
  },
  {
    slug: 'rali-terra',
    name: 'Rali de Terra',
    level: 'amateur',
    description: 'Terra e areia: acerto de suspensão faz diferença.',
    config: base({
      laps: 4,
      trackLength: { min: 1800, max: 2600 },
      trackComplexity: 0.7,
      terrains: ['dirt', 'sand', 'mixed'],
      rainChance: 0.2,
      entryRequirement: { minLevel: 'amateur', minRaces: 0 },
      playbackSpeed: 2,
    }),
  },
  {
    slug: 'pro-series',
    name: 'Pro Series',
    level: 'pro',
    description: 'Estratégia de pneus de verdade: corridas longas e clima instável.',
    config: base({
      laps: 8,
      trackLength: { min: 2500, max: 4000 },
      trackComplexity: 0.7,
      terrains: ['asphalt', 'mixed'],
      weathers: ['dry', 'cloudy', 'light_rain', 'rain'],
      rainChance: 0.3,
      setupLimits: {
        allowedTyres: ['soft', 'medium', 'hard', 'wet'],
        aero: { min: 1, max: 10 },
        allowedEngines: ['economy', 'balanced', 'power'],
        maxPitStops: 3,
      },
      scoring: { ...DEFAULT_SCORING, multiplier: 1.5 },
      entryRequirement: { minLevel: 'pro', minRaces: 5 },
      playbackSpeed: 3,
    }),
  },
  {
    slug: 'elite-gp',
    name: 'Elite GP',
    level: 'elite',
    description: 'O topo: pistas técnicas, tudo pode acontecer.',
    config: base({
      laps: 12,
      trackLength: { min: 3000, max: 5000 },
      trackComplexity: 0.9,
      terrains: ['asphalt', 'mixed', 'dirt'],
      weathers: ['dry', 'cloudy', 'light_rain', 'rain'],
      rainChance: 0.35,
      setupLimits: {
        allowedTyres: ['soft', 'medium', 'hard', 'wet'],
        aero: { min: 1, max: 10 },
        allowedEngines: ['economy', 'balanced', 'power'],
        maxPitStops: 3,
      },
      scoring: { ...DEFAULT_SCORING, multiplier: 2 },
      entryRequirement: { minLevel: 'elite', minRaces: 10 },
      playbackSpeed: 4,
    }),
  },
];

export const SPECIAL_TRACK: EditorTrack = {
  controlPoints: [
    [0, 0],
    [300, 0],
    [500, 0],
    [560, 40],
    [560, 120],
    [480, 160],
    [380, 160],
    [330, 220],
    [360, 300],
    [300, 360],
    [120, 360],
    [40, 300],
    [60, 200],
    [-40, 120],
    [-60, 40],
  ].map(([x, y]) => ({ x: x! * 1.3, y: y! * 1.3, width: 13 })),
  terrainSegments: [{ from: 0.45, to: 0.62, terrain: 'dirt' }],
  baseTerrain: 'asphalt',
  startAt: 0.08,
  decorationSeed: 'anel-do-lago',
};

const BOT_NAMES = [
  'Faísca',
  'Turbo',
  'Zebra',
  'Vácuo',
  'Apex',
  'Chicane',
  'Box',
  'Slick',
  'Pole',
  'Grip',
  'Drift',
  'Volante',
  'Pistão',
  'Escape',
  'Nitro',
  'Cambagem',
  'Retão',
  'Curvão',
  'Pódio',
  'Largada',
  'Bandeira',
  'Radar',
  'Bólido',
  'Rally',
  'Kart',
  'Dínamo',
  'Válvula',
  'Freio',
  'Torque',
  'Trilho',
  'Garagem',
  'Pitlane',
  'Hélice',
  'Asfalto',
  'Cronos',
  'Faro',
  'Ronco',
  'Brisa',
  'Raio',
  'Cometa',
];
const PLACES: [string, string, string][] = [
  ['BR', 'SP', 'São Paulo'],
  ['BR', 'SP', 'Campinas'],
  ['BR', 'RJ', 'Rio de Janeiro'],
  ['BR', 'MG', 'Belo Horizonte'],
  ['BR', 'RS', 'Porto Alegre'],
  ['BR', 'PR', 'Curitiba'],
  ['BR', 'BA', 'Salvador'],
  ['PT', 'Lisboa', 'Lisboa'],
  ['AR', 'Buenos Aires', 'Buenos Aires'],
  ['US', 'CA', 'San Diego'],
];

export async function seedDemo(db: Db, config: Config, clock: Clock, log: (m: string) => void) {
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(categories)) as [{ n: number }];
  if (n > 0) {
    log('Seed: banco já populado, nada a fazer.');
    return false;
  }
  const adminId = await ensureAdmin(db, config);
  const pw = await hashPassword('editor12345');
  const [ed] = await db
    .insert(users)
    .values({
      email: 'editor@tracado.local',
      passwordHash: pw,
      roles: ['player', 'track_editor'],
      emailVerified: true,
    })
    .returning();
  await db
    .insert(profiles)
    .values({
      userId: ed!.id,
      nickname: 'Projetista',
      country: 'BR',
      region: 'SP',
      city: 'Interlagos',
      level: 'pro',
    });
  const cats = await db.insert(categories).values(SEED_CATEGORIES).returning();
  await ensureActiveSeason(db, clock.now());
  // Pilotos de demonstração (is_bot): só entram em corridas quando DEMO_BOTS > 0.
  const botPw = await hashPassword(`bot-${config.JWT_SECRET}`);
  const r = createRng('bots');
  for (let i = 0; i < BOT_NAMES.length; i++) {
    const [u] = await db
      .insert(users)
      .values({ email: `bot${i + 1}@tracado.local`, passwordHash: botPw, isBot: true, emailVerified: true })
      .returning();
    const [c, reg, city] = PLACES[i % PLACES.length]!;
    await db
      .insert(profiles)
      .values({
        userId: u!.id,
        nickname: `${BOT_NAMES[i]}${r.int(10, 99)}`,
        country: c,
        region: reg,
        city,
        carColor: r.pick(['red', 'blue', 'green', 'yellow', 'black']),
        level: 'elite',
        careerRaces: 50,
      });
  }
  const ctx = { db, clock } as unknown as Ctx;
  // Pista especial publicada.
  const { version } = await createSpecialTrack(ctx, 'Anel do Lago', SPECIAL_TRACK, adminId);
  await changeStatus({ ...ctx, clock } as Ctx, version.id, 'publish', adminId);
  const now = clock.now();
  const byslug = (s: string) => cats.find((c) => c.slug === s)!.id;
  // Corrida de demonstração começando logo.
  await createRace(
    ctx,
    {
      name: 'Corrida de Boas-vindas',
      categoryId: byslug('copa-novatos'),
      ranked: true,
      startAt: new Date(now + 4 * 60_000).toISOString(),
      registrationLeadMinutes: 60,
      practiceMinutes: 2,
      setupLockSeconds: 15,
      qualifyingSeconds: 30,
      capacity: 22,
      waitlistMax: 10,
      track: { type: 'procedural' },
    },
    adminId,
  );
  await createRace(
    ctx,
    {
      name: 'Desafio Anel do Lago',
      categoryId: byslug('copa-novatos'),
      ranked: false,
      startAt: new Date(now + 40 * 60_000).toISOString(),
      registrationLeadMinutes: 60,
      practiceMinutes: 5,
      setupLockSeconds: 20,
      qualifyingSeconds: 45,
      capacity: 22,
      waitlistMax: 10,
      track: { type: 'version', trackVersionId: version.id },
    },
    adminId,
  );
  // Agenda: 12h, 18h e 21h (horário de Brasília) nos próximos 3 dias.
  const day0 = Date.UTC(
    new Date(now).getUTCFullYear(),
    new Date(now).getUTCMonth(),
    new Date(now).getUTCDate(),
  );
  const slots: [string, string][] = [
    ['12:00', 'copa-novatos'],
    ['18:00', 'liga-amadora'],
    ['21:00', 'rali-terra'],
  ];
  for (let d = 0; d < 3; d++)
    for (const [t, slug] of slots) {
      const [hh, mm] = t.split(':').map(Number);
      const at = day0 + d * 86_400_000 + (hh! * 60 + mm! + 180) * 60_000;
      if (at < now + 10 * 60_000) continue;
      await createRace(
        ctx,
        {
          name: `${cats.find((c) => c.slug === slug)!.name} — ${t}`,
          categoryId: byslug(slug),
          ranked: true,
          startAt: new Date(at).toISOString(),
          registrationLeadMinutes: 6 * 60,
          practiceMinutes: 10,
          setupLockSeconds: 30,
          qualifyingSeconds: 60,
          capacity: 22,
          waitlistMax: 10,
          track: { type: 'procedural' },
        },
        adminId,
      );
    }
  void eq;
  log('Seed: categorias, temporada, 40 pilotos de demonstração, pista especial e agenda criados.');
  return true;
}
