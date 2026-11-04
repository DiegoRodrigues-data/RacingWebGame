import { ClockSync, type ServerEvents, type ServerEventType, type WsEnvelope } from '@tracado/shared';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getAccessToken, post, refreshSession } from './api';

type Handler = (env: WsEnvelope) => void;
type Status = 'idle' | 'connecting' | 'open' | 'closed';

/**
 * Cliente de tempo real: uma conexão por aba, salas com `lastSeq` para reenvio após reconexão,
 * sincronização de relógio (NTP simplificado) e reconexão com backoff exponencial + jitter.
 */
class Realtime {
  private ws: WebSocket | null = null;
  private rooms = new Map<string, { lastSeq?: number; handlers: Set<Handler> }>();
  private any = new Set<Handler>();
  private retry = 0;
  private pingTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private statusListeners = new Set<() => void>();
  readonly clock = new ClockSync();
  status: Status = 'idle';
  userId: string | null = null;

  private setStatus(s: Status) {
    this.status = s;
    this.statusListeners.forEach((l) => l());
  }
  onStatus(fn: () => void): () => void {
    this.statusListeners.add(fn);
    return () => {
      this.statusListeners.delete(fn);
    };
  }

  async connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING))
      return;
    this.setStatus('connecting');
    let ticket: string | null = null;
    if (getAccessToken())
      ticket = (await post<{ ticket: string }>('/auth/ws-ticket').catch(() => null))?.ticket ?? null;
    const base =
      import.meta.env.VITE_WS_URL ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const ws = new WebSocket(ticket ? `${base}?ticket=${encodeURIComponent(ticket)}` : base);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.setStatus('open');
      for (const [room, r] of this.rooms)
        this.raw({ type: 'subscribe', room, ...(r.lastSeq !== undefined ? { lastSeq: r.lastSeq } : {}) });
      this.syncClock();
      this.pingTimer = window.setInterval(() => this.ping(), 10_000);
    };
    ws.onmessage = (ev) => {
      const now = Date.now();
      const env = JSON.parse(String(ev.data)) as WsEnvelope;
      if (env.type === 'pong')
        this.clock.sample((env.payload as ServerEvents['pong']).clientTime, env.serverTime, now);
      else this.clock.passive(env.serverTime, now);
      if (env.type === 'hello') this.userId = (env.payload as ServerEvents['hello']).userId;
      if (env.room) {
        const r = this.rooms.get(env.room);
        if (r && env.seq > 0) r.lastSeq = Math.max(r.lastSeq ?? 0, env.seq);
        r?.handlers.forEach((h) => h(env));
      }
      this.any.forEach((h) => h(env));
    };
    ws.onclose = (ev) => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.setStatus('closed');
      if (this.ws !== ws) return;
      this.ws = null;
      if (ev.code === 4401) void refreshSession().finally(() => this.scheduleReconnect());
      else this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = Math.min(10_000, 500 * 2 ** this.retry) * (0.7 + Math.random() * 0.6);
    this.retry++;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  /** Reabre a conexão (ex.: após login/logout, para trocar a identidade do socket). */
  reconnect() {
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    void this.connect();
  }

  private raw(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
  private ping() {
    this.raw({ type: 'ping', clientTime: Date.now() });
  }
  private syncClock() {
    for (let i = 0; i < 4; i++) setTimeout(() => this.ping(), i * 300);
  }

  subscribe(room: string, h: Handler): () => void {
    let r = this.rooms.get(room);
    if (!r) {
      r = { handlers: new Set() };
      this.rooms.set(room, r);
      this.raw({ type: 'subscribe', room });
    } else if (r.handlers.size === 0) this.raw({ type: 'subscribe', room });
    r.handlers.add(h);
    return () => {
      r!.handlers.delete(h);
      if (r!.handlers.size === 0) {
        this.rooms.delete(room);
        this.raw({ type: 'unsubscribe', room });
      }
    };
  }
  onAny(h: Handler): () => void {
    this.any.add(h);
    return () => {
      this.any.delete(h);
    };
  }
}

export const realtime = new Realtime();

export function useRoom(room: string | null, handler: (env: WsEnvelope) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!room) return;
    void realtime.connect();
    return realtime.subscribe(room, (e) => ref.current(e));
  }, [room]);
}

export function useEvent<T extends ServerEventType>(
  type: T,
  handler: (p: ServerEvents[T], env: WsEnvelope) => void,
) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(
    () => realtime.onAny((e) => e.type === type && ref.current(e.payload as ServerEvents[T], e)),
    [type],
  );
}

export function useConnection() {
  return useSyncExternalStore(
    (cb) => realtime.onStatus(cb),
    () => `${realtime.status}|${realtime.clock.rtt ?? ''}`,
  );
}

/** Hora do servidor, atualizada periodicamente (para contagens regressivas sincronizadas). */
export function useServerNow(intervalMs = 250): number {
  const [now, setNow] = useState(() => realtime.clock.now());
  useEffect(() => {
    const id = setInterval(() => setNow(realtime.clock.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
