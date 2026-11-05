import { crazyCreateSchema } from '@tracado/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../../context';
import { requireAuth } from '../../lib/auth';
import { parse } from '../../lib/validate';
import type { PhaseEngine } from '../engine/engine';
import * as svc from './service';

const idParam = z.object({ id: z.string().uuid() });
const codeParam = z.object({ code: z.string().trim().min(6).max(32) });

/** Corrida Maluca: grupos fechados de amigos com convite por link. */
export function crazyRoutes(app: FastifyInstance, ctx: Ctx, engine: PhaseEngine) {
  app.get('/crazy/groups', async (req) => svc.myGroups(ctx, requireAuth(req)));
  app.post('/crazy/groups', async (req, reply) => {
    const g = await svc.createGroup(ctx, requireAuth(req), parse(crazyCreateSchema, req.body));
    return reply.code(201).send(g);
  });
  app.get('/crazy/groups/:id', async (req) => svc.getGroup(ctx, parse(idParam, req.params).id, req.user));
  app.get('/crazy/invite/:code', async (req) =>
    svc.invitePreview(ctx, parse(codeParam, req.params).code, req.user),
  );
  app.post('/crazy/invite/:code/join', async (req) =>
    svc.joinGroup(ctx, requireAuth(req), parse(codeParam, req.params).code),
  );
  // Pular o preparo: "Estou pronto" de cada piloto e "Largar agora" do organizador. O tick logo em seguida
  // aplica as transições na hora (sem esperar o próximo ciclo do motor).
  app.put('/races/:id/ready', async (req) => {
    const { ready } = parse(z.object({ ready: z.boolean() }), req.body);
    const r = await svc.setReady(ctx, parse(idParam, req.params).id, requireAuth(req), ready);
    if (r.skipped) await engine.tick();
    return r;
  });
  app.post('/races/:id/start-now', async (req) => {
    const r = await svc.startNow(ctx, parse(idParam, req.params).id, requireAuth(req));
    if (r.skipped) await engine.tick();
    return r;
  });
  app.post('/crazy/guest-link', async (req) => svc.guestLink(ctx, requireAuth(req)));
}
