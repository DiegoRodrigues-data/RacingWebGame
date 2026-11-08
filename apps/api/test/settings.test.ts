import { DEFAULT_GAME_SETTINGS, pickBiome, pickTerrain, type GameSettings } from '@tracado/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupApp, T0, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => (t = await setupApp({ AUTO_RACES_CATEGORY: 'teste' })));
afterAll(() => t.close());

const HOUR = 3_600_000;

describe('configurações do jogo (admin)', () => {
  it('sem nada salvo, valem as variáveis antigas; só admin edita', async () => {
    const r = await t.json('GET', '/admin/settings', undefined, t.admin);
    expect(r.body.settings.autoRaces.enabled).toBe(false);
    expect(r.body.settings.autoRaces.categories).toEqual(['teste']);
    expect(r.body.categories.map((c: { slug: string }) => c.slug)).toContain('teste');
    const u = await t.register('Curioso');
    expect((await t.json('GET', '/admin/settings', undefined, u.token)).body.error.code).toBe('FORBIDDEN');
    expect((await t.json('PUT', '/admin/settings', r.body.settings, u.token)).body.error.code).toBe(
      'FORBIDDEN',
    );
    // O navegador lê só as fases e os limites da Corrida Maluca.
    const pub = (await t.json('GET', '/settings')).body;
    expect(Object.keys(pub).sort()).toEqual(['crazy', 'phases']);
  });

  it('valida: terreno liberado, categoria existente e pista publicada no rodízio', async () => {
    const base: GameSettings = (await t.json('GET', '/admin/settings', undefined, t.admin)).body.settings;
    const semTerreno = {
      ...base,
      tracks: { ...base.tracks, terrains: { asphalt: 0, dirt: 0, sand: 0, mixed: 0 } },
    };
    expect((await t.json('PUT', '/admin/settings', semTerreno, t.admin)).body.error.code).toBe(
      'VALIDATION_ERROR',
    );
    const semCat = { ...base, autoRaces: { ...base.autoRaces, categories: ['nao-existe'] } };
    expect((await t.json('PUT', '/admin/settings', semCat, t.admin)).body.error.message).toMatch(
      /nao-existe/,
    );
    const pool = { ...base, tracks: { ...base.tracks, pool: ['00000000-0000-4000-8000-000000000000'] } };
    expect((await t.json('PUT', '/admin/settings', pool, t.admin)).body.error.message).toMatch(/publicadas/);
  });

  it('grade automática obedece: terreno sorteado pelos pesos, fases e voltas configuradas', async () => {
    const base: GameSettings = (await t.json('GET', '/admin/settings', undefined, t.admin)).body.settings;
    const next: GameSettings = {
      ...base,
      phases: { practiceMin: 3, traceWindowSec: 90, setupLockSec: 15, qualifyingSec: 45 },
      autoRaces: { ...base.autoRaces, enabled: true, perDay: 24, lookaheadHours: 4, laps: 12 },
      tracks: {
        ...base.tracks,
        terrains: { asphalt: 0, dirt: 100, sand: 0, mixed: 0 },
        seedPrefix: 'teste-terra',
      },
    };
    const saved = await t.json('PUT', '/admin/settings', next, t.admin);
    expect(saved.status).toBe(200);
    await t.engine.tick();
    const rs = (await t.json('GET', `/races?from=${T0}&to=${T0 + 5 * HOUR}`)).body as any[];
    expect(rs.length).toBe(4);
    for (const r of rs) {
      expect(r.track.terrain).toBe('dirt');
      expect(r.laps).toBe(12);
      const tl = r.timeline;
      expect(Date.parse(tl.traceWindowAt) - Date.parse(tl.practiceAt)).toBe(3 * 60_000);
      expect(Date.parse(tl.setupLockAt) - Date.parse(tl.traceWindowAt)).toBe(90_000);
      expect(Date.parse(tl.qualifyingAt) - Date.parse(tl.setupLockAt)).toBe(15_000);
      expect(Date.parse(tl.raceAt) - Date.parse(tl.qualifyingAt)).toBe(45_000);
    }
    const audit = (await t.json('GET', '/admin/audit', undefined, t.admin)).body;
    expect(audit.some((a: { action: string }) => a.action === 'settings.update')).toBe(true);
  });

  it('gerador: salva a pista de uma seed como oficial e põe no rodízio', async () => {
    const r = await t.json(
      'POST',
      '/admin/tracks/from-seed',
      {
        name: 'Areião',
        seed: 'gerador-1',
        params: { length: 1600, complexity: 0.4, width: 12, terrain: 'sand' },
        addToPool: true,
      },
      t.admin,
    );
    expect(r.status).toBe(201);
    expect(r.body.pool).toContain(r.body.versionId);
    const s = (await t.json('GET', '/admin/settings', undefined, t.admin)).body;
    expect(s.pool[0]).toMatchObject({ name: 'Areião', terrain: 'sand', status: 'published' });
  });

  it('Corrida Maluca respeita o limite de corridas por grupo', async () => {
    const base: GameSettings = (await t.json('GET', '/admin/settings', undefined, t.admin)).body.settings;
    await t.json('PUT', '/admin/settings', { ...base, crazy: { ...base.crazy, maxRaces: 2 } }, t.admin);
    const u = await t.register('Limitado');
    const startAt = new Date(t.clock.now() + 10 * 60_000).toISOString();
    const r = await t.json('POST', '/crazy/groups', { name: 'Muitas', races: 3, startAt }, u.token);
    expect(r.body.error.message).toMatch(/No máximo 2/);
  });

  it('a conta de administração não corre nem entra em grupos', async () => {
    const raceId = await t.createRace({}, 60 * 60_000);
    const r = await t.json('POST', `/races/${raceId}/entries`, {}, t.admin);
    expect(r.body.error.code).toBe('FORBIDDEN');
    const startAt = new Date(t.clock.now() + 10 * 60_000).toISOString();
    expect(
      (await t.json('POST', '/crazy/groups', { name: 'Do admin', races: 1, startAt }, t.admin)).body.error
        .code,
    ).toBe('FORBIDDEN');
  });

  it('sem janela de traçado (padrão): o treino vai direto ao parque fechado, sem aviso de janela', async () => {
    const raceId = await t.createRace({ traceWindowSeconds: 0 }, 30 * 60_000);
    const u = await t.register('SemJanela');
    await t.json('POST', `/races/${raceId}/entries`, {}, u.token);
    let race = await t.race(raceId);
    expect(race.timeline.setupLockAt).toBe(race.timeline.traceWindowAt);
    await t.advanceTo(Date.parse(race.timeline.practiceAt));
    expect((await t.race(raceId)).status).toBe('practice');
    await t.advanceTo(Date.parse(race.timeline.traceWindowAt));
    race = await t.race(raceId);
    expect(race.status).toBe('setup_lock');
    const notes = (await t.json('GET', '/notifications', undefined, u.token)).body as { type: string }[];
    expect(notes.some((n) => n.type === 'trace_window_open')).toBe(false);
    // O padrão das configurações é sem janela (um teste acima salvou 90 s de propósito).
    expect(DEFAULT_GAME_SETTINGS.phases.traceWindowSec).toBe(0);
  });

  it('cenário: sorteado pelos pesos, nunca da mesma cor da pista', () => {
    // Deserto liberado: pista de asfalto pode ir; pista de areia nunca (cai no autódromo).
    expect(pickBiome({ grass: 0, desert: 100, canyon: 0 }, 'asphalt', 0.5)).toBe('desert');
    expect(pickBiome({ grass: 0, desert: 100, canyon: 0 }, 'sand', 0.5)).toBe('grass');
    expect(pickBiome({ grass: 0, desert: 50, canyon: 50 }, 'dirt', 0.9)).toBe('desert');
    expect(pickBiome({ grass: 0, desert: 50, canyon: 50 }, 'sand', 0.1)).toBe('canyon');
  });

  it('grade automática grava o cenário da corrida', async () => {
    const base: GameSettings = (await t.json('GET', '/admin/settings', undefined, t.admin)).body.settings;
    await t.json(
      'PUT',
      '/admin/settings',
      {
        ...base,
        autoRaces: { ...base.autoRaces, enabled: true, lookaheadHours: 8, tracksPerDay: 0 },
        tracks: {
          ...base.tracks,
          terrains: { asphalt: 100, dirt: 0, sand: 0, mixed: 0 },
          biomes: { grass: 0, desert: 0, canyon: 100 },
        },
      },
      t.admin,
    );
    await t.advance(5 * HOUR);
    const rs = (await t.json('GET', `/races?from=${t.clock.now() + 3 * HOUR}&to=${t.clock.now() + 9 * HOUR}`))
      .body as any[];
    expect(rs.length).toBeGreaterThan(0);
    for (const r of rs) expect(r.track.biome).toBe('canyon');
    // Corrida do admin sem cenário escolhido: autódromo.
    const id = await t.createRace({}, 2 * HOUR);
    expect((await t.race(id)).track.biome).toBe('grass');
  });

  it('sorteio de terreno respeita os pesos', () => {
    const w = { ...DEFAULT_GAME_SETTINGS.tracks.terrains, asphalt: 50, sand: 50 };
    expect(pickTerrain(w, 0.1)).toBe('asphalt');
    expect(pickTerrain(w, 0.9)).toBe('sand');
    expect(pickTerrain({ asphalt: 0, dirt: 0, sand: 0, mixed: 1 }, 0.5)).toBe('mixed');
  });
});
