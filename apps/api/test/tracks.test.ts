import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SPECIAL_TRACK } from '../src/db/seed';
import { setupApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => (t = await setupApp()));
afterAll(() => t.close());

const editorToken = async () => {
  const u = await t.register(`Editor${Math.floor(Math.random() * 1e6)}`);
  await t.json('PATCH', `/admin/users/${u.userId}`, { roles: ['player', 'track_editor'] }, t.admin);
  return (await t.login(`${u.nickname.toLowerCase()}@teste.dev`, 'senha-forte-1')).body.accessToken as string;
};

describe('editor de pistas especiais', () => {
  it('pré-visualiza, cria rascunho, submete; apenas admin publica; corrida exige pista publicada', async () => {
    const ed = await editorToken();
    const prev = await t.json('POST', '/admin/tracks/preview', { editor: SPECIAL_TRACK }, ed);
    expect(prev.body.issues).toEqual([]);
    expect(prev.body.estimate.lapTimeMs).toBeGreaterThan(0);
    const created = await t.json(
      'POST',
      '/admin/tracks',
      { name: 'Circuito Especial', editor: SPECIAL_TRACK },
      ed,
    );
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('draft');
    const vid = created.body.id;
    const raceDraft = await t.json(
      'POST',
      '/admin/races',
      {
        name: 'Xis',
        categoryId: t.categoryId,
        startAt: new Date(t.clock.now() + 3600_000).toISOString(),
        track: { type: 'version', trackVersionId: vid },
      },
      t.admin,
    );
    expect(raceDraft.body.error, JSON.stringify(raceDraft.body)).toMatchObject({
      code: 'TRACK_NOT_PUBLISHED',
    });
    expect((await t.json('POST', `/admin/tracks/versions/${vid}/submit`, {}, ed)).body.status).toBe('review');
    expect((await t.json('POST', `/admin/tracks/versions/${vid}/publish`, {}, ed)).body.error.code).toBe(
      'FORBIDDEN',
    );
    expect((await t.json('POST', `/admin/tracks/versions/${vid}/publish`, {}, t.admin)).body.status).toBe(
      'published',
    );
    const raceId = await t.createRace({ track: { type: 'version', trackVersionId: vid } });
    expect((await t.race(raceId)).track.versionId).toBe(vid);

    // Nova versão não altera a corrida já associada à versão anterior.
    const v2 = await t.json(
      'POST',
      `/admin/tracks/${created.body.trackId}/versions`,
      { editor: { ...SPECIAL_TRACK, startAt: 0.2 } },
      ed,
    );
    expect(v2.body.version).toBe(2);
    expect((await t.race(raceId)).track.versionId).toBe(vid);
    // Versão publicada é imutável.
    expect(
      (await t.json('PATCH', `/admin/tracks/versions/${vid}`, { editor: SPECIAL_TRACK }, ed)).body.error.code,
    ).toBe('CONFLICT');
  });

  it('não publica pista inválida e devolve os problemas posicionados', async () => {
    const bad = {
      ...SPECIAL_TRACK,
      controlPoints: [
        { x: 0, y: 0, width: 12 },
        { x: 30, y: 0, width: 12 },
        { x: 30, y: 30, width: 12 },
        { x: 0, y: 30, width: 12 },
      ],
    };
    const prev = await t.json('POST', '/admin/tracks/preview', { editor: bad }, t.admin);
    expect(prev.body.issues.length).toBeGreaterThan(0);
    const created = await t.json('POST', '/admin/tracks', { name: 'Ruim', editor: bad }, t.admin);
    const pub = await t.json('POST', `/admin/tracks/versions/${created.body.id}/publish`, {}, t.admin);
    expect(pub.body.error.code).toBe('TRACK_INVALID');
    expect(pub.body.error.details[0]).toHaveProperty('code');
  });

  it('geometria de pista procedural é reproduzível e servida com cache imutável', async () => {
    const raceId = await t.createRace({ track: { type: 'procedural', seed: 'repro' } });
    const r = await t.race(raceId);
    const res = await t.app.inject({ method: 'GET', url: `/tracks/versions/${r.track.versionId}/geometry` });
    expect(res.headers['cache-control']).toContain('immutable');
    const g = JSON.parse(res.body);
    const prev = await t.json(
      'POST',
      '/admin/tracks/preview',
      { seed: 'repro', params: g.source.params },
      t.admin,
    );
    expect(prev.body.geometry.hash).toBe(g.hash);
  });
});

describe('administração de corridas', () => {
  it('gera corridas em lote e edita parâmetros apenas antes do treino', async () => {
    const day = new Date(t.clock.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const batch = await t.json(
      'POST',
      '/admin/races/batch',
      {
        namePrefix: 'Lote',
        categoryId: t.categoryId,
        fromDate: day,
        toDate: day,
        times: ['12:00', '18:00', '21:00'],
        track: { type: 'procedural' },
      },
      t.admin,
    );
    expect(batch.body.created).toBe(3);
    const id = batch.body.ids[0];
    const upd = await t.json('PATCH', `/admin/races/${id}`, { laps: 45, name: 'Renomeada' }, t.admin);
    expect(upd.body).toMatchObject({ laps: 45, name: 'Renomeada' });
    const ev = await t.json(
      'POST',
      '/admin/events',
      {
        name: 'Copa Teste',
        categoryId: t.categoryId,
        startsAt: new Date(t.clock.now()).toISOString(),
        endsAt: new Date(t.clock.now() + 86_400_000 * 7).toISOString(),
        status: 'published',
      },
      t.admin,
    );
    expect(ev.status).toBe(201);
    expect((await t.json('GET', '/events')).body.map((e: any) => e.id)).toContain(ev.body.id);
  });
});
