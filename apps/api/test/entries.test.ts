import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => (t = await setupApp()));
afterAll(() => t.close());

const users = async (n: number, prefix: string) => {
  const out = [];
  for (let i = 0; i < n; i++) out.push(await t.register(`${prefix}${i}`));
  return out;
};

describe('inscrições com limite de 22 carros', () => {
  it('22 confirmam, a 23ª vai para a fila e a capacidade é exibida', async () => {
    const race = await t.createRace();
    const us = await users(23, 'cap');
    for (const u of us.slice(0, 22))
      expect((await t.json('POST', `/races/${race}/entries`, {}, u.token)).body.status).toBe('confirmed');
    const last = await t.json('POST', `/races/${race}/entries`, {}, us[22]!.token);
    expect(last.body).toMatchObject({ status: 'waitlisted', waitlistPosition: 1 });
    expect(last.body.capacity).toMatchObject({ capacity: 22, confirmed: 22, waitlisted: 1, free: 0 });
    const d = await t.race(race);
    expect(
      new Set(
        d.entries.filter((e: any) => e.status === 'confirmed').map((e: any) => `${e.carColor}-${e.carModel}`),
      ).size,
    ).toBe(22);
    expect(
      new Set(d.entries.filter((e: any) => e.status === 'confirmed').map((e: any) => e.carNumber)).size,
    ).toBe(22);
  });

  it('duas tentativas simultâneas pela última vaga: exatamente uma confirma', async () => {
    const race = await t.createRace({}, 3 * 3600_000);
    const us = await users(23, 'last');
    for (const u of us.slice(0, 21)) await t.json('POST', `/races/${race}/entries`, {}, u.token);
    const [a, b] = await Promise.all([
      t.json('POST', `/races/${race}/entries`, {}, us[21]!.token),
      t.json('POST', `/races/${race}/entries`, {}, us[22]!.token),
    ]);
    expect([a.body.status, b.body.status].sort()).toEqual(['confirmed', 'waitlisted']);
    expect((await t.race(race)).capacity).toMatchObject({ confirmed: 22, waitlisted: 1 });
  });

  it('50 inscrições em paralelo: 22 confirmadas, 10 na fila, o resto RACE_FULL', async () => {
    const race = await t.createRace({}, 6 * 3600_000);
    const us = await users(50, 'par');
    const res = await Promise.all(us.map((u) => t.json('POST', `/races/${race}/entries`, {}, u.token)));
    const count = (pred: (r: any) => boolean) => res.filter(pred).length;
    expect(count((r) => r.body.status === 'confirmed')).toBe(22);
    expect(count((r) => r.body.status === 'waitlisted')).toBe(10);
    expect(count((r) => r.body.error?.code === 'RACE_FULL')).toBe(18);
  });

  it('cancelar libera a vaga e promove o primeiro da fila', async () => {
    const race = await t.createRace({ capacity: 2, waitlistMax: 2 }, 9 * 3600_000);
    const [a, b, c, d] = await users(4, 'promo');
    for (const u of [a, b, c, d]) await t.json('POST', `/races/${race}/entries`, {}, u!.token);
    const r = await t.json('DELETE', `/races/${race}/entries/me`, undefined, a!.token);
    expect(r.body).toMatchObject({ status: 'cancelled', promoted: c!.userId });
    const det = await t.race(race);
    expect(det.entries.find((e: any) => e.userId === c!.userId).status).toBe('confirmed');
    expect(det.entries.find((e: any) => e.userId === d!.userId).waitlistPosition).toBe(1);
    const notes = await t.json('GET', '/notifications', undefined, c!.token);
    expect(notes.body.map((n: any) => n.type)).toContain('entry_promoted');
  });

  it('não permite inscrição duplicada, fora da janela, nem em horários sobrepostos', async () => {
    const r1 = await t.createRace({}, 12 * 3600_000);
    const r2 = await t.createRace({}, 12 * 3600_000 + 5 * 60_000);
    const [u] = await users(1, 'dup');
    expect((await t.json('POST', `/races/${r1}/entries`, {}, u!.token)).status).toBe(201);
    expect((await t.json('POST', `/races/${r1}/entries`, {}, u!.token)).body.error.code).toBe(
      'ALREADY_REGISTERED',
    );
    expect((await t.json('POST', `/races/${r2}/entries`, {}, u!.token)).body.error.code).toBe(
      'SCHEDULE_CONFLICT',
    );
    const far = await t.createRace({ registrationLeadMinutes: 10 }, 48 * 3600_000);
    expect((await t.json('POST', `/races/${far}/entries`, {}, u!.token)).body.error.code).toBe(
      'REGISTRATION_CLOSED',
    );
  });

  it('respeita o nível exigido pela categoria', async () => {
    const cat = await t.json(
      'POST',
      '/admin/categories',
      {
        slug: 'elite-x',
        name: 'Elite X',
        level: 'elite',
        config: {
          ...(await t.json('GET', '/categories')).body[0].config,
          entryRequirement: { minLevel: 'elite', minRaces: 0 },
        },
      },
      t.admin,
    );
    const race = await t.createRace({ categoryId: cat.body.id }, 20 * 3600_000);
    const [u] = await users(1, 'nov');
    expect((await t.json('POST', `/races/${race}/entries`, {}, u!.token)).body.error.code).toBe(
      'INELIGIBLE_LEVEL',
    );
  });
});

