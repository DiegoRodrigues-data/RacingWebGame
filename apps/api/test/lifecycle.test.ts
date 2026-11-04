import { DEFAULT_SETUP, TRACE_WINDOW_MS } from '@tracado/shared';
import { offsetsToTrace, suggestedLine, type TrackGeometry } from '@tracado/trackgen';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clearGeometryCache } from '../src/modules/tracks/service';
import { setupApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => (t = await setupApp()));
afterAll(() => t.close());

describe('ciclo de vida completo de uma corrida (fluxo crítico)', () => {
  it('criação → inscrição → treino → traçado (5 min) → parque fechado → classificação → corrida → resultado → ranking', async () => {
    const raceId = await t.createRace({ ranked: true }, 20 * 60_000);
    let race = await t.race(raceId);
    expect(race.status).toBe('registration_open');
    const players = [
      await t.register('Ana', { city: 'Campinas' }),
      await t.register('Bruno', { city: 'Santos' }),
      await t.register('Caio', { country: 'PT', region: 'Lisboa', city: 'Lisboa' }),
    ];
    for (const p of players)
      expect((await t.json('POST', `/races/${raceId}/entries`, {}, p.token)).status).toBe(201);

    // Setup pode ser salvo antes do treino; limites da categoria são respeitados.
    const [ana, bruno, caio] = players as [(typeof players)[0], (typeof players)[0], (typeof players)[0]];
    const oneStop = [{ lap: 15, tyre: 'hard' as const }];
    expect(
      (
        await t.json(
          'PUT',
          `/races/${raceId}/setup`,
          { ...DEFAULT_SETUP, tyre: 'soft', pitStops: oneStop },
          ana.token,
        )
      ).status,
    ).toBe(200);
    // Parada nos boxes é obrigatória.
    const noStop = await t.json(
      'PUT',
      `/races/${raceId}/setup`,
      { ...DEFAULT_SETUP, pitStops: [] },
      ana.token,
    );
    expect(noStop.body.error.code).toBe('SETUP_INVALID');
    expect(noStop.body.error.message).toMatch(/obrigatória/);
    const bad = await t.json(
      'PUT',
      `/races/${raceId}/setup`,
      {
        ...DEFAULT_SETUP,
        pitStops: [
          { lap: 1, tyre: 'hard' },
          { lap: 2, tyre: 'soft' },
        ],
      },
      ana.token,
    );
    expect(bad.body.error.code).toBe('SETUP_INVALID');

    // Traçado antes da janela já fica salvo no servidor (vale mesmo se o jogador fechar a página).
    const g: TrackGeometry = (await t.json('GET', `/tracks/versions/${race.track.versionId}/geometry`)).body;
    const trace = offsetsToTrace(suggestedLine(g), 256);
    expect((await t.json('PUT', `/races/${raceId}/trace`, { points: trace }, ana.token)).body.version).toBe(
      1,
    );
    expect((await t.json('GET', `/races/${raceId}`, undefined, ana.token)).body.me.hasTrace).toBe(true);

    // Treino.
    await t.advanceTo(Date.parse(race.timeline.practiceAt));
    race = await t.race(raceId);
    expect(race.status).toBe('practice');
    expect(
      (await t.json('POST', `/races/${raceId}/entries`, {}, (await t.register('Atrasado')).token)).body.error
        .code,
    ).toBe('REGISTRATION_CLOSED');
    const practice = await t.json('GET', `/races/${raceId}/practice`);
    expect(practice.body.reference.suggestedLapMs).toBeLessThan(practice.body.reference.centerlineLapMs);

    // Janela de traçado: 5 minutos, sincronizada com o servidor.
    await t.advanceTo(Date.parse(race.timeline.traceWindowAt));
    race = await t.race(raceId);
    expect(race.status).toBe('trace_window');
    expect(Date.parse(race.phaseDeadline) - Date.parse(race.timeline.traceWindowAt)).toBe(TRACE_WINDOW_MS);
    const ok = await t.json('PUT', `/races/${raceId}/trace`, { points: trace }, ana.token);
    expect(ok.status).toBe(200);
    expect(ok.body.version).toBe(2); // a v1 foi salva antes da janela
    // Limite de envio (2 s).
    expect(
      (await t.json('PUT', `/races/${raceId}/trace`, { points: trace }, ana.token)).body.error.code,
    ).toBe('TRACE_RATE_LIMITED');
    // Ponto fora da pista.
    const out = trace.map((p, i) => (i === 40 ? { ...p, d: 1.5 } : p));
    const rej = await t.json('PUT', `/races/${raceId}/trace`, { points: out }, bruno.token);
    expect(rej.body.error.code).toBe('TRACE_OUT_OF_BOUNDS');
    expect(rej.body.error.details.indices).toContain(40);
    // Edição dentro da janela substitui a versão anterior.
    t.clock.advance(3000);
    expect(
      (
        await t.json(
          'PUT',
          `/races/${raceId}/trace`,
          { points: trace.map((p) => ({ ...p, d: p.d * 0.9 })) },
          ana.token,
        )
      ).body.version,
    ).toBe(3);
    expect((await t.json('PUT', `/races/${raceId}/trace`, { points: trace }, bruno.token)).status).toBe(200);
    // Caio não envia traçado: correrá com a linha central e penalidade.
    // Notificação de 1 minuto restante.
    await t.advanceTo(Date.parse(race.timeline.setupLockAt) - 59_000);
    expect(
      (await t.json('GET', '/notifications', undefined, caio.token)).body.map((n: any) => n.type),
    ).toContain('trace_window_closing');

    // Envio 1 s após o prazo é recusado; setup fica travado.
    await t.advanceTo(Date.parse(race.timeline.setupLockAt) + 1000);
    expect((await t.race(raceId)).status).toBe('setup_lock');
    expect(
      (await t.json('PUT', `/races/${raceId}/trace`, { points: trace }, bruno.token)).body.error.code,
    ).toBe('TRACE_WINDOW_CLOSED');
    expect((await t.json('PUT', `/races/${raceId}/setup`, DEFAULT_SETUP, bruno.token)).body.error.code).toBe(
      'SETUP_LOCKED',
    );

    // Classificação: simulação determinística no servidor.
    // Sem a pista em cache (como logo após reiniciar o servidor): a classificação precisa ler a geometria
    // dentro da transação; com o PGlite, uma leitura por fora travaria o motor.
    clearGeometryCache();
    await t.advanceTo(Date.parse(race.timeline.qualifyingAt));
    race = await t.race(raceId);
    expect(race.status).toBe('qualifying');
    const quali = (await t.json('GET', `/races/${raceId}/qualifying`)).body;
    expect(quali).toHaveLength(3);
    expect(quali.find((q: any) => q.userId === caio.userId)).toMatchObject({
      usedDefaultTrace: true,
      usedDefaultSetup: true,
    });
    expect(race.timeline.raceEndsAt).not.toBeNull();
    expect((await t.json('GET', `/races/${raceId}/replay`)).body.error.code).toBe('CONFLICT');

    // Corrida: replay revela só até o instante atual.
    await t.advanceTo(Date.parse(race.timeline.raceAt));
    expect((await t.race(raceId)).status).toBe('race');
    await t.advance(5000 + 10_000);
    const partial = (await t.json('GET', `/races/${raceId}/replay`)).body;
    expect(partial.complete).toBe(false);
    const lastT = partial.frames[partial.frames.length - 1].t;
    expect(lastT).toBeLessThanOrEqual(10_000 * partial.playbackSpeed);
    expect(partial.frames.length).toBeLessThan(partial.durationMs / 250);
    // Mini mapa dos cards: só a cauda, com o índice do primeiro frame para encaixar os ticks do WebSocket.
    const tail = (await t.json('GET', `/races/${raceId}/replay?tail=4`)).body;
    expect(tail.frames).toEqual(partial.frames.slice(-4));
    expect(tail.fromFrame).toBe(partial.frames.length - 4);
    expect(tail.incidents).toEqual([]);
    expect((await t.json('GET', `/races/${raceId}/results`)).body.error.code).toBe('CONFLICT');

    // Fim: resultado persistido e ranking atualizado.
    await t.advanceTo(Date.parse((await t.race(raceId)).timeline.raceEndsAt) + 10);
    expect((await t.race(raceId)).status).toBe('finished');
    const results = (await t.json('GET', `/races/${raceId}/results`)).body.rows;
    expect(results).toHaveLength(3);
    expect(results[0].position).toBe(1);
    expect(results[0].points).toBeGreaterThanOrEqual(25);
    const world = (await t.json('GET', '/rankings?scope=world', undefined, ana.token)).body;
    expect(world.rows).toHaveLength(3);
    expect(world.rows[0].userId).toBe(results[0].userId);
    expect(world.me.userId).toBe(ana.userId);
    const national = (await t.json('GET', '/rankings?scope=national&key=PT')).body;
    expect(national.rows.map((r: any) => r.userId)).toEqual([caio.userId]);
    const local = (await t.json('GET', '/rankings?scope=local', undefined, ana.token)).body;
    expect(local.key).toBe('BR-sp-campinas');
    expect(local.rows.map((r: any) => r.userId)).toEqual([ana.userId]);
    const replay = (await t.json('GET', `/races/${raceId}/replay`)).body;
    expect(replay.complete).toBe(true);
    expect(replay.frames[replay.frames.length - 1].t).toBe(replay.durationMs);

    // Auditoria: reprocessar reproduz exatamente o mesmo resultado.
    const re = await t.json('POST', `/admin/races/${raceId}/reprocess`, {}, t.admin);
    expect(re.body.match).toBe(true);

    // Anulação: pontos zerados e rankings reconstruídos.
    const an = await t.json('POST', `/admin/races/${raceId}/annul`, { reason: 'teste de anulação' }, t.admin);
    expect(an.status).toBe(200);
    expect((await t.json('GET', '/rankings?scope=world')).body.rows).toHaveLength(0);
    expect((await t.json('GET', `/races/${raceId}/results`)).body.annulled).toBe(true);
    const audit = (await t.json('GET', '/admin/audit', undefined, t.admin)).body.map((a: any) => a.action);
    expect(audit).toEqual(expect.arrayContaining(['race.create', 'race.reprocess', 'race.annul']));

    // Arquivamento 24 h depois.
    await t.advance(24 * 3600_000 + 1000);
    expect((await t.race(raceId)).status).toBe('archived');
  });
});

