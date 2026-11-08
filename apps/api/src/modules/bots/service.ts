import { randomUUID } from 'node:crypto';
import {
  AppError,
  CAR_COLORS,
  driverProfileFor,
  LEVEL_XP,
  meetsLevel,
  type DriverProfile,
  type GameSettings,
  type Level,
} from '@tracado/shared';
import { createRng } from '@tracado/trackgen';
import { and, asc, eq, gt, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import type { Ctx } from '../../context';
import { botPersonas, botPlans, entries, profiles, races, users } from '../../db/schema';
import { hashPassword } from '../../lib/crypto';
import { prepareBots } from '../engine/bots';
import { assignCar, checkScheduleConflict, promoteNext } from '../races/entries';
import { notify } from '../notifications/service';
import { broadcastRace, capacityOf, getCategory, getRaceRow, type RaceRow } from '../races/service';
import { getSettings } from '../settings/service';

/**
 * Pilotos simulados da grade automática.
 * - Cada um tem uma persona fixa (nível, estilo, horário em que joga, vontade de correr), então o desempenho no
 *   ranking é coerente de uma corrida para outra.
 * - Por dia, entre `activeMin` e `activeMax` deles ficam ativos; um ativo só "está online" no horário dele.
 * - Na abertura das inscrições de uma corrida automática, o motor planeja quem entra e quando (`bot_plans`); a cada
 *   tick, inscreve quem chegou a hora. Assim o grid enche aos poucos, como com gente.
 * - Nunca tiram vaga de gente: deixam `reserveSeats` livres e, com o grid cheio, um deles cede a vaga.
 * - O grid de cada corrida mira entre `gridMin` e `gridMax` carros: se faltar gente online no horário, entram outros
 *   pilotos simulados, e durante o treino o motor completa o que faltar até o mínimo.
 */

type Persona = typeof botPersonas.$inferSelect;
type PoolSettings = GameSettings['botPool'];

/** Brasília (sem horário de verão desde 2019). */
const BRT_OFFSET_MS = -3 * 3_600_000;
const DAY_MS = 86_400_000;
const brtDay = (t: number) => Math.floor((t + BRT_OFFSET_MS) / DAY_MS);
const brtHour = (t: number) => new Date(t + BRT_OFFSET_MS).getUTCHours();

/** Personas a mais que o máximo ativo por dia (ou que o grid alvo), para o rodízio variar quem aparece. */
const POOL_SLACK = 10;
export const poolSize = (s: PoolSettings) => Math.max(s.activeMax, s.gridMax) + POOL_SLACK;
/** O complemento do grid começa quando falta isto para o treino (e vai até perto do parque fechado). */
const TOPUP_LEAD_MS = 10 * 60_000;
/** Até quanto tempo antes do treino eles começam a se inscrever (corridas abertas com 24 h de antecedência). */
const JOIN_LEAD_MS = 3 * 3_600_000;

/** Está no horário em que costuma jogar? `de == até` = o dia todo. */
export function isOnlineHour(p: Pick<Persona, 'hourFrom' | 'hourTo'>, t: number) {
  if (p.hourFrom === p.hourTo) return true;
  const h = brtHour(t);
  return p.hourFrom <= p.hourTo ? h >= p.hourFrom && h < p.hourTo : h >= p.hourFrom || h < p.hourTo;
}

/** Quem está ativo no dia `t`: sorteio estável por dia entre as personas ligadas. */
export function activeOn(personas: Persona[], s: PoolSettings, t: number): Set<string> {
  const day = brtDay(t);
  const on = personas.filter((p) => p.active);
  const n = Math.min(on.length, createRng(`botpool|${day}`).int(s.activeMin, s.activeMax));
  const ranked = on
    .map((p) => ({ id: p.userId, k: createRng(`botpool|${day}|${p.userId}`).next() }))
    .sort((a, b) => a.k - b.k);
  return new Set(ranked.slice(0, n).map((r) => r.id));
}

export async function loadPersonas(ctx: Pick<Ctx, 'db'>) {
  return ctx.db.select().from(botPersonas).orderBy(asc(botPersonas.createdAt), asc(botPersonas.userId));
}

/** Quantos pilotos simulados estão "online" agora (cache curto: a página inicial pede isso a cada visita). */
let onlineCache: { at: number; n: number } | null = null;
export async function onlineBotCount(ctx: Pick<Ctx, 'db' | 'config' | 'clock'>): Promise<number> {
  const s = (await getSettings(ctx)).botPool;
  if (!s.enabled || !s.countOnline) return 0;
  const now = ctx.clock.now();
  if (onlineCache && now >= onlineCache.at && now - onlineCache.at < 60_000) return onlineCache.n;
  const personas = await loadPersonas(ctx);
  const act = activeOn(personas, s, now);
  const n = personas.filter((p) => act.has(p.userId) && isOnlineHour(p, now)).length;
  onlineCache = { at: now, n };
  return n;
}
export function forgetOnlineBotCache() {
  onlineCache = null;
}

// ---------------------------------------------------------------- Criação das personas

const FIRST = [
  'Rafa',
  'Lu',
  'Gabi',
  'Dudu',
  'Nanda',
  'Leo',
  'Bia',
  'Caio',
  'Mari',
  'Juca',
  'Teo',
  'Duda',
  'Gui',
  'Lari',
  'Rodrigo',
  'Camila',
  'Thiago',
  'Fernanda',
  'Bruno',
  'Paula',
  'Vini',
  'Isa',
  'Pedro',
  'Carol',
  'Marcos',
  'Renata',
  'Felipe',
  'Aline',
  'Diogo',
  'Tati',
  'Joao',
  'Livia',
  'Igor',
  'Manu',
  'Andre',
  'Bel',
  'Henrique',
  'Jessica',
  'Otavio',
  'Clara',
  'Murilo',
  'Sofia',
  'Danilo',
  'Yasmin',
  'Fabio',
  'Lais',
  'Hugo',
  'Nina',
];
const WORDS = [
  'turbo',
  'drift',
  'apex',
  'racer',
  'speed',
  'kart',
  'box',
  'gp',
  'pole',
  'v8',
  'nitro',
  'zebra',
  'curva',
  'retao',
  'pista',
  'pneu',
  'motor',
  'volta',
  'rally',
  'slick',
];
const PLACES: [string, string, string][] = [
  ['BR', 'SP', 'São Paulo'],
  ['BR', 'SP', 'São Paulo'],
  ['BR', 'SP', 'Campinas'],
  ['BR', 'SP', 'Santos'],
  ['BR', 'SP', 'Ribeirão Preto'],
  ['BR', 'RJ', 'Rio de Janeiro'],
  ['BR', 'RJ', 'Niterói'],
  ['BR', 'MG', 'Belo Horizonte'],
  ['BR', 'MG', 'Uberlândia'],
  ['BR', 'RS', 'Porto Alegre'],
  ['BR', 'PR', 'Curitiba'],
  ['BR', 'PR', 'Londrina'],
  ['BR', 'SC', 'Florianópolis'],
  ['BR', 'SC', 'Joinville'],
  ['BR', 'BA', 'Salvador'],
  ['BR', 'PE', 'Recife'],
  ['BR', 'CE', 'Fortaleza'],
  ['BR', 'GO', 'Goiânia'],
  ['BR', 'DF', 'Brasília'],
  ['BR', 'ES', 'Vitória'],
  ['BR', 'PA', 'Belém'],
  ['BR', 'AM', 'Manaus'],
  ['PT', 'Lisboa', 'Lisboa'],
  ['PT', 'Porto', 'Porto'],
];
/** Rotinas de jogo (hora de Brasília): [de, até). */
const ROUTINES: [number, number][] = [
  [18, 24],
  [19, 1],
  [20, 2],
  [12, 19],
  [9, 14],
  [21, 3],
  [10, 23],
  [17, 23],
  [7, 12],
  [13, 22],
];

function nicknameFor(r: ReturnType<typeof createRng>) {
  const f = r.pick(FIRST);
  const w = r.pick(WORDS);
  const n = r.int(1, 99);
  const yy = r.int(85, 99);
  switch (r.int(0, 6)) {
    case 0:
      return `${f}${n}`;
    case 1:
      return `${f.toLowerCase()}_${w}`;
    case 2:
      return `${f}${w[0]!.toUpperCase()}${w.slice(1)}`;
    case 3:
      return `${w}${f}`;
    case 4:
      return `${f.toLowerCase()}${yy}`;
    case 5:
      return `${f}.${w}`;
    default:
      return `${f}_${n}`;
  }
}

export function levelFor(skill: number): Level {
  return skill > 0.8 ? 'elite' : skill > 0.6 ? 'pro' : skill > 0.35 ? 'amateur' : 'rookie';
}

/** Perfil do piloto de uma persona: o estilo puxa o ataque, a habilidade puxa o ritmo, com variação pelo id. */
export function personaDriver(userId: string, p: Pick<Persona, 'skill' | 'aggression'>): DriverProfile {
  const base = driverProfileFor(userId);
  const c = (v: number) => Math.round(Math.max(0, Math.min(100, v)));
  return {
    attack: c(base.attack * 0.4 + p.aggression * 100 * 0.6),
    defense: base.defense,
    pace: c(base.pace * 0.6 + (30 + p.skill * 40) * 0.4),
  };
}

/** Personas criadas antes do perfil do piloto ganham um (uma vez). */
async function ensurePersonaDrivers(ctx: Pick<Ctx, 'db'>) {
  const rows = await ctx.db
    .select({ id: botPersonas.userId, skill: botPersonas.skill, aggression: botPersonas.aggression })
    .from(botPersonas)
    .innerJoin(profiles, eq(profiles.userId, botPersonas.userId))
    .where(isNull(profiles.driver));
  for (const r of rows)
    await ctx.db
      .update(profiles)
      .set({ driver: personaDriver(r.id, r) })
      .where(eq(profiles.userId, r.id));
}

/** Cria personas até ter `poolSize`. Idempotente; chamado ao salvar as configurações e ao planejar. */
export async function ensureBotPool(
  ctx: Pick<Ctx, 'db' | 'config'>,
  s: PoolSettings,
  /** Cria estas a mais, além do tamanho do rodízio (botão do admin). */
  extra = 0,
): Promise<number> {
  await ensurePersonaDrivers(ctx);
  const want = poolSize(s);
  const [c] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(botPersonas);
  const missing = Math.max(0, want - (c?.n ?? 0)) + extra;
  if (missing <= 0) return 0;
  const pw = await hashPassword(`persona-${randomUUID()}-${ctx.config.JWT_SECRET}`);
  let created = 0;
  for (let i = 0; i < missing; i++) {
    const r = createRng(randomUUID());
    // Habilidade centrada no meio (soma de dois sorteios): poucos muito bons, poucos muito fracos.
    const skill = (r.next() + r.next()) / 2;
    const level = levelFor(skill);
    const [from, to] = r.pick(ROUTINES);
    const [country, region, city] = r.pick(PLACES);
    let nickname = '';
    for (let k = 0; k < 20 && !nickname; k++) {
      const nick = nicknameFor(r);
      const [taken] = await ctx.db
        .select({ id: profiles.userId })
        .from(profiles)
        .where(sql`lower(${profiles.nickname}) = lower(${nick})`);
      if (!taken) nickname = nick;
    }
    if (!nickname) continue;
    const careerRaces = r.int(level === 'rookie' ? 2 : 15, level === 'elite' ? 160 : 70);
    const aggression = r.next();
    await ctx.db.transaction(async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({
          email: `p-${randomUUID()}@pilotos.tracado.local`,
          passwordHash: pw,
          isBot: true,
          emailVerified: true,
        })
        .returning({ id: users.id });
      await tx
        .insert(profiles)
        .values({
          userId: u!.id,
          nickname,
          country,
          region,
          city,
          carColor: r.pick(CAR_COLORS),
          level,
          xp: LEVEL_XP[level] + r.int(0, 250),
          careerRaces,
          driver: personaDriver(u!.id, { skill, aggression }),
        });
      await tx
        .insert(botPersonas)
        .values({
          userId: u!.id,
          skill,
          aggression,
          pitRisk: r.next(),
          hourFrom: (from + r.int(-1, 1) + 24) % 24,
          hourTo: (to + r.int(-1, 1) + 24) % 24,
          joinRate: r.range(0.35, 0.85),
        });
    });
    created++;
  }
  return created;
}

