import { randomUUID } from 'node:crypto';
import {
  AppError,
  CRAZY_AWARDS,
  CRAZY_SKIP_LOCK_MS,
  CRAZY_SKIPPABLE_PHASES,
  crazyStartAllowed,
  crazyPointsFor,
  type AuthResponse,
  type CrazyAwardKey,
  type CrazyCreateInput,
  type CrazyGroupDto,
  type CrazyGroupSummaryDto,
  type CrazyInviteDto,
  type CrazyRaceDto,
  type CrazyStandingDto,
  type Biome,
  type GuestJoinInput,
  type RaceCreate,
  type RaceSummaryDto,
} from '@tracado/shared';
import { and, asc, eq, gt, inArray, lt, notInArray, sql } from 'drizzle-orm';
import type { Ctx } from '../../context';
import {
  categories,
  crazyGroups,
  crazyMembers,
  entries,
  oneTimeTokens,
  profiles,
  raceResults,
  races,
  users,
} from '../../db/schema';
import type { AuthUser } from '../../lib/auth';
import { hashPassword, randomToken, sha256 } from '../../lib/crypto';
import { getMe, issueTokens, sendVerification } from '../auth/service';
import { autoBiome, autoTrack, phaseInput } from '../engine/autoRaces';
import { getSettings } from '../settings/service';
import { assertActive, newAccountStatus } from '../users/service';
import { assertPlayer, assignCar } from '../races/entries';
import {
  broadcastRace,
  createRace,
  getRaceRow,
  publishEntries,
  raceSummaries,
  type RaceRow,
} from '../races/service';
import { raceAwards } from './awards';

type GroupRow = typeof crazyGroups.$inferSelect;

/** Fases em que um membro novo ainda entra na corrida (até o parque fechado). */
const ENTERABLE = ['scheduled', 'registration_open', 'practice', 'trace_window'] as const;
const DONE = ['finished', 'archived', 'cancelled'];
/** Convidados criados por IP em 24 h (uma turma na mesma rede Wi-Fi precisa caber). */
const MAX_GUESTS_PER_IP_PER_DAY = 40;
const GUEST_LINK_TTL_MS = 365 * 86_400_000;

async function isGuest(ctx: Pick<Ctx, 'db'>, userId: string) {
  const [u] = await ctx.db.select({ g: users.isGuest }).from(users).where(eq(users.id, userId));
  if (!u) throw new AppError('UNAUTHORIZED');
  return u.g;
}

async function groupById(ctx: Pick<Ctx, 'db'>, id: string): Promise<GroupRow> {
  const [g] = await ctx.db.select().from(crazyGroups).where(eq(crazyGroups.id, id));
  if (!g) throw new AppError('NOT_FOUND', 'Grupo não encontrado.');
  return g;
}

async function groupByCode(ctx: Pick<Ctx, 'db'>, code: string): Promise<GroupRow> {
  const [g] = await ctx.db.select().from(crazyGroups).where(eq(crazyGroups.inviteCode, code));
  if (!g) throw new AppError('NOT_FOUND', 'Convite inválido. Confira o link com quem te chamou.');
  return g;
}

async function groupRaces(ctx: Pick<Ctx, 'db'>, groupId: string): Promise<RaceRow[]> {
  return ctx.db.select().from(races).where(eq(races.crazyGroupId, groupId)).orderBy(asc(races.crazyRound));
}

async function memberIds(ctx: Pick<Ctx, 'db'>, groupId: string): Promise<string[]> {
  return (
    await ctx.db
      .select({ u: crazyMembers.userId })
      .from(crazyMembers)
      .where(eq(crazyMembers.groupId, groupId))
  ).map((r) => r.u);
}

function statusOf(rs: RaceRow[]): CrazyGroupSummaryDto['status'] {
  if (rs.every((r) => DONE.includes(r.status))) return 'finished';
  if (rs.some((r) => !['scheduled', 'registration_open'].includes(r.status))) return 'running';
  return 'upcoming';
}

/**
 * Cria o grupo e já agenda todas as corridas, uma a cada `intervalMinutes`, com as inscrições abertas desde
 * agora. As corridas são amistosas (não ranqueadas) e ficam fora das listas públicas.
 */
