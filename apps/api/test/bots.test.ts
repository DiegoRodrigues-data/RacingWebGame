import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { botPersonas, botPlans, entries, rankingEntries } from '../src/db/schema';
import { forgetOnlineBotCache } from '../src/modules/bots/service';
import { ensureActiveSeason } from '../src/modules/rankings/service';
import { setupApp, T0, type TestApp } from './helpers';

let t: TestApp;
const HOUR = 3_600_000;
const MIN = 60_000;

async function saveBotPool(over: Record<string, unknown>) {
  const cur = (await t.json('GET', '/admin/settings', undefined, t.admin)).body.settings;
  const r = await t.json(
    'PUT',
    '/admin/settings',
    { ...cur, botPool: { ...cur.botPool, ...over } },
    t.admin,
    { 'x-tracado-csrf': '1' },
  );
  expect(r.status).toBe(200);
  forgetOnlineBotCache();
  return r.body.settings;
}

const confirmedBots = async (raceId: string) =>
  (
    await t.ctx.db
      .select({ u: entries.userId })
      .from(entries)
      .innerJoin(botPersonas, eq(botPersonas.userId, entries.userId))
      .where(and(eq(entries.raceId, raceId), eq(entries.status, 'confirmed')))
  ).map((r) => r.u);

let firstRace = '';

beforeAll(async () => {
  t = await setupApp({ AUTO_RACES_PER_DAY: 24, AUTO_RACES_CATEGORY: 'teste' });
});
afterAll(() => t.close());

describe('pilotos simulados', () => {
  it('ao ligar, cria as personas (máximo ativo + folga) com perfil de gente', async () => {
    await saveBotPool({ enabled: true, activeMin: 20, activeMax: 20, perRaceMax: 10, reserveSeats: 2 });
    const r = await t.json('GET', '/admin/bots', undefined, t.admin);
    expect(r.status).toBe(200);
    expect(r.body.summary.total).toBe(30);
    expect(r.body.summary.activeToday).toBe(20);
    expect(new Set(r.body.bots.map((b: any) => b.nickname)).size).toBe(30);
    // Para o teste: todos jogam o dia todo e sempre querem correr.
    await t.ctx.db.update(botPersonas).set({ hourFrom: 0, hourTo: 0, joinRate: 1 });
  });

  it('planeja as inscrições na abertura e inscreve aos poucos, deixando vagas para gente', async () => {
    await t.engine.tick(); // cria a grade e abre as inscrições (planejando os pilotos simulados)
    const races = (await t.json('GET', `/races?from=${T0}&to=${T0 + 3 * HOUR}&limit=10`)).body as any[];
    const first = races.find((r) => Date.parse(r.timeline.practiceAt) === T0 + HOUR)!;
    firstRace = first.id;
    const plans = await t.ctx.db.select().from(botPlans).where(eq(botPlans.raceId, first.id));
    expect(plans.length).toBeGreaterThanOrEqual(4);
    expect(plans.length).toBeLessThanOrEqual(10);

    const counts: number[] = [];
    for (let k = 0; k < 8; k++) {
      await t.advance(10 * MIN);
      counts.push((await confirmedBots(first.id)).length);
    }
    // Entram em momentos diferentes, não todos de uma vez.
    expect(new Set(counts).size).toBeGreaterThan(1);
    const final = counts.at(-1)!;
    expect(final).toBeGreaterThan(0);
    expect(final).toBeLessThanOrEqual(10);

    // Para o jogador, são pilotos comuns: sem a marca de bot e já com traçado e setup.
    const list = (await t.json('GET', `/races/${first.id}/entries`)).body as any[];
    const bots = new Set(await confirmedBots(first.id));
    const shown = list.filter((e) => bots.has(e.userId));
    expect(shown.length).toBe(final);
    expect(shown.every((e) => e.bot === false && e.hasTrace && e.hasSetup)).toBe(true);

    // A corrida rodou com eles: resultado publicado e nenhum erro no motor.
    expect((await t.race(first.id)).status).toBe('finished');
    const res = (await t.json('GET', `/races/${first.id}/results`)).body.rows as any[];
    expect(res.filter((r) => bots.has(r.userId))).toHaveLength(final);
    expect(t.ctx.engineErrors).toEqual([]);
  });

  it('somam na contagem de online, e o admin pode desligar isso', async () => {
    const on = (await t.json('GET', '/lobby')).body.stats.online;
    expect(on).toBe(20);
    await saveBotPool({ countOnline: false });
    expect((await t.json('GET', '/lobby')).body.stats.online).toBe(0);
    await saveBotPool({ countOnline: true });
  });

  it('desligar um piloto pelo admin tira ele das corridas ainda abertas', async () => {
    // A corrida da primeira hora já acabou; pega uma com inscrições abertas e pilotos simulados dentro.
    const open = (await t.json('GET', `/races?from=${T0}&to=${T0 + 6 * HOUR}&limit=10`)).body as any[];
    let raceId = '';
    for (const r of open)
      if (r.status === 'registration_open' && (await confirmedBots(r.id)).length) raceId = r.id;
    expect(raceId).not.toBe('');
    expect(raceId).not.toBe(firstRace);
    const [bot] = await confirmedBots(raceId);
    const r = await t.json('PATCH', `/admin/bots/${bot}`, { active: false }, t.admin, {
      'x-tracado-csrf': '1',
    });
    expect(r.status).toBe(200);
    expect(r.body.leftRaces).toBeGreaterThan(0);
    expect(await confirmedBots(raceId)).not.toContain(bot);
    const pending = await t.ctx.db
      .select()
      .from(botPlans)
      .where(and(eq(botPlans.userId, bot!), isNull(botPlans.doneAt)));
    expect(pending).toHaveLength(0);
    const list = (await t.json('GET', '/admin/bots', undefined, t.admin)).body.bots as any[];
    expect(list.find((b) => b.userId === bot).active).toBe(false);
  });

  it('com o grid cheio, um piloto simulado cede a vaga para gente', async () => {
    const raceId = await t.createRace({ capacity: 3 }, 2 * HOUR);
    const ids = (
      await t.ctx.db.select({ id: botPersonas.userId }).from(botPersonas).where(eq(botPersonas.active, true))
    )
      .map((r) => r.id)
      .slice(0, 3);
    const now = t.clock.now();
    await t.ctx.db
      .insert(entries)
      .values(
        ids.map((userId, i) => ({
          raceId,
          userId,
          status: 'confirmed' as const,
          carColor: 'red',
          carModel: i + 1,
          carNumber: 60 + i,
          confirmedAt: new Date(now + i),
        })),
      );
    const u = await t.register('gente');
    const r = await t.json('POST', `/races/${raceId}/entries`, {}, u.token, { 'x-tracado-csrf': '1' });
    expect(r.body.status).toBe('confirmed');
    const left = await confirmedBots(raceId);
    expect(left).toHaveLength(2);
    expect(left).not.toContain(ids[2]); // sai o último que entrou
  });

  it('ranking misto, com opção de mostrar só gente', async () => {
    const season = await ensureActiveSeason(t.ctx.db, t.clock.now());
    const human = await t.register('humano-rank');
    const [bot] = (await t.ctx.db.select({ id: botPersonas.userId }).from(botPersonas).limit(1)).map(
      (r) => r.id,
    );
    await t.ctx.db.insert(rankingEntries).values(
      [
        { userId: bot!, points: 50 },
        { userId: human.userId, points: 10 },
      ].map((e) => ({ seasonId: season.id, scope: 'world' as const, scopeKey: 'world', races: 3, ...e })),
    );
    await t.ctx.store.incr('ranking:ver');
    const ids = async () =>
      ((await t.json('GET', '/rankings?scope=world')).body.rows as any[]).map((r) => r.userId);
    expect(await ids()).toEqual(expect.arrayContaining([bot, human.userId]));
    await saveBotPool({ inRanking: false });
    const only = await ids();
    expect(only).toContain(human.userId);
    expect(only).not.toContain(bot);
    await saveBotPool({ inRanking: true });
  });

  it('desligado no admin, nenhum piloto simulado se inscreve mais', async () => {
    const joined = async () =>
      (await t.ctx.db.select().from(botPlans).where(eq(botPlans.outcome, 'joined'))).length;
    const before = await joined();
    expect(before).toBeGreaterThan(0);
    await saveBotPool({ enabled: false });
    await t.advance(2 * HOUR);
    expect(await joined()).toBe(before);
    const skipped = await t.ctx.db.select().from(botPlans).where(eq(botPlans.outcome, 'skipped'));
    expect(skipped.length).toBeGreaterThan(0);
  });
});

