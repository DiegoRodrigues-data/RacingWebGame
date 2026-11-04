import { createHash } from 'node:crypto';
import { AppError } from '@tracado/shared';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { Ctx } from '../../context';
import { profiles, users } from '../../db/schema';
import { hashPassword, randomToken } from '../../lib/crypto';
import { issueTokens } from './service';

/**
 * Login com Google: OAuth 2.0 com código de autorização + PKCE. O servidor troca o código pelo token usando o
 * segredo do cliente e lê o perfil no endpoint userinfo (a resposta vem direto do Google por TLS).
 * Vínculo: `users.google_sub`; na primeira vez, um e-mail já cadastrado e verificado pelo Google é reaproveitado.
 */
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const STATE_TTL_MS = 10 * 60_000;

export const googleEnabled = (ctx: Ctx) => !!(ctx.config.GOOGLE_CLIENT_ID && ctx.config.GOOGLE_CLIENT_SECRET);
export const googleRedirectUri = (ctx: Ctx) =>
  `${ctx.config.PUBLIC_WEB_URL.replace(/\/$/, '')}/api/auth/google/callback`;

/** Só caminhos internos (evita redirecionamento aberto). */
export const safeNext = (next: unknown) =>
  typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\')
    ? next.slice(0, 300)
    : '/';

const b64url = (b: Buffer) => b.toString('base64url');

export async function googleStart(ctx: Ctx, next: string): Promise<{ url: string; state: string }> {
  if (!googleEnabled(ctx)) throw new AppError('NOT_FOUND', 'Login com Google não configurado.');
  const state = randomToken(24);
  const verifier = randomToken(48);
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  await ctx.store.set(
    `oauth:google:${state}`,
    JSON.stringify({ verifier, next: safeNext(next) }),
    STATE_TTL_MS,
  );
  const q = new URLSearchParams({
    client_id: ctx.config.GOOGLE_CLIENT_ID!,
    redirect_uri: googleRedirectUri(ctx),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return { url: `${AUTH_URL}?${q}`, state };
}

interface GoogleProfile {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
}

/** Apelido a partir do nome no Google, no formato aceito pelo cadastro e sem colidir com outro piloto. */
async function freeNickname(ctx: Ctx, p: GoogleProfile): Promise<string> {
  const raw = (p.given_name || p.name || p.email?.split('@')[0] || 'Piloto').replace(
    /[^A-Za-z0-9_\-À-ÿ]/gu,
    '',
  );
  let base = raw.slice(0, 16);
  if (base.length < 3) base = 'Piloto';
  for (let i = 0; i < 20; i++) {
    const nick = i === 0 ? base : `${base.slice(0, 15)}${Math.floor(10 + Math.random() * 9990)}`;
    const [taken] = await ctx.db
      .select({ id: profiles.userId })
      .from(profiles)
      .where(sql`lower(${profiles.nickname}) = lower(${nick})`);
    if (!taken) return nick;
  }
  return `Piloto${randomToken(4).replace(/[^A-Za-z0-9]/g, '')}`.slice(0, 20);
}

export async function googleCallback(
  ctx: Ctx,
  code: string,
  state: string,
  ip: string | null,
): Promise<{ refresh: string; next: string; created: boolean }> {
  const saved = await ctx.store.take(`oauth:google:${state}`);
  if (!saved) throw new AppError('UNAUTHORIZED', 'Login com Google expirado. Tente de novo.');
  const { verifier, next } = JSON.parse(saved) as { verifier: string; next: string };

  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: ctx.config.GOOGLE_CLIENT_ID!,
      client_secret: ctx.config.GOOGLE_CLIENT_SECRET!,
      redirect_uri: googleRedirectUri(ctx),
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  if (!tokenRes.ok) throw new AppError('UNAUTHORIZED', 'O Google recusou o login.');
  const { access_token } = (await tokenRes.json()) as { access_token?: string };
  const infoRes = await fetch(USERINFO_URL, { headers: { authorization: `Bearer ${access_token}` } });
  if (!access_token || !infoRes.ok)
    throw new AppError('UNAUTHORIZED', 'Não foi possível ler o perfil do Google.');
  const g = (await infoRes.json()) as GoogleProfile;
  if (!g.sub) throw new AppError('UNAUTHORIZED', 'Perfil do Google inválido.');
  const email = g.email?.trim().toLowerCase();
  const now = ctx.clock.now();

  let [u] = await ctx.db.select().from(users).where(eq(users.googleSub, g.sub));
  if (!u && email && g.email_verified) {
    [u] = await ctx.db.select().from(users).where(eq(users.email, email));
    if (u) {
      if (u.isBot) throw new AppError('FORBIDDEN', 'Esta conta não pode entrar pelo Google.');
      await ctx.db.update(users).set({ googleSub: g.sub, emailVerified: true }).where(eq(users.id, u.id));
    }
  }
  let created = false;
  if (!u) {
    if (!email || !g.email_verified)
      throw new AppError('UNAUTHORIZED', 'Sua conta Google precisa ter um e-mail verificado.');
    if (ip) {
      const [c] = await ctx.db
        .select({ n: sql<number>`count(*)::int` })
        .from(users)
        .where(and(eq(users.signupIp, ip), gt(users.createdAt, new Date(now - 86_400_000))));
      if ((c?.n ?? 0) >= ctx.config.MAX_SIGNUPS_PER_IP_PER_DAY)
        throw new AppError('RATE_LIMITED', 'Muitos cadastros a partir desta rede. Tente mais tarde.');
    }
    const nickname = await freeNickname(ctx, g);
    // Senha aleatória e descartada: a conta entra pelo Google (ou cria uma senha em "esqueci a senha").
    const passwordHash = await hashPassword(randomToken(32));
    u = await ctx.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(users)
        .values({
          email,
          passwordHash,
          emailVerified: true,
          googleSub: g.sub,
          signupIp: ip,
          createdAt: new Date(now),
        })
        .returning();
      // Região e cidade ficam para o jogador completar (valem para os rankings regional e local).
      await tx
        .insert(profiles)
        .values({ userId: row!.id, nickname, country: 'BR', region: 'A definir', city: 'A definir' });
      return row!;
    });
    created = true;
  }
  await ctx.db
    .update(users)
    .set({ lastLoginAt: new Date(now) })
    .where(eq(users.id, u!.id));
  const t = await issueTokens(ctx, { id: u!.id, roles: u!.roles }, ip);
  return { refresh: t.refresh, next, created };
}