// ---------------------------------------------------------------- Planejamento e inscrição

const OPEN_PHASES = ['registration_open', 'practice', 'trace_window'] as const;

/** Personas que podem correr numa categoria (nível e corridas mínimas), com o perfil. */
async function eligiblePersonas(ctx: Ctx, race: RaceRow) {
  const cat = await getCategory(ctx.db, race.categoryId);
  const req = cat.config.entryRequirement;
  const rows = await ctx.db
    .select({ p: botPersonas, level: profiles.level, career: profiles.careerRaces })
    .from(botPersonas)
    .innerJoin(profiles, eq(profiles.userId, botPersonas.userId))
    .where(eq(botPersonas.active, true));
  return {
    all: rows.map((r) => r.p),
    eligible: rows
      .filter((r) => meetsLevel(r.level, req.minLevel) && r.career >= req.minRaces)
      .map((r) => r.p),
  };
}

/** Confirmados na corrida mais os planos ainda por executar. */
async function gridCount(ctx: Ctx, raceId: string) {
  const [c] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(entries)
    .where(and(eq(entries.raceId, raceId), eq(entries.status, 'confirmed')));
  const [p] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(botPlans)
    .where(and(eq(botPlans.raceId, raceId), isNull(botPlans.doneAt)));
  return { confirmed: c?.n ?? 0, pending: p?.n ?? 0 };
}

