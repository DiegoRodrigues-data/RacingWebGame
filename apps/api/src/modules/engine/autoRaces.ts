import { pickBiome, pickTerrain, type Biome, type GameSettings, type RaceCreate } from '@tracado/shared';
import { createRng } from '@tracado/trackgen';
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { Ctx } from '../../context';
import { categories, notifications, races, tracks, trackVersions } from '../../db/schema';
import { createRace } from '../races/service';
import { newSeed } from '../tracks/service';
import { getSettings } from '../settings/service';

type CategoryRow = typeof categories.$inferSelect;

/** Durações das fases (configurações do jogo) no formato de criação de corrida. */
export function phaseInput(s: GameSettings) {
  return {
    practiceMinutes: s.phases.practiceMin,
    traceWindowSeconds: s.phases.traceWindowSec,
    setupLockSeconds: s.phases.setupLockSec,
    qualifyingSeconds: s.phases.qualifyingSec,
  };
}
export const preludeMs = (s: GameSettings) =>
  s.phases.practiceMin * 60_000 +
  (s.phases.traceWindowSec + s.phases.setupLockSec + s.phases.qualifyingSec) * 1000;

/**
 * Pista de uma corrida automática conforme as configurações: às vezes uma pista salva do rodízio; senão,
 * gerada com terreno sorteado pelos pesos, comprimento e complexidade da configuração (ou da categoria).
 */
export async function autoTrack(
  ctx: Pick<Ctx, 'db'>,
  s: GameSettings,
  cat: Pick<CategoryRow, 'config'>,
): Promise<RaceCreate['track']> {
  const t = s.tracks;
  const seed = t.seedPrefix ? `${t.seedPrefix}-${newSeed()}` : newSeed();
  const r = createRng(`${seed}|auto`);
  if (t.pool.length && r.next() < t.poolChance) {
    const id = t.pool[Math.floor(r.next() * t.pool.length)]!;
    const [v] = await ctx.db
      .select({ id: trackVersions.id })
      .from(trackVersions)
      .where(and(eq(trackVersions.id, id), eq(trackVersions.status, 'published')));
    if (v) return { type: 'version', trackVersionId: v.id };
  }
  const cfg = cat.config;
  const min = t.lengthMin ?? cfg.trackLength.min;
  const max = Math.max(min, t.lengthMax ?? cfg.trackLength.max);
  return {
    type: 'procedural',
    seed,
    params: {
      length: Math.round((min + r.next() * (max - min)) / 50) * 50,
      complexity: t.complexity ?? cfg.trackComplexity,
      width: t.width,
      terrain: pickTerrain(t.terrains, r.next()),
    },
  };
}

/** Cenário sorteado pelos pesos das configurações, compatível com o terreno da pista escolhida. */
export async function autoBiome(
  ctx: Pick<Ctx, 'db'>,
  s: GameSettings,
  track: RaceCreate['track'],
): Promise<Biome> {
  let terrain = 'asphalt';
  if (track.type === 'procedural') terrain = track.params?.terrain ?? 'asphalt';
  else {
    const [v] = await ctx.db
      .select({ t: trackVersions.terrain })
      .from(trackVersions)
      .where(eq(trackVersions.id, track.trackVersionId));
    terrain = v?.t ?? 'asphalt';
  }
  return pickBiome(s.tracks.biomes, terrain, Math.random());
}

async function categoryBySlug(ctx: Pick<Ctx, 'db'>, slug: string) {
  const [c] = await ctx.db.select().from(categories).where(eq(categories.slug, slug));
  return c && c.active ? c : null;
}

/** Corridas automáticas não são criadas para começar em menos que isto (dá tempo de alguém se inscrever). */
const MIN_LEAD_MS = 5 * 60_000;

const hourLabel = (at: number) =>
  new Date(at).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });

/**
 * Grade automática (configurações do jogo → grade): `perDay` corridas por dia em horários fixos (24 = uma a cada
 * hora cheia, em UTC), sempre preenchida até `lookaheadHours` à frente. As inscrições abrem assim que a corrida é
 * criada. As categorias entram em rodízio pelo horário e a pista sai das configurações de pista (terrenos com peso).
 * Idempotente: cada horário é marcado com `flags.auto` e não é recriado, nem se tiver sido cancelado pelo admin.
 */
