import { AppError, driverProfileFor, driverProfileSchema } from '@tracado/shared';
import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../../context';
import { botPersonas, botPlans, entries, profiles, raceResults, rankingEntries } from '../../db/schema';
import { requireRole } from '../../lib/auth';
import { parse } from '../../lib/validate';
import { audit } from '../admin/routes';
import { currentSeason } from '../rankings/service';
import { getSettings } from '../settings/service';
import {
  activeOn,
  ensureBotPool,
  forgetOnlineBotCache,
  isOnlineHour,
  levelFor,
  loadPersonas,
  poolSize,
  withdrawPersona,
} from './service';

const patchSchema = z
  .object({
    active: z.boolean(),
    skill: z.number().min(0).max(1),
    aggression: z.number().min(0).max(1),
    pitRisk: z.number().min(0).max(1),
    joinRate: z.number().min(0).max(1),
    hourFrom: z.number().int().min(0).max(23),
    hourTo: z.number().int().min(0).max(23),
    /** Perfil do piloto (ataque, defesa, ritmo), o mesmo que o jogador edita no perfil dele. */
    driver: driverProfileSchema,
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Nada para alterar.');

/**
 * Administração dos pilotos simulados: lista com estado de hoje e ranking, edição de cada um (persona e perfil do
 * piloto) e criação de mais personas.
 */
export function botRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/admin/bots', async (req) => {
    requireRole(req, 'admin');
    const s = (await getSettings(ctx)).botPool;
    const now = ctx.clock.now();
    const personas = await loadPersonas(ctx);
    const ids = personas.map((p) => p.userId);
    const act = activeOn(personas, s, now);
    const season = await currentSeason(ctx.db, now);
    const [profs, results, ranks, pending, upcoming] = ids.length
      ? await Promise.all([
          ctx.db.select().from(profiles).where(inArray(profiles.userId, ids)),
          ctx.db
            .select({
              userId: raceResults.userId,
              races: sql<number>`count(*)::int`,
              wins: sql<number>`count(*) filter (where ${raceResults.position} = 1 and ${raceResults.status} = 'finished')::int`,
              avgPos: sql<number>`avg(${raceResults.position})::float`,
            })
            .from(raceResults)
            .where(inArray(raceResults.userId, ids))
            .groupBy(raceResults.userId),
          season
            ? ctx.db
                .select({ userId: rankingEntries.userId, points: rankingEntries.points })
                .from(rankingEntries)
                .where(
                  and(
                    eq(rankingEntries.seasonId, season.id),
                    eq(rankingEntries.scope, 'world'),
                    inArray(rankingEntries.userId, ids),
                  ),
                )
            : Promise.resolve([]),
          ctx.db
            .select({ n: sql<number>`count(*)::int` })
            .from(botPlans)
            .where(isNull(botPlans.doneAt)),
          ctx.db
            .select({ userId: entries.userId, n: sql<number>`count(*)::int` })
            .from(entries)
            .innerJoin(botPersonas, eq(botPersonas.userId, entries.userId))
            .where(and(eq(entries.status, 'confirmed'), gte(entries.createdAt, new Date(now - 86_400_000))))
            .groupBy(entries.userId),
        ])
      : [[], [], [], [{ n: 0 }], []];
    const prof = new Map(profs.map((p) => [p.userId, p]));
    const res = new Map(results.map((r) => [r.userId, r]));
    const pts = new Map(ranks.map((r) => [r.userId, r.points]));
    const day = new Map(upcoming.map((r) => [r.userId, r.n]));
    const rows = personas.map((p) => {
      const pr = prof.get(p.userId);
      const r = res.get(p.userId);
      return {
        userId: p.userId,
        nickname: pr?.nickname ?? '?',
        city: pr ? `${pr.city}/${pr.region}` : '',
        level: pr?.level ?? 'rookie',
        active: p.active,
        activeToday: act.has(p.userId),
        onlineNow: act.has(p.userId) && isOnlineHour(p, now),
        skill: p.skill,
        driver: pr?.driver ?? driverProfileFor(p.userId),
        aggression: p.aggression,
        pitRisk: p.pitRisk,
        joinRate: p.joinRate,
        hourFrom: p.hourFrom,
        hourTo: p.hourTo,
        races: r?.races ?? 0,
        wins: r?.wins ?? 0,
        avgPosition: r?.avgPos ?? null,
        seasonPoints: pts.get(p.userId) ?? 0,
        entries24h: day.get(p.userId) ?? 0,
      };
    });
    return {
      settings: s,
      summary: {
        total: personas.length,
        enabled: personas.filter((p) => p.active).length,
        activeToday: act.size,
        onlineNow: rows.filter((r) => r.onlineNow).length,
        pendingPlans: pending[0]?.n ?? 0,
        poolSize: poolSize(s),
      },
      bots: rows.sort((a, b) => b.seasonPoints - a.seasonPoints || b.skill - a.skill),
    };
  });

  app.patch('/admin/bots/:id', async (req) => {
    const u = requireRole(req, 'admin');
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const { driver, ...b } = parse(patchSchema, req.body);
    const [before] = await ctx.db.select().from(botPersonas).where(eq(botPersonas.userId, id));
    if (!before) throw new AppError('NOT_FOUND', 'Piloto simulado não encontrado.');
    const [after] = Object.keys(b).length
      ? await ctx.db.update(botPersonas).set(b).where(eq(botPersonas.userId, id)).returning()
      : [before];
    // O nível exibido acompanha a habilidade; o perfil do piloto vale a partir das próximas corridas.
    const prof = {
      ...(b.skill !== undefined ? { level: levelFor(b.skill) } : {}),
      ...(driver ? { driver } : {}),
    };
    if (Object.keys(prof).length) await ctx.db.update(profiles).set(prof).where(eq(profiles.userId, id));
    const left = before.active && b.active === false ? await withdrawPersona(ctx, id) : 0;
    forgetOnlineBotCache();
    await audit(ctx, u, 'bot.update', 'user', id, { before, after, driver, leftRaces: left });
    return { ok: true, leftRaces: left };
  });

  /** Mais personas além do rodízio (gente nova "chegando"). */
  app.post('/admin/bots', async (req) => {
    const u = requireRole(req, 'admin');
    const { count } = parse(z.object({ count: z.number().int().min(1).max(30) }), req.body);
    const created = await ensureBotPool(ctx, (await getSettings(ctx)).botPool, count);
    forgetOnlineBotCache();
    await audit(ctx, u, 'bot.create', 'user', null, { count, created });
    return { created };
  });
}