/**
 * Abertura das inscrições de uma corrida automática: decide quem entra e quando. O grid mira entre `gridMin` e
 * `gridMax` carros (sorteado pela seed). Os horários ficam entre `JOIN_LEAD_MS` antes do treino e a metade do treino
 * (sem treino, até 1 minuto antes do parque fechado),
 * mais densos perto da largada. Primeiro entram os que estão online no horário e querem correr; se não bastar, os
 * outros ativos do dia; por último, os demais (como alguém que abriu o jogo só para essa corrida).
 */
export async function planBotEntries(ctx: Ctx, race: RaceRow): Promise<number> {
  const s = (await getSettings(ctx)).botPool;
  if (!s.enabled) return 0;
  // Uma vez por corrida (marca em flags): o planejamento roda na abertura e na checagem por minuto.
  const mark = await ctx.db
    .update(races)
    .set({ flags: sql`${races.flags} || '{"botsPlanned": true}'::jsonb` })
    .where(and(eq(races.id, race.id), sql`not (${races.flags} ? 'botsPlanned')`))
    .returning({ id: races.id });
  if (!mark.length) return 0;
  await ensureBotPool(ctx, s);
  const { all, eligible } = await eligiblePersonas(ctx, race);
  const now = ctx.clock.now();
  const from = Math.max(now, race.practiceAt.getTime() - JOIN_LEAD_MS);
  // Até a metade do treino; sem treino, até 1 minuto antes do parque fechado.
  const to = Math.min(
    race.practiceAt.getTime() + (race.setupLockAt.getTime() - race.practiceAt.getTime()) * 0.5,
    race.setupLockAt.getTime() - 60_000,
  );
  if (to <= from) return 0;
  const target = Math.min(
    race.capacity - s.reserveSeats,
    createRng(`${race.seed}|botplan`).int(s.gridMin, s.gridMax),
  );
  const { confirmed } = await gridCount(ctx, race.id);
  const want = target - confirmed;
  if (want <= 0) return 0;
  const today = activeOn(all, s, from);
  const candidates = eligible.map((p) => {
    const r = createRng(`${race.seed}|botplan|${p.userId}`);
    const keen = r.chance(p.joinRate);
    let joinAt: number | null = null;
    for (let k = 0; k < 3 && joinAt === null; k++) {
      // √u: mais inscrições perto do treino, como gente que decide em cima da hora.
      const t = Math.round(from + (to - from) * Math.sqrt(r.next()));
      if (isOnlineHour(p, t) && activeOn(all, s, t).has(p.userId)) joinAt = t;
    }
    const tier = joinAt !== null && keen ? 0 : joinAt !== null ? 1 : today.has(p.userId) ? 2 : 3;
    return {
      userId: p.userId,
      joinAt: joinAt ?? Math.round(from + (to - from) * Math.sqrt(r.next())),
      tier,
      k: createRng(`${race.seed}|botpick|${p.userId}`).next(),
    };
  });
  const chosen = candidates.sort((a, b) => a.tier - b.tier || a.k - b.k).slice(0, want);
  if (!chosen.length) return 0;
  await ctx.db
    .insert(botPlans)
    .values(chosen.map((c) => ({ raceId: race.id, userId: c.userId, joinAt: new Date(c.joinAt) })))
    .onConflictDoNothing();
  return chosen.length;
}

