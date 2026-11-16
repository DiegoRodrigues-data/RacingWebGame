import { randomUUID } from 'node:crypto';
import {
  AppError,
  effectiveDriver,
  REFRESH_TOKEN_TTL_S,
  WS_TICKET_TTL_S,
  type AuthResponse,
  type MeDto,
  type RegisterInput,
} from '@tracado/shared';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Ctx } from '../../context';
import { oneTimeTokens, profiles, refreshTokens, users } from '../../db/schema';
import { signAccessToken, type AuthUser } from '../../lib/auth';
import { hashPassword, randomToken, sha256, verifyPassword } from '../../lib/crypto';
import { assertActive, effectiveRoles, endSessions, newAccountStatus } from '../users/service';

const MAX_FAILED = 5;

export async function getMe(ctx: Ctx, userId: string): Promise<MeDto> {
  const [row] = await ctx.db
    .select()
    .from(users)
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(users.id, userId));
  if (!row) throw new AppError('UNAUTHORIZED', 'Conta não encontrada.');
  const p = row.profiles;
  return {
    id: row.users.id,
    // Convidado tem e-mail fictício (só para a coluna única): não aparece para ninguém.
    email: row.users.isGuest ? '' : row.users.email,
    emailVerified: row.users.emailVerified,
    roles: effectiveRoles(ctx.config, row.users),
    profile: {
      userId: p.userId,
      nickname: p.nickname,
      country: p.country,
      region: p.region,
      city: p.city,
      carColor: p.carColor,
      level: p.level,
      xp: p.xp,
      reducedMotion: p.reducedMotion,
      emailReminders: p.emailReminders,
      careerRaces: p.careerRaces,
      driver: effectiveDriver(p.userId, p.driver),
      driverChosen: p.driver != null,
    },
    guest: row.users.isGuest,
    hasPassword: row.users.hasPassword && !row.users.isGuest,
    google: !!row.users.googleSub,
    master: row.users.isMaster,
  };
}

/**
 * Emite access token e refresh. Os papéis vêm do banco na hora (não de `user.roles`): assim o admin por e-mail
 * (ADMIN_EMAILS) e uma troca de papel no painel valem na próxima renovação.
 */
export async function issueTokens(
  ctx: Ctx,
  user: Pick<AuthUser, 'id'> & Partial<AuthUser>,
  ip: string | null,
  familyId: string = randomUUID(),
) {
  const now = ctx.clock.now();
  const [u] = await ctx.db.select().from(users).where(eq(users.id, user.id));
  if (!u) throw new AppError('UNAUTHORIZED', 'Conta não encontrada.');
  const roles = effectiveRoles(ctx.config, u);
  const refresh = randomToken(48);
  const [row] = await ctx.db
    .insert(refreshTokens)
    .values({
      userId: user.id,
      tokenHash: sha256(refresh),
      familyId,
      expiresAt: new Date(now + REFRESH_TOKEN_TTL_S * 1000),
      ip,
    })
    .returning({ id: refreshTokens.id });
  const accessToken = await signAccessToken(ctx.config.JWT_SECRET, { id: u.id, roles }, now);
  return { accessToken, refresh, refreshId: row!.id };
}

/** Cadastro sob aprovação: a conta é criada, mas só entra depois que o admin aprovar. */
export interface PendingSignup {
  pending: true;
  message: string;
}

export async function register(
  ctx: Ctx,
  input: RegisterInput,
  ip: string | null,
): Promise<(AuthResponse & { refresh: string }) | PendingSignup> {
  const now = ctx.clock.now();
  const status = await newAccountStatus(ctx, { email: input.email });
  // Antifraude básico: limite de cadastros por IP em 24 h; acima de um limiar menor, sinaliza para revisão.
  let flagged = false;
  if (ip) {
    const [c] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.signupIp, ip), gt(users.createdAt, new Date(now - 86_400_000))));
    const n = c?.n ?? 0;
    if (n >= ctx.config.MAX_SIGNUPS_PER_IP_PER_DAY)
      throw new AppError('RATE_LIMITED', 'Muitos cadastros a partir desta rede. Tente mais tarde.');
    flagged = n >= ctx.config.FLAG_SIGNUPS_PER_IP_PER_DAY;
  }
  const existing = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, input.email));
  if (existing.length) throw new AppError('EMAIL_TAKEN', 'Este e-mail já está cadastrado.');
  const nick = await ctx.db
    .select({ id: profiles.userId })
    .from(profiles)
    .where(sql`lower(${profiles.nickname}) = lower(${input.nickname})`);
  if (nick.length) throw new AppError('NICKNAME_TAKEN', 'Este apelido já está em uso.');
  const passwordHash = await hashPassword(input.password);
  const userId = await ctx.db
    .transaction(async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({
          email: input.email,
          passwordHash,
          signupIp: ip,
          flaggedForReview: flagged,
          status,
          createdAt: new Date(now),
        })
        .returning({ id: users.id });
      await tx
        .insert(profiles)
        .values({
          userId: u!.id,
          nickname: input.nickname,
          country: input.country,
          region: input.region,
          city: input.city,
        });
      return u!.id;
    })
    .catch((e: unknown) => {
      if (String((e as Error).message).includes('profiles_nickname_uq'))
        throw new AppError('NICKNAME_TAKEN', 'Este apelido já está em uso.');
      if (String((e as Error).message).includes('users_email_uq'))
        throw new AppError('EMAIL_TAKEN', 'Este e-mail já está cadastrado.');
      throw e;
    });
  await sendVerification(ctx, userId, input.email);
  if (status === 'pending')
    return {
      pending: true,
      message: 'Cadastro recebido! Você recebe um e-mail quando a organização aprovar o seu acesso.',
    };
  const t = await issueTokens(ctx, { id: userId }, ip);
  return { accessToken: t.accessToken, expiresIn: 900, me: await getMe(ctx, userId), refresh: t.refresh };
}

