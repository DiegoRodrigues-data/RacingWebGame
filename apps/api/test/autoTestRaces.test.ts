import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupApp, T0, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => (t = await setupApp({ AUTO_TEST_RACES_EVERY_MIN: 5, AUTO_RACES_CATEGORY: 'teste' })));
afterAll(() => t.close());

const MIN = 60_000;
const tests = async () =>
  (await t.json('GET', `/races?test=true&from=${T0 - 24 * 60 * MIN}&to=${T0 + 48 * 60 * MIN}&limit=300`))
    .body as any[];

describe('corridas teste com bots', () => {
  it('cria uma a cada 5 minutos na próxima hora, com 10 voltas e inscrições abertas', async () => {
    await t.engine.tick();
    await t.engine.tick();
    const rs = (await tests()).sort((a, b) => a.timeline.practiceAt.localeCompare(b.timeline.practiceAt));
    expect(rs).toHaveLength(12);
    expect(Date.parse(rs[0].timeline.practiceAt)).toBe(T0 + 5 * MIN);
    rs.forEach((r, i) => expect(Date.parse(r.timeline.practiceAt)).toBe(T0 + (i + 1) * 5 * MIN));
    expect(rs.every((r) => r.laps === 10 && r.test && !r.ranked && r.status === 'registration_open')).toBe(
      true,
    );
    expect(rs[0].name).toBe('Corrida Teste 09:05');
  });

  it('ficam fora das listas normais e aparecem em "Acontecendo agora"', async () => {
    expect((await t.json('GET', '/races')).body.some((r: any) => r.test)).toBe(false);
    const lobby = (await t.json('GET', '/lobby')).body;
    expect(lobby.upcoming.some((r: any) => r.test)).toBe(false);
    expect(lobby.live.filter((r: any) => r.test)).toHaveLength(1); // a próxima aberta
    const u = await t.register('testador');
    const first = lobby.live.find((r: any) => r.test);
    expect((await t.json('POST', `/races/${first.id}/entries`, {}, u.token)).body.status).toBe('confirmed');
    await t.advance(6 * MIN); // a primeira entra no treino
    const live = (await t.json('GET', '/lobby')).body.live.filter((r: any) => r.test);
    expect(live.map((r: any) => r.status)).toContain('practice');
  });

  it('corre até o fim e é apagada depois do prazo de retenção', async () => {
    const firstId = (await tests()).find((r) => Date.parse(r.timeline.practiceAt) === T0 + 5 * MIN).id;
    for (let k = 0; k < 10; k++) await t.advance(30 * MIN);
    expect((await t.json('GET', `/races/${firstId}`)).status).toBe(404);
    const rs = await tests();
    expect(rs.length).toBeGreaterThanOrEqual(12);
    expect(rs.every((r) => Date.parse(r.timeline.practiceAt) > t.clock.now() - 4 * 60 * MIN)).toBe(true);
  });
});