/**
 * Perto da largada, completa o grid até `gridMin` (gente que cancelou, pilotos que não conseguiram entrar, grid
 * planejado antes de o admin subir o mínimo). Os que faltam entram espalhados até perto do parque fechado.
 */
export async function topUpBotEntries(ctx: Ctx, race: RaceRow, s: PoolSettings): Promise<number> {
  const now = ctx.clock.now();
  const lockAt = race.setupLockAt.getTime() - 30_000;
  if (race.practiceAt.getTime() - now > TOPUP_LEAD_MS || lockAt - now < 15_000) return 0;
  const { confirmed, pending } = await gridCount(ctx, race.id);
  const want = Math.min(s.gridMin, race.capacity - s.reserveSeats) - confirmed - pending;
  if (want <= 0) return 0;
  const { all, eligible } = await eligiblePersonas(ctx, race);
  const planned = new Set(
    (await ctx.db.select({ u: botPlans.userId }).from(botPlans).where(eq(botPlans.raceId, race.id))).map(
      (r) => r.u,
    ),
  );
  const inRace = new Set(
    (
      await ctx.db
        .select({ u: entries.userId })
        .from(entries)
        .where(and(eq(entries.raceId, race.id), ne(entries.status, 'cancelled')))
    ).map((r) => r.u),
  );
  const today = activeOn(all, s, now);
  const r = createRng(`${race.seed}|topup|${confirmed}|${pending}`);
  const pick = eligible
    .filter((p) => !planned.has(p.userId) && !inRace.has(p.userId))
    .map((p) => ({ p, k: (isOnlineHour(p, now) && today.has(p.userId) ? 0 : 1) + r.next() }))
    .sort((a, b) => a.k - b.k)
    .slice(0, want);
  if (!pick.length) return 0;
  const until = Math.min(lockAt, now + 4 * 60_000);
  await ctx.db
    .insert(botPlans)
    .values(
      pick.map(({ p }) => ({
        raceId: race.id,
        userId: p.userId,
        joinAt: new Date(Math.round(now + (until - now) * r.next())),
      })),
    )
    .onConflictDoNothing();
  return pick.length;
}

