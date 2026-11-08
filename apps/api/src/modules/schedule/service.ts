import {
  AppError,
  ROOM,
  type RaceCreate,
  type TrackDayDto,
  type TrackDaySlotDto,
  type TrackDayTrackDto,
} from '@tracado/shared';
import { and, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { Ctx } from '../../context';
import {
  categories,
  entries,
  races,
  trackPlans,
  tracks,
  trackVersions,
  traces,
  users,
} from '../../db/schema';
import { autoBiome, autoTrack, brtDayStart, gridStep, slotCategory } from '../engine/autoRaces';
import { notify } from '../notifications/service';
import { getCategory, getRaceRow, getSummary, raceSummaries, resolveTrackVersion } from '../races/service';
import { getSettings, saveSettings } from '../settings/service';

const DAY_MS = 86_400_000;
/** A pista só pode ser trocada até este tempo antes do parque fechado. */
const CHANGE_LOCK_MS = 60_000;
/** Fases em que a pista ainda pode mudar. */
const OPEN = ['scheduled', 'registration_open'] as const;

export { brtDay, brtDayStart } from '../engine/autoRaces';

type VersionRow = { v: typeof trackVersions.$inferSelect; t: typeof tracks.$inferSelect };
function trackDto({ v, t }: VersionRow): TrackDayTrackDto {
  return {
    versionId: v.id,
    name: t.name,
    kind: t.kind,
    terrain: v.terrain,
    length: v.length,
    corners: v.corners,
    seed: v.source.type === 'procedural' ? v.source.seed : null,
  };
}

async function versionRows(ctx: Pick<Ctx, 'db'>, ids: string[]) {
  if (!ids.length) return new Map<string, VersionRow>();
  const rows = await ctx.db
    .select({ v: trackVersions, t: tracks })
    .from(trackVersions)
    .innerJoin(tracks, eq(tracks.id, trackVersions.trackId))
    .where(inArray(trackVersions.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.v.id, r]));
}

/**
 * Pistas de um dia: cada horário da grade automática (já criado ou não) e as corridas avulsas do admin, com a
 * pista, de onde ela veio e a reserva do admin; e as especiais publicadas, com quantas vezes entram no dia.
 */
export async function trackDay(ctx: Ctx, day: string): Promise<TrackDayDto> {
  const st = await getSettings(ctx);
  const now = ctx.clock.now();
  const from = brtDayStart(day);
  const to = from + DAY_MS;
  const step = gridStep(st);
  const dayRaces = await ctx.db
    .select()
    .from(races)
    .where(
      and(
        gte(races.practiceAt, new Date(from)),
        lt(races.practiceAt, new Date(to)),
        isNull(races.crazyGroupId),
        sql`not (${races.flags} ? 'autoTest')`,
        sql`${races.status} <> 'cancelled'`,
      ),
    );
  const summaries = new Map((await raceSummaries(ctx.db, dayRaces)).map((s) => [s.id, s]));
  const plans = await ctx.db
    .select()
    .from(trackPlans)
    .where(and(gte(trackPlans.slotAt, new Date(from)), lt(trackPlans.slotAt, new Date(to))));
  const specials = await ctx.db
    .select({ v: trackVersions, t: tracks })
    .from(trackVersions)
    .innerJoin(tracks, eq(tracks.id, trackVersions.trackId))
    .where(and(eq(tracks.kind, 'special'), eq(trackVersions.status, 'published')));
  const versions = await versionRows(ctx, [
    ...dayRaces.map((r) => r.trackVersionId),
    ...plans.map((p) => p.trackVersionId),
  ]);
  const cats = await ctx.db.select().from(categories);
  const catOf = (id: string) => cats.find((c) => c.id === id);

  const raceSlot = (r: (typeof dayRaces)[number]): TrackDaySlotDto => {
    const s = summaries.get(r.id)!;
    const v = versions.get(r.trackVersionId)!;
    const c = catOf(r.categoryId);
    const auto = !!r.flags.auto;
    return {
      at: r.practiceAt.toISOString(),
      grid: auto,
      category: c ? { slug: c.slug, name: c.name } : null,
      race: {
        id: r.id,
        name: r.name,
        status: r.status,
        confirmed: s.capacity.confirmed,
        capacity: r.capacity,
      },
      track: trackDto(v),
      biome: r.biome,
      source: v.t.kind === 'procedural' ? 'auto' : auto && !r.flags.trackPicked ? 'pool' : 'admin',
      plan: null,
      editable:
        (OPEN as readonly string[]).includes(r.status) && now < r.setupLockAt.getTime() - CHANGE_LOCK_MS,
    };
  };

  const slots: TrackDaySlotDto[] = [];
  const used = new Set<string>();
  if (st.autoRaces.enabled)
    for (let at = Math.ceil(from / step) * step; at < to; at += step) {
      const r = dayRaces.find((x) => x.flags.auto && x.practiceAt.getTime() === at);
      if (r) {
        used.add(r.id);
        slots.push(raceSlot(r));
        continue;
      }
      const c = slotCategory(st, cats, at);
      const p = plans.find((x) => x.slotAt.getTime() === at);
      const pv = p ? versions.get(p.trackVersionId) : undefined;
      slots.push({
        at: new Date(at).toISOString(),
        grid: true,
        category: c ? { slug: c.slug, name: c.name } : null,
        race: null,
        track: null,
        biome: null,
        source: null,
        plan: pv ? trackDto(pv) : null,
        editable: at > now && !!c,
      });
    }
  for (const r of dayRaces) if (!used.has(r.id)) slots.push(raceSlot(r));
  slots.sort((a, b) => a.at.localeCompare(b.at));

  const created = dayRaces.filter((r) => r.flags.auto).map((r) => r.practiceAt.getTime());
  const count = (id: string) =>
    slots.filter((s) => s.track?.versionId === id || (!s.track && s.plan?.versionId === id)).length;
  return {
    day,
    slots,
    specials: specials
      .map((r) => ({ ...trackDto(r), inPool: st.tracks.pool.includes(r.v.id), today: count(r.v.id) }))
      .sort((a, b) => b.today - a.today || a.name.localeCompare(b.name)),
    poolChance: st.tracks.pool.length ? st.tracks.poolChance : 0,
    createdUntil: created.length ? new Date(Math.max(...created)).toISOString() : null,
  };
}