export async function createGroup(ctx: Ctx, user: AuthUser, input: CrazyCreateInput) {
  assertPlayer(user);
  if (await isGuest(ctx, user.id))
    throw new AppError('FORBIDDEN', 'Crie sua conta para montar um grupo da Corrida Maluca.');
  const now = ctx.clock.now();
  const start = Date.parse(input.startAt);
  if (start < now + 60_000)
    throw new AppError('VALIDATION_ERROR', 'A primeira corrida precisa começar daqui a pelo menos 1 minuto.');
  const st = await getSettings(ctx);
  if (input.races > st.crazy.maxRaces)
    throw new AppError('VALIDATION_ERROR', `No máximo ${st.crazy.maxRaces} corridas por grupo.`);
  // Categoria: a primeira ativa do rodízio da grade automática (empresta clima e limites de setup).
  let cat: typeof categories.$inferSelect | undefined;
  for (const slug of st.autoRaces.categories) {
    if (cat) break;
    [cat] = await ctx.db
      .select()
      .from(categories)
      .where(and(eq(categories.slug, slug), eq(categories.active, true)));
  }
  if (!cat) throw new AppError('NOT_FOUND', 'Nenhuma categoria ativa para as corridas.');
  const step = input.intervalMinutes * 60_000;
  // Pistas sorteadas fora da transação (consultam o rodízio de pistas salvas).
  const trackFor: RaceCreate['track'][] = [];
  const biomeFor: Biome[] = [];
  for (let i = 0; i < input.races; i++) {
    trackFor.push(await autoTrack(ctx, st, cat));
    biomeFor.push(await autoBiome(ctx, st, trackFor[i]!));
  }
  const groupId = await ctx.db.transaction(async (tx) => {
    const [g] = await tx
      .insert(crazyGroups)
      .values({
        name: input.name,
        ownerId: user.id,
        inviteCode: randomToken(9),
        raceCount: input.races,
        laps: input.laps,
        intervalMinutes: input.intervalMinutes,
        chaos: input.chaos,
        botFill: input.botFill,
        createdAt: new Date(now),
      })
      .returning();
    await tx.insert(crazyMembers).values({ groupId: g!.id, userId: user.id, joinedAt: new Date(now) });
    for (let i = 0; i < input.races; i++) {
      const at = start + i * step;
      const row = await createRace(
        ctx,
        {
          name: input.races === 1 ? input.name : `${input.name} · Etapa ${i + 1}`,
          categoryId: cat!.id,
          ranked: false,
          startAt: new Date(at).toISOString(),
          registrationLeadMinutes: Math.ceil((at - now) / 60_000) + 1,
          ...phaseInput(st),
          capacity: 22,
          waitlistMax: 0,
          laps: input.laps,
          track: trackFor[i]!,
          biome: biomeFor[i]!,
        },
        user.id,
        tx,
      );
      await tx
        .update(races)
        .set({
          crazyGroupId: g!.id,
          crazyRound: i + 1,
          flags: { ...row.flags, crazy: true, ...(input.chaos ? { chaos: true } : {}) },
        })
        .where(eq(races.id, row.id));
    }
    return g!.id;
  });
  await enterMember(ctx, groupId, user.id);
  ctx.log.info({ groupId, races: input.races }, 'Grupo da Corrida Maluca criado');
  return getGroup(ctx, groupId, user);
}

/** Inscreve o membro em todas as corridas do grupo que ainda aceitam piloto (até o parque fechado). */
export async function enterMember(ctx: Ctx, groupId: string, userId: string) {
  const now = ctx.clock.now();
  const open = (await groupRaces(ctx, groupId)).filter(
    (r) => (ENTERABLE as readonly string[]).includes(r.status) && r.setupLockAt.getTime() > now,
  );
  const [p] = await ctx.db.select().from(profiles).where(eq(profiles.userId, userId));
  if (!p) return;
  for (const r of open) {
    const added = await ctx.mutex.run(`race:${r.id}`, () =>
      ctx.db.transaction(async (tx) => {
        const [e] = await tx
          .select()
          .from(entries)
          .where(and(eq(entries.raceId, r.id), eq(entries.userId, userId)));
        if (e?.status === 'confirmed') return false;
        const [c] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(entries)
          .where(and(eq(entries.raceId, r.id), eq(entries.status, 'confirmed')));
        if ((c?.n ?? 0) >= r.capacity) return false;
        const car = await assignCar(tx, r.id, p.carColor);
        const values = {
          status: 'confirmed' as const,
          ...car,
          gridSlot: null,
          confirmedAt: new Date(now),
          updatedAt: new Date(now),
        };
        if (e) await tx.update(entries).set(values).where(eq(entries.id, e.id));
        else await tx.insert(entries).values({ raceId: r.id, userId, createdAt: new Date(now), ...values });
        return true;
      }),
    );
    if (added) await broadcastRace(ctx, r.id);
  }
}

