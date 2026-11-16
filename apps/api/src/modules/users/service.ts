import {
  ACCESS_TOKEN_TTL_S,
  AppError,
  emailDomainAllowed,
  SAFETY_PHRASE,
  type AccessPolicy,
  type AdminSource,
  type AdminUserCreateInput,
  type AdminUserDto,
  type AdminUserUpdateInput,
  type Role,
  type UserStatus,
} from '@tracado/shared';
import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import type { Config } from '../../config';
import type { Ctx } from '../../context';
import { adminAuditLog, oneTimeTokens, profiles, refreshTokens, users } from '../../db/schema';
import type { AuthUser } from '../../lib/auth';
import { hashPassword, randomToken } from '../../lib/crypto';
import { getSettings, saveSettings } from '../settings/service';

/**
 * Gestão de usuários no modelo do Gerador_Prompt:
 * - Master: o admin de ADMIN_EMAIL/ADMIN_PASSWORD (`users.is_master`), sincronizado a cada boot; o painel não o
 *   edita, bloqueia nem exclui.
 * - Administradores por e-mail (`ADMIN_EMAILS`): o papel de admin é calculado na emissão do token, não gravado; tirar
 *   o e-mail da variável tira o acesso na próxima renovação (até 15 min). Não podem ser bloqueados nem excluídos.
 * - Situação da conta (`users.status`) e regra de novos cadastros (`GameSettings.access`).
 */

type UserRow = typeof users.$inferSelect;

export const isAdminEmail = (cfg: Config, email: string | null | undefined) =>
  !!email && cfg.ADMIN_EMAILS.includes(email.toLowerCase());

/** Papéis que valem no token e no /me: os gravados mais o de admin para os e-mails de ADMIN_EMAILS. */
export function effectiveRoles(
  cfg: Config,
  u: Pick<UserRow, 'roles' | 'email' | 'isGuest' | 'isBot'>,
): Role[] {
  if (u.isGuest || u.isBot || !isAdminEmail(cfg, u.email) || u.roles.includes('admin')) return u.roles;
  return [...u.roles, 'admin'];
}

export function adminSourceOf(
  cfg: Config,
  u: Pick<UserRow, 'roles' | 'email' | 'isGuest' | 'isBot' | 'isMaster'>,
): AdminSource {
  if (u.isMaster) return 'master';
  if (!u.isGuest && !u.isBot && isAdminEmail(cfg, u.email)) return 'email';
  return u.roles.includes('admin') ? 'role' : null;
}

/** Mensagens para quem acertou a senha (ou o Google) mas não pode entrar. */
const STATUS_ERRORS = {
  pending: [
    'ACCOUNT_PENDING',
    'Seu cadastro aguarda a aprovação da organização. Você recebe um e-mail quando for liberado.',
  ],
  blocked: ['ACCOUNT_BLOCKED', 'Seu acesso está bloqueado. Fale com a organização do Roda Presa.'],
} as const;

export function assertActive(u: Pick<UserRow, 'status'>) {
  if (u.status === 'active') return;
  const [code, message] = STATUS_ERRORS[u.status as 'pending' | 'blocked'] ?? STATUS_ERRORS.blocked;
  throw new AppError(code, message);
}

export async function accessPolicy(ctx: Pick<Ctx, 'db' | 'config' | 'clock'>): Promise<AccessPolicy> {
  return (await getSettings(ctx)).access;
}

export async function saveAccessPolicy(ctx: Ctx, policy: AccessPolicy, actorId: string) {
  const s = await getSettings(ctx);
  return (await saveSettings(ctx, { ...s, access: policy }, actorId)).access;
}

/** Convidado (sem e-mail) só entra com os cadastros liberados e sem lista de domínios. */
export const guestsAllowed = (p: AccessPolicy) => p.signupMode === 'open' && !p.signupDomains.length;

/**
 * Situação de uma conta nova pela regra de cadastros. Recusa (SIGNUP_CLOSED, com `details.reason`) quando os
 * cadastros estão fechados, quando o e-mail é de um domínio fora da lista ou quando é convidado e a regra pede
 * aprovação ou e-mail. `trusted` (e-mail de ADMIN_EMAILS pelo Google) passa direto.
 */
