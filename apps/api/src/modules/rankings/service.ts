import {
  AppError,
  LEVEL_XP,
  nextLevel,
  prevLevel,
  type Level,
  type RankingPageDto,
  type RankingRowDto,
  type RankingScope,
  type Scoring,
} from '@tracado/shared';
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { Ctx } from '../../context';
import type { Db, Tx } from '../../db/client';
import {
  profiles,
  raceResults,
  races,
  rankingEntries,
  seasonMemberships,
  seasons,
  users,
} from '../../db/schema';
import { getSettings } from '../settings/service';
import { notify } from '../notifications/service';

type SeasonRow = typeof seasons.$inferSelect;

export const normalizeKey = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, '-');

export function scopeKeys(m: {
  country: string;
  region: string;
  city: string;
}): { scope: RankingScope; key: string }[] {
  const c = m.country.toUpperCase();
  return [
    { scope: 'world', key: 'world' },
    { scope: 'national', key: c },
    { scope: 'regional', key: `${c}-${normalizeKey(m.region)}` },
    { scope: 'local', key: `${c}-${normalizeKey(m.region)}-${normalizeKey(m.city)}` },
  ];
}

/** Pontos de uma posição: tabela da categoria + bônus de volta mais rápida (só para quem terminou), × multiplicador. */
export function computePoints(
  scoring: Scoring,
  position: number,
  finished: boolean,
  fastestLap: boolean,
): number {
  if (!finished) return 0;
  const base = scoring.points[position - 1] ?? 0;
  return Math.round((base + (fastestLap ? scoring.fastestLapBonus : 0)) * scoring.multiplier);
}

function quarterOf(at: number) {
  const d = new Date(at);
  const q = Math.floor(d.getUTCMonth() / 3);
  return {
    name: `Temporada ${d.getUTCFullYear()} · T${q + 1}`,
    startsAt: new Date(Date.UTC(d.getUTCFullYear(), q * 3, 1)),
    endsAt: new Date(Date.UTC(d.getUTCFullYear(), q * 3 + 3, 1) - 1),
  };
}

/** Temporada ativa que cobre o instante; cria a do trimestre se não existir. */
export async function ensureActiveSeason(db: Db | Tx, at: number): Promise<SeasonRow> {
  const [s] = await db
    .select()
    .from(seasons)
    .where(
      and(
        eq(seasons.status, 'active'),
        lte(seasons.startsAt, new Date(at)),
        gte(seasons.endsAt, new Date(at)),
      ),
    )
    .orderBy(desc(seasons.startsAt))
    .limit(1);
  if (s) return s;
  const q = quarterOf(at);
  const [created] = await db
    .insert(seasons)
    .values({ ...q, status: 'active' })
    .returning();
  return created!;
}

export async function currentSeason(db: Db | Tx, at: number): Promise<SeasonRow | null> {
  const [s] = await db
    .select()
    .from(seasons)
    .where(and(lte(seasons.startsAt, new Date(at)), gte(seasons.endsAt, new Date(at))))
    .orderBy(desc(seasons.startsAt))
    .limit(1);
  return s ?? (await db.select().from(seasons).orderBy(desc(seasons.startsAt)).limit(1))[0] ?? null;
}

export interface ScoredResult {
  userId: string;
  position: number;
  finished: boolean;
  points: number;
  fastestLap: boolean;
}

/** Aplica um resultado ranqueado aos 4 escopos. O vínculo regional é congelado no primeiro resultado da temporada. */
export async function applyResults(tx: Tx, seasonId: string, rows: ScoredResult[], at: Date) {
  for (const r of rows) {
    const [p] = await tx.select().from(profiles).where(eq(profiles.userId, r.userId));
    if (!p) continue;
    await tx
      .insert(seasonMemberships)
      .values({
        seasonId,
        userId: r.userId,
        country: p.country,
        region: p.region,
        city: p.city,
        createdAt: at,
      })
      .onConflictDoNothing();
    const [m] = await tx
      .select()
      .from(seasonMemberships)
      .where(and(eq(seasonMemberships.seasonId, seasonId), eq(seasonMemberships.userId, r.userId)));
    for (const k of scopeKeys(m!)) {
      const inc = {
        points: r.points,
        races: 1,
        wins: r.finished && r.position === 1 ? 1 : 0,
        podiums: r.finished && r.position <= 3 ? 1 : 0,
        fastestLaps: r.fastestLap ? 1 : 0,
      };
      await tx
        .insert(rankingEntries)
        .values({
          seasonId,
          scope: k.scope,
          scopeKey: k.key,
          userId: r.userId,
          ...inc,
          joinedAt: m!.createdAt,
          updatedAt: at,
        })
        .onConflictDoUpdate({
          target: [
            rankingEntries.seasonId,
            rankingEntries.scope,
            rankingEntries.scopeKey,
            rankingEntries.userId,
          ],
          set: {
            points: sql`${rankingEntries.points} + ${inc.points}`,
            races: sql`${rankingEntries.races} + 1`,
            wins: sql`${rankingEntries.wins} + ${inc.wins}`,
            podiums: sql`${rankingEntries.podiums} + ${inc.podiums}`,
            fastestLaps: sql`${rankingEntries.fastestLaps} + ${inc.fastestLaps}`,
            updatedAt: at,
          },
        });
    }
  }
}

