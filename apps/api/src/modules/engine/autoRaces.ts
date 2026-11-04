import { and, eq, gte, lte, sql } from 'drizzle-orm';
import type { Ctx } from '../../context';
import { categories, races } from '../../db/schema';
import { createRace } from '../races/service';

/** Corridas automáticas não são criadas para começar em menos que isto (dá tempo de alguém se inscrever). */
const MIN_LEAD_MS = 5 * 60_000;

const hourLabel = (at: number) =>
  new Date(at).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });

/**
 * Grade automática: `AUTO_RACES_PER_DAY` corridas por dia em horários fixos (24 = uma a cada hora cheia, em UTC),
 * sempre preenchida até `AUTO_RACES_LOOKAHEAD_HOURS` à frente. As inscrições abrem assim que a corrida é criada,
 * na categoria `AUTO_RACES_CATEGORY` (por padrão a Copa Novatos, aberta a qualquer nível).
 * Idempotente: cada horário é marcado com `flags.auto` e não é recriado, nem se tiver sido cancelado pelo admin.
 */
export async function ensureAutoRaces(ctx: Ctx): Promise<number> {
  const cfg = ctx.config;
  if (!cfg.AUTO_RACES_PER_DAY) return 0;
  const step = Math.round(86_400_000 / cfg.AUTO_RACES_PER_DAY);
  const now = ctx.clock.now();
  const horizon = now + cfg.AUTO_RACES_LOOKAHEAD_HOURS * 3_600_000;
  const [cat] = await ctx.db.select().from(categories).where(eq(categories.slug, cfg.AUTO_RACES_CATEGORY));
  if (!cat || !cat.active) return 0;
  const first = Math.ceil((now + MIN_LEAD_MS) / step) * step;
  if (first > horizon) return 0;
  const taken = new Set(
    (
      await ctx.db
        .select({ at: races.practiceAt })
        .from(races)
        .where(
          and(
            gte(races.practiceAt, new Date(first)),
            lte(races.practiceAt, new Date(horizon)),
            sql`${races.flags} ? 'auto'`,
          ),
        )
    ).map((r) => r.at.getTime()),
  );
  let created = 0;
  for (let at = first; at <= horizon; at += step) {
    if (taken.has(at)) continue;
    const row = await createRace(
      ctx,
      {
        name: `Corrida das ${hourLabel(at)}`,
        categoryId: cat.id,
        ranked: cfg.AUTO_RACES_RANKED,
        startAt: new Date(at).toISOString(),
        // Inscrições abertas desde já: o prazo cobre toda a janela de antecedência.
        registrationLeadMinutes: Math.ceil((at - now) / 60_000) + 1,
        practiceMinutes: 10,
        setupLockSeconds: 30,
        qualifyingSeconds: 60,
        capacity: 22,
        waitlistMax: 10,
        track: { type: 'procedural' },
      },
      null,
    );
    await ctx.db
      .update(races)
      .set({ flags: { ...row.flags, auto: true } })
      .where(eq(races.id, row.id));
    created++;
  }
  if (created) ctx.log.info({ created }, 'Corridas automáticas criadas');
  return created;
}
