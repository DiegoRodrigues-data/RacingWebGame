import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => (t = await setupApp()));
afterAll(() => t.close());

describe('autenticação', () => {
  it('cadastra, entra e lê /me', async () => {
    const u = await t.register('Ayrton');
    const me = await t.json('GET', '/me', undefined, u.token);
    expect(me.status).toBe(200);
    expect(me.body.profile.nickname).toBe('Ayrton');
    expect(me.body.roles).toEqual(['player']);
  });

  it('rejeita e-mail e apelido duplicados', async () => {
    await t.register('Nelson');
    const dupEmail = await t.json('POST', '/auth/register', {
      email: 'nelson@teste.dev',
      password: 'senha-forte-1',
      nickname: 'Outro',
      country: 'BR',
      region: 'SP',
      city: 'Xa',
    });
    expect(dupEmail.body.error.code).toBe('EMAIL_TAKEN');
    const dupNick = await t.json('POST', '/auth/register', {
      email: 'novo@teste.dev',
      password: 'senha-forte-1',
      nickname: 'nelson',
      country: 'BR',
      region: 'SP',
      city: 'Xa',
    });
    expect(dupNick.body.error.code).toBe('NICKNAME_TAKEN');
  });

  it('valida o payload de cadastro', async () => {
    const r = await t.json('POST', '/auth/register', {
      email: 'x',
      password: '1',
      nickname: 'a',
      country: 'BRA',
      region: 'S',
      city: '',
    });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('login inválido e bloqueio progressivo após 5 falhas', async () => {
    await t.register('Emerson');
    for (let i = 0; i < 5; i++)
      expect((await t.login('emerson@teste.dev', 'errada')).body.error.code).toBe('INVALID_CREDENTIALS');
    const locked = await t.login('emerson@teste.dev', 'senha-forte-1');
    expect(locked.status).toBe(423);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
    t.clock.advance(16 * 60_000);
    expect((await t.login('emerson@teste.dev', 'senha-forte-1')).status).toBe(200);
  });

  it('refresh exige cabeçalho CSRF, rotaciona o token e detecta reuso', async () => {
    const u = await t.register('Rubens');
    const cookie = { cookie: `tracado_rt=${u.cookie}` };
    expect((await t.json('POST', '/auth/refresh', undefined, undefined, cookie)).body.error.code).toBe(
      'FORBIDDEN',
    );
    const r1 = await t.json('POST', '/auth/refresh', undefined, undefined, {
      ...cookie,
      'x-tracado-csrf': '1',
    });
    expect(r1.status).toBe(200);
    const newCookie = r1.res.cookies.find((c) => c.name === 'tracado_rt')!.value;
    expect(newCookie).not.toBe(u.cookie);
    // Reusar o token antigo revoga a família inteira.
    const reuse = await t.json('POST', '/auth/refresh', undefined, undefined, {
      ...cookie,
      'x-tracado-csrf': '1',
    });
    expect(reuse.body.error.code).toBe('TOKEN_REUSED');
    const after = await t.json('POST', '/auth/refresh', undefined, undefined, {
      cookie: `tracado_rt=${newCookie}`,
      'x-tracado-csrf': '1',
    });
    expect(after.status).toBe(401);
  });

  it('token de acesso expira em 15 minutos', async () => {
    const u = await t.register('Felipe');
    expect((await t.json('GET', '/me', undefined, u.jwt)).status).toBe(200);
    t.clock.advance(16 * 60_000);
    const r = await t.json('GET', '/me', undefined, u.jwt);
    expect(r.status).toBe(401);
  });

  it('verificação de e-mail e redefinição de senha via token de uso único', async () => {
    const u = await t.register('Bia');
    const mail = t.ctx.mailer.sent.filter((m) => m.to === 'bia@teste.dev');
    const token = mail[0]!.body.split('token=')[1]!;
    expect((await t.json('POST', '/auth/verify-email', { token })).status).toBe(200);
    expect((await t.json('POST', '/auth/verify-email', { token })).status).toBe(400);
    expect((await t.json('GET', '/me', undefined, u.token)).body.emailVerified).toBe(true);
    await t.json('POST', '/auth/forgot-password', { email: 'bia@teste.dev' });
    const reset = t.ctx.mailer.sent
      .filter((m) => m.subject.includes('Redefinição'))
      .pop()!
      .body.split('token=')[1]!;
    expect(
      (await t.json('POST', '/auth/reset-password', { token: reset, password: 'nova-senha-123' })).status,
    ).toBe(200);
    expect((await t.login('bia@teste.dev', 'nova-senha-123')).status).toBe(200);
  });
});

describe('autorização', () => {
  it('rotas protegidas exigem login e rotas admin exigem papel', async () => {
    expect((await t.json('GET', '/me')).body.error.code).toBe('UNAUTHORIZED');
    const u = await t.register('Comum');
    expect((await t.json('GET', '/admin/dashboard', undefined, u.token)).body.error.code).toBe('FORBIDDEN');
    expect((await t.json('GET', '/admin/dashboard', undefined, t.admin)).status).toBe(200);
  });
  it('visitantes leem informações públicas', async () => {
    expect((await t.json('GET', '/lobby')).status).toBe(200);
    expect((await t.json('GET', '/races')).status).toBe(200);
    expect((await t.json('GET', '/rankings?scope=world')).status).toBe(200);
  });
  it('antifraude: limita cadastros por IP', async () => {
    const t2 = await setupApp({ MAX_SIGNUPS_PER_IP_PER_DAY: 2, FLAG_SIGNUPS_PER_IP_PER_DAY: 1 });
    await t2.register('ip1');
    await t2.register('ip2');
    await expect(t2.register('ip3')).rejects.toThrow('RATE_LIMITED');
    const flagged = await t2.json('GET', '/admin/users?flagged=true', undefined, t2.admin);
    expect(flagged.body.map((u: any) => u.nickname)).toEqual(['ip2']);
    await t2.close();
  });
  it('health e métricas', async () => {
    const h = await t.json('GET', '/health');
    expect(h.body).toMatchObject({ status: 'ok', db: true, store: true });
    const m = await t.app.inject({ method: 'GET', url: '/metrics' });
    expect(m.body).toContain('tracado_http_request_duration_seconds');
  });
});
