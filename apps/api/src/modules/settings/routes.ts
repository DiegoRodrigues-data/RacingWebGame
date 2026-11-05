import { AppError, gameSettingsSchema, trackParamsSchema } from '@tracado/shared';
import { TrackGenerationError } from '@tracado/trackgen';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../../context';
import { categories, tracks, trackVersions } from '../../db/schema';
import { requireRole } from '../../lib/auth';
import { parse } from '../../lib/validate';
import { audit } from '../admin/routes';
import type { PhaseEngine } from '../engine/engine';
import { saveProceduralTrack } from '../tracks/service';
import { getSettings, publicSettings, saveSettings, settingsFromConfig } from './service';

async function poolTracks(ctx: Ctx, ids: string[]) {
  if (!ids.length) return [];
  const rows = await ctx.db
    .select({ v: trackVersions, t: tracks })
    .from(trackVersions)
    .innerJoin(tracks, eq(tracks.id, trackVersions.trackId))
    .where(inArray(trackVersions.id, ids));
  return rows.map(({ v, t }) => ({
    versionId: v.id,
    name: t.name,
    length: v.length,
    terrain: v.terrain,
    corners: v.corners,
    status: v.status,
  }));
}

/** Configurações do jogo: leitura pública do que o navegador precisa; edição só para admin. */
export function settingsRoutes(app: FastifyInstance, ctx: Ctx, engine: PhaseEngine) {
  app.get('/settings', async () => publicSettings(await getSettings(ctx)));

  app.get('/admin/settings', async (req) => {
    requireRole(req, 'admin');
    const settings = await getSettings(ctx);
    const cats = await ctx.db.select().from(categories);
    return {
      settings,
      defaults: settingsFromConfig(ctx.config),
      categories: cats.map((c) => ({
        slug: c.slug,
        name: c.name,
        active: c.active,
        laps: c.config.laps,
        terrains: c.config.terrains,
        trackLength: c.config.trackLength,
        trackComplexity: c.config.trackComplexity,
      })),
      pool: await poolTracks(ctx, settings.tracks.pool),
    };
  });

  app.put('/admin/settings', async (req) => {
    const u = requireRole(req, 'admin');
    const next = parse(gameSettingsSchema, req.body);
    const slugs = new Set((await ctx.db.select({ s: categories.slug }).from(categories)).map((c) => c.s));
    const missing = next.autoRaces.categories.filter((s) => !slugs.has(s));
    if (missing.length)
      throw new AppError('VALIDATION_ERROR', `Categoria inexistente: ${missing.join(', ')}.`);
    if (next.tracks.pool.length) {
      const ok = await ctx.db
        .select({ id: trackVersions.id })
        .from(trackVersions)
        .where(and(inArray(trackVersions.id, next.tracks.pool), eq(trackVersions.status, 'published')));
      if (ok.length !== new Set(next.tracks.pool).size)
        throw new AppError('VALIDATION_ERROR', 'O rodízio só aceita pistas publicadas.');
    }
    const before = await getSettings(ctx);
    const saved = await saveSettings(ctx, next, u.id);
    await audit(ctx, u, 'settings.update', 'settings', 'main', { before, after: saved });
    engine.nudgeAutoRaces();
    return { settings: saved, pool: await poolTracks(ctx, saved.tracks.pool) };
  });

  /** Gerador de pistas: salva a pista de uma seed como oficial e (opcional) põe no rodízio. */
  app.post('/admin/tracks/from-seed', async (req, reply) => {
    const u = requireRole(req, 'admin', 'track_editor');
    const b = parse(
      z.object({
        name: z.string().trim().max(60).nullable().optional(),
        seed: z.string().trim().min(1).max(64),
        params: trackParamsSchema,
        addToPool: z.boolean().default(false),
      }),
      req.body,
    );
    const v = await saveProceduralTrack(ctx, b.name ?? null, b.seed, b.params, u.id).catch((e) => {
      if (e instanceof TrackGenerationError) throw new AppError('TRACK_INVALID', e.message, e.issues);
      throw e;
    });
    await audit(ctx, u, 'track.from_seed', 'track_version', v.id, { seed: b.seed, params: b.params });
    if (b.addToPool) {
      const s = await getSettings(ctx);
      if (!s.tracks.pool.includes(v.id) && s.tracks.pool.length < 50)
        await saveSettings(ctx, { ...s, tracks: { ...s.tracks, pool: [...s.tracks.pool, v.id] } }, u.id);
    }
    return reply.code(201).send({ versionId: v.id, pool: (await getSettings(ctx)).tracks.pool });
  });
}
