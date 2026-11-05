import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => (t = await setupApp()));
afterAll(() => t.close());

describe('eventos para o jogador', () => {
  it('evento publicado aparece com as corridas ligadas a ele; rascunho não aparece', async () => {
    const now = t.clock.now();
    const mk = async (name: string, status: string) =>
      (
        await t.json(
          'POST',
          '/admin/events',
          {
            name,
            categoryId: t.categoryId,
            startsAt: new Date(now).toISOString(),
            endsAt: new Date(now + 2 * 86_400_000).toISOString(),
            status,
            description: 'Só terra e areia',
          },
          t.admin,
        )
      ).body.id as string;
    const pub = await mk('Só poeira', 'published');
    await mk('Secreto', 'draft');
    const raceId = await t.createRace({ eventId: pub }, 60 * 60_000);

    const list = (await t.json('GET', '/events')).body as any[];
    expect(list.map((e) => e.name)).toEqual(['Só poeira']);
    expect(list[0]).toMatchObject({ upcomingRaces: 1, finishedRaces: 0 });
    expect(list[0].nextRaceAt).toBeTruthy();

    const detail = (await t.json('GET', `/events/${pub}`)).body;
    expect(detail.races.map((r: any) => r.id)).toEqual([raceId]);
    expect(detail.races[0].event).toMatchObject({ id: pub, name: 'Só poeira' });
    expect((await t.json('GET', '/lobby')).body.events.map((e: any) => e.id)).toContain(pub);
  });
});