async function addMember(ctx: Ctx, g: GroupRow, userId: string) {
  const ids = await memberIds(ctx, g.id);
  if (ids.includes(userId)) return;
  if (ids.length >= (await getSettings(ctx)).crazy.maxMembers)
    throw new AppError('CONFLICT', 'Este grupo já está completo.');
  if (statusOf(await groupRaces(ctx, g.id)) === 'finished')
    throw new AppError('CONFLICT', 'Este campeonato já terminou.');
  await ctx.db
    .insert(crazyMembers)
    .values({ groupId: g.id, userId, joinedAt: new Date(ctx.clock.now()) })
    .onConflictDoNothing();
  await enterMember(ctx, g.id, userId);
}

/** Entrada pelo convite de quem já tem conta (ou já é convidado). */
export async function joinGroup(ctx: Ctx, user: AuthUser, inviteCode: string) {
  assertPlayer(user);
  const g = await groupByCode(ctx, inviteCode);
  await addMember(ctx, g, user.id);
  return { groupId: g.id };
}

async function suggestNickname(ctx: Pick<Ctx, 'db'>, base: string): Promise<string | null> {
  const stem = base.slice(0, 17);
  for (let i = 0; i < 8; i++) {
    const cand = `${stem}${10 + Math.floor(Math.random() * 89)}`;
    const t = await ctx.db
      .select({ id: profiles.userId })
      .from(profiles)
      .where(sql`lower(${profiles.nickname}) = lower(${cand})`);
    if (!t.length) return cand;
  }
  return null;
}

/**
 * Convidado: conta sem e-mail nem senha, criada só com apelido e cor do carro (pelo link de convite de um grupo
 * ou direto, para jogar as corridas abertas). A sessão é a mesma das contas normais (cookie de refresh); para
 * voltar em outro aparelho, o convidado gera um link pessoal (`guestLink`) ou cria a conta de verdade
 * (`upgradeGuest`).
 */
export async function createGuest(
  ctx: Ctx,
  input: GuestJoinInput,
  ip: string | null,
): Promise<AuthResponse & { refresh: string; groupId: string | null }> {
  const now = ctx.clock.now();
  // Regra de cadastros: convidado só entra com os cadastros liberados e sem lista de domínios.
  await newAccountStatus(ctx, { email: null, guest: true });
  const g = input.inviteCode ? await groupByCode(ctx, input.inviteCode) : null;
  if (g && (await memberIds(ctx, g.id)).length >= (await getSettings(ctx)).crazy.maxMembers)
    throw new AppError('CONFLICT', 'Este grupo já está completo.');
  if (ip) {
    const [c] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(users)
      .where(
        and(eq(users.signupIp, ip), eq(users.isGuest, true), gt(users.createdAt, new Date(now - 86_400_000))),
      );
    if ((c?.n ?? 0) >= MAX_GUESTS_PER_IP_PER_DAY)
      throw new AppError('RATE_LIMITED', 'Muitos convidados a partir desta rede. Tente mais tarde.');
  }
  const taken = await ctx.db
    .select({ id: profiles.userId })
    .from(profiles)
    .where(sql`lower(${profiles.nickname}) = lower(${input.nickname})`);
  if (taken.length)
    throw new AppError('NICKNAME_TAKEN', 'Esse apelido já tem dono. Tente outro.', {
      suggestion: await suggestNickname(ctx, input.nickname),
    });
  const passwordHash = await hashPassword(randomToken(32));
  const userId = await ctx.db
    .transaction(async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({
          email: `convidado-${randomUUID()}@convidado.invalid`,
          passwordHash,
          isGuest: true,
          signupIp: ip,
          createdAt: new Date(now),
        })
        .returning({ id: users.id });
      await tx
        .insert(profiles)
        .values({
          userId: u!.id,
          nickname: input.nickname,
          country: 'BR',
          region: '—',
          city: '—',
          carColor: input.carColor,
        });
      return u!.id;
    })
    .catch((e: unknown) => {
      if (String((e as Error).message).includes('profiles_nickname_uq'))
        throw new AppError('NICKNAME_TAKEN', 'Esse apelido já tem dono. Tente outro.');
      throw e;
    });
  if (g) await addMember(ctx, g, userId);
  const t = await issueTokens(ctx, { id: userId }, ip);
  return {
    accessToken: t.accessToken,
    expiresIn: 900,
    me: await getMe(ctx, userId),
    refresh: t.refresh,
    groupId: g?.id ?? null,
  };
}