export async function newAccountStatus(
  ctx: Pick<Ctx, 'db' | 'config' | 'clock'>,
  input: { email: string | null; guest?: boolean; trusted?: boolean },
): Promise<Extract<UserStatus, 'active' | 'pending'>> {
  if (input.trusted) return 'active';
  const p = await accessPolicy(ctx);
  if (p.signupMode === 'closed')
    throw new AppError(
      'SIGNUP_CLOSED',
      'Novos cadastros estão fechados no momento. Quem já tem conta entra normalmente.',
      { reason: 'closed' },
    );
  if (input.guest) {
    if (!guestsAllowed(p))
      throw new AppError(
        'SIGNUP_CLOSED',
        p.signupMode === 'approval'
          ? 'Novos cadastros passam pela aprovação da organização: crie uma conta com e-mail ou entre com o Google.'
          : 'Só são aceitos cadastros com e-mail dos domínios autorizados: crie uma conta com um deles.',
        { reason: p.signupMode === 'approval' ? 'approval' : 'domain' },
      );
    return 'active';
  }
  if (!input.email || !emailDomainAllowed(input.email, p.signupDomains))
    throw new AppError(
      'SIGNUP_CLOSED',
      `Só são aceitos cadastros com e-mail de: ${p.signupDomains.join(', ')}.`,
      { reason: 'domain' },
    );
  return p.signupMode === 'approval' ? 'pending' : 'active';
}

// ---------- Sessões ----------

/**
 * Marca de bloqueio no Store: o access token (JWT de 15 min) não é consultado no banco, então o hook de auth olha esta
 * chave para derrubar na hora quem foi bloqueado ou excluído. Ela dura o tempo de vida de um access token; depois
 * disso o refresh já é recusado pelo banco.
 */
const blockedKey = (id: string) => `user:blocked:${id}`;
export const isBlockedNow = async (ctx: Pick<Ctx, 'store'>, id: string) =>
  (await ctx.store.get(blockedKey(id))) !== null;

export async function endSessions(ctx: Pick<Ctx, 'db' | 'clock'>, userId: string) {
  await ctx.db
    .update(refreshTokens)
    .set({ revokedAt: new Date(ctx.clock.now()) })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}

export const clearBlockMark = (ctx: Pick<Ctx, 'store'>, id: string) => ctx.store.del(blockedKey(id));

async function cutAccess(ctx: Ctx, userId: string) {
  await endSessions(ctx, userId);
  await ctx.store.set(blockedKey(userId), '1', (ACCESS_TOKEN_TTL_S + 60) * 1000);
}

// ---------- Painel de usuários ----------

const toDto = (cfg: Config, u: UserRow, p: typeof profiles.$inferSelect): AdminUserDto => ({
  id: u.id,
  email: u.isGuest ? '' : u.email,
  nickname: p.nickname,
  roles: effectiveRoles(cfg, u),
  status: u.status,
  adminSource: adminSourceOf(cfg, u),
  google: !!u.googleSub,
  guest: u.isGuest,
  isBot: u.isBot,
  hasPassword: u.hasPassword && !u.isGuest,
  flagged: u.flaggedForReview,
  verified: u.emailVerified,
  level: p.level,
  careerRaces: p.careerRaces,
  createdAt: u.createdAt.toISOString(),
  lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  signupIp: u.signupIp,
});

export async function listUsers(
  ctx: Ctx,
  f: { q?: string; flagged?: boolean; status?: UserStatus; bots?: boolean },
) {
  const rows = await ctx.db
    .select({ u: users, p: profiles })
    .from(users)
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(
      and(
        f.q ? or(ilike(users.email, `%${f.q}%`), ilike(profiles.nickname, `%${f.q}%`)) : undefined,
        f.flagged ? eq(users.flaggedForReview, true) : undefined,
        f.status ? eq(users.status, f.status) : undefined,
        f.bots ? undefined : eq(users.isBot, false),
      ),
    )
    // Pendentes primeiro (é o que pede ação), depois os mais novos.
    .orderBy(sql`(${users.status} = 'pending') desc`, desc(users.isMaster), desc(users.createdAt))
    .limit(200);
  const [c] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(eq(users.status, 'pending'));
  return { users: rows.map(({ u, p }) => toDto(ctx.config, u, p)), pending: c?.n ?? 0 };
}