describe('escolha do carro', () => {
  it('troca para um carro livre, recusa um carro ocupado e trava no parque fechado', async () => {
    const race = await t.createRace({}, 15 * 3600_000);
    const [a, b, c] = await users(3, 'car');
    for (const u of [a, b]) await t.json('POST', `/races/${race}/entries`, {}, u!.token);
    const det = await t.race(race);
    const carB = det.entries.find((e: any) => e.userId === b!.userId);

    const ok = await t.json('PUT', `/races/${race}/car`, { carColor: 'green', carModel: 4 }, a!.token);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ carColor: 'green', carModel: 4 });
    expect((await t.race(race)).entries.find((e: any) => e.userId === a!.userId)).toMatchObject({
      carColor: 'green',
      carModel: 4,
    });

    const taken = await t.json(
      'PUT',
      `/races/${race}/car`,
      { carColor: carB.carColor, carModel: carB.carModel },
      a!.token,
    );
    expect(taken.body.error.code).toBe('CAR_TAKEN');
    expect(
      (await t.json('PUT', `/races/${race}/car`, { carColor: 'pink', carModel: 1 }, a!.token)).status,
    ).toBe(400);
    expect(
      (await t.json('PUT', `/races/${race}/car`, { carColor: 'red', carModel: 2 }, c!.token)).body.error.code,
    ).toBe('NOT_REGISTERED');
  });
});

describe('minhas corridas', () => {
  it('lista as corridas em que o jogador está inscrito e exige login', async () => {
    const r1 = await t.createRace({ name: 'Minha A' }, 20 * 3600_000);
    const r2 = await t.createRace({ name: 'Outra B' }, 22 * 3600_000);
    const [u] = await users(1, 'minhas');
    await t.json('POST', `/races/${r1}/entries`, {}, u!.token);
    const mine = await t.json('GET', '/me/races', undefined, u!.token);
    expect(mine.status).toBe(200);
    expect(mine.body.map((r: any) => r.id)).toEqual([r1]);
    expect(mine.body.map((r: any) => r.id)).not.toContain(r2);
    expect((await t.json('GET', '/me/races')).status).toBe(401);
  });
});

describe('inscrição tardia', () => {
  it('no treino e na janela de traçado entra quem achar vaga; grid cheio e parque fechado recusam', async () => {
    const race = await t.createRace({ capacity: 2, waitlistMax: 2 }, 24 * 3600_000);
    const [a, b, c, d] = await users(4, 'tarde');
    await t.json('POST', `/races/${race}/entries`, {}, a!.token);
    const { timeline } = await t.race(race);
    await t.advanceTo(Date.parse(timeline.practiceAt));
    expect((await t.race(race)).status).toBe('practice');
    const late = await t.json('POST', `/races/${race}/entries`, {}, b!.token);
    expect(late.body.status).toBe('confirmed');
    // Grid cheio: sem fila de espera depois que o treino começou.
    expect((await t.json('POST', `/races/${race}/entries`, {}, c!.token)).body.error.code).toBe('RACE_FULL');
    await t.json('DELETE', `/races/${race}/entries/me`, undefined, b!.token);
    await t.advanceTo(Date.parse(timeline.traceWindowAt));
    expect((await t.race(race)).status).toBe('trace_window');
    expect((await t.json('POST', `/races/${race}/entries`, {}, c!.token)).body.status).toBe('confirmed');
    await t.advanceTo(Date.parse(timeline.setupLockAt));
    expect((await t.json('POST', `/races/${race}/entries`, {}, d!.token)).body.error.code).toBe(
      'REGISTRATION_CLOSED',
    );
  });
});
