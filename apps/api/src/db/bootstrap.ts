import { eq } from 'drizzle-orm';
import type { Config } from '../config';
import { hashPassword } from '../lib/crypto';
import type { Db } from './client';
import { profiles, users } from './schema';

/** Garante o administrador inicial definido por variáveis de ambiente. */
export async function ensureAdmin(db: Db, cfg: Config) {
  const [u] = await db.select().from(users).where(eq(users.email, cfg.ADMIN_EMAIL));
  if (u) {
    if (!u.roles.includes('admin'))
      await db
        .update(users)
        .set({ roles: [...u.roles, 'admin'] })
        .where(eq(users.id, u.id));
    return u.id;
  }
  const [c] = await db
    .insert(users)
    .values({
      email: cfg.ADMIN_EMAIL,
      passwordHash: await hashPassword(cfg.ADMIN_PASSWORD),
      roles: ['player', 'admin'],
      emailVerified: true,
    })
    .returning();
  await db
    .insert(profiles)
    .values({
      userId: c!.id,
      nickname: 'DiretorDeProva',
      country: 'BR',
      region: 'SP',
      city: 'São Paulo',
      level: 'elite',
    });
  return c!.id;
}