describe('motor de fases', () => {
  it('é idempotente: ticks concorrentes não aplicam a mesma transição duas vezes', async () => {
    const raceId = await t.createRace({}, 50 * 60_000);
    const p = await t.register('Idem');
    await t.json('POST', `/races/${raceId}/entries`, {}, p.token);
    const race = await t.race(raceId);
    t.clock.set(Date.parse(race.timeline.qualifyingAt));
    await Promise.all([t.engine.tick(), t.engine.tick(), t.engine.tick()]);
    expect((await t.race(raceId)).status).toBe('qualifying');
    expect((await t.json('GET', `/races/${raceId}/qualifying`)).body).toHaveLength(1);
  });

  it('recupera corridas atrasadas após queda, aplicando transições em cadeia', async () => {
    const raceId = await t.createRace({}, 80 * 60_000);
    const p = await t.register('Recup');
    await t.json('POST', `/races/${raceId}/entries`, {}, p.token);
    const race = await t.race(raceId);
    t.clock.set(Date.parse(race.timeline.raceAt) + 3600_000); // servidor "ficou fora" até depois da corrida
    await t.engine.tick();
    const after = await t.race(raceId);
    expect(after.status).toBe('finished');
    expect((await t.json('GET', `/races/${raceId}/results`)).body.rows).toHaveLength(1);
  });

  it('cancela automaticamente corrida sem inscritos e notifica no cancelamento administrativo', async () => {
    const empty = await t.createRace({}, 120 * 60_000);
    await t.advanceTo(Date.parse((await t.race(empty)).timeline.practiceAt));
    expect((await t.race(empty)).status).toBe('cancelled');
    const r2 = await t.createRace({}, 200 * 60_000);
    const p = await t.register('Cancel');
    await t.json('POST', `/races/${r2}/entries`, {}, p.token);
    expect(
      (await t.json('POST', `/admin/races/${r2}/cancel`, { reason: 'chuva forte' }, t.admin)).body.status,
    ).toBe('cancelled');
    expect(
      (await t.json('GET', '/notifications', undefined, p.token)).body.map((n: any) => n.type),
    ).toContain('race_cancelled');
  });

  it('desistência durante o treino não promove a fila e o piloto não larga', async () => {
    const raceId = await t.createRace({ capacity: 2, waitlistMax: 1 }, 300 * 60_000);
    const [a, b, c] = [await t.register('Wd1'), await t.register('Wd2'), await t.register('Wd3')];
    for (const u of [a, b, c]) await t.json('POST', `/races/${raceId}/entries`, {}, u.token);
    await t.advanceTo(Date.parse((await t.race(raceId)).timeline.practiceAt));
    expect((await t.json('DELETE', `/races/${raceId}/entries/me`, undefined, a.token)).body).toMatchObject({
      status: 'withdrawn',
      promoted: null,
    });
    const race = await t.race(raceId);
    await t.advanceTo(Date.parse(race.timeline.qualifyingAt));
    const q = (await t.json('GET', `/races/${raceId}/qualifying`)).body;
    expect(q.map((r: any) => r.userId)).toEqual([b.userId]);
  });
});
