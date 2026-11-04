import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { Ctx } from '../../context';
import { categories, notifications, races, tracks } from '../../db/schema';
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

/**
 * Corridas teste: curtas (AUTO_TEST_RACES_LAPS voltas, padrão 10), largando a cada AUTO_TEST_RACES_EVERY_MIN
 * minutos, preenchidas até AUTO_TEST_RACES_LOOKAHEAD_MIN à frente. Amistosas, com bots (DEMO_BOTS) completando o
 * grid, e fora das listas normais. Ficam abaixo do mínimo de voltas das corridas normais de propósito.
 * Depois de AUTO_TEST_RACES_KEEP_HOURS encerradas, são apagadas com replay, resultados e pista.
 */
export async function ensureAutoTestRaces(ctx: Ctx): Promise<number> {
  const cfg = ctx.config;
  if (!cfg.AUTO_TEST_RACES_EVERY_MIN) return 0;
  await pruneTestRaces(ctx);
  const step = cfg.AUTO_TEST_RACES_EVERY_MIN * 60_000;
  const now = ctx.clock.now();
  const horizon = now + cfg.AUTO_TEST_RACES_LOOKAHEAD_MIN * 60_000;
  const [cat] = await ctx.db.select().from(categories).where(eq(categories.slug, cfg.AUTO_RACES_CATEGORY));
  if (!cat || !cat.active) return 0;
  const first = Math.ceil((now + 2 * 60_000) / step) * step;
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
            sql`${races.flags} ? 'autoTest'`,
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
        name: `Corrida Teste ${hourLabel(at)}`,
        categoryId: cat.id,
        ranked: false,
        startAt: new Date(at).toISOString(),
        registrationLeadMinutes: Math.ceil((at - now) / 60_000) + 1,
        practiceMinutes: 2,
        setupLockSeconds: 10,
        qualifyingSeconds: 20,
        capacity: 22,
        waitlistMax: 10,
        laps: cfg.AUTO_TEST_RACES_LAPS,
        track: { type: 'procedural' },
      },
      null,
    );
    await ctx.db
      .update(races)
      .set({ flags: { ...row.flags, autoTest: true } })
      .where(eq(races.id, row.id));
    created++;
  }
  if (created) ctx.log.info({ created }, 'Corridas teste criadas');
  return created;
}

/** Apaga corridas teste encerradas há mais de AUTO_TEST_RACES_KEEP_HOURS (com replay, resultados e pista). */
export async function pruneTestRaces(ctx: Ctx): Promise<number> {
  const before = new Date(ctx.clock.now() - ctx.config.AUTO_TEST_RACES_KEEP_HOURS * 3_600_000);
  const old = await ctx.db
    .select({ id: races.id, version: races.trackVersionId })
    .from(races)
    .where(
      and(
        sql`${races.flags} ? 'autoTest'`,
        inArray(races.status, ['finished', 'archived', 'cancelled']),
        lte(sql`coalesce(${races.raceEndsAt}, ${races.raceAt})`, before),
      ),
    )
    .limit(200);
  if (!old.length) return 0;
  const ids = old.map((r) => r.id);
  await ctx.db.transaction(async (tx) => {
    await tx.delete(races).where(inArray(races.id, ids));
    await tx.delete(notifications).where(inArray(sql`${notifications.payload}->>'raceId'`, ids));
    // Pistas procedurais eram exclusivas de cada corrida.
    await tx.execute(sql`
      delete from ${tracks} t
      where t.kind = 'procedural'
        and not exists (
          select 1 from track_versions v join races r on r.track_version_id = v.id where v.track_id = t.id
        )
        and t.id in (select track_id from track_versions where id in (${sql.join(
          old.map((r) => sql`${r.version}`),
          sql`, `,
        )}))`);
  });
  ctx.log.info({ removed: ids.length }, 'Corridas teste antigas apagadas');
  return ids.length;
}