export async function sendVerification(ctx: Ctx, userId: string, email: string) {
  const token = randomToken();
  await ctx.db
    .insert(oneTimeTokens)
    .values({
      userId,
      kind: 'email_verify',
      tokenHash: sha256(token),
      expiresAt: new Date(ctx.clock.now() + 3 * 86_400_000),
    });
  await ctx.mailer.send(
    email,
    'Confirme seu e-mail no Roda Presa',
    `${ctx.config.PUBLIC_WEB_URL}/verificar-email?token=${token}`,
  );
}

/** Conta pelo e-mail ou pelo apelido (convidado e piloto simulado não entram por senha). */
async function findByLogin(ctx: Ctx, login: string) {
  const key = login.trim().toLowerCase();
  if (key.includes('@')) {
    const [u] = await ctx.db.select().from(users).where(eq(users.email, key));
    return u;
  }
  const [row] = await ctx.db
    .select({ u: users })
    .from(users)
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(sql`lower(${profiles.nickname}) = ${key}`);
  return row?.u;
}

export async function login(
  ctx: Ctx,
  loginId: string,
  password: string,
  ip: string | null,
): Promise<AuthResponse & { refresh: string }> {
  const now = ctx.clock.now();
  const u = await findByLogin(ctx, loginId);
  if (!u || u.isGuest || u.isBot) {
    await hashPassword(password); // tempo constante aproximado: não revela se a conta existe
    throw new AppError('INVALID_CREDENTIALS', 'E-mail, apelido ou senha incorretos.');
  }
  if (u.lockedUntil && u.lockedUntil.getTime() > now)
    throw new AppError('ACCOUNT_LOCKED', 'Conta temporariamente bloqueada por excesso de tentativas.', {
      until: u.lockedUntil.toISOString(),
    });
  const ok = await verifyPassword(u.passwordHash, password);
  if (!ok) {
    const failed = u.failedLogins + 1;
    // Bloqueio progressivo: 15 min, 30 min, 1 h... até 24 h.
    const lockedUntil =
      failed >= MAX_FAILED
        ? new Date(now + Math.min(86_400_000, 15 * 60_000 * 2 ** (failed - MAX_FAILED)))
        : null;
    await ctx.db.update(users).set({ failedLogins: failed, lockedUntil }).where(eq(users.id, u.id));
    throw new AppError('INVALID_CREDENTIALS', 'E-mail, apelido ou senha incorretos.');
  }
  // Só depois da senha certa, para não revelar a situação de contas alheias.
  assertActive(u);
  await ctx.db
    .update(users)
    .set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date(now) })
    .where(eq(users.id, u.id));
  const t = await issueTokens(ctx, { id: u.id }, ip);
  return { accessToken: t.accessToken, expiresIn: 900, me: await getMe(ctx, u.id), refresh: t.refresh };
}

/** Rotação de refresh token com detecção de reuso: um token já trocado revoga toda a família. */
export async function refresh(
  ctx: Ctx,
  token: string,
  ip: string | null,
): Promise<AuthResponse & { refresh: string }> {
  const now = ctx.clock.now();
  const [row] = await ctx.db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, sha256(token)));
  if (!row) throw new AppError('UNAUTHORIZED', 'Sessão inválida.');
  if (row.revokedAt || row.replacedBy) {
    await ctx.db
      .update(refreshTokens)
      .set({ revokedAt: new Date(now) })
      .where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));
    ctx.log.warn(
      { userId: row.userId, familyId: row.familyId },
      'Reuso de refresh token detectado; família revogada',
    );
    throw new AppError('TOKEN_REUSED', 'Sessão encerrada por segurança. Entre novamente.');
  }
  if (row.expiresAt.getTime() <= now) throw new AppError('UNAUTHORIZED', 'Sessão expirada.');
  const [u] = await ctx.db
    .select({ id: users.id, status: users.status })
    .from(users)
    .where(eq(users.id, row.userId));
  if (!u) throw new AppError('UNAUTHORIZED');
  if (u.status !== 'active') {
    await endSessions(ctx, u.id);
    assertActive(u);
  }
  const t = await issueTokens(ctx, { id: u.id }, ip, row.familyId);
  await ctx.db.update(refreshTokens).set({ replacedBy: t.refreshId }).where(eq(refreshTokens.id, row.id));
  return { accessToken: t.accessToken, expiresIn: 900, me: await getMe(ctx, u.id), refresh: t.refresh };
}