/** Recalcula a temporada a partir dos resultados persistidos (idempotente; usado em anulações e auditoria). */
export async function rebuildSeason(ctx: Ctx, seasonId: string) {
  await ctx.db.transaction(async (tx) => {
    await tx.delete(rankingEntries).where(eq(rankingEntries.seasonId, seasonId));
    const rows = await tx
      .select({ r: raceResults, finishedAt: races.raceEndsAt })
      .from(raceResults)
      .innerJoin(races, eq(races.id, raceResults.raceId))
      .where(
        and(
          eq(raceResults.seasonId, seasonId),
          eq(races.ranked, true),
          eq(races.annulled, false),
          eq(raceResults.ranked, true),
        ),
      )
      .orderBy(asc(races.raceEndsAt));
    for (const { r, finishedAt } of rows)
      await applyResults(
        tx,
        seasonId,
        [
          {
            userId: r.userId,
            position: r.position,
            finished: r.status === 'finished',
            points: r.points,
            fastestLap: r.fastestLap,
          },
        ],
        finishedAt ?? new Date(),
      );
  });
  await bumpRankingCache(ctx);
}

export async function bumpRankingCache(ctx: Ctx) {
  await ctx.store.incr('ranking:ver');
}

/** Ordem: pontos, vitórias, pódios, voltas mais rápidas, menos corridas, quem entrou primeiro na temporada. */
const ORDER = [
  desc(rankingEntries.points),
  desc(rankingEntries.wins),
  desc(rankingEntries.podiums),
  desc(rankingEntries.fastestLaps),
  asc(rankingEntries.races),
  asc(rankingEntries.joinedAt),
  asc(rankingEntries.userId),
];