describe('pilotos simulados ligados com a grade já aberta', () => {
  it('planeja as corridas que já estavam com inscrições abertas', async () => {
    const u = await setupApp({ AUTO_RACES_PER_DAY: 24, AUTO_RACES_CATEGORY: 'teste' });
    try {
      await u.engine.tick(); // grade criada e aberta sem pilotos simulados
      const before = await u.ctx.db.select().from(botPlans);
      expect(before).toHaveLength(0);
      const cur = (await u.json('GET', '/admin/settings', undefined, u.admin)).body.settings;
      await u.json(
        'PUT',
        '/admin/settings',
        { ...cur, botPool: { ...cur.botPool, enabled: true, activeMin: 20, activeMax: 20 } },
        u.admin,
        { 'x-tracado-csrf': '1' },
      );
      await u.ctx.db.update(botPersonas).set({ hourFrom: 0, hourTo: 0, joinRate: 1 });
      await u.engine.tick(); // o PUT antecipa a checagem por minuto
      const plans = await u.ctx.db.select().from(botPlans);
      expect(new Set(plans.map((p) => p.raceId)).size).toBeGreaterThan(1);
      // Uma vez só por corrida.
      await u.advance(2 * MIN);
      expect((await u.ctx.db.select().from(botPlans)).length).toBeGreaterThanOrEqual(plans.length);
      const again = await u.ctx.db.select().from(botPlans);
      const perRace = new Map<string, number>();
      for (const p of again) perRace.set(p.raceId, (perRace.get(p.raceId) ?? 0) + 1);
      expect(Math.max(...perRace.values())).toBeLessThanOrEqual(10);
    } finally {
      await u.close();
    }
  });
});
