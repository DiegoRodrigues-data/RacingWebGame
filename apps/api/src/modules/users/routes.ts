import {
  accessPolicySchema,
  adminUserCreateSchema,
  adminUserDeleteSchema,
  adminUserStatusSchema,
  adminUserUpdateSchema,
  userStatusSchema,
  type AccessDto,
} from '@tracado/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../../context';
import { requireRole } from '../../lib/auth';
import { parse } from '../../lib/validate';
import { audit } from '../admin/routes';
import { googleEnabled } from '../auth/google';
import * as svc from './service';

const idParam = z.object({ id: z.string().uuid() });

/** Painel de usuários (só admin): lista, cadastro, edição, aprovação, bloqueio, exclusão e regra de cadastros. */
export function userRoutes(app: FastifyInstance, ctx: Ctx) {
  const admin = (req: Parameters<typeof requireRole>[0]) => requireRole(req, 'admin');

  app.get('/admin/users', async (req) => {
    admin(req);
    const q = parse(
      z.object({
        q: z.string().max(100).optional(),
        flagged: z.enum(['true', 'false']).optional(),
        status: userStatusSchema.optional(),
        bots: z.enum(['true', 'false']).optional(),
      }),
      req.query,
    );
    return svc.listUsers(ctx, {
      q: q.q || undefined,
      flagged: q.flagged === 'true',
      status: q.status,
      bots: q.bots === 'true',
    });
  });

  app.post('/admin/users', async (req, reply) => {
    const u = admin(req);
    const b = parse(adminUserCreateSchema, req.body);
    const user = await svc.createUser(ctx, b);
    await audit(ctx, u, 'user.create', 'user', user.id, { email: b.email, nickname: b.nickname });
    return reply.code(201).send(user);
  });

  app.patch('/admin/users/:id', async (req) => {
    const u = admin(req);
    const { id } = parse(idParam, req.params);
    const b = parse(adminUserUpdateSchema, req.body);
    const user = await svc.updateUser(ctx, u, id, b);
    const { password, ...diff } = b;
    await audit(ctx, u, 'user.update', 'user', id, { ...diff, ...(password ? { password: 'trocada' } : {}) });
    return user;
  });

  app.put('/admin/users/:id/status', async (req) => {
    const u = admin(req);
    const { id } = parse(idParam, req.params);
    const { status } = parse(adminUserStatusSchema, req.body);
    const user = await svc.setStatus(ctx, u, id, status);
    await audit(ctx, u, `user.${status === 'blocked' ? 'block' : 'activate'}`, 'user', id);
    return user;
  });

  app.delete('/admin/users/:id', async (req) => {
    const u = admin(req);
    const { id } = parse(idParam, req.params);
    const { confirmation } = parse(adminUserDeleteSchema, req.body ?? {});
    const r = await svc.deleteUser(ctx, u, id, confirmation);
    await audit(ctx, u, `user.${r.mode === 'deleted' ? 'delete' : 'anonymize'}`, 'user', id);
    return { ok: true, ...r };
  });

  app.get('/admin/access', async (req): Promise<AccessDto> => {
    admin(req);
    return { ...(await svc.accessPolicy(ctx)), googleLogin: googleEnabled(ctx) };
  });

  app.put('/admin/access', async (req): Promise<AccessDto> => {
    const u = admin(req);
    const b = parse(accessPolicySchema, req.body);
    const saved = await svc.saveAccessPolicy(ctx, b, u.id);
    await audit(ctx, u, 'access.update', 'settings', null, b);
    return { ...saved, googleLogin: googleEnabled(ctx) };
  });
}
