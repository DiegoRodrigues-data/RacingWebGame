import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupApp, T0, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => (t = await setupApp({ AUTO_RACES_PER_DAY: 24, AUTO_RACES_CATEGORY: 'teste' })));
afterAll(() => t.close());

const HOUR = 3_600_000;
const list = async () =>
  (await t.json('GET', `/races?from=${T0 - HOUR}&to=${T0 + 3 * 24 * HOUR}&limit=300`)).body as any[];

describe('grade automática de corridas', () => {
  it('cria uma corrida por hora cheia nas próximas 24 h, com inscrições abertas para todos', async () => {
    await t.engine.tick(); // cria a grade
    await t.engine.tick(); // scheduled → registration_open
    const rs = await list();
    expect(rs).toHaveLength(24);
    const starts = rs.map((r) => Date.parse(r.timeline.practiceAt)).sort((a, b) => a - b);
    expect(starts[0]).toBe(T0 + HOUR);
    starts.forEach((s, i) => expect(s).toBe(T0 + (i + 1) * HOUR));
    expect(rs.every((r) => r.status === 'registration_open' && r.ranked === false)).toBe(true);
    expect(rs.find((r) => Date.parse(r.timeline.practiceAt) === T0 + HOUR).name).toBe('Corrida das 10:00');

    const u = await t.register('madrugador');
    const first = rs.find((r) => Date.parse(r.timeline.practiceAt) === T0 + HOUR);
    expect((await t.json('POST', `/races/${first.id}/entries`, {}, u.token)).body.status).toBe('confirmed');
  });

  it('não duplica horários e vai completando a grade conforme o tempo passa', async () => {
    await t.advance(2 * 60_000);
    expect(await list()).toHaveLength(24);
    await t.advance(HOUR);
    const rs = await list();
    expect(rs.filter((r) => Date.parse(r.timeline.practiceAt) === T0 + 25 * HOUR)).toHaveLength(1);
    expect(new Set(rs.map((r) => r.timeline.practiceAt)).size).toBe(rs.length);
  });
});
