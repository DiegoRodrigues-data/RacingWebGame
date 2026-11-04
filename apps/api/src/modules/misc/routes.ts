import { rankingQuerySchema } from '@tracado/shared';
import { desc } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../../context';
import { categories, seasons } from '../../db/schema';
import { requireAuth } from '../../lib/auth';
import { parse } from '../../lib/validate';
import { list, markRead } from '../notifications/service';
import { getRanking } from '../rankings/service';

export function miscRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/rankings', async (req) =>
    getRanking(ctx, parse(rankingQuerySchema, req.query), req.user?.id ?? null),
  );
  app.get('/seasons', async () =>
    (await ctx.db.select().from(seasons).orderBy(desc(seasons.startsAt))).map((s) => ({
      ...s,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
    })),
  );
  app.get('/categories', async () => (await ctx.db.select().from(categories)).filter((c) => c.active));
  app.get('/notifications', async (req) => list(ctx, requireAuth(req).id));
  app.post('/notifications/:id/read', async (req) => {
    const { id } = parse(z.object({ id: z.union([z.string().uuid(), z.literal('all')]) }), req.params);
    await markRead(ctx, requireAuth(req).id, id);
    return { ok: true };
  });
}
