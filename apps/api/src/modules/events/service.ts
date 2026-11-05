import type { EventDto } from '@tracado/shared';
import { and, asc, eq, gte, inArray } from 'drizzle-orm';
import type { Ctx } from '../../context';
import { categories, events, races } from '../../db/schema';

type EventRow = typeof events.$inferSelect;

/** Monta os eventos para o jogador: categoria, corridas por acontecer, encerradas e a próxima largada. */
export async function eventDtos(ctx: Pick<Ctx, 'db' | 'clock'>, rows: EventRow[]): Promise<EventDto[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const cats = await ctx.db.select({ id: categories.id, name: categories.name }).from(categories);
  const rs = await ctx.db
    .select({ eventId: races.eventId, status: races.status, practiceAt: races.practiceAt })
    .from(races)
    .where(inArray(races.eventId, ids));
  const now = ctx.clock.now();
  return rows.map((e) => {
    const mine = rs.filter((r) => r.eventId === e.id && r.status !== 'cancelled');
    const done = mine.filter((r) => r.status === 'finished' || r.status === 'archived');
    const next = mine
      .filter(
        (r) => !['finished', 'archived'].includes(r.status) && r.practiceAt.getTime() >= now - 3_600_000,
      )
      .sort((a, b) => a.practiceAt.getTime() - b.practiceAt.getTime())[0];
    return {
      id: e.id,
      name: e.name,
      description: e.description,
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt.toISOString(),
      ranked: e.ranked,
      category: { id: e.categoryId, name: cats.find((c) => c.id === e.categoryId)?.name ?? '' },
      upcomingRaces: mine.length - done.length,
      finishedRaces: done.length,
      nextRaceAt: next ? next.practiceAt.toISOString() : null,
    };
  });
}

/** Eventos publicados: os que ainda não acabaram primeiro (pela data), depois os encerrados. */
export async function publicEvents(ctx: Pick<Ctx, 'db' | 'clock'>, onlyActive = false): Promise<EventDto[]> {
  const now = new Date(ctx.clock.now());
  const rows = await ctx.db
    .select()
    .from(events)
    .where(and(eq(events.status, 'published'), onlyActive ? gte(events.endsAt, now) : undefined))
    .orderBy(asc(events.startsAt))
    .limit(100);
  const list = await eventDtos(ctx, rows);
  const active = list.filter((e) => Date.parse(e.endsAt) >= now.getTime());
  const ended = list.filter((e) => Date.parse(e.endsAt) < now.getTime()).reverse();
  return [...active, ...ended];
}
