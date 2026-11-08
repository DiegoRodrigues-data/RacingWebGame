import type { GameSettings } from '@tracado/shared';
import { botPlans } from '../src/db/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupApp, T0, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => (t = await setupApp({ AUTO_RACES_CATEGORY: 'teste' })));
afterAll(() => t.close());

const HOUR = 3_600_000;
const STEP = 30 * 60_000;
// Dia de Brasília que contém T0 (03/11/2026 09:00 BRT): começa às 03:00 UTC.
const DAY_START = Date.UTC(2026, 10, 3, 3);

const grid = async () => {
  const rs = (await t.json('GET', `/races?from=${T0}&to=${T0 + 2 * 24 * HOUR}&limit=300`)).body as any[];
  const out = await Promise.all(rs.map((r) => t.race(r.id)));
  return out
    .map((r) => ({ at: Date.parse(r.timeline.practiceAt), track: r.track.versionId, biome: r.track.biome }))
    .sort((a, b) => a.at - b.at);
};

describe('grade de 30 em 30 min com as pistas do dia', () => {
  it('repete cada pista a cada `tracksPerDay` horários, com o mesmo cenário, e troca no dia seguinte', async () => {
    const base: GameSettings = (await t.json('GET', '/admin/settings', undefined, t.admin)).body.settings;
    const put = await t.json(
      'PUT',
      '/admin/settings',
      {
        ...base,
        autoRaces: { ...base.autoRaces, enabled: true, perDay: 48, lookaheadHours: 24, tracksPerDay: 4 },
        tracks: { ...base.tracks, biomes: { grass: 50, desert: 50, canyon: 0 } },
        botPool: { ...base.botPool, enabled: false },
      },
      t.admin,
    );
    expect(put.status).toBe(200);
    await t.engine.tick();

    const rs = await grid();
    expect(rs).toHaveLength(48);
    rs.forEach((r, i) => expect(r.at).toBe(T0 + STEP + i * STEP));

    const today = rs.filter((r) => r.at < DAY_START + 24 * HOUR);
    const tomorrow = rs.filter((r) => r.at >= DAY_START + 24 * HOUR);
    const pos = (at: number) => Math.floor((at - DAY_START) / STEP) % 4;
    // Hoje: quatro pistas, cada uma no seu lugar do rodízio, nunca em horários seguidos.
    expect(new Set(today.map((r) => r.track)).size).toBe(4);
    for (const r of today) {
      const first = today.find((x) => pos(x.at) === pos(r.at))!;
      expect(r.track).toBe(first.track);
      expect(r.biome).toBe(first.biome);
    }
    for (let i = 1; i < rs.length; i++) expect(rs[i]!.track).not.toBe(rs[i - 1]!.track);
    // Amanhã: pistas novas.
    const todayTracks = new Set(today.map((r) => r.track));
    expect(tomorrow.length).toBeGreaterThan(0);
    expect(tomorrow.some((r) => todayTracks.has(r.track))).toBe(false);
  });

  it('com 0 pistas por dia, cada horário ganha uma pista nova', async () => {
    const base: GameSettings = (await t.json('GET', '/admin/settings', undefined, t.admin)).body.settings;
    await t.json(
      'PUT',
      '/admin/settings',
      { ...base, autoRaces: { ...base.autoRaces, lookaheadHours: 36, tracksPerDay: 0 } },
      t.admin,
    );
    await t.engine.tick();
    const fresh = (await grid()).filter((r) => r.at > T0 + 24 * HOUR + STEP / 2);
    expect(fresh.length).toBeGreaterThan(10);
    expect(new Set(fresh.map((r) => r.track)).size).toBe(fresh.length);
  });
});

describe('pilotos simulados com corridas que se sobrepõem', () => {
  it('não planeja o mesmo piloto em duas corridas do mesmo horário', async () => {
    const u = await setupApp({ AUTO_RACES_CATEGORY: 'teste' });
    try {
      const base: GameSettings = (await u.json('GET', '/admin/settings', undefined, u.admin)).body.settings;
      const put = await u.json(
        'PUT',
        '/admin/settings',
        {
          ...base,
          // 60 voltas de 5 a 6 km a 4×: cada corrida invade o horário seguinte (30 min depois).
          autoRaces: { ...base.autoRaces, enabled: true, perDay: 48, lookaheadHours: 4, laps: 60 },
          tracks: { ...base.tracks, lengthMin: 5000, lengthMax: 6000 },
          botPool: { ...base.botPool, enabled: true, activeMin: 30, activeMax: 30, gridMin: 8, gridMax: 8 },
        },
        u.admin,
      );
      expect(put.status).toBe(200);
      await u.engine.tick(); // cria a grade
      await u.engine.tick(); // abre as inscrições e planeja
      const rs = ((await u.json('GET', `/races?from=${T0}&to=${T0 + 5 * HOUR}&limit=50`)).body as any[]).sort(
        (a, b) => Date.parse(a.timeline.practiceAt) - Date.parse(b.timeline.practiceAt),
      );
      expect(rs.length).toBeGreaterThan(4);
      const plans = await u.ctx.db.select().from(botPlans);
      const of = (id: string) => new Set(plans.filter((p) => p.raceId === id).map((p) => p.userId));
      for (let i = 1; i < rs.length; i++) {
        const [a, b] = [of(rs[i - 1].id), of(rs[i].id)];
        expect(b.size).toBe(8);
        expect([...b].some((id) => a.has(id))).toBe(false);
      }
      expect(u.ctx.engineErrors).toEqual([]);
    } finally {
      await u.close();
    }
  });
});
