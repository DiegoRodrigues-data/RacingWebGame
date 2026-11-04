import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupApp, T0, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => (t = await setupApp({ AUTO_TEST_RACES_GAP_MIN: 10, AUTO_RACES_CATEGORY: 'teste' })));
afterAll(() => t.close());

const MIN = 60_000;
const tests = async () =>
  (
    (await t.json('GET', `/races?test=true&from=${T0 - 24 * 60 * MIN}&to=${T0 + 48 * 60 * MIN}&limit=300`))
      .body as any[]
  ).sort((a, b) => a.timeline.practiceAt.localeCompare(b.timeline.practiceAt));

describe('corridas teste com bots, em ciclo', () => {
  it('cria uma corrida teste de 10 voltas que larga em 10 minutos, com inscrições abertas', async () => {
    await t.engine.tick();
    await t.engine.tick();
    const rs = await tests();
    expect(rs).toHaveLength(1);
    expect(Date.parse(rs[0].timeline.raceAt)).toBe(T0 + 10 * MIN);
    expect(rs[0]).toMatchObject({ laps: 10, test: true, ranked: false, status: 'registration_open' });
    expect(rs[0].name).toBe('Corrida Teste 09:10');
  });

  it('fica fora das listas normais e aparece em "Acontecendo agora"', async () => {
    expect((await t.json('GET', '/races')).body.some((r: any) => r.test)).toBe(false);
    const lobby = (await t.json('GET', '/lobby')).body;
    expect(lobby.upcoming.some((r: any) => r.test)).toBe(false);
    const first = lobby.live.find((r: any) => r.test);
    expect(first).toBeTruthy();
    const u = await t.register('testador');
    expect((await t.json('POST', `/races/${first.id}/entries`, {}, u.token)).body.status).toBe('confirmed');
  });

  it('só cria a próxima quando a atual larga, para 10 minutos depois da bandeirada', async () => {
    await t.advance(3 * MIN);
    expect(await tests()).toHaveLength(1); // a atual ainda não largou
    const [first] = await tests();
    await t.advanceTo(Date.parse(first.timeline.raceAt) + 6000);
    await t.engine.tick(); // a próxima abre inscrições no ciclo seguinte do motor
    const rs = await tests();
    expect(rs).toHaveLength(2);
    const cur = rs[0],
      next = rs[1];
    expect(['race', 'finished']).toContain(cur.status);
    expect(Date.parse(next.timeline.raceAt)).toBe(Date.parse(cur.timeline.raceEndsAt) + 10 * MIN);
    expect(next.status).toBe('registration_open');
  });

  it('segue em ciclo, nunca com mais de duas ao mesmo tempo, e apaga as antigas', async () => {
    const firstId = (await tests())[0].id;
    for (let k = 0; k < 16; k++) {
      await t.advance(15 * MIN);
      const active = (await tests()).filter((r) => !['finished', 'archived', 'cancelled'].includes(r.status));
      expect(active.length).toBeLessThanOrEqual(2);
      expect(active.length).toBeGreaterThanOrEqual(1);
    }
    expect((await t.json('GET', `/races/${firstId}`)).status).toBe(404);
  });
});