/** Link pessoal de volta do convidado (substitui o anterior). Só o hash fica no banco. */
export async function guestLink(ctx: Ctx, user: AuthUser): Promise<{ url: string }> {
  if (!(await isGuest(ctx, user.id))) throw new AppError('FORBIDDEN', 'Só convidados usam link de volta.');
  const key = randomToken(32);
  await ctx.db
    .delete(oneTimeTokens)
    .where(and(eq(oneTimeTokens.userId, user.id), eq(oneTimeTokens.kind, 'guest_login')));
  await ctx.db
    .insert(oneTimeTokens)
    .values({
      userId: user.id,
      kind: 'guest_login',
      tokenHash: sha256(key),
      expiresAt: new Date(ctx.clock.now() + GUEST_LINK_TTL_MS),
    });
  return { url: `${ctx.config.PUBLIC_WEB_URL.replace(/\/$/, '')}/voltar/${key}` };
}

export async function resumeGuest(
  ctx: Ctx,
  key: string,
  ip: string | null,
): Promise<AuthResponse & { refresh: string }> {
  const [row] = await ctx.db
    .select({ t: oneTimeTokens, guest: users.isGuest, status: users.status })
    .from(oneTimeTokens)
    .innerJoin(users, eq(users.id, oneTimeTokens.userId))
    .where(and(eq(oneTimeTokens.tokenHash, sha256(key)), eq(oneTimeTokens.kind, 'guest_login')));
  if (!row || row.t.expiresAt.getTime() <= ctx.clock.now())
    throw new AppError('UNAUTHORIZED', 'Link de volta inválido ou expirado.');
  if (!row.guest) throw new AppError('UNAUTHORIZED', 'Esta conta já tem e-mail e senha. Entre com eles.');
  assertActive(row);
  await ctx.db
    .update(users)
    .set({ lastLoginAt: new Date(ctx.clock.now()) })
    .where(eq(users.id, row.t.userId));
  const t = await issueTokens(ctx, { id: row.t.userId }, ip);
  return {
    accessToken: t.accessToken,
    expiresIn: 900,
    me: await getMe(ctx, row.t.userId),
    refresh: t.refresh,
  };
}

/** Convidado vira conta normal: ganha e-mail e senha, mantém apelido, grupos e histórico. */
export async function upgradeGuest(ctx: Ctx, user: AuthUser, email: string, password: string) {
  if (!(await isGuest(ctx, user.id))) throw new AppError('CONFLICT', 'Sua conta já tem e-mail e senha.');
  const existing = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing.length) throw new AppError('EMAIL_TAKEN', 'Este e-mail já está cadastrado.');
  await ctx.db
    .update(users)
    .set({
      email,
      passwordHash: await hashPassword(password),
      hasPassword: true,
      isGuest: false,
      emailVerified: false,
    })
    .where(eq(users.id, user.id));
  await ctx.db
    .delete(oneTimeTokens)
    .where(and(eq(oneTimeTokens.userId, user.id), eq(oneTimeTokens.kind, 'guest_login')));
  await sendVerification(ctx, user.id, email);
  return getMe(ctx, user.id);
}

async function ownerNick(ctx: Pick<Ctx, 'db'>, ownerId: string) {
  const [p] = await ctx.db
    .select({ n: profiles.nickname })
    .from(profiles)
    .where(eq(profiles.userId, ownerId));
  return p?.n ?? '—';
}

/** Etapa em destaque: a que está rolando ou a próxima; com tudo encerrado, a última que correu. */
function featuredOf(rs: RaceRow[]): RaceRow | null {
  return (
    rs.find((r) => !DONE.includes(r.status)) ??
    [...rs].reverse().find((r) => r.status !== 'cancelled') ??
    rs.at(-1) ??
    null
  );
}