export async function logout(ctx: Ctx, token: string | undefined) {
  if (!token) return;
  const [row] = await ctx.db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, sha256(token)));
  if (row)
    await ctx.db
      .update(refreshTokens)
      .set({ revokedAt: new Date(ctx.clock.now()) })
      .where(eq(refreshTokens.familyId, row.familyId));
}

export async function forgotPassword(ctx: Ctx, email: string) {
  const [u] = await ctx.db
    .select({ id: users.id, master: users.isMaster })
    .from(users)
    .where(eq(users.email, email));
  // Não revela existência. A senha do Master só muda pela variável ADMIN_PASSWORD.
  if (!u || u.master) return;
  const token = randomToken();
  await ctx.db
    .insert(oneTimeTokens)
    .values({
      userId: u.id,
      kind: 'password_reset',
      tokenHash: sha256(token),
      expiresAt: new Date(ctx.clock.now() + 3600_000),
    });
  await ctx.mailer.send(
    email,
    'Redefinição de senha do Roda Presa',
    `${ctx.config.PUBLIC_WEB_URL}/redefinir-senha?token=${token}`,
  );
}

async function consumeToken(ctx: Ctx, kind: 'password_reset' | 'email_verify', token: string) {
  const now = ctx.clock.now();
  const [row] = await ctx.db
    .select()
    .from(oneTimeTokens)
    .where(and(eq(oneTimeTokens.tokenHash, sha256(token)), eq(oneTimeTokens.kind, kind)));
  if (!row || row.usedAt || row.expiresAt.getTime() <= now)
    throw new AppError('VALIDATION_ERROR', 'Link inválido ou expirado.');
  await ctx.db
    .update(oneTimeTokens)
    .set({ usedAt: new Date(now) })
    .where(eq(oneTimeTokens.id, row.id));
  return row.userId;
}

export async function resetPassword(ctx: Ctx, token: string, password: string) {
  const userId = await consumeToken(ctx, 'password_reset', token);
  await ctx.db
    .update(users)
    .set({
      passwordHash: await hashPassword(password),
      hasPassword: true,
      failedLogins: 0,
      lockedUntil: null,
    })
    .where(eq(users.id, userId));
  await ctx.db
    .update(refreshTokens)
    .set({ revokedAt: new Date(ctx.clock.now()) })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}

/**
 * Troca de senha logado: confere a atual, grava a nova e encerra as outras sessões. Conta criada pelo Google
 * (`hasPassword` falso) cria a primeira senha sem informar a atual e passa a entrar também por e-mail e senha.
 */
export async function changePassword(ctx: Ctx, user: AuthUser, current: string | undefined, next: string) {
  const [u] = await ctx.db.select().from(users).where(eq(users.id, user.id));
  if (!u) throw new AppError('UNAUTHORIZED');
  if (u.isGuest)
    throw new AppError('CONFLICT', 'Convidado não tem senha: crie sua conta com e-mail e senha.');
  if (u.isMaster)
    throw new AppError('FORBIDDEN', 'A senha do Master é definida pela variável ADMIN_PASSWORD.');
  if (u.hasPassword && !(await verifyPassword(u.passwordHash, current ?? '')))
    throw new AppError('INVALID_CREDENTIALS', 'A senha atual não confere.');
  await ctx.db
    .update(users)
    .set({ passwordHash: await hashPassword(next), hasPassword: true, failedLogins: 0, lockedUntil: null })
    .where(eq(users.id, u.id));
  await ctx.db
    .update(refreshTokens)
    .set({ revokedAt: new Date(ctx.clock.now()) })
    .where(and(eq(refreshTokens.userId, u.id), isNull(refreshTokens.revokedAt)));
}

export async function verifyEmail(ctx: Ctx, token: string) {
  const userId = await consumeToken(ctx, 'email_verify', token);
  await ctx.db.update(users).set({ emailVerified: true }).where(eq(users.id, userId));
}

export async function issueWsTicket(ctx: Ctx, user: AuthUser): Promise<string> {
  const ticket = randomToken(24);
  await ctx.store.set(`wsticket:${ticket}`, JSON.stringify(user), WS_TICKET_TTL_S * 1000);
  return ticket;
}

export async function redeemWsTicket(ctx: Ctx, ticket: string): Promise<AuthUser | null> {
  const v = await ctx.store.take(`wsticket:${ticket}`);
  return v ? (JSON.parse(v) as AuthUser) : null;
}
