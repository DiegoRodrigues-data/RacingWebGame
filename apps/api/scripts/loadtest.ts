/**
 * Teste de carga contra um servidor em execução (precisa de ENABLE_DEV_ROUTES e limites de cadastro altos).
 *   API=http://localhost:3001 SOCKETS=500 USERS=60 pnpm loadtest
 * Mede: abertura de N sockets inscritos na sala de uma corrida, latência de entrega de broadcast
 * e inscrições concorrentes (sempre 22 confirmadas no máximo).
 */
import WebSocket from 'ws';

const API = process.env.API ?? 'http://localhost:3001';
const WS = API.replace(/^http/, 'ws') + '/ws';
const SOCKETS = Number(process.env.SOCKETS ?? 500);
const USERS = Number(process.env.USERS ?? 60);

async function j(method: string, path: string, body?: unknown, token?: string) {
  const r = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null };
}
const pct = (arr: number[], p: number) =>
  [...arr].sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor((arr.length * p) / 100))] ?? 0;

const admin = (
  await j('POST', '/auth/login', {
    email: process.env.ADMIN_EMAIL ?? 'admin@tracado.local',
    password: process.env.ADMIN_PASSWORD ?? 'admin12345',
  })
).body.accessToken;
const cats = (await j('GET', '/categories')).body;
const now = (await j('GET', '/time')).body.serverTime;
const race = await j(
  'POST',
  '/admin/races',
  {
    name: `Carga ${Date.now()}`,
    categoryId: cats[0].id,
    startAt: new Date(now + 3600_000).toISOString(),
    registrationLeadMinutes: 120,
    track: { type: 'procedural' },
  },
  admin,
);
const raceId = race.body.id;
await new Promise((r) => setTimeout(r, 1500)); // aguarda o motor abrir as inscrições
console.log(`Corrida ${raceId} criada.`);

// 1) Sockets
const t0 = Date.now();
const sockets: WebSocket[] = [];
const received: number[] = [];
let opened = 0;
const socketErrors: Record<string, number> = {};
await Promise.all(
  Array.from(
    { length: SOCKETS },
    () =>
      new Promise<void>((res) => {
        const ws = new WebSocket(WS);
        sockets.push(ws);
        ws.on('open', () => {
          opened++;
          ws.send(JSON.stringify({ type: 'subscribe', room: `race:${raceId}` }));
          res();
        });
        ws.on('message', (d) => {
          const m = JSON.parse(String(d));
          if (m.type === 'race.capacity') received.push(Date.now());
        });
        ws.on('error', (e) => {
          socketErrors[String((e as Error).message)] = (socketErrors[String((e as Error).message)] ?? 0) + 1;
          res();
        });
      }),
  ),
);
console.log(
  `Sockets abertos: ${opened}/${SOCKETS} em ${Date.now() - t0} ms`,
  Object.keys(socketErrors).length ? socketErrors : '',
);
await new Promise((r) => setTimeout(r, 1000));

// 2) Usuários e inscrições concorrentes
const tokens: string[] = [];
for (let i = 0; i < USERS; i++) {
  const nick = `carga${Date.now().toString(36)}${i}`;
  const r = await j('POST', '/auth/register', {
    email: `${nick}@carga.dev`,
    password: 'senha-carga-1',
    nickname: nick,
    country: 'BR',
    region: 'SP',
    city: 'Campinas',
  });
  if (r.status === 201) tokens.push(r.body.accessToken);
}
console.log(`Usuários criados: ${tokens.length}`);
const lat: number[] = [];
const sendAt = Date.now();
const results = await Promise.all(
  tokens.map(async (t) => {
    const s = Date.now();
    const r = await j('POST', `/races/${raceId}/entries`, {}, t);
    lat.push(Date.now() - s);
    return r.body?.status ?? r.body?.error?.code;
  }),
);
const count = (k: string) => results.filter((r) => r === k).length;
const others = results.filter((r) => !['confirmed', 'waitlisted', 'RACE_FULL'].includes(r));
if (others.length) console.log('Outros resultados:', others.slice(0, 5));
console.log(
  `Inscrições: confirmed=${count('confirmed')} waitlisted=${count('waitlisted')} RACE_FULL=${count('RACE_FULL')} outros=${results.length - count('confirmed') - count('waitlisted') - count('RACE_FULL')}`,
);
console.log(
  `Latência da inscrição: p50=${pct(lat, 50)} ms p95=${pct(lat, 95)} ms máx=${Math.max(...lat)} ms`,
);
await new Promise((r) => setTimeout(r, 3000));
const deliveries = received.length;
const fanoutLat = received.map((t) => t - sendAt);
const accepted = count('confirmed') + count('waitlisted');
console.log(
  `Broadcasts race.capacity entregues: ${deliveries} (esperados: ${accepted} inscrições aceitas × ${opened} sockets = ${accepted * opened})`,
);
console.log(
  `Atraso de entrega desde o início das inscrições: p50=${pct(fanoutLat, 50)} ms p95=${pct(fanoutLat, 95)} ms`,
);
const ok = count('confirmed') <= 22;
console.log(ok ? 'OK: limite de 22 carros respeitado sob concorrência.' : 'FALHA: mais de 22 confirmados!');
for (const s of sockets) s.close();
process.exit(ok ? 0 : 1);