async function summaryOf(
  ctx: Pick<Ctx, 'db'>,
  g: GroupRow,
  rs: RaceRow[],
  members: number,
  owner: string,
  sums?: RaceSummaryDto[],
): Promise<CrazyGroupSummaryDto> {
  const next = rs.find((r) => !DONE.includes(r.status));
  const feat = featuredOf(rs);
  const featured = feat
    ? (sums?.find((x) => x.id === feat.id) ?? (await raceSummaries(ctx.db, [feat]))[0]!)
    : null;
  return {
    id: g.id,
    name: g.name,
    ownerNickname: owner,
    races: g.raceCount,
    finishedRaces: rs.filter((r) => r.status === 'finished' || r.status === 'archived').length,
    members,
    nextRaceAt: next ? next.practiceAt.toISOString() : null,
    status: statusOf(rs),
    featured,
  };
}

/** Grupos de que o usuário participa, dos que têm corrida mais perto para os encerrados. */
export async function myGroups(ctx: Ctx, user: AuthUser): Promise<CrazyGroupSummaryDto[]> {
  const gs = await ctx.db
    .select({ g: crazyGroups })
    .from(crazyMembers)
    .innerJoin(crazyGroups, eq(crazyGroups.id, crazyMembers.groupId))
    .where(eq(crazyMembers.userId, user.id));
  const out = await Promise.all(
    gs.map(async ({ g }) =>
      summaryOf(
        ctx,
        g,
        await groupRaces(ctx, g.id),
        (await memberIds(ctx, g.id)).length,
        await ownerNick(ctx, g.ownerId),
      ),
    ),
  );
  const rank = { running: 0, upcoming: 1, finished: 2 };
  return out.sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      (a.nextRaceAt ?? '').localeCompare(b.nextRaceAt ?? '') ||
      a.name.localeCompare(b.name),
  );
}

export async function invitePreview(ctx: Ctx, code: string, user: AuthUser | null): Promise<CrazyInviteDto> {
  const g = await groupByCode(ctx, code);
  const rs = await groupRaces(ctx, g.id);
  const mem = await ctx.db
    .select({ u: crazyMembers.userId, n: profiles.nickname })
    .from(crazyMembers)
    .innerJoin(profiles, eq(profiles.userId, crazyMembers.userId))
    .where(eq(crazyMembers.groupId, g.id))
    .orderBy(asc(crazyMembers.joinedAt));
  const s = await summaryOf(ctx, g, rs, mem.length, await ownerNick(ctx, g.ownerId));
  return {
    id: g.id,
    name: g.name,
    ownerNickname: s.ownerNickname,
    races: g.raceCount,
    members: mem.map((m) => m.n),
    nextRaceAt: s.nextRaceAt,
    status: s.status,
    isMember: !!user && mem.some((m) => m.u === user.id),
    full: mem.length >= (await getSettings(ctx)).crazy.maxMembers,
  };
}

