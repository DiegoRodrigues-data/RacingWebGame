import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setupApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(
  async () =>
    (t = await setupApp({ GOOGLE_CLIENT_ID: 'cliente-teste', GOOGLE_CLIENT_SECRET: 'segredo-teste' })),
);
afterAll(() => t.close());
afterEach(() => vi.unstubAllGlobals());

/** Simula o Google: troca de código e userinfo. */
function fakeGoogle(profile: Record<string, unknown>) {
  const real = globalThis.fetch;
  const calls: { url: string; body?: string }[] = [];
  vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith('https://oauth2.googleapis.com/token')) {
      calls.push({ url: u, body: String(init?.body) });
      return new Response(JSON.stringify({ access_token: 'token-google' }), { status: 200 });
    }
    if (u.startsWith('https://openidconnect.googleapis.com/v1/userinfo'))
      return new Response(JSON.stringify(profile), { status: 200 });
    return real(url, init);
  });
  return calls;
}

async function loginGoogle(next = '/calendario', tamperState = false) {
  const start = await t.app.inject({
    method: 'GET',
    url: `/auth/google/start?next=${encodeURIComponent(next)}`,
  });
  expect(start.statusCode).toBe(302);
  const loc = new URL(start.headers.location as string);
  expect(loc.origin + loc.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  expect(loc.searchParams.get('code_challenge_method')).toBe('S256');
  expect(loc.searchParams.get('redirect_uri')).toBe('http://localhost:5173/api/auth/google/callback');
  const state = loc.searchParams.get('state')!;
  const og = start.cookies.find((c) => c.name === 'tracado_og')!;
  expect(og.sameSite).toBe('Lax');
  const cb = await t.app.inject({
    method: 'GET',
    url: `/auth/google/callback?code=codigo&state=${tamperState ? 'outro' : state}`,
    cookies: { tracado_og: og.value },
  });
  expect(cb.statusCode).toBe(302);
  const rt = cb.cookies.find((c) => c.name === 'tracado_rt' && c.value);
  return { location: cb.headers.location as string, rt: rt?.value };
}

const meFrom = async (rt: string) =>
  (
    await t.app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { tracado_rt: rt },
      headers: { 'x-tracado-csrf': '1' },
    })
  ).json().me;

describe('login com Google', () => {
  it('anuncia o provedor quando configurado', async () => {
    expect((await t.json('GET', '/auth/providers')).body).toEqual({ google: true });
  });

  it('cria a conta no primeiro acesso e manda completar o perfil; depois volta para onde estava', async () => {
    const calls = fakeGoogle({
      sub: 'g-1',
      email: 'Joana@Gmail.com',
      email_verified: true,
      given_name: 'Joana',
    });
    const first = await loginGoogle();
    expect(first.location).toBe('http://localhost:5173/conta?bemvindo=1');
    expect(calls[0]!.body).toContain('code_verifier=');
    const me = await meFrom(first.rt!);
    expect(me).toMatchObject({ email: 'joana@gmail.com', emailVerified: true });
    expect(me.profile.nickname).toBe('Joana');

    const again = await loginGoogle('/rankings');
    expect(again.location).toBe('http://localhost:5173/rankings');
    expect((await meFrom(again.rt!)).id).toBe(me.id);
  });

  it('vincula a uma conta existente com o mesmo e-mail verificado', async () => {
    const u = await t.register('ContaAntiga');
    fakeGoogle({ sub: 'g-2', email: 'contaantiga@teste.dev', email_verified: true, given_name: 'Outro' });
    const r = await loginGoogle('/');
    expect(r.location).toBe('http://localhost:5173/');
    expect((await meFrom(r.rt!)).id).toBe(u.userId);
  });

  it('recusa state trocado e redirecionamento para fora do site', async () => {
    fakeGoogle({ sub: 'g-3', email: 'x@gmail.com', email_verified: true });
    const bad = await loginGoogle('/', true);
    expect(bad.location).toBe('http://localhost:5173/entrar?erro=google');
    expect(bad.rt).toBeUndefined();
    const evil = await loginGoogle('//evil.example/x');
    expect(evil.location).toBe('http://localhost:5173/conta?bemvindo=1');
    const evil2 = await loginGoogle('https://evil.example');
    expect(evil2.location).toBe('http://localhost:5173/');
  });
});