async function target(ctx: Ctx, id: string) {
  const [row] = await ctx.db
    .select({ u: users, p: profiles })
    .from(users)
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(users.id, id));
  if (!row) throw new AppError('NOT_FOUND', 'Usuário não encontrado.');
  if (row.u.isMaster)
    throw new AppError(
      'FORBIDDEN',
      'O Master é configurado pelas variáveis de ambiente (ADMIN_EMAIL e ADMIN_PASSWORD).',
    );
  if (row.u.isBot)
    throw new AppError('FORBIDDEN', 'Pilotos simulados são geridos em Admin → Pilotos simulados.');
  return row;
}

function requireNotEnvAdmin(ctx: Ctx, u: UserRow) {
  if (isAdminEmail(ctx.config, u.email) && !u.isGuest)
    throw new AppError(
      'FORBIDDEN',
      'Este administrador é definido pela variável ADMIN_EMAILS. Para tirar o acesso, remova o e-mail de lá.',
    );
}

async function assertFree(ctx: Ctx, field: { email?: string; nickname?: string }, exceptId?: string) {
  if (field.email) {
    const [o] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, field.email));
    if (o && o.id !== exceptId) throw new AppError('EMAIL_TAKEN', 'Já existe uma conta com esse e-mail.');
  }
  if (field.nickname) {
    const [o] = await ctx.db
      .select({ id: profiles.userId })
      .from(profiles)
      .where(sql`lower(${profiles.nickname}) = lower(${field.nickname})`);
    if (o && o.id !== exceptId) throw new AppError('NICKNAME_TAKEN', 'Este apelido já está em uso.');
  }
}

export async function createUser(ctx: Ctx, input: AdminUserCreateInput) {
  await assertFree(ctx, input);
  const passwordHash = await hashPassword(input.password);
  const id = await ctx.db.transaction(async (tx) => {
    const [u] = await tx
      .insert(users)
      .values({ email: input.email, passwordHash, emailVerified: true, createdAt: new Date(ctx.clock.now()) })
      .returning({ id: users.id });
    await tx
      .insert(profiles)
      .values({
        userId: u!.id,
        nickname: input.nickname,
        country: 'BR',
        region: input.region ?? 'A definir',
        city: input.city ?? 'A definir',
      });
    return u!.id;
  });
  const row = await target(ctx, id);
  return toDto(ctx.config, row.u, row.p);
}

export async function updateUser(ctx: Ctx, actor: AuthUser, id: string, b: AdminUserUpdateInput) {
  const { u } = await target(ctx, id);
  if (b.email !== undefined && b.email !== u.email) {
    if (u.isGuest)
      throw new AppError('CONFLICT', 'Convidado não tem e-mail: ele mesmo cria a conta em Minha conta.');
    if (u.googleSub)
      throw new AppError('CONFLICT', 'O e-mail desta conta vem do Google e não pode ser alterado aqui.');
    requireNotEnvAdmin(ctx, u);
  }
  if (b.password && u.isGuest)
    throw new AppError('CONFLICT', 'Convidado não tem senha: ele mesmo cria a conta em Minha conta.');
  if (b.roles && id === actor.id && !b.roles.includes('admin'))
    throw new AppError('VALIDATION_ERROR', 'Você não pode remover o próprio acesso de administrador.');
  await assertFree(ctx, { email: b.email, nickname: b.nickname }, id);
  const set: Partial<typeof users.$inferInsert> = {};
  if (b.email !== undefined && b.email !== u.email)
    Object.assign(set, { email: b.email, emailVerified: true });
  if (b.roles) set.roles = b.roles;
  if (b.flagged !== undefined) set.flaggedForReview = b.flagged;
  if (b.password)
    Object.assign(set, {
      passwordHash: await hashPassword(b.password),
      hasPassword: true,
      failedLogins: 0,
      lockedUntil: null,
    });
  if (Object.keys(set).length) await ctx.db.update(users).set(set).where(eq(users.id, id));
  if (b.nickname)
    await ctx.db
      .update(profiles)
      .set({ nickname: b.nickname, updatedAt: new Date(ctx.clock.now()) })
      .where(eq(profiles.userId, id));
  // Senha nova derruba as sessões (como no Gerador_Prompt); papéis novos valem na próxima renovação do token.
  if (b.password) await endSessions(ctx, id);
  const row = await target(ctx, id);
  return toDto(ctx.config, row.u, row.p);
}

