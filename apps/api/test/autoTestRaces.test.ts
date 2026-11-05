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

const ACTIVE = (r: any) => !['finished', 'archived', 'cancelled'].includes(r.status);

describe('corridas teste com bots, em ciclo (uma por vez)', () => {
  it('cria uma corrida teste de 10 voltas com treino em 2 minutos e inscrições abertas', async () => {
    await t.engine.tick();
    await t.engine.tick();
    const rs = await tests();
    expect(rs).toHaveLength(1);
    expect(Date.parse(rs[0].timeline.practiceAt)).toBe(T0 + 2 * MIN);
    expect(rs[0]).toMatchObject({ laps: 10, test: true, ranked: false, status: 'registration_open' });
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

  it('não existe fila: a próxima só nasce na bandeirada e começa 2 minutos depois', async () => {
    const [first] = await tests();
    // Durante treino, classificação e corrida: continua só uma.
    for (const at of ['practiceAt', 'setupLockAt', 'qualifyingAt', 'raceAt'] as const) {
      await t.advanceTo(Date.parse(first.timeline[at]) + 6000);
      await t.engine.tick();
      expect((await tests()).filter(ACTIVE)).toHaveLength(1);
    }
    const running = (await tests()).find((r) => r.id === first.id);
    expect(running.status).toBe('race');
    await t.advanceTo(Date.parse(running.timeline.raceEndsAt));
    const rs = await tests();
    expect(rs.find((r) => r.id === first.id).status).toBe('finished');
    const next = rs.filter(ACTIVE);
    expect(next).toHaveLength(1);
    expect(Date.parse(next[0].timeline.practiceAt)).toBe(Date.parse(running.timeline.raceEndsAt) + 2 * MIN);
    expect(next[0].status).toBe('registration_open');
  });

  it('segue em ciclo, nunca com mais de uma ao mesmo tempo, e apaga as antigas', async () => {
    const firstId = (await tests())[0].id;
    for (let k = 0; k < 40; k++) {
      await t.advance(6 * MIN);
      expect((await tests()).filter(ACTIVE).length).toBeLessThanOrEqual(1);
    }
    expect((await t.json('GET', `/races/${firstId}`)).status).toBe(404);
  });

  it('passa por todos os terrenos em sequência', async () => {
    const seq: string[] = [];
    for (let k = 0; k < 5; k++) {
      const cur = (await tests()).find(ACTIVE);
      seq.push(cur.track.terrain);
      // Corre a atual até a bandeirada: a próxima nasce na hora.
      await t.advanceTo(Date.parse(cur.timeline.raceAt) + 6000);
      const running = (await t.race(cur.id)).timeline;
      await t.advanceTo(Date.parse(running.raceEndsAt));
    }
    const order = ['asphalt', 'dirt', 'sand', 'mixed'];
    for (let i = 1; i < seq.length; i++)
      expect(order.indexOf(seq[i]!)).toBe((order.indexOf(seq[i - 1]!) + 1) % 4);
    expect(new Set(seq.slice(0, 4)).size).toBe(4);
  });
});