/** Página do grupo: calendário, tabela do campeonato, troféus de cada corrida e títulos de honra. */
export async function getGroup(ctx: Ctx, id: string, user: AuthUser | null): Promise<CrazyGroupDto> {
  const g = await groupById(ctx, id);
  const rs = await groupRaces(ctx, g.id);
  const mem = await ctx.db
    .select({ m: crazyMembers, p: profiles, guest: users.isGuest })
    .from(crazyMembers)
    .innerJoin(profiles, eq(profiles.userId, crazyMembers.userId))
    .innerJoin(users, eq(users.id, crazyMembers.userId))
    .where(eq(crazyMembers.groupId, g.id))
    .orderBy(asc(crazyMembers.joinedAt));
  const owner = mem.find((m) => m.m.userId === g.ownerId)?.p.nickname ?? (await ownerNick(ctx, g.ownerId));
  const isMember = !!user && mem.some((m) => m.m.userId === user.id);
  const sums = await raceSummaries(ctx.db, rs);
  const finished = rs.filter((r) => r.status === 'finished' || r.status === 'archived');
  const results = finished.length
    ? await ctx.db
        .select({ r: raceResults, nick: profiles.nickname, color: profiles.carColor })
        .from(raceResults)
        .innerJoin(users, eq(users.id, raceResults.userId))
        .innerJoin(profiles, eq(profiles.userId, raceResults.userId))
        .where(
          and(
            inArray(
              raceResults.raceId,
              finished.map((r) => r.id),
            ),
            eq(users.isBot, false),
          ),
        )
        .orderBy(asc(raceResults.position))
    : [];
  const table = new Map<string, CrazyStandingDto>();
  const schedule: CrazyRaceDto[] = [];
  for (const [i, r] of rs.entries()) {
    const done = finished.includes(r);
    // Posição entre os amigos (bots não roubam pontos).
    const rows = results.filter((x) => x.r.raceId === r.id);
    const awards = done ? await raceAwards(ctx, r) : [];
    rows.forEach((x, k) => {
      const pos = k + 1;
      const s = table.get(x.r.userId) ?? {
        position: 0,
        userId: x.r.userId,
        nickname: x.nick,
        carColor: x.color,
        points: 0,
        races: 0,
        wins: 0,
        podiums: 0,
        trophies: {},
      };
      s.points += crazyPointsFor(pos);
      s.races++;
      if (pos === 1) s.wins++;
      if (pos <= 3) s.podiums++;
      table.set(x.r.userId, s);
    });
    for (const a of awards) {
      const s = table.get(a.userId);
      if (s) s.trophies[a.key] = (s.trophies[a.key] ?? 0) + 1;
    }
    schedule.push({
      round: r.crazyRound ?? i + 1,
      raceId: r.id,
      name: r.name,
      status: r.status,
      practiceAt: r.practiceAt.toISOString(),
      raceAt: r.raceAt.toISOString(),
      laps: r.laps,
      trackName: sums[i]!.track.name,
      podium: rows.slice(0, 3).map((x, k) => ({ userId: x.r.userId, nickname: x.nick, position: k + 1 })),
      awards,
      race: sums[i]!,
    });
  }
  // Quem ainda não correu aparece zerado na tabela.
  for (const m of mem)
    if (!table.has(m.m.userId))
      table.set(m.m.userId, {
        position: 0,
        userId: m.m.userId,
        nickname: m.p.nickname,
        carColor: m.p.carColor,
        points: 0,
        races: 0,
        wins: 0,
        podiums: 0,
        trophies: {},
      });
  const standings = [...table.values()]
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.wins - a.wins ||
        b.podiums - a.podiums ||
        a.nickname.localeCompare(b.nickname),
    )
    .map((s, k) => ({ ...s, position: k + 1 }));
  const summary = await summaryOf(ctx, g, rs, mem.length, owner, sums);
  const honors: CrazyGroupDto['honors'] = [];
  if (summary.status === 'finished' && rs.length > 1)
    for (const key of Object.keys(CRAZY_AWARDS) as CrazyAwardKey[]) {
      let top: CrazyStandingDto | null = null;
      for (const s of standings) if ((s.trophies[key] ?? 0) > (top?.trophies[key] ?? 0)) top = s;
      if (top) honors.push({ key, userId: top.userId, nickname: top.nickname, count: top.trophies[key]! });
    }
  return {
    ...summary,
    laps: g.laps,
    intervalMinutes: g.intervalMinutes,
    chaos: g.chaos,
    botFill: g.botFill,
    isMember,
    isOwner: !!user && user.id === g.ownerId,
    inviteCode: isMember ? g.inviteCode : null,
    memberList: mem.map((m) => ({
      userId: m.m.userId,
      nickname: m.p.nickname,
      carColor: m.p.carColor,
      guest: m.guest,
      owner: m.m.userId === g.ownerId,
      joinedAt: m.m.joinedAt.toISOString(),
    })),
    schedule,
    standings,
    honors,
  };
}

async function readyCount(ctx: Pick<Ctx, 'db'>, raceId: string) {
  const rows = await ctx.db
    .select({ ready: entries.readyAt })
    .from(entries)
    .innerJoin(users, eq(users.id, entries.userId))
    .where(and(eq(entries.raceId, raceId), eq(entries.status, 'confirmed'), eq(users.isBot, false)));
  return { humans: rows.length, ready: rows.filter((r) => r.ready).length };
}

