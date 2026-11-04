import { ROOM, type WsEnvelope } from '@tracado/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { setupApp, type TestApp } from './helpers';

let t: TestApp;
let base: string;
beforeAll(async () => {
  t = await setupApp();
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = t.app.server.address() as { port: number };
  base = `ws://127.0.0.1:${addr.port}/ws`;
});
afterAll(() => t.close());

class Client {
  msgs: WsEnvelope[] = [];
  ws: WebSocket;
  closed: { code: number } | null = null;
  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (d) => this.msgs.push(JSON.parse(String(d))));
    this.ws.on('close', (code) => (this.closed = { code }));
  }
  open() {
    return new Promise<void>((res, rej) => {
      this.ws.once('open', () => res());
      this.ws.once('error', rej);
    });
  }
  send(m: object) {
    this.ws.send(JSON.stringify(m));
  }
  async waitFor(pred: (m: WsEnvelope) => boolean, ms = 3000): Promise<WsEnvelope> {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const m = this.msgs.find(pred);
      if (m) return m;
      await new Promise((r) => setTimeout(r, 15));
    }
    throw new Error(`timeout; recebidas: ${this.msgs.map((m) => m.type).join(',')}`);
  }
  close() {
    this.ws.close();
  }
}

describe('WebSocket', () => {
  it('visitante recebe hello e snapshot da corrida; capacidade em tempo real', async () => {
    const raceId = await t.createRace();
    const c = new Client(base);
    await c.open();
    await c.waitFor((m) => m.type === 'hello');
    c.send({ type: 'subscribe', room: ROOM.race(raceId) });
    const snap = await c.waitFor((m) => m.type === 'race.snapshot');
    expect((snap.payload as any).race.id).toBe(raceId);
    const u = await t.register('Wsu');
    await t.json('POST', `/races/${raceId}/entries`, {}, u.token);
    const cap = await c.waitFor((m) => m.type === 'race.capacity');
    expect((cap.payload as any).confirmed).toBe(1);
    c.close();
  });

  it('reconexão com lastSeq recebe os eventos perdidos, incluindo mudança de fase', async () => {
    const raceId = await t.createRace({}, 40 * 60_000);
    const u = await t.register('Recon');
    await t.json('POST', `/races/${raceId}/entries`, {}, u.token);
    const c1 = new Client(base);
    await c1.open();
    c1.send({ type: 'subscribe', room: ROOM.race(raceId) });
    const snap = await c1.waitFor((m) => m.type === 'race.snapshot');
    const lastSeq = snap.seq;
    c1.close();
    // Enquanto desconectado: corrida entra em treino.
    await t.advanceTo(Date.parse((await t.race(raceId)).timeline.practiceAt));
    const c2 = new Client(base);
    await c2.open();
    c2.send({ type: 'subscribe', room: ROOM.race(raceId), lastSeq });
    const phase = await c2.waitFor((m) => m.type === 'race.phase');
    expect((phase.payload as any).to).toBe('practice');
    expect(phase.seq).toBeGreaterThan(lastSeq);
    expect(c2.msgs.some((m) => m.type === 'race.snapshot')).toBe(false);
    // Sem lastSeq: snapshot com a fase atual.
    const c3 = new Client(base);
    await c3.open();
    c3.send({ type: 'subscribe', room: ROOM.race(raceId) });
    expect(((await c3.waitFor((m) => m.type === 'race.snapshot')).payload as any).race.status).toBe(
      'practice',
    );
    c2.close();
    c3.close();
  });

  it('ticket autentica e entrega notificações privadas; sala de outro usuário é proibida', async () => {
    const u = await t.register('Tick');
    const other = await t.register('Outro1');
    const { ticket } = (await t.json('POST', '/auth/ws-ticket', {}, u.token)).body;
    const c = new Client(`${base}?ticket=${ticket}`);
    await c.open();
    expect(((await c.waitFor((m) => m.type === 'hello')).payload as any).userId).toBe(u.userId);
    c.send({ type: 'subscribe', room: ROOM.user(other.userId) });
    expect(((await c.waitFor((m) => m.type === 'error')).payload as any).code).toBe('FORBIDDEN');
    const raceId = await t.createRace({}, 70 * 60_000);
    await t.json('POST', `/races/${raceId}/entries`, {}, u.token);
    const n = await c.waitFor((m) => m.type === 'notification');
    expect((n.payload as any).type).toBe('entry_confirmed');
    c.close();
    // Ticket é de uso único.
    const c2 = new Client(`${base}?ticket=${ticket}`);
    await c2.open().catch(() => undefined);
    await new Promise((r) => setTimeout(r, 100));
    expect(c2.closed?.code).toBe(4401);
  });

  it('mensagem inválida é descartada com erro; flood encerra a conexão', async () => {
    const c = new Client(base);
    await c.open();
    c.ws.send('{"type":"hack"}');
    expect(((await c.waitFor((m) => m.type === 'error')).payload as any).code).toBe('VALIDATION_ERROR');
    for (let i = 0; i < 60; i++) c.send({ type: 'ping', clientTime: i });
    await new Promise((r) => setTimeout(r, 200));
    expect(c.closed?.code).toBe(1008);
  });

  it('ping devolve pong com serverTime para sincronizar o relógio', async () => {
    const c = new Client(base);
    await c.open();
    c.send({ type: 'ping', clientTime: 123 });
    const p = await c.waitFor((m) => m.type === 'pong');
    expect((p.payload as any).clientTime).toBe(123);
    expect(p.serverTime).toBe(t.clock.now());
    c.close();
  });

  it('transmite frames da corrida ao vivo', async () => {
    const raceId = await t.createRace({}, 100 * 60_000);
    const u = await t.register('Live');
    await t.json('POST', `/races/${raceId}/entries`, {}, u.token);
    const race = await t.race(raceId);
    await t.advanceTo(Date.parse(race.timeline.raceAt) - 1);
    const c = new Client(base);
    await c.open();
    c.send({ type: 'subscribe', room: ROOM.race(raceId) });
    await c.waitFor((m) => m.type === 'race.snapshot');
    await t.advanceTo(Date.parse(race.timeline.raceAt));
    expect(((await c.waitFor((m) => m.type === 'race.started')).payload as any).cars).toHaveLength(1);
    await t.advance(5000 + 3000);
    const tick = await c.waitFor((m) => m.type === 'race.tick');
    expect((tick.payload as any).frames.length).toBeGreaterThan(0);
    c.close();
  });
});
