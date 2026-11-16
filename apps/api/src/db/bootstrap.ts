import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Config } from '../config';
import { hashPassword, verifyPassword } from '../lib/crypto';
import type { Db, Tx } from './client';
import { profiles, refreshTokens, users } from './schema';

/** Apelido livre para o admin: "DiretorDeProva", depois "DiretorDeProva2", 3... (o apelido é único no jogo). */
async function freeNickname(db: Db | Tx, base = 'DiretorDeProva') {
  for (let n = 1; ; n++) {
    const nick = n === 1 ? base : `${base}${n}`;
    const taken = await db
      .select({ id: profiles.userId })
      .from(profiles)
      .where(sql`lower(${profiles.nickname}) = lower(${nick})`);
    if (!taken.length) return nick;
  }
}

async function createProfile(db: Db | Tx, userId: string) {
  await db
    .insert(profiles)
    .values({
      userId,
      nickname: await freeNickname(db),
      country: 'BR',
      region: 'SP',
      city: 'São Paulo',
      level: 'elite',
    });
}

/**
 * Sincroniza o Master (modelo do Gerador_Prompt): o admin principal é definido por ADMIN_EMAIL e ADMIN_PASSWORD, e
 * as variáveis valem sempre, a cada boot.
 * - Acha o Master pela marca `is_master`; na primeira vez, adota a conta que já tem o ADMIN_EMAIL (o admin criado
 *   pelas versões antigas) ou cria uma, com usuário e perfil na mesma transação.
 * - E-mail diferente da variável: troca (se outro usuário já tiver aquele e-mail, mantém e avisa).
 * - Senha diferente da variável: grava a nova, zera o bloqueio por tentativas e encerra as sessões.
 * - Garante o papel de admin, a situação ativa e o perfil (conta sem perfil não consegue entrar).
 */
export async function ensureAdmin(db: Db, cfg: Config, log?: (m: string) => void) {
  let [u] = await db.select().from(users).where(eq(users.isMaster, true));
  if (!u) [u] = await db.select().from(users).where(eq(users.email, cfg.ADMIN_EMAIL));
  if (!u) {
    const passwordHash = await hashPassword(cfg.ADMIN_PASSWORD);
    return db.transaction(async (tx) => {
      const [c] = await tx
        .insert(users)
        .values({
          email: cfg.ADMIN_EMAIL,
          passwordHash,
          roles: ['player', 'admin'],
          emailVerified: true,
          isMaster: true,
        })
        .returning();
      await createProfile(tx, c!.id);
      log?.(`Administrador Master "${cfg.ADMIN_EMAIL}" criado.`);
      return c!.id;
    });
  }
  const set: Partial<typeof users.$inferInsert> = {};
  if (!u.isMaster) set.isMaster = true;
  if (!u.roles.includes('admin')) set.roles = [...u.roles, 'admin'];
  if (u.status !== 'active') set.status = 'active';
  if (u.email !== cfg.ADMIN_EMAIL) {
    const [other] = await db.select({ id: users.id }).from(users).where(eq(users.email, cfg.ADMIN_EMAIL));
    if (other)
      log?.(
        `ADMIN_EMAIL "${cfg.ADMIN_EMAIL}" já pertence a outra conta; o Master continua com "${u.email}".`,
      );
    else {
      set.email = cfg.ADMIN_EMAIL;
      set.emailVerified = true;
    }
  }
  const passwordChanged = !(await verifyPassword(u.passwordHash, cfg.ADMIN_PASSWORD));
  if (passwordChanged)
    Object.assign(set, {
      passwordHash: await hashPassword(cfg.ADMIN_PASSWORD),
      hasPassword: true,
      failedLogins: 0,
      lockedUntil: null,
    });
  if (Object.keys(set).length) await db.update(users).set(set).where(eq(users.id, u.id));
  if (passwordChanged) {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, u.id), isNull(refreshTokens.revokedAt)));
    log?.('Senha do Master atualizada a partir de ADMIN_PASSWORD; as sessões abertas foram encerradas.');
  }
  const [p] = await db.select({ id: profiles.userId }).from(profiles).where(eq(profiles.userId, u.id));
  if (!p) {
    await createProfile(db, u.id);
    log?.('Perfil do admin estava faltando e foi criado.');
  }
  return u.id;
}
