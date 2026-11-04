import { AppError } from '@tracado/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../../context';
import { parse } from '../../lib/validate';
import type { PhaseEngine } from '../engine/engine';

/** Rotas exclusivas de desenvolvimento/teste (ENABLE_DEV_ROUTES): controlar o relógio do servidor. */
export function devRoutes(app: FastifyInstance, ctx: Ctx, engine: PhaseEngine) {
  app.get('/dev/clock', async () => ({ now: ctx.clock.now(), offset: ctx.clock.offset ?? 0 }));
  app.post('/dev/clock/advance', async (req) => {
    const { ms } = parse(
      z.object({
        ms: z
          .number()
          .int()
          .min(0)
          .max(30 * 86_400_000),
      }),
      req.body,
    );
    if (!ctx.clock.advance) throw new AppError('CONFLICT', 'Relógio fixo.');
    ctx.clock.advance(ms);
    await engine.tick();
    return { now: ctx.clock.now() };
  });
  app.post('/dev/clock/reset', async () => {
    ctx.clock.reset?.();
    return { now: ctx.clock.now() };
  });
  app.post('/dev/engine/tick', async () => {
    await engine.tick();
    return { ok: true };
  });
  app.get('/dev/mail', async () => ctx.mailer.sent.slice(-50));
}