/**
 * Checagem por minuto do motor: planeja as corridas automáticas abertas que ainda não foram planejadas (cobre o
 * recurso ligado com a grade já criada; sem isso, os primeiros pilotos simulados só viriam 24 h depois) e completa o
 * grid das que estão perto da largada.
 */
export async function planOpenAutoRaces(ctx: Ctx): Promise<number> {
  if (!(await getSettings(ctx)).botPool.enabled) return 0;
  const open = await ctx.db
    .select()
    .from(races)
    .where(
      and(
        inArray(races.status, ['registration_open', 'practice']),
        isNull(races.crazyGroupId),
        sql`${races.flags} ? 'auto'`,
        sql`not (${races.flags} ? 'autoTest')`,
        sql`not (${races.flags} ? 'botsPlanned')`,
      ),
    );
  let n = 0;
  for (const r of open) n += await planBotEntries(ctx, r);
  await dropDemoBots(ctx);
  // Complemento do grid perto da largada, nas corridas já planejadas.
  const s = (await getSettings(ctx)).botPool;
  const soon = await ctx.db
    .select()
    .from(races)
    .where(
      and(
        inArray(races.status, ['registration_open', 'practice']),
        isNull(races.crazyGroupId),
        lte(races.practiceAt, new Date(ctx.clock.now() + TOPUP_LEAD_MS)),
        sql`${races.flags} ? 'auto'`,
        sql`not (${races.flags} ? 'autoTest')`,
        sql`${races.flags} ? 'botsPlanned'`,
      ),
    );
  for (const r of soon) n += await topUpBotEntries(ctx, r, s);
  return n;
}