export async function publishedSpecial(ctx: Pick<Ctx, 'db'>, versionId: string) {
  const [row] = await ctx.db
    .select({ v: trackVersions, t: tracks })
    .from(trackVersions)
    .innerJoin(tracks, eq(tracks.id, trackVersions.trackId))
    .where(eq(trackVersions.id, versionId));
  if (!row || row.v.status !== 'published' || row.t.kind !== 'special')
    throw new AppError('TRACK_NOT_PUBLISHED', 'Escolha uma pista especial publicada.');
  return row;
}

/** Reserva (ou tira a reserva de) uma pista especial para um horário da grade que ainda não virou corrida. */
export async function planSlot(ctx: Ctx, at: number, versionId: string | null, actorId: string) {
  const st = await getSettings(ctx);
  if (at % gridStep(st) !== 0) throw new AppError('VALIDATION_ERROR', 'Horário fora da grade automática.');
  if (at <= ctx.clock.now()) throw new AppError('VALIDATION_ERROR', 'Esse horário já passou.');
  const [race] = await ctx.db
    .select({ id: races.id })
    .from(races)
    .where(and(eq(races.practiceAt, new Date(at)), sql`${races.flags} ? 'auto'`));
  if (race)
    throw new AppError('INVALID_TRANSITION', 'A corrida desse horário já existe: troque a pista dela.');
  if (!versionId) {
    await ctx.db.delete(trackPlans).where(eq(trackPlans.slotAt, new Date(at)));
    return null;
  }
  await publishedSpecial(ctx, versionId);
  const row = { slotAt: new Date(at), trackVersionId: versionId, createdBy: actorId };
  await ctx.db
    .insert(trackPlans)
    .values(row)
    .onConflictDoUpdate({
      target: trackPlans.slotAt,
      set: { trackVersionId: versionId, createdBy: actorId, createdAt: new Date(ctx.clock.now()) },
    });
  return row;
}

/**
 * Troca a pista de uma corrida antes do parque fechado: uma especial publicada, ou `null` para gerar outra
 * automaticamente. O cenário é sorteado de novo (compatível com o terreno), os traçados salvos são apagados (eram
 * da outra pista) e quem está inscrito é avisado.
 */
