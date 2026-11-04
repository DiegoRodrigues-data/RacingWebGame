import { Redis } from 'ioredis';

/**
 * Armazenamento rápido e efêmero: tickets de WS, limites de taxa, buffers de reenvio, sequência por sala,
 * cache de rankings, eleição de líder do motor de fases e pub/sub entre instâncias.
 * MemoryStore atende uma instância; RedisStore permite escalar horizontalmente.
 */
export interface Store {
  readonly kind: 'memory' | 'redis';
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs?: number): Promise<void>;
  /** Define apenas se não existir. Retorna true se definiu. */
  setNx(key: string, value: string, ttlMs: number): Promise<boolean>;
  /** Lê e apaga (uso único). */
  take(key: string): Promise<string | null>;
  del(key: string): Promise<void>;
  incr(key: string, ttlMs?: number): Promise<number>;
  pushCapped(key: string, value: string, max: number, ttlMs?: number): Promise<void>;
  range(key: string): Promise<string[]>;
  publish(channel: string, message: string): Promise<void>;
  subscribe(channel: string, handler: (message: string) => void): Promise<void>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

export class MemoryStore implements Store {
  readonly kind = 'memory' as const;
  private kv = new Map<string, { v: string; exp: number | null }>();
  private lists = new Map<string, { v: string[]; exp: number | null }>();
  private subs = new Map<string, Set<(m: string) => void>>();
  constructor(private readonly now: () => number = Date.now) {}
  private alive<T extends { exp: number | null }>(map: Map<string, T>, key: string): T | undefined {
    const e = map.get(key);
    if (!e) return undefined;
    if (e.exp !== null && e.exp <= this.now()) {
      map.delete(key);
      return undefined;
    }
    return e;
  }
  async get(key: string) {
    return this.alive(this.kv, key)?.v ?? null;
  }
  async set(key: string, value: string, ttlMs?: number) {
    this.kv.set(key, { v: value, exp: ttlMs ? this.now() + ttlMs : null });
  }
  async setNx(key: string, value: string, ttlMs: number) {
    if (this.alive(this.kv, key)) return false;
    this.kv.set(key, { v: value, exp: this.now() + ttlMs });
    return true;
  }
  async take(key: string) {
    const v = this.alive(this.kv, key)?.v ?? null;
    this.kv.delete(key);
    return v;
  }
  async del(key: string) {
    this.kv.delete(key);
    this.lists.delete(key);
  }
  async incr(key: string, ttlMs?: number) {
    const cur = this.alive(this.kv, key);
    const n = (cur ? Number(cur.v) : 0) + 1;
    this.kv.set(key, { v: String(n), exp: cur?.exp ?? (ttlMs ? this.now() + ttlMs : null) });
    return n;
  }
  async pushCapped(key: string, value: string, max: number, ttlMs?: number) {
    const cur = this.alive(this.lists, key) ?? { v: [], exp: null };
    cur.v.push(value);
    if (cur.v.length > max) cur.v.splice(0, cur.v.length - max);
    cur.exp = ttlMs ? this.now() + ttlMs : cur.exp;
    this.lists.set(key, cur);
  }
  async range(key: string) {
    return [...(this.alive(this.lists, key)?.v ?? [])];
  }
  async publish(channel: string, message: string) {
    for (const h of this.subs.get(channel) ?? []) h(message);
  }
  async subscribe(channel: string, handler: (m: string) => void) {
    const set = this.subs.get(channel) ?? new Set();
    set.add(handler);
    this.subs.set(channel, set);
  }
  async ping() {
    return true;
  }
  async close() {
    this.subs.clear();
  }
}

export class RedisStore implements Store {
  readonly kind = 'redis' as const;
  private pub: Redis;
  private sub: Redis;
  private handlers = new Map<string, Set<(m: string) => void>>();
  constructor(url: string) {
    this.pub = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: false });
    this.sub = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: false });
    this.sub.on('message', (ch: string, msg: string) => {
      for (const h of this.handlers.get(ch) ?? []) h(msg);
    });
  }
  async get(key: string) {
    return this.pub.get(key);
  }
  async set(key: string, value: string, ttlMs?: number) {
    if (ttlMs) await this.pub.set(key, value, 'PX', ttlMs);
    else await this.pub.set(key, value);
  }
  async setNx(key: string, value: string, ttlMs: number) {
    return (await this.pub.set(key, value, 'PX', ttlMs, 'NX')) === 'OK';
  }
  async take(key: string) {
    const [[, v]] = (await this.pub.multi().get(key).del(key).exec()) as [[null, string | null], unknown];
    return v;
  }
  async del(key: string) {
    await this.pub.del(key);
  }
  async incr(key: string, ttlMs?: number) {
    const n = await this.pub.incr(key);
    if (ttlMs && n === 1) await this.pub.pexpire(key, ttlMs);
    return n;
  }
  async pushCapped(key: string, value: string, max: number, ttlMs?: number) {
    const m = this.pub.multi().rpush(key, value).ltrim(key, -max, -1);
    if (ttlMs) m.pexpire(key, ttlMs);
    await m.exec();
  }
  async range(key: string) {
    return this.pub.lrange(key, 0, -1);
  }
  async publish(channel: string, message: string) {
    await this.pub.publish(channel, message);
  }
  async subscribe(channel: string, handler: (m: string) => void) {
    const set = this.handlers.get(channel) ?? new Set();
    set.add(handler);
    this.handlers.set(channel, set);
    if (set.size === 1) await this.sub.subscribe(channel);
  }
  async ping() {
    try {
      return (await this.pub.ping()) === 'PONG';
    } catch {
      return false;
    }
  }
  async close() {
    this.pub.disconnect();
    this.sub.disconnect();
  }
}

export function createStore(url: string | undefined, now: () => number): Store {
  return url ? new RedisStore(url) : new MemoryStore(now);
}
