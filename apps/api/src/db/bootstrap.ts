import { eq, sql } from 'drizzle-orm';
import type { Config } from '../config';
import { hashPassword } from '../lib/crypto';
import type { Db, Tx } from './client';
import { profiles, users } from './schema';

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
 * Garante o administrador inicial definido por variáveis de ambiente.
 * - Cria usuário e perfil na mesma transação (antes, um apelido repetido deixava o usuário sem perfil, e
 *   conta sem perfil não consegue entrar). Uma conta que ficou assim é consertada aqui.
 * - A senha só é gravada na criação; ADMIN_RESET_PASSWORD força a de ADMIN_PASSWORD (recuperação de acesso).
 */
export async function ensureAdmin(db: Db, cfg: Config, log?: (m: string) => void) {
  const [u] = await db.select().from(users).where(eq(users.email, cfg.ADMIN_EMAIL));
  if (u) {
    if (!u.roles.includes('admin'))
      await db
        .update(users)
        .set({ roles: [...u.roles, 'admin'] })
        .where(eq(users.id, u.id));
    const [p] = await db.select({ id: profiles.userId }).from(profiles).where(eq(profiles.userId, u.id));
    if (!p) {
      await createProfile(db, u.id);
      log?.('Perfil do admin estava faltando e foi criado.');
    }
    if (cfg.ADMIN_RESET_PASSWORD) {
      await db
        .update(users)
        .set({ passwordHash: await hashPassword(cfg.ADMIN_PASSWORD), failedLogins: 0, lockedUntil: null })
        .where(eq(users.id, u.id));
      log?.('Senha do admin redefinida por ADMIN_RESET_PASSWORD. Desligue a variável depois de entrar.');
    }
    return u.id;
  }
  const passwordHash = await hashPassword(cfg.ADMIN_PASSWORD);
  return db.transaction(async (tx) => {
    const [c] = await tx
      .insert(users)
      .values({ email: cfg.ADMIN_EMAIL, passwordHash, roles: ['player', 'admin'], emailVerified: true })
      .returning();
    await createProfile(tx, c!.id);
    return c!.id;
  });
}
