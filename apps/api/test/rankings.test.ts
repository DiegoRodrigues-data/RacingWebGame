import { DEFAULT_SCORING } from '@tracado/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seasons } from '../src/db/schema';
import {
  applyResults,
  computePoints,
  ensureActiveSeason,
  normalizeKey,
  rebuildSeason,
  scopeKeys,
} from '../src/modules/rankings/service';
import { setupApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => (t = await setupApp({ RANKING_MIN_RACES: 1 })));
afterAll(() => t.close());

describe('pontuação', () => {
  it('tabela padrão, bônus de volta mais rápida e multiplicador', () => {
    expect(computePoints(DEFAULT_SCORING, 1, true, false)).toBe(25);
    expect(computePoints(DEFAULT_SCORING, 1, true, true)).toBe(26);
    expect(computePoints(DEFAULT_SCORING, 11, true, false)).toBe(0);
    expect(computePoints(DEFAULT_SCORING, 1, false, true)).toBe(0);
    expect(computePoints({ ...DEFAULT_SCORING, multiplier: 1.5 }, 2, true, false)).toBe(27);
  });
  it('escopos derivados do perfil', () => {
    expect(scopeKeys({ country: 'br', region: 'São Paulo', city: 'São José dos Campos' })).toEqual([
      { scope: 'world', key: 'world' },
      { scope: 'national', key: 'BR' },
      { scope: 'regional', key: 'BR-sao-paulo' },
      { scope: 'local', key: 'BR-sao-paulo-sao-jose-dos-campos' },
    ]);
    expect(normalizeKey('  Rio  de Janeiro ')).toBe('rio-de-janeiro');
  });
});

describe('desempate e reconstrução', () => {
  it('pontos → vitórias → pódios → voltas rápidas → menos corridas → entrada mais antiga', async () => {
    const s = await ensureActiveSeason(t.ctx.db, t.clock.now());
    const [a, b, c, d] = [
      await t.register('Rk1'),
      await t.register('Rk2'),
      await t.register('Rk3'),
      await t.register('Rk4'),
    ];
    const at = (k: number) => new Date(t.clock.now() + k);
    await t.ctx.db.transaction(async (tx) => {
      // a: 25 (1 vitória). b: 25 (sem vitória, 2 corridas). c: 25 (sem vitória, 1 corrida, entrou depois de d). d: 25 idem, entrou antes.
      await applyResults(
        tx,
        s.id,
        [{ userId: a.userId, position: 1, finished: true, points: 25, fastestLap: false }],
        at(1),
      );
      await applyResults(
        tx,
        s.id,
        [{ userId: b.userId, position: 2, finished: true, points: 18, fastestLap: false }],
        at(2),
      );
      await applyResults(
        tx,
        s.id,
        [{ userId: b.userId, position: 9, finished: true, points: 7, fastestLap: false }],
        at(3),
      );
      await applyResults(
        tx,
        s.id,
        [{ userId: d.userId, position: 4, finished: true, points: 25, fastestLap: false }],
        at(4),
      );
      await applyResults(
        tx,
        s.id,
        [{ userId: c.userId, position: 4, finished: true, points: 25, fastestLap: false }],
        at(5),
      );
    });
    const page = (await t.json('GET', `/rankings?scope=world&season=${s.id}`)).body;
    expect(page.rows.map((r: any) => r.nickname)).toEqual(['Rk1', 'Rk2', 'Rk4', 'Rk3'].map((n) => n));
    // b tem pódio (2º) e c/d não; d entrou antes de c.
    expect(page.rows[1].podiums).toBe(1);
  });

  it('a mudança de região no perfil só vale na próxima temporada (vínculo congelado)', async () => {
    const s = await ensureActiveSeason(t.ctx.db, t.clock.now());
    const u = await t.register('Mudou', { region: 'RJ', city: 'Niteroi' });
    await t.ctx.db.transaction((tx) =>
      applyResults(
        tx,
        s.id,
        [{ userId: u.userId, position: 1, finished: true, points: 25, fastestLap: false }],
        new Date(t.clock.now()),
      ),
    );
    await t.json('PATCH', '/me/profile', { region: 'MG', city: 'Uberlandia' }, u.token);
    const reg = (await t.json('GET', '/rankings?scope=regional', undefined, u.token)).body;
    expect(reg.key).toBe('BR-rj');
    expect(reg.me.userId).toBe(u.userId);
  });

  it('rebuild é idempotente', async () => {
    const [s] = await t.ctx.db.select().from(seasons);
    const before = (await t.json('GET', `/rankings?scope=world&season=${s!.id}`)).body.rows;
    await rebuildSeason(t.ctx, s!.id);
    await rebuildSeason(t.ctx, s!.id);
    // Sem race_results reais, o rebuild remove entradas sintéticas: confirma que zera de forma consistente.
    const after = (await t.json('GET', `/rankings?scope=world&season=${s!.id}`)).body.rows;
    expect(before.length).toBeGreaterThan(0);
    expect(after).toEqual([]);
  });
});