export async function getRanking(
  ctx: Ctx,
  q: { scope: RankingScope; key?: string; season?: string; page: number; pageSize: number },
  userId: string | null,
): Promise<RankingPageDto> {
  const season = q.season
    ? (await ctx.db.select().from(seasons).where(eq(seasons.id, q.season)))[0]
    : ((await currentSeason(ctx.db, ctx.clock.now())) ?? (await ensureActiveSeason(ctx.db, ctx.clock.now())));
  if (!season) throw new AppError('NOT_FOUND', 'Nenhuma temporada encontrada.');
  let key = q.key ?? 'world';
  if (q.scope !== 'world' && !q.key) {
    if (!userId) throw new AppError('VALIDATION_ERROR', 'Informe a chave do escopo (país/região/cidade).');
    const [m] = await ctx.db
      .select()
      .from(seasonMemberships)
      .where(and(eq(seasonMemberships.seasonId, season.id), eq(seasonMemberships.userId, userId)));
    const [p] = m ? [m] : await ctx.db.select().from(profiles).where(eq(profiles.userId, userId));
    if (!p) throw new AppError('NOT_FOUND');
    key = scopeKeys(p).find((k) => k.scope === q.scope)!.key;
  }
  if (q.scope === 'world') key = 'world';
  // Configurações do jogo → pilotos simulados: com `inRanking` desligado, o ranking mostra só gente.
  const withBots = (await getSettings(ctx)).botPool.inRanking;
  const ver = (await ctx.store.get('ranking:ver')) ?? '0';
  const cacheKey = `ranking:${ver}:${withBots ? 'b' : 'h'}:${season.id}:${q.scope}:${key}:${q.page}:${q.pageSize}`;
  let base: Omit<RankingPageDto, 'me'> | null = null;
  const cached = await ctx.store.get(cacheKey);
  if (cached) base = JSON.parse(cached) as Omit<RankingPageDto, 'me'>;
  const minRaces = ctx.config.RANKING_MIN_RACES;
  const where = and(
    eq(rankingEntries.seasonId, season.id),
    eq(rankingEntries.scope, q.scope),
    eq(rankingEntries.scopeKey, key),
    gte(rankingEntries.races, minRaces),
    withBots
      ? undefined
      : sql`not exists (select 1 from ${users} where ${users.id} = ${rankingEntries.userId} and ${users.isBot})`,
  );
  const toRow = (
    r: { e: typeof rankingEntries.$inferSelect; p: typeof profiles.$inferSelect },
    position: number,
  ): RankingRowDto => ({
    position,
    userId: r.e.userId,
    nickname: r.p.nickname,
    country: r.p.country,
    region: r.p.region,
    city: r.p.city,
    level: r.p.level,
    points: r.e.points,
    races: r.e.races,
    wins: r.e.wins,
    podiums: r.e.podiums,
    fastestLaps: r.e.fastestLaps,
  });
  if (!base) {
    const [tot] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(rankingEntries)
      .where(where);
    const rows = await ctx.db
      .select({ e: rankingEntries, p: profiles })
      .from(rankingEntries)
      .innerJoin(profiles, eq(profiles.userId, rankingEntries.userId))
      .where(where)
      .orderBy(...ORDER)
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    base = {
      season: {
        id: season.id,
        name: season.name,
        startsAt: season.startsAt.toISOString(),
        endsAt: season.endsAt.toISOString(),
        status: season.status,
      },
      scope: q.scope,
      key,
      total: tot?.n ?? 0,
      page: q.page,
      pageSize: q.pageSize,
      rows: rows.map((r, i) => toRow(r, (q.page - 1) * q.pageSize + i + 1)),
    };
    await ctx.store.set(cacheKey, JSON.stringify(base), 30_000);
  }
  let me: RankingRowDto | null = null;
  if (userId) {
    const all = await ctx.db
      .select({ e: rankingEntries, p: profiles })
      .from(rankingEntries)
      .innerJoin(profiles, eq(profiles.userId, rankingEntries.userId))
      .where(where)
      .orderBy(...ORDER);
    const idx = all.findIndex((r) => r.e.userId === userId);
    if (idx >= 0) me = toRow(all[idx]!, idx + 1);
  }
  return { ...base, me };
}

/**
 * Fecha a temporada: promove quem atingiu o XP do próximo nível e disputou ≥ 3 corridas;
 * rebaixa os 10% de pior pontuação do nível (com ≥ 3 corridas), sem descer abaixo de Novato.
 */
export async function closeSeason(ctx: Ctx, seasonId: string) {
  const changes: { userId: string; from: Level; to: Level }[] = [];
  await ctx.db.transaction(async (tx) => {
    const [s] = await tx.select().from(seasons).where(eq(seasons.id, seasonId)).for('update');
    if (!s) throw new AppError('NOT_FOUND');
    if (s.status === 'closed') throw new AppError('CONFLICT', 'Temporada já encerrada.');
    const rows = await tx
      .select({ e: rankingEntries, p: profiles })
      .from(rankingEntries)
      .innerJoin(profiles, eq(profiles.userId, rankingEntries.userId))
      .where(and(eq(rankingEntries.seasonId, seasonId), eq(rankingEntries.scope, 'world')));
    const byLevel = new Map<Level, typeof rows>();
    for (const r of rows) byLevel.set(r.p.level, [...(byLevel.get(r.p.level) ?? []), r]);
    for (const [level, list] of byLevel) {
      const active = list.filter((r) => r.e.races >= 3).sort((a, b) => a.e.points - b.e.points);
      const demoteCount = Math.floor(active.length * 0.1);
      const demote = new Set(active.slice(0, demoteCount).map((r) => r.e.userId));
      for (const r of active) {
        const up = nextLevel(level);
        const down = prevLevel(level);
        if (up && r.p.xp >= LEVEL_XP[up]) changes.push({ userId: r.e.userId, from: level, to: up });
        else if (down && demote.has(r.e.userId)) changes.push({ userId: r.e.userId, from: level, to: down });
      }
    }
    for (const c of changes)
      await tx.update(profiles).set({ level: c.to }).where(eq(profiles.userId, c.userId));
    await tx.update(seasons).set({ status: 'closed' }).where(eq(seasons.id, seasonId));
  });
  for (const c of changes) await notify(ctx, [c.userId], 'level_changed', { level: c.to, from: c.from });
  await bumpRankingCache(ctx);
  return changes;
}
