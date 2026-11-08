import { DEFAULT_SETUP } from '@tracado/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { profiles, raceReplays, users } from '../src/db/schema';
import { setupApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => (t = await setupApp({ AUTO_RACES_CATEGORY: 'teste' })));
afterAll(() => t.close());

const cookieOf = (res: { cookies: { name: string; value: string }[] }) =>
  res.cookies.find((c) => c.name === 'tracado_rt')?.value;

describe('Corrida Maluca', () => {
  it('grupo fechado: convite, convidado, corridas privadas, troféus e campeonato', async () => {
    const dono = await t.register('Dono');
    const startAt = new Date(t.clock.now() + 10 * 60_000).toISOString();
    const created = await t.json(
      'POST',
      '/crazy/groups',
      { name: 'Turma do Kart', races: 3, laps: 6, startAt, intervalMinutes: 20 },
      dono.token,
    );
    expect(created.status).toBe(201);
    const g = created.body;
    expect(g.schedule).toHaveLength(3);
    expect(g.inviteCode).toBeTruthy();
    expect(g.isOwner).toBe(true);
    expect(g.chaos).toBe(true);
    expect(g.botFill).toBe(0);
    const [r1, r2] = g.schedule.map((s: { raceId: string }) => s.raceId) as [string, string, string];
    await t.engine.tick();

    // Convite: prévia pública, sem o código no detalhe para quem não é membro.
    const prev = await t.json('GET', `/crazy/invite/${g.inviteCode}`);
    expect(prev.body.name).toBe('Turma do Kart');
    expect(prev.body.members).toEqual(['Dono']);
    expect((await t.json('GET', `/crazy/groups/${g.id}`)).body.inviteCode).toBeNull();
    expect((await t.json('GET', '/crazy/invite/codigo-que-nao-existe')).status).toBe(404);
    // Links com prévia (WhatsApp): convite e página do grupo; o do grupo não expõe o código.
    const sInv = await t.app.inject({ method: 'GET', url: `/s/maluca/${g.inviteCode}` });
    expect(sInv.body).toContain('og:title" content="🤪 Convite: Turma do Kart · Corrida Maluca"');
    expect(sInv.body).toContain(`url=/corrida-maluca/convite/${g.inviteCode}"`);
    const sGrp = await t.app.inject({ method: 'GET', url: `/s/grupo/${g.id}` });
    expect(sGrp.body).toContain('🤪 Turma do Kart · Corrida Maluca');
    expect(sGrp.body).toContain(`url=/corrida-maluca/${g.id}"`);
    expect(sGrp.body).not.toContain(g.inviteCode);
    expect((await t.app.inject({ method: 'GET', url: '/s/maluca/nao-existe' })).body).toContain(
      'url=/corrida-maluca"',
    );

    // Convidado entra só com apelido e já está inscrito em todas as corridas do grupo.
    const guest = await t.json('POST', '/auth/guest', {
      inviteCode: g.inviteCode,
      nickname: 'Zezinho',
      carColor: 'blue',
    });
    expect(guest.status).toBe(201);
    expect(guest.body.me.guest).toBe(true);
    expect(guest.body.me.email).toBe('');
    expect(guest.body.groupId).toBe(g.id);
    expect(cookieOf(guest.res)).toBeTruthy();
    const zeId = guest.body.me.id as string;
    const ze = `USER:${zeId}`;
    // Apelido repetido: erro com sugestão.
    const dup = await t.json('POST', '/auth/guest', { inviteCode: g.inviteCode, nickname: 'zezinho' });
    expect(dup.body.error.code).toBe('NICKNAME_TAKEN');
    expect(dup.body.error.details.suggestion).toMatch(/^zezinho\d\d$/);

    // Quem já tem conta entra pelo convite.
    const bia = await t.register('Bia');
    expect((await t.json('POST', `/crazy/invite/${g.inviteCode}/join`, {}, bia.token)).status).toBe(200);
    let race = await t.race(r1);
    expect(race.crazy).toMatchObject({ groupId: g.id, groupName: 'Turma do Kart', round: 1, rounds: 3 });
    expect(race.ranked).toBe(false);
    expect(race.entries.filter((e: { status: string }) => e.status === 'confirmed')).toHaveLength(3);

    // Fora das listas públicas.
    const list = (await t.json('GET', '/races?test=all')).body as { id: string }[];
    expect(list.some((r) => r.id === r1)).toBe(false);
    const lobby = (await t.json('GET', '/lobby', undefined, bia.token)).body;
    expect(lobby.upcoming.some((r: { id: string }) => r.id === r1)).toBe(false);

    // Grupo fechado: quem não é membro não se inscreve; convidado não entra em corrida aberta nem cria grupo.
    const intruso = await t.register('Intruso');
    expect((await t.json('POST', `/races/${r1}/entries`, {}, intruso.token)).body.error.code).toBe(
      'FORBIDDEN',
    );
    const publica = await t.createRace({}, 90 * 60_000);
    expect((await t.json('POST', `/races/${publica}/entries`, {}, ze)).body.error.message).toMatch(
      /Convidados/,
    );
    expect(
      (await t.json('POST', '/crazy/groups', { name: 'Outra', races: 1, startAt }, ze)).body.error.code,
    ).toBe('FORBIDDEN');

    // Link pessoal de volta: entra de novo como o mesmo convidado.
    const link = await t.json('POST', '/crazy/guest-link', {}, ze);
    const key = (link.body.url as string).split('/voltar/')[1]!;
    const back = await t.json('POST', '/auth/guest/resume', { key });
    expect(back.body.me.id).toBe(zeId);
    expect((await t.json('POST', '/auth/guest/resume', { key: 'x'.repeat(40) })).status).toBe(401);
    // Gerar outro link invalida o anterior.
    await t.json('POST', '/crazy/guest-link', {}, ze);
    expect((await t.json('POST', '/auth/guest/resume', { key })).status).toBe(401);

    // Meus grupos.
    const mine = (await t.json('GET', '/crazy/groups', undefined, ze)).body;
    expect(mine.map((x: { id: string }) => x.id)).toEqual([g.id]);
    // Miniatura do card: a etapa atual ou a próxima.
    expect(mine[0].featured.id).toBe(r1);
    expect(mine[0].featured.track.versionId).toBeTruthy();

    // Corrida 1 inteira. A Bia mexe no setup; o resto fica no padrão (Piloto de Sofá).
    expect(
      (
        await t.json(
          'PUT',
          `/races/${r1}/setup`,
          { ...DEFAULT_SETUP, pitStops: [{ lap: 3, tyre: 'hard' }] },
          bia.token,
        )
      ).status,
    ).toBe(200);
    race = await t.race(r1);
    for (const at of ['practiceAt', 'traceWindowAt', 'setupLockAt', 'qualifyingAt', 'raceAt'] as const)
      await t.advanceTo(Date.parse(race.timeline[at]));
    race = await t.race(r1);
    expect(race.status).toBe('race');
    // Membro que chega depois da largada entra só nas próximas.
    const caio = await t.register('Caio');
    await t.json('POST', `/crazy/invite/${g.inviteCode}/join`, {}, caio.token);
    expect((await t.race(r1)).entries.some((e: { userId: string }) => e.userId === caio.userId)).toBe(false);
    expect((await t.race(r2)).entries.some((e: { userId: string }) => e.userId === caio.userId)).toBe(true);
    await t.advanceTo(Date.parse(race.timeline.raceEndsAt));
    expect((await t.race(r1)).status).toBe('finished');

    const detail = (await t.json('GET', `/crazy/groups/${g.id}`, undefined, bia.token)).body;
    expect(detail.status).toBe('running');
    expect(detail.finishedRaces).toBe(1);
    expect(detail.featured.id).toBe(r2);
    expect(detail.schedule[0].race.track.versionId).toBeTruthy();
    expect(detail.inviteCode).toBe(g.inviteCode);
    const s1 = detail.schedule[0];
    expect(s1.podium).toHaveLength(3);
    const keys = s1.awards.map((a: { key: string }) => a.key);
    expect(keys).toContain('rocket');
    expect(keys).toContain('turtle');
    const couch = s1.awards.filter((a: { key: string }) => a.key === 'couch');
    expect(couch.map((a: { userId: string }) => a.userId).sort()).toEqual([dono.userId, zeId].sort());
    for (const a of s1.awards) expect(a.line).toContain(a.nickname);
    // Pontos entre os amigos: 10 + 8 + 6; Caio entrou depois e está zerado.
    const pts = detail.standings.map((s: { points: number }) => s.points);
    expect(pts).toEqual([10, 8, 6, 0]);
    expect(detail.standings[3].userId).toBe(caio.userId);
    expect(detail.memberList.find((m: { userId: string }) => m.userId === zeId).guest).toBe(true);

    // Modo caos: eventos aleatórios ligados na simulação.
    const [rep] = await t.ctx.db.select().from(raceReplays).where(eq(raceReplays.raceId, r1));
    expect((rep!.simInput as { randomEvents: unknown }).randomEvents).toEqual({
      safetyCar: true,
      oil: true,
      mechanical: true,
    });

    // Convidado vira conta normal.
    const up = await t.json(
      'POST',
      '/auth/guest/upgrade',
      { email: 'ze@teste.dev', password: 'senha-forte-1' },
      ze,
    );
    expect(up.body.guest).toBe(false);
    expect(up.body.email).toBe('ze@teste.dev');
    expect((await t.login('ze@teste.dev', 'senha-forte-1')).status).toBe(200);
  });

  it('bots só quando o dono libera, completando o grid até o número escolhido', async () => {
    // Pilotos de demonstração no banco (em produção vêm do seed).
    for (let i = 0; i < 8; i++) {
      const [u] = await t.ctx.db
        .insert(users)
        .values({ email: `bot-maluco${i}@tracado.local`, passwordHash: 'x', isBot: true })
        .returning();
      await t.ctx.db
        .insert(profiles)
        .values({ userId: u!.id, nickname: `BotMaluco${i}`, country: 'BR', region: 'SP', city: 'X' });
    }
    const dono = await t.register('DonoBots');
    const startAt = new Date(t.clock.now() + 10 * 60_000).toISOString();
    const comBots = (
      await t.json(
        'POST',
        '/crazy/groups',
        { name: 'Com bots', races: 1, laps: 5, startAt, botFill: 6, chaos: false },
        dono.token,
      )
    ).body;
    const semBots = (
      await t.json('POST', '/crazy/groups', { name: 'Sem bots', races: 1, laps: 5, startAt }, dono.token)
    ).body;
    const a = comBots.schedule[0].raceId as string;
    const b = semBots.schedule[0].raceId as string;
    await t.engine.tick();
    const ra = await t.race(a);
    await t.advanceTo(Date.parse(ra.timeline.traceWindowAt));
    const confirmed = async (id: string) =>
      (await t.race(id)).entries.filter((e: { status: string }) => e.status === 'confirmed').length;
    expect(await confirmed(a)).toBe(6);
    expect(await confirmed(b)).toBe(1);
    await t.advanceTo(Date.parse(ra.timeline.raceAt));
    await t.advanceTo(Date.parse((await t.race(a)).timeline.raceEndsAt));
    const det = (await t.json('GET', `/crazy/groups/${comBots.id}`, undefined, dono.token)).body;
    // Bots não pontuam nem levam troféu: o dono é o único na tabela e o primeiro entre os amigos.
    expect(det.standings).toHaveLength(1);
    expect(det.standings[0].points).toBe(10);
    for (const aw of det.schedule[0].awards) expect(aw.userId).toBe(dono.userId);
    expect(det.status).toBe('finished');
  });

  it('pular o preparo: todos prontos ou o organizador manda largar (com metade pronta)', async () => {
    const org = await t.register('Organiza');
    const startAt = new Date(t.clock.now() + 5 * 60_000).toISOString();
    const g = (
      await t.json(
        'POST',
        '/crazy/groups',
        { name: 'Pressa', races: 2, laps: 5, startAt, intervalMinutes: 30 },
        org.token,
      )
    ).body;
    const [r1, r2] = g.schedule.map((s: { raceId: string }) => s.raceId) as [string, string];
    const a = await t.register('AmigoA');
    const b = await t.register('AmigoB');
    for (const p of [a, b]) await t.json('POST', `/crazy/invite/${g.inviteCode}/join`, {}, p.token);
    await t.engine.tick();

    // Sem treino, o preparo é com as inscrições abertas, mas só da próxima etapa: a 2 espera a 1 acabar.
    expect((await t.json('PUT', `/races/${r2}/ready`, { ready: true }, a.token)).body.error.code).toBe(
      'INVALID_TRANSITION',
    );
    let race = await t.race(r1);
    expect(race.status).toBe('registration_open');
    const raceAtBefore = Date.parse(race.timeline.raceAt);
    const qualiMs = raceAtBefore - Date.parse(race.timeline.qualifyingAt);

    // Organizador sem ninguém pronto: espera. Quem não é organizador: proibido.
    expect((await t.json('POST', `/races/${r1}/start-now`, {}, org.token)).body.error.code).toBe('CONFLICT');
    expect((await t.json('POST', `/races/${r1}/start-now`, {}, a.token)).body.error.code).toBe('FORBIDDEN');

    // Dois de três prontos: ainda não pula sozinho, mas o organizador já pode mandar largar.
    let r = (await t.json('PUT', `/races/${r1}/ready`, { ready: true }, a.token)).body;
    expect(r).toMatchObject({ humans: 3, ready: 1, skipped: false });
    r = (await t.json('PUT', `/races/${r1}/ready`, { ready: true }, b.token)).body;
    expect(r).toMatchObject({ ready: 2, skipped: false });
    race = await t.race(r1);
    expect(race.status).toBe('registration_open');
    expect(race.entries.filter((e: { ready: boolean }) => e.ready)).toHaveLength(2);
    const now = t.clock.now();
    r = (await t.json('POST', `/races/${r1}/start-now`, {}, org.token)).body;
    expect(r.skipped).toBe(true);
    race = await t.race(r1);
    expect(race.status).toBe('setup_lock');
    expect(Date.parse(race.timeline.qualifyingAt)).toBe(now + 10_000);
    // A classificação ao vivo continua com a mesma duração.
    expect(Date.parse(race.timeline.raceAt) - Date.parse(race.timeline.qualifyingAt)).toBe(qualiMs);
    expect(Date.parse(race.timeline.raceAt)).toBeLessThan(raceAtBefore);
    // Depois de pular, não dá mais para mexer.
    expect((await t.json('PUT', `/races/${r1}/ready`, { ready: false }, a.token)).body.error.code).toBe(
      'INVALID_TRANSITION',
    );
    await t.advanceTo(Date.parse(race.timeline.qualifyingAt));
    expect((await t.race(r1)).status).toBe('qualifying');
    await t.advanceTo(Date.parse(race.timeline.raceAt));
    expect((await t.race(r1)).status).toBe('race');

    // Etapa 2 sem mudança de horário; depois da bandeirada da 1, todos prontos pulam sozinhos.
    let race2 = await t.race(r2);
    expect(Date.parse(race2.timeline.practiceAt)).toBe(Date.parse(startAt) + 30 * 60_000);
    await t.advanceTo(Date.parse((await t.race(r1)).timeline.raceEndsAt) + 1000);
    expect((await t.race(r1)).status).toBe('finished');
    expect((await t.race(r2)).status).toBe('registration_open');
    for (const p of [a, b]) await t.json('PUT', `/races/${r2}/ready`, { ready: true }, p.token);
    r = (await t.json('PUT', `/races/${r2}/ready`, { ready: true }, org.token)).body;
    expect(r).toMatchObject({ humans: 3, ready: 3, skipped: true });
    race2 = await t.race(r2);
    expect(race2.status).toBe('setup_lock');

    // Corrida aberta não tem "pronto".
    const publica = await t.createRace({}, 60 * 60_000);
    expect((await t.json('PUT', `/races/${publica}/ready`, { ready: true }, a.token)).body.error.code).toBe(
      'FORBIDDEN',
    );
  });
});
