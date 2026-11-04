import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  clientMessageSchema,
  ROOM,
  WS_PROTOCOL_VERSION,
  type ServerEvents,
  type ServerEventType,
  type WsEnvelope,
} from '@tracado/shared';
import type { FastifyBaseLogger } from 'fastify';
import { WebSocket, WebSocketServer } from 'ws';
import type { AuthUser } from '../../lib/auth';
import type { Clock } from '../../lib/clock';
import type { Metrics } from '../../lib/metrics';
import type { Store } from '../../lib/store';

const CHANNEL = 'ws:broadcast';
const BUFFER_MAX = 300;
const BUFFER_TTL = 6 * 3600_000;
const FLOOD_WINDOW_MS = 10_000;
const FLOOD_MAX = 40;
const HEARTBEAT_MS = 25_000;
const ROOM_RE = /^(lobby|race:[0-9a-f-]{36}|user:[0-9a-f-]{36})$/;

interface Conn {
  id: string;
  ws: WebSocket;
  user: AuthUser | null;
  rooms: Set<string>;
  alive: boolean;
  window: number[];
}

export type SnapshotProvider = (
  room: string,
  user: AuthUser | null,
) => Promise<{ type: ServerEventType; payload: unknown } | null>;

export class WsHub {
  private wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });
  private rooms = new Map<string, Set<Conn>>();
  private conns = new Set<Conn>();
  private heartbeat: NodeJS.Timeout | null = null;
  snapshotProvider: SnapshotProvider = async () => null;
  ticketRedeemer: (ticket: string) => Promise<AuthUser | null> = async () => null;

  constructor(
    private readonly deps: { store: Store; clock: Clock; metrics: Metrics; log: FastifyBaseLogger },
  ) {}

  async init() {
    await this.deps.store.subscribe(CHANNEL, (raw) => {
      try {
        const env = JSON.parse(raw) as WsEnvelope;
        this.deliverLocal(env.room, raw, env.type);
      } catch (e) {
        this.deps.log.warn({ err: e }, 'Mensagem de broadcast inválida');
      }
    });
    this.heartbeat = setInterval(() => {
      for (const c of this.conns) {
        if (!c.alive) {
          c.ws.terminate();
          continue;
        }
        c.alive = false;
        c.ws.ping();
      }
    }, HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  get connectionCount() {
    return this.conns.size;
  }
  roomSize(room: string) {
    return this.rooms.get(room)?.size ?? 0;
  }

  /** Publica para todos os assinantes da sala em todas as instâncias. */
  async publish<T extends ServerEventType>(room: string, type: T, payload: ServerEvents[T]): Promise<void> {
    const seq = await this.deps.store.incr(`wsseq:${room}`, BUFFER_TTL);
    const env: WsEnvelope<T> = {
      v: WS_PROTOCOL_VERSION,
      type,
      room,
      seq,
      serverTime: this.deps.clock.now(),
      payload,
    };
    const raw = JSON.stringify(env);
    await this.deps.store.pushCapped(`wsbuf:${room}`, raw, BUFFER_MAX, BUFFER_TTL);
    await this.deps.store.publish(CHANNEL, raw);
  }

  private deliverLocal(room: string, raw: string, type: string) {
    const set = this.rooms.get(room);
    if (!set) return;
    for (const c of set) {
      if (c.ws.readyState === WebSocket.OPEN && c.ws.bufferedAmount < 4 * 1024 * 1024) {
        c.ws.send(raw);
        this.deps.metrics.wsMessagesOut.inc({ type });
      }
    }
  }

  private sendDirect<T extends ServerEventType>(
    c: Conn,
    type: T,
    payload: ServerEvents[T],
    room = '',
    seq = 0,
  ) {
    if (c.ws.readyState !== WebSocket.OPEN) return;
    const env: WsEnvelope<T> = {
      v: WS_PROTOCOL_VERSION,
      type,
      room,
      seq,
      serverTime: this.deps.clock.now(),
      payload,
    };
    c.ws.send(JSON.stringify(env));
    this.deps.metrics.wsMessagesOut.inc({ type });
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const url = new URL(req.url ?? '/', 'http://x');
    const ticket = url.searchParams.get('ticket');
    void (async () => {
      const user = ticket ? await this.ticketRedeemer(ticket) : null;
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        if (ticket && !user) {
          ws.close(4401, 'ticket inválido ou expirado');
          return;
        }
        this.onConnection(ws, user);
      });
    })().catch((e) => {
      this.deps.log.error({ err: e }, 'Falha no upgrade WS');
      socket.destroy();
    });
  }

  private onConnection(ws: WebSocket, user: AuthUser | null) {
    const c: Conn = { id: randomUUID(), ws, user, rooms: new Set(), alive: true, window: [] };
    this.conns.add(c);
    this.deps.metrics.wsConnections.set(this.conns.size);
    ws.on('pong', () => (c.alive = true));
    ws.on('close', () => {
      for (const r of c.rooms) this.leave(c, r);
      this.conns.delete(c);
      this.deps.metrics.wsConnections.set(this.conns.size);
    });
    ws.on('error', () => ws.terminate());
    ws.on('message', (data) => {
      const now = Date.now();
      c.window = c.window.filter((t) => now - t < FLOOD_WINDOW_MS);
      c.window.push(now);
      if (c.window.length > FLOOD_MAX) {
        this.deps.log.warn({ conn: c.id, user: c.user?.id }, 'Flood de mensagens WS; conexão encerrada');
        ws.close(1008, 'flood');
        return;
      }
      let msg;
      try {
        msg = clientMessageSchema.parse(JSON.parse(String(data)));
      } catch {
        this.deps.log.debug({ conn: c.id }, 'Mensagem WS inválida descartada');
        this.sendDirect(c, 'error', { code: 'VALIDATION_ERROR', message: 'Mensagem inválida.' });
        return;
      }
      void this.onMessage(c, msg).catch((e) =>
        this.deps.log.error({ err: e }, 'Erro ao processar mensagem WS'),
      );
    });
    this.sendDirect(c, 'hello', {
      connectionId: c.id,
      userId: user?.id ?? null,
      protocol: WS_PROTOCOL_VERSION,
    });
    if (user) void this.subscribe(c, ROOM.user(user.id), undefined);
  }

  private leave(c: Conn, room: string) {
    c.rooms.delete(room);
    const set = this.rooms.get(room);
    if (set) {
      set.delete(c);
      if (!set.size) this.rooms.delete(room);
    }
  }

  private async onMessage(c: Conn, msg: ReturnType<typeof clientMessageSchema.parse>) {
    if (msg.type === 'ping') return this.sendDirect(c, 'pong', { clientTime: msg.clientTime });
    if (msg.type === 'unsubscribe') return this.leave(c, msg.room);
    return this.subscribe(c, msg.room, msg.lastSeq);
  }

  private async subscribe(c: Conn, room: string, lastSeq: number | undefined) {
    if (!ROOM_RE.test(room))
      return this.sendDirect(c, 'error', { code: 'VALIDATION_ERROR', message: 'Sala inválida.' });
    if (room.startsWith('user:') && room !== ROOM.user(c.user?.id ?? '-'))
      return this.sendDirect(c, 'error', { code: 'FORBIDDEN', message: 'Sala privada.' });
    if (c.rooms.size >= 20 && !c.rooms.has(room))
      return this.sendDirect(c, 'error', { code: 'RATE_LIMITED', message: 'Salas demais.' });
    c.rooms.add(room);
    const set = this.rooms.get(room) ?? new Set();
    set.add(c);
    this.rooms.set(room, set);
    const current = Number((await this.deps.store.get(`wsseq:${room}`)) ?? 0);
    if (lastSeq !== undefined) {
      if (lastSeq >= current) return;
      const buf = (await this.deps.store.range(`wsbuf:${room}`)).map((r) => ({
        raw: r,
        seq: (JSON.parse(r) as WsEnvelope).seq,
      }));
      // O buffer cobre o intervalo perdido: reenvia na ordem. Senão, snapshot novo.
      if (buf.length && buf[0]!.seq <= lastSeq + 1) {
        for (const b of buf) if (b.seq > lastSeq && c.ws.readyState === WebSocket.OPEN) c.ws.send(b.raw);
        return;
      }
    }
    const snap = await this.snapshotProvider(room, c.user);
    if (snap) this.sendDirect(c, snap.type, snap.payload as never, room, current);
    else if (lastSeq !== undefined) this.sendDirect(c, 'resync', { reason: 'buffer' }, room, current);
  }

  close() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const c of this.conns) c.ws.terminate();
    this.wss.close();
  }
}