/**
 * Com os pilotos simulados ligados, a grade automática não tem bots de demonstração (eles levam a marca de bot e
 * entregariam o resto). Corridas abertas antes de ligar o recurso foram preenchidas com eles: saem aqui, antes do
 * parque fechado.
 */
async function dropDemoBots(ctx: Ctx): Promise<number> {
  const now = ctx.clock.now();
  const rows = await ctx.db
    .select({ id: entries.id, raceId: entries.raceId })
    .from(entries)
    .innerJoin(races, eq(races.id, entries.raceId))
    .innerJoin(users, eq(users.id, entries.userId))
    .leftJoin(botPersonas, eq(botPersonas.userId, entries.userId))
    .where(
      and(
        eq(entries.status, 'confirmed'),
        eq(users.isBot, true),
        isNull(botPersonas.userId),
        inArray(races.status, ['registration_open', 'practice']),
        gt(races.setupLockAt, new Date(now + 15_000)),
        isNull(races.crazyGroupId),
        sql`${races.flags} ? 'auto'`,
        sql`not (${races.flags} ? 'autoTest')`,
      ),
    );
  if (!rows.length) return 0;
  await ctx.db
    .update(entries)
    .set({ status: 'cancelled', updatedAt: new Date(now) })
    .where(
      inArray(
        entries.id,
        rows.map((r) => r.id),
      ),
    );
  for (const id of new Set(rows.map((r) => r.raceId))) await broadcastRace(ctx, id);
  ctx.log.info({ removed: rows.length }, 'Bots de demonstração retirados da grade automática');
  return rows.length;
}

/** Tick do motor: inscreve os pilotos simulados cuja hora chegou. */
export async function runBotPlans(ctx: Ctx): Promise<number> {
  const now = ctx.clock.now();
  const due = await ctx.db
    .select({ plan: botPlans, status: races.status })
    .from(botPlans)
    .innerJoin(races, eq(races.id, botPlans.raceId))
    .where(and(isNull(botPlans.doneAt), lte(botPlans.joinAt, new Date(now))))
    .orderBy(asc(botPlans.joinAt))
    .limit(100);
  if (!due.length) return 0;
  const s = (await getSettings(ctx)).botPool;
  let joined = 0;
  const touched = new Set<string>();
  for (const { plan, status } of due) {
    let outcome = 'skipped';
    if (s.enabled && (OPEN_PHASES as readonly string[]).includes(status)) {
      try {
        if (await joinBot(ctx, plan.raceId, plan.userId, s)) {
          outcome = 'joined';
          joined++;
          touched.add(plan.raceId);
        }
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
      }
    }
    await ctx.db
      .update(botPlans)
      .set({ doneAt: new Date(now), outcome })
      .where(and(eq(botPlans.raceId, plan.raceId), eq(botPlans.userId, plan.userId)));
  }
  // Traçado e setup já na inscrição: quem olha o grid vê o piloto "pronto", como um humano que já preparou.
  for (const id of touched) {
    await prepareBots(ctx, id);
    await broadcastRace(ctx, id);
  }
  return joined;
}

