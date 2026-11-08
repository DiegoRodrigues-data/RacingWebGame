import { AppError, trackChoiceSchema } from '@tracado/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../../context';
import { requireRole } from '../../lib/auth';
import { parse } from '../../lib/validate';
import { audit } from '../admin/routes';
import type { PhaseEngine } from '../engine/engine';
import { getSettings, saveSettings } from '../settings/service';
import { brtDay, changeRaceTrack, planSlot, publishedSpecial, trackDay } from './service';

/** Pistas do dia (admin): o que entra em cada horário, troca de pista, reservas e o rodízio de especiais. */
export function scheduleRoutes(app: FastifyInstance, ctx: Ctx, engine: PhaseEngine) {
  app.get('/admin/track-day', async (req) => {
    requireRole(req, 'admin');
    const q = parse(
      z.object({
        day: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      }),
      req.query,
    );
    return trackDay(ctx, q.day ?? brtDay(ctx.clock.now()));
  });

  /** Reserva para um horário que ainda não virou corrida (null = volta para a geração automática). */
  app.put('/admin/track-day/slots/:at', async (req) => {
    const u = requireRole(req, 'admin');
    const { at } = parse(z.object({ at: z.string().datetime() }), req.params);
    const { trackVersionId } = parse(trackChoiceSchema, req.body);
    const plan = await planSlot(ctx, Date.parse(at), trackVersionId, u.id);
    await audit(ctx, u, 'track.plan', 'track_version', trackVersionId, { at });
    return { plan };
  });

  /** Troca a pista de uma corrida aberta: especial publicada ou null para gerar outra. */
  app.put('/admin/races/:id/track', async (req) => {
    const u = requireRole(req, 'admin');
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const { trackVersionId } = parse(trackChoiceSchema, req.body);
    const r = await changeRaceTrack(ctx, id, trackVersionId, u.id);
    await audit(ctx, u, 'race.track', 'race', id, { from: r.from, to: r.to, tracesDropped: r.tracesDropped });
    return r;
  });

  /** Põe ou tira uma especial do rodízio da grade (configurações → pistas). */
  app.put('/admin/track-day/pool', async (req) => {
    const u = requireRole(req, 'admin');
    const b = parse(z.object({ trackVersionId: z.string().uuid(), inPool: z.boolean() }), req.body);
    const st = await getSettings(ctx);
    const pool = st.tracks.pool.filter((id) => id !== b.trackVersionId);
    if (b.inPool) {
      await publishedSpecial(ctx, b.trackVersionId);
      if (pool.length >= 50) throw new AppError('VALIDATION_ERROR', 'O rodízio aceita até 50 pistas.');
      pool.push(b.trackVersionId);
    }
    const saved = await saveSettings(ctx, { ...st, tracks: { ...st.tracks, pool } }, u.id);
    await audit(ctx, u, 'settings.pool', 'track_version', b.trackVersionId, { inPool: b.inPool });
    engine.nudgeAutoRaces();
    return { pool: saved.tracks.pool, poolChance: saved.tracks.poolChance };
  });
}
