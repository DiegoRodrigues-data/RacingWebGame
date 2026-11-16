import {
  AppError,
  changePasswordSchema,
  forgotPasswordSchema,
  guestJoinSchema,
  guestResumeSchema,
  guestUpgradeSchema,
  loginSchema,
  REFRESH_TOKEN_TTL_S,
  registerSchema,
  resetPasswordSchema,
  updateProfileSchema,
  verifyEmailSchema,
} from '@tracado/shared';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Ctx } from '../../context';
import { profiles, users } from '../../db/schema';
import { requireAuth } from '../../lib/auth';
import { parse } from '../../lib/validate';
import { googleCallback, googleEnabled, googleStart, safeNext } from './google';
import * as crazy from '../crazy/service';
import * as svc from './service';
import { accessPolicy, guestsAllowed } from '../users/service';

const COOKIE = 'tracado_rt';

function googleErrorParam(e: unknown) {
  if (!(e instanceof AppError)) return 'google';
  if (e.code === 'ACCOUNT_PENDING') return 'pendente';
  if (e.code === 'ACCOUNT_BLOCKED') return 'bloqueado';
  if (e.code === 'SIGNUP_CLOSED')
    return (e.details as { reason?: string } | undefined)?.reason === 'domain' ? 'dominio' : 'fechado';
  return 'google';
}