async function crazyPrepRace(ctx: Pick<Ctx, 'db' | 'clock'>, raceId: string) {
  const race = await getRaceRow(ctx.db, raceId);
  if (!race.crazyGroupId)
    throw new AppError('FORBIDDEN', 'Só as corridas da Corrida Maluca pulam o preparo.');
  if (
    !(CRAZY_SKIPPABLE_PHASES as readonly string[]).includes(race.status) ||
    ctx.clock.now() >= race.setupLockAt.getTime() - CRAZY_SKIP_LOCK_MS
  )
    throw new AppError('INVALID_TRANSITION', 'O preparo desta corrida já acabou.');
  // Sem treino, o preparo é com as inscrições abertas: só a próxima etapa do grupo pode largar antes da hora.
  if (race.status === 'registration_open') {
    const [earlier] = await ctx.db
      .select({ id: races.id })
      .from(races)
      .where(
        and(
          eq(races.crazyGroupId, race.crazyGroupId),
          lt(races.crazyRound, race.crazyRound ?? 0),
          notInArray(races.status, ['finished', 'archived', 'cancelled']),
        ),
      )
      .limit(1);
    if (earlier) throw new AppError('INVALID_TRANSITION', 'A etapa anterior do grupo ainda não terminou.');
  }
  return race;
}

/**
 * Pula o resto do preparo (treino e janela de traçado): parque fechado já, classificação em 10 s e a largada
 * depois da sessão de classificação ao vivo (que nunca é pulada). As próximas etapas do grupo não mudam.
 * O UPDATE é condicional na fase, então dois pedidos simultâneos antecipam uma vez só.
 */
async function skipPrep(ctx: Ctx, race: RaceRow, reason: string) {
  const now = ctx.clock.now();
  const qualiMs = race.raceAt.getTime() - race.qualifyingAt.getTime();
  const qualifyingAt = now + CRAZY_SKIP_LOCK_MS;
  const upd = await ctx.db
    .update(races)
    .set({
      practiceAt: new Date(Math.min(race.practiceAt.getTime(), now)),
      traceWindowAt: new Date(Math.min(race.traceWindowAt.getTime(), now)),
      setupLockAt: new Date(now),
      qualifyingAt: new Date(qualifyingAt),
      raceAt: new Date(qualifyingAt + qualiMs),
      // Sem os avisos de "janela abriu" e "falta 1 minuto": a janela some.
      flags: { ...race.flags, prepSkipped: true, traceWarned: true },
    })
    .where(and(eq(races.id, race.id), inArray(races.status, [...CRAZY_SKIPPABLE_PHASES])))
    .returning({ id: races.id });
  if (upd.length) ctx.log.info({ raceId: race.id, reason }, 'Corrida Maluca: preparo pulado');
  return upd.length > 0;
}

/** "Estou pronto": quando todos os amigos inscritos estão prontos, a corrida pula o resto do preparo. */
export async function setReady(ctx: Ctx, raceId: string, user: AuthUser, ready: boolean) {
  const race = await crazyPrepRace(ctx, raceId);
  const upd = await ctx.db
    .update(entries)
    .set({ readyAt: ready ? new Date(ctx.clock.now()) : null })
    .where(and(eq(entries.raceId, raceId), eq(entries.userId, user.id), eq(entries.status, 'confirmed')))
    .returning({ id: entries.id });
  if (!upd.length) throw new AppError('NOT_REGISTERED', 'Você não está no grid desta corrida.');
  const count = await readyCount(ctx, raceId);
  const skipped = ready && count.ready === count.humans ? await skipPrep(ctx, race, 'todos prontos') : false;
  await publishEntries(ctx, raceId);
  return { ...count, skipped };
}

/** "Largar agora" do organizador: pula o preparo com pelo menos metade da turma pronta. */
export async function startNow(ctx: Ctx, raceId: string, user: AuthUser) {
  const race = await crazyPrepRace(ctx, raceId);
  const [g] = await ctx.db.select().from(crazyGroups).where(eq(crazyGroups.id, race.crazyGroupId!));
  if (g?.ownerId !== user.id) throw new AppError('FORBIDDEN', 'Só quem criou o grupo manda largar.');
  const count = await readyCount(ctx, raceId);
  if (!crazyStartAllowed(count.ready, count.humans))
    throw new AppError(
      'CONFLICT',
      `Espere pelo menos metade da turma ficar pronta (${count.ready}/${count.humans}).`,
    );
  const skipped = await skipPrep(ctx, race, 'organizador mandou largar');
  return { ...count, skipped };
}