export async function changeRaceTrack(
  ctx: Ctx,
  raceId: string,
  versionId: string | null,
  actorId: string | null,
) {
  const st = await getSettings(ctx);
  const before = await getRaceRow(ctx.db, raceId);
  const cat = await getCategory(ctx.db, before.categoryId);
  if (versionId) await publishedSpecial(ctx, versionId);
  const track: RaceCreate['track'] = versionId
    ? { type: 'version', trackVersionId: versionId }
    : await autoTrack(ctx, st, cat, undefined, false);
  const biome = await autoBiome(ctx, st, track);
  const res = await ctx.mutex.run(`race:${raceId}`, () =>
    ctx.db.transaction(async (tx) => {
      const race = await getRaceRow(tx, raceId, true);
      if (
        !(OPEN as readonly string[]).includes(race.status) ||
        ctx.clock.now() >= race.setupLockAt.getTime() - CHANGE_LOCK_MS
      )
        throw new AppError(
          'INVALID_TRANSITION',
          'A pista só pode ser trocada com as inscrições abertas, até 1 minuto antes do parque fechado.',
        );
      if (race.crazyGroupId) throw new AppError('FORBIDDEN', 'A pista da Corrida Maluca é do organizador.');
      const trackVersionId = await resolveTrackVersion(tx, track, cat.config, actorId);
      const flags = { ...race.flags };
      if (versionId) flags.trackPicked = true;
      else delete flags.trackPicked;
      await tx.update(races).set({ trackVersionId, biome, flags }).where(eq(races.id, raceId));
      const dropped = await tx
        .delete(traces)
        .where(eq(traces.raceId, raceId))
        .returning({ u: traces.userId });
      // A procedural antiga era só desta corrida: sai junto.
      await tx.execute(sql`
        delete from ${tracks} t
        where t.kind = 'procedural'
          and t.id = (select track_id from track_versions where id = ${race.trackVersionId})
          and not exists (
            select 1 from track_versions v join races r on r.track_version_id = v.id where v.track_id = t.id
          )`);
      return { from: race.trackVersionId, to: trackVersionId, tracesDropped: dropped.length };
    }),
  );
  const s = await getSummary(ctx.db, raceId);
  await ctx.hub.publish(ROOM.lobby, 'lobby.race', { race: s });
  const humans = await ctx.db
    .select({ id: entries.userId })
    .from(entries)
    .innerJoin(users, eq(users.id, entries.userId))
    .where(
      and(
        eq(entries.raceId, raceId),
        inArray(entries.status, ['confirmed', 'waitlisted']),
        eq(users.isBot, false),
      ),
    );
  await notify(
    ctx,
    humans.map((h) => h.id),
    'track_changed',
    { raceId, raceName: s.name, trackName: s.track.name },
  );
  return { ...res, race: s };
}

/**
 * Pistas que não estão mais publicadas (descontinuadas) saem de circulação: do rodízio da grade, das reservas e
 * das corridas ainda abertas (que passam para uma pista gerada, com aviso aos inscritos). Corridas em andamento ou
 * encerradas mantêm a pista (histórico e replay). Idempotente: roda ao descontinuar e na checagem por minuto do
 * motor (cobre o que já estava descontinuado antes).
 */
export async function retireUnpublishedTracks(ctx: Ctx, actorId: string | null = null) {
  const st = await getSettings(ctx);
  let pool = 0;
  if (st.tracks.pool.length) {
    const ok = new Set(
      (
        await ctx.db
          .select({ id: trackVersions.id })
          .from(trackVersions)
          .where(and(inArray(trackVersions.id, st.tracks.pool), eq(trackVersions.status, 'published')))
      ).map((r) => r.id),
    );
    const keep = st.tracks.pool.filter((id) => ok.has(id));
    pool = st.tracks.pool.length - keep.length;
    if (pool) await saveSettings(ctx, { ...st, tracks: { ...st.tracks, pool: keep } }, actorId);
  }
  const plans = await ctx.db
    .delete(trackPlans)
    .where(sql`${trackPlans.trackVersionId} in (select id from track_versions where status <> 'published')`)
    .returning({ at: trackPlans.slotAt });
  const open = await ctx.db
    .select({ id: races.id, lock: races.setupLockAt })
    .from(races)
    .innerJoin(trackVersions, eq(trackVersions.id, races.trackVersionId))
    .innerJoin(tracks, eq(tracks.id, trackVersions.trackId))
    .where(
      and(
        inArray(races.status, [...OPEN]),
        isNull(races.crazyGroupId),
        eq(tracks.kind, 'special'),
        sql`${trackVersions.status} <> 'published'`,
      ),
    );
  let swapped = 0;
  for (const r of open) {
    if (ctx.clock.now() >= r.lock.getTime() - CHANGE_LOCK_MS) continue;
    await changeRaceTrack(ctx, r.id, null, actorId);
    swapped++;
  }
  if (pool || plans.length || swapped)
    ctx.log.info({ pool, plans: plans.length, swapped }, 'Pistas descontinuadas tiradas de circulação');
  return { pool, plans: plans.length, races: swapped };
}
