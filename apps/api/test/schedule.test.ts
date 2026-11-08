import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SPECIAL_TRACK } from '../src/db/seed';
import { setupApp, T0, type TestApp } from './helpers';

let t: TestApp;
let special: string;
beforeAll(async () => {
  t = await setupApp({ AUTO_RACES_PER_DAY: 24, AUTO_RACES_CATEGORY: 'teste' });
  const created = await t.json(
    'POST',
    '/admin/tracks',
    { name: 'Anel Especial', editor: SPECIAL_TRACK },
    t.admin,
  );
  special = created.body.id;
  await t.json('POST', `/admin/tracks/versions/${special}/publish`, {}, t.admin);
  await t.engine.tick(); // cria a grade
  await t.engine.tick(); // scheduled → registration_open
});
afterAll(() => t.close());

const HOUR = 3_600_000;
// T0 = 03/11/2026 12:00 UTC = 09:00 em Brasília.
const day = (d: string) => t.json('GET', `/admin/track-day?day=${d}`, undefined, t.admin);
const iso = (ms: number) => new Date(ms).toISOString();

describe('pistas do dia', () => {
  it('lista cada horário do dia (Brasília) com a pista, de onde veio e as especiais publicadas', async () => {
    const r = await day('2026-11-03');
    expect(r.status).toBe(200);
    expect(r.body.slots).toHaveLength(24);
    expect(r.body.slots[0].at).toBe('2026-11-03T03:00:00.000Z');
    const withRace = r.body.slots.filter((s: any) => s.race);
    // Grade criada de T0 + 1 h até 02:00 UTC do dia seguinte (fim do dia em Brasília).
    expect(withRace).toHaveLength(14);
    expect(withRace.every((s: any) => s.source === 'auto' && s.track.kind === 'procedural')).toBe(true);
    expect(withRace.every((s: any) => s.editable)).toBe(true);
    // Horários que já passaram sem corrida não aceitam reserva.
    expect(r.body.slots.filter((s: any) => !s.race).every((s: any) => !s.editable)).toBe(true);
    const sp = r.body.specials.find((s: any) => s.versionId === special);
    expect(sp).toMatchObject({ name: 'Anel Especial', kind: 'special', inPool: false, today: 0 });
    expect(
      (await t.json('GET', '/admin/track-day', undefined, await t.register('curioso').then((u) => u.token)))
        .status,
    ).toBe(403);
  });

  it('reserva uma especial para um horário ainda sem corrida; a grade usa e marca como escolhida', async () => {
    const at = Date.UTC(2026, 10, 4, 20, 0); // fora da janela de 24 h
    expect(
      (await t.json('PUT', `/admin/track-day/slots/${iso(at)}`, { trackVersionId: special }, t.admin)).status,
    ).toBe(200);
    // Fora da grade ou no passado: recusa.
    expect(
      (
        await t.json(
          'PUT',
          `/admin/track-day/slots/${iso(at + 60_000)}`,
          { trackVersionId: special },
          t.admin,
        )
      ).body.error.code,
    ).toBe('VALIDATION_ERROR');
    const before = (await day('2026-11-04')).body.slots.find((s: any) => s.at === iso(at));
    expect(before).toMatchObject({ race: null, plan: { versionId: special }, editable: true });
    expect((await day('2026-11-04')).body.specials.find((s: any) => s.versionId === special).today).toBe(1);

    await t.advanceTo(at - 20 * HOUR); // a janela de 24 h alcança o horário
    const after = (await day('2026-11-04')).body.slots.find((s: any) => s.at === iso(at));
    expect(after.race).not.toBeNull();
    expect(after).toMatchObject({ source: 'admin', plan: null, track: { versionId: special } });
    // Com a corrida criada, a reserva não vale mais: troca-se a pista da corrida.
    expect(
      (await t.json('PUT', `/admin/track-day/slots/${iso(at)}`, { trackVersionId: null }, t.admin)).body.error
        .code,
    ).toBe('INVALID_TRANSITION');
  });

  it('troca a pista de uma corrida aberta: avisa os inscritos, apaga traçados; null gera outra', async () => {
    const slots = (await day('2026-11-04')).body.slots.filter(
      (s: any) => s.race?.status === 'registration_open',
    );
    const target = slots.find((s: any) => s.source === 'auto');
    const raceId = target.race.id;
    const u = await t.register('trocado');
    expect((await t.json('POST', `/races/${raceId}/entries`, {}, u.token)).body.status).toBe('confirmed');

    const r = await t.json('PUT', `/admin/races/${raceId}/track`, { trackVersionId: special }, t.admin);
    expect(r.status).toBe(200);
    expect(r.body.race.track.versionId).toBe(special);
    const notes = (await t.json('GET', '/notifications', undefined, u.token)).body;
    expect(notes.some((n: any) => n.type === 'track_changed' && n.payload.raceId === raceId)).toBe(true);
    const now = (await day('2026-11-04')).body.slots.find((s: any) => s.race?.id === raceId);
    expect(now.source).toBe('admin');

    const back = await t.json('PUT', `/admin/races/${raceId}/track`, { trackVersionId: null }, t.admin);
    expect(back.body.race.track.versionId).not.toBe(special);
    const auto = (await day('2026-11-04')).body.slots.find((s: any) => s.race?.id === raceId);
    expect(auto).toMatchObject({ source: 'auto', track: { kind: 'procedural' } });

    // Pista em rascunho não entra.
    const draft = await t.json('POST', '/admin/tracks', { name: 'Rascunho', editor: SPECIAL_TRACK }, t.admin);
    expect(
      (await t.json('PUT', `/admin/races/${raceId}/track`, { trackVersionId: draft.body.id }, t.admin)).body
        .error.code,
    ).toBe('TRACK_NOT_PUBLISHED');
  });

  it('não troca a pista perto do parque fechado', async () => {
    const r = await t.race(
      (await day('2026-11-04')).body.slots.find((s: any) => s.race?.status === 'registration_open').race.id,
    );
    await t.advanceTo(Date.parse(r.timeline.setupLockAt) - 30_000);
    const res = await t.json('PUT', `/admin/races/${r.id}/track`, { trackVersionId: special }, t.admin);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('põe e tira especiais do rodízio', async () => {
    const on = await t.json(
      'PUT',
      '/admin/track-day/pool',
      { trackVersionId: special, inPool: true },
      t.admin,
    );
    expect(on.body.pool).toContain(special);
    expect((await day('2026-11-04')).body.specials.find((s: any) => s.versionId === special).inPool).toBe(
      true,
    );
    const off = await t.json(
      'PUT',
      '/admin/track-day/pool',
      { trackVersionId: special, inPool: false },
      t.admin,
    );
    expect(off.body.pool).not.toContain(special);
  });
});

void T0;