/** Aprovar um cadastro pendente, bloquear ou desbloquear. Bloquear derruba a pessoa na hora. */
export async function setStatus(ctx: Ctx, actor: AuthUser, id: string, status: 'active' | 'blocked') {
  const { u } = await target(ctx, id);
  if (status === 'blocked') {
    requireNotEnvAdmin(ctx, u);
    if (id === actor.id) throw new AppError('VALIDATION_ERROR', 'Você não pode bloquear a própria conta.');
  }
  await ctx.db.update(users).set({ status }).where(eq(users.id, id));
  if (status === 'blocked') await cutAccess(ctx, id);
  else {
    await clearBlockMark(ctx, id);
    if (u.status === 'pending' && !u.isGuest)
      await ctx.mailer.send(
        u.email,
        'Seu cadastro no Roda Presa foi aprovado',
        `Pode entrar e correr: ${ctx.config.PUBLIC_WEB_URL}/entrar`,
      );
  }
  const row = await target(ctx, id);
  return toDto(ctx.config, row.u, row.p);
}

/** Violação de chave estrangeira (23503), também quando o Drizzle embrulha o erro do driver em `cause`. */
function isForeignKeyViolation(e: unknown): boolean {
  for (
    let x = e as { code?: unknown; message?: unknown; cause?: unknown } | undefined, i = 0;
    x && i < 5;
    i++
  ) {
    if (x.code === '23503' || /foreign key/i.test(String(x.message ?? ''))) return true;
    x = x.cause as typeof x;
  }
  return false;
}

/**
 * Exclusão definitiva (exige a frase de segurança). Conta sem histórico é apagada. Quem já correu tem inscrições,
 * resultados e rankings presos a ela; apagar mudaria corridas passadas, então a conta é anonimizada: perde e-mail,
 * senha, login com Google e cidade, ganha o apelido "Removido…" e fica bloqueada.
 */
export async function deleteUser(ctx: Ctx, actor: AuthUser, id: string, confirmation: string) {
  if (confirmation.trim().toUpperCase() !== SAFETY_PHRASE)
    throw new AppError('VALIDATION_ERROR', `Para confirmar, digite exatamente: ${SAFETY_PHRASE}`);
  const { u } = await target(ctx, id);
  requireNotEnvAdmin(ctx, u);
  if (id === actor.id) throw new AppError('VALIDATION_ERROR', 'Você não pode excluir a própria conta.');
  await cutAccess(ctx, id);
  try {
    await ctx.db.transaction(async (tx) => {
      await tx.update(adminAuditLog).set({ actorId: null }).where(eq(adminAuditLog.actorId, id));
      await tx.delete(users).where(eq(users.id, id));
    });
    return { mode: 'deleted' as const };
  } catch (e) {
    if (!isForeignKeyViolation(e)) throw e;
  }
  const tag =
    randomToken(6)
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(0, 6) || 'x';
  await ctx.db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        email: `removido-${id}@removido.invalid`,
        passwordHash: await hashPassword(randomToken(32)),
        hasPassword: false,
        googleSub: null,
        isGuest: false,
        status: 'blocked',
        roles: ['player'],
        signupIp: null,
        emailVerified: false,
      })
      .where(eq(users.id, id));
    await tx
      .update(profiles)
      .set({
        nickname: `Removido${tag}`,
        region: '—',
        city: '—',
        emailReminders: false,
        updatedAt: new Date(ctx.clock.now()),
      })
      .where(eq(profiles.userId, id));
    await tx.delete(oneTimeTokens).where(eq(oneTimeTokens.userId, id));
  });
  return { mode: 'anonymized' as const };
}