/** Inscrição de um piloto simulado, com as mesmas travas da inscrição de gente (mutex + FOR UPDATE). */
async function joinBot(ctx: Ctx, raceId: string, userId: string, s: PoolSettings): Promise<boolean> {
  return ctx.mutex.run(`race:${raceId}`, () =>
    ctx.db.transaction(async (tx) => {
      const now = ctx.clock.now();
      const race = await getRaceRow(tx, raceId, true);
      if (!(OPEN_PHASES as readonly string[]).includes(race.status)) return false;
      // Margem antes do parque fechado: dá tempo de preparar traçado e setup.
      if (now >= race.setupLockAt.getTime() - 15_000) return false;
      const [p] = await tx
        .select({ active: botPersonas.active, color: profiles.carColor })
        .from(botPersonas)
        .innerJoin(profiles, eq(profiles.userId, botPersonas.userId))
        .where(eq(botPersonas.userId, userId));
      if (!p?.active) return false;
      const [existing] = await tx
        .select()
        .from(entries)
        .where(and(eq(entries.raceId, raceId), eq(entries.userId, userId)));
      if (existing && existing.status !== 'cancelled') return false;
      const cap = await capacityOf(tx, race);
      if (cap.confirmed >= race.capacity - s.reserveSeats) return false;
      await checkScheduleConflict(tx, race, userId);
      const car = await assignCar(tx, raceId, p.color);
      const values = {
        status: 'confirmed' as const,
        ...car,
        gridSlot: null,
        confirmedAt: new Date(now),
        createdAt: new Date(now),
        updatedAt: new Date(now),
      };
      if (existing) await tx.update(entries).set(values).where(eq(entries.id, existing.id));
      else await tx.insert(entries).values({ raceId, userId, ...values });
      return true;
    }),
  );
}

/**
 * Persona desligada pelo admin: sai das corridas que ainda aceitam desistência (antes do parque fechado),
 * como alguém que cancelou, e os planos pendentes são descartados.
 */
export async function withdrawPersona(ctx: Ctx, userId: string): Promise<number> {
  const now = ctx.clock.now();
  await ctx.db
    .update(botPlans)
    .set({ doneAt: new Date(now), outcome: 'skipped' })
    .where(and(eq(botPlans.userId, userId), isNull(botPlans.doneAt)));
  const open = await ctx.db
    .select({ e: entries, r: races })
    .from(entries)
    .innerJoin(races, eq(races.id, entries.raceId))
    .where(
      and(
        eq(entries.userId, userId),
        eq(entries.status, 'confirmed'),
        inArray(races.status, [...OPEN_PHASES]),
      ),
    );
  let n = 0;
  for (const { e, r } of open) {
    if (now >= r.setupLockAt.getTime()) continue;
    const promoted = await ctx.mutex.run(`race:${r.id}`, () =>
      ctx.db.transaction(async (tx) => {
        await tx
          .update(entries)
          .set({ status: 'cancelled', updatedAt: new Date(now) })
          .where(eq(entries.id, e.id));
        return r.status === 'registration_open' ? promoteNext(tx, r.id, now) : null;
      }),
    );
    if (promoted) await notify(ctx, [promoted], 'entry_promoted', { raceId: r.id, raceName: r.name });
    await broadcastRace(ctx, r.id);
    n++;
  }
  return n;
}