export async function ensureAutoRaces(ctx: Ctx): Promise<number> {
  const st = await getSettings(ctx);
  const a = st.autoRaces;
  if (!a.enabled) return 0;
  const step = Math.round(86_400_000 / a.perDay);
  const now = ctx.clock.now();
  const horizon = now + a.lookaheadHours * 3_600_000;
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
    // Rodízio pelo número do horário: a mesma hora sempre cai na mesma categoria da lista.
    const slot = Math.floor(at / step);
    let cat: CategoryRow | null = null;
    for (let k = 0; k < a.categories.length && !cat; k++)
      cat = await categoryBySlug(ctx, a.categories[(slot + k) % a.categories.length]!);
    if (!cat) break;
    const track = await autoTrack(ctx, st, cat);
    const row = await createRace(
      ctx,
      {
        name: `Corrida das ${hourLabel(at)}`,
        categoryId: cat.id,
        ranked: a.ranked,
        startAt: new Date(at).toISOString(),
        // Inscrições abertas desde já: o prazo cobre toda a janela de antecedência.
        registrationLeadMinutes: Math.ceil((at - now) / 60_000) + 1,
        ...phaseInput(st),
        capacity: 22,
        waitlistMax: 10,
        ...(a.laps ? { laps: a.laps } : {}),
        track,
        biome: await autoBiome(ctx, st, track),
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
 * Corridas teste em ciclo (configurações do jogo → corridas teste): uma de cada vez, curta, amistosa e com bots
 * completando o grid. A próxima larga `gapMin` minutos depois da bandeirada da anterior e é criada assim que a
 * anterior começa a correr (o fim já é conhecido), com inscrições abertas desde então. Ficam fora das listas
 * normais. Depois de `keepHours` encerradas, são apagadas com replay, resultados e pista.
 */
export async function ensureAutoTestRaces(ctx: Ctx): Promise<boolean> {
  const st = await getSettings(ctx);
  const tr = st.testRaces;
  if (!tr.enabled) return false;
  await pruneTestRaces(ctx);
  const now = ctx.clock.now();
  const gap = tr.gapMin * 60_000;
  const [last] = await ctx.db
    .select()
    .from(races)
    .where(sql`${races.flags} ? 'autoTest'`)
    .orderBy(desc(races.practiceAt))
    .limit(1);
  let raceAt: number;
  if (!last || ['finished', 'archived', 'cancelled'].includes(last.status))
    raceAt = (last?.raceEndsAt?.getTime() ?? now) + gap;
  else if (last.status === 'race' && last.raceEndsAt) raceAt = last.raceEndsAt.getTime() + gap;
  else return false; // a atual ainda não largou: a próxima é criada quando ela começar a correr
  // Nunca começa o treino no passado nem sem tempo para alguém se inscrever.
  const practiceAt = Math.max(raceAt - preludeMs(st), now + 60_000);
  let cat: CategoryRow | null = null;
  for (const slug of st.autoRaces.categories) if (!cat) cat = await categoryBySlug(ctx, slug);
  if (!cat) return false;
  const track = await autoTrack(ctx, st, cat);
  const row = await createRace(
    ctx,
    {
      name: `Corrida Teste ${hourLabel(practiceAt + preludeMs(st))}`,
      categoryId: cat.id,
      ranked: false,
      startAt: new Date(practiceAt).toISOString(),
      registrationLeadMinutes: Math.ceil((practiceAt - now) / 60_000) + 1,
      ...phaseInput(st),
      capacity: 22,
      waitlistMax: 10,
      laps: tr.laps,
      track,
      biome: await autoBiome(ctx, st, track),
    },
    null,
  );
  await ctx.db
    .update(races)
    .set({ flags: { ...row.flags, autoTest: true } })
    .where(eq(races.id, row.id));
  ctx.log.info({ raceId: row.id, practiceAt: new Date(practiceAt).toISOString() }, 'Corrida teste criada');
  return true;
}

/** Apaga corridas teste encerradas há mais de `testRaces.keepHours` (com replay, resultados e pista). */
export async function pruneTestRaces(ctx: Ctx): Promise<number> {
  const keepHours = (await getSettings(ctx)).testRaces.keepHours;
  const before = new Date(ctx.clock.now() - keepHours * 3_600_000);
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