export function authRoutes(app: FastifyInstance, ctx: Ctx) {
  const setCookie = (reply: FastifyReply, token: string) =>
    reply.setCookie(COOKIE, token, {
      httpOnly: true,
      secure: ctx.config.COOKIE_SECURE,
      sameSite: 'strict',
      path: '/auth',
      maxAge: REFRESH_TOKEN_TTL_S,
    });
  // Rotas que usam o cookie exigem um cabeçalho customizado (bloqueia CSRF simples entre sites).
  const csrf = (req: FastifyRequest) => {
    if (req.headers['x-tracado-csrf'] !== '1') throw new AppError('FORBIDDEN', 'Cabeçalho CSRF ausente.');
  };
  const authLimit = {
    config: { rateLimit: { max: ctx.config.AUTH_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' } },
  };

  app.post('/auth/register', authLimit, async (req, reply) => {
    const r = await svc.register(ctx, parse(registerSchema, req.body), req.ip);
    // Cadastro sob aprovação: sem sessão até o admin aprovar.
    if ('pending' in r) return reply.code(202).send(r);
    setCookie(reply, r.refresh);
    const { refresh: _r, ...body } = r;
    return reply.code(201).send(body);
  });
  app.post('/auth/login', authLimit, async (req, reply) => {
    const b = parse(loginSchema, req.body);
    const r = await svc.login(ctx, b.login, b.password, req.ip);
    setCookie(reply, r.refresh);
    const { refresh: _r, ...body } = r;
    return body;
  });
  // Login com Google. O cookie "tracado_og" (SameSite=Lax, volta na navegação vinda do Google) prende o state
  // ao navegador que iniciou o login.
  // Também diz a regra de cadastros, para a tela de entrada avisar antes (aprovação, fechados, convidados).
  app.get('/auth/providers', async () => {
    const p = await accessPolicy(ctx);
    return { google: googleEnabled(ctx), signupMode: p.signupMode, guests: guestsAllowed(p) };
  });
  app.get('/auth/google/start', authLimit, async (req, reply) => {
    const { next } = req.query as { next?: string };
    const { url, state } = await googleStart(ctx, safeNext(next));
    reply.setCookie('tracado_og', state, {
      httpOnly: true,
      secure: ctx.config.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/auth/google',
      maxAge: 600,
    });
    return reply.redirect(url);
  });
  app.get('/auth/google/callback', authLimit, async (req, reply) => {
    const q = req.query as { code?: string; state?: string; error?: string };
    const web = ctx.config.PUBLIC_WEB_URL.replace(/\/$/, '');
    const cookieState = req.cookies['tracado_og'];
    reply.clearCookie('tracado_og', { path: '/auth/google' });
    if (q.error || !q.code || !q.state || q.state !== cookieState)
      return reply.redirect(`${web}/entrar?erro=google`);
    try {
      const r = await googleCallback(ctx, q.code, q.state, req.ip);
      setCookie(reply, r.refresh);
      return reply.redirect(r.created ? `${web}/conta?bemvindo=1` : `${web}${r.next}`);
    } catch (e) {
      // Recusas da regra de cadastros e da situação da conta voltam com um motivo para a tela de entrada.
      const reason = googleErrorParam(e);
      if (reason === 'google') req.log.warn({ err: e }, 'Login com Google falhou');
      return reply.redirect(`${web}/entrar?erro=${reason}`);
    }
  });
  // Convidado: joga só com apelido (com ou sem convite da Corrida Maluca); volta pelo link pessoal; ou vira
  // conta normal.
  app.post('/auth/guest', authLimit, async (req, reply) => {
    const r = await crazy.createGuest(ctx, parse(guestJoinSchema, req.body), req.ip);
    setCookie(reply, r.refresh);
    const { refresh: _r, ...body } = r;
    return reply.code(201).send(body);
  });
  app.post('/auth/guest/resume', authLimit, async (req, reply) => {
    const r = await crazy.resumeGuest(ctx, parse(guestResumeSchema, req.body).key, req.ip);
    setCookie(reply, r.refresh);
    const { refresh: _r, ...body } = r;
    return body;
  });
  app.post('/auth/guest/link', async (req) => crazy.guestLink(ctx, requireAuth(req)));
  app.post('/auth/guest/upgrade', authLimit, async (req) => {
    const b = parse(guestUpgradeSchema, req.body);
    return crazy.upgradeGuest(ctx, requireAuth(req), b.email, b.password);
  });
  app.post(
    '/auth/refresh',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      csrf(req);
      const token = req.cookies[COOKIE];
      if (!token) throw new AppError('UNAUTHORIZED', 'Sem sessão.');
      try {
        const r = await svc.refresh(ctx, token, req.ip);
        setCookie(reply, r.refresh);
        const { refresh: _r, ...body } = r;
        return body;
      } catch (e) {
        reply.clearCookie(COOKIE, { path: '/auth' });
        throw e;
      }
    },
  );
  app.post('/auth/logout', async (req, reply) => {
    csrf(req);
    await svc.logout(ctx, req.cookies[COOKIE]);
    reply.clearCookie(COOKIE, { path: '/auth' });
    return { ok: true };
  });
  app.post('/auth/forgot-password', authLimit, async (req) => {
    await svc.forgotPassword(ctx, parse(forgotPasswordSchema, req.body).email);
    return { ok: true };
  });
  app.post('/auth/reset-password', authLimit, async (req) => {
    const b = parse(resetPasswordSchema, req.body);
    await svc.resetPassword(ctx, b.token, b.password);
    return { ok: true };
  });
  // Troca de senha logado: as outras sessões caem e esta recebe um refresh novo.
  app.post('/auth/change-password', authLimit, async (req, reply) => {
    const u = requireAuth(req);
    const b = parse(changePasswordSchema, req.body);
    await svc.changePassword(ctx, u, b.currentPassword, b.newPassword);
    const t = await svc.issueTokens(ctx, u, req.ip);
    setCookie(reply, t.refresh);
    return { ok: true };
  });
  app.post('/auth/verify-email', authLimit, async (req) => {
    await svc.verifyEmail(ctx, parse(verifyEmailSchema, req.body).token);
    return { ok: true };
  });
  app.post('/auth/resend-verification', authLimit, async (req) => {
    const u = requireAuth(req);
    const me = await svc.getMe(ctx, u.id);
    if (!me.emailVerified) await svc.sendVerification(ctx, u.id, me.email);
    return { ok: true };
  });
  app.post('/auth/ws-ticket', async (req) => {
    const u = requireAuth(req);
    return { ticket: await svc.issueWsTicket(ctx, u) };
  });
  app.get('/me', async (req) => svc.getMe(ctx, requireAuth(req).id));
  app.patch('/me/profile', async (req) => {
    const u = requireAuth(req);
    const b = parse(updateProfileSchema, req.body);
    if (b.nickname) {
      const taken = await ctx.db
        .select({ id: profiles.userId })
        .from(profiles)
        .where(sql`lower(${profiles.nickname}) = lower(${b.nickname}) and ${profiles.userId} <> ${u.id}`);
      if (taken.length) throw new AppError('NICKNAME_TAKEN', 'Este apelido já está em uso.');
    }
    // Mudança de região vale para rankings apenas a partir da próxima temporada (vínculo da temporada é congelado).
    await ctx.db
      .update(profiles)
      .set({ ...b, updatedAt: new Date(ctx.clock.now()) })
      .where(eq(profiles.userId, u.id));
    return svc.getMe(ctx, u.id);
  });
  void users;
}
