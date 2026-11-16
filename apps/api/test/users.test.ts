import { SAFETY_PHRASE } from '@tracado/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { users } from '../src/db/schema';
import { setupApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => (t = await setupApp({ ADMIN_EMAILS: ['chefia@teste.dev'] })));
afterAll(() => t.close());

const setAccess = (signupMode: string, signupDomains: string[] = []) =>
  t.json('PUT', '/admin/access', { signupMode, signupDomains }, t.admin);
const signup = (nickname: string, email = `${nickname.toLowerCase()}@teste.dev`) =>
  t.json('POST', '/auth/register', {
    email,
    password: 'senha-forte-1',
    nickname,
    country: 'BR',
    region: 'SP',
    city: 'Campinas',
  });
const userRow = async (id: string) => (await t.ctx.db.select().from(users).where(eq(users.id, id)))[0]!;
const listed = async (q: string) =>
  (await t.json('GET', `/admin/users?q=${q}`, undefined, t.admin)).body.users as any[];

describe('login', () => {
  it('aceita o e-mail ou o apelido', async () => {
    await t.register('Apelidado');
    expect(
      (await t.json('POST', '/auth/login', { login: 'apelidado', password: 'senha-forte-1' })).status,
    ).toBe(200);
    expect(
      (await t.json('POST', '/auth/login', { login: 'APELIDADO@teste.dev', password: 'senha-forte-1' }))
        .status,
    ).toBe(200);
    // Clientes antigos mandam `email`.
    expect((await t.login('apelidado@teste.dev', 'senha-forte-1')).status).toBe(200);
    const bad = await t.json('POST', '/auth/login', { login: 'apelidado', password: 'errada-123' });
    expect(bad.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('administradores por e-mail (ADMIN_EMAILS)', () => {
  it('têm acesso de admin sem papel gravado e não podem ser bloqueados nem excluídos', async () => {
    const r = await signup('Chefia', 'chefia@teste.dev');
    expect(r.body.me.roles).toContain('admin');
    expect((await userRow(r.body.me.id)).roles).toEqual(['player']);
    const panel = await t.json('GET', '/admin/dashboard', undefined, `Bearer-less`, {
      authorization: `Bearer ${r.body.accessToken}`,
    });
    expect(panel.status).toBe(200);
    const [u] = await listed('chefia');
    expect(u.adminSource).toBe('email');
    const block = await t.json('PUT', `/admin/users/${u.id}/status`, { status: 'blocked' }, t.admin);
    expect(block.body.error.message).toMatch(/ADMIN_EMAILS/);
    const del = await t.json('DELETE', `/admin/users/${u.id}`, { confirmation: SAFETY_PHRASE }, t.admin);
    expect(del.body.error.message).toMatch(/ADMIN_EMAILS/);
  });
  it('o Master não é editado, bloqueado nem excluído pelo painel', async () => {
    const [m] = (await t.json('GET', '/admin/users', undefined, t.admin)).body.users.filter(
      (u: any) => u.adminSource === 'master',
    );
    expect(m.id).toBe(t.adminId);
    for (const r of [
      await t.json('PATCH', `/admin/users/${m.id}`, { nickname: 'OutroNome' }, t.admin),
      await t.json('PUT', `/admin/users/${m.id}/status`, { status: 'blocked' }, t.admin),
      await t.json('DELETE', `/admin/users/${m.id}`, { confirmation: SAFETY_PHRASE }, t.admin),
    ])
      expect(r.body.error.message).toMatch(/Master/);
  });
});

describe('regra de novos cadastros', () => {
  it('liberados por padrão; com aprovação, a conta espera e o admin aprova', async () => {
    expect((await t.json('GET', '/auth/providers')).body).toEqual({
      google: false,
      signupMode: 'open',
      guests: true,
    });
    expect((await setAccess('approval')).body).toMatchObject({ signupMode: 'approval', signupDomains: [] });
    expect((await t.json('GET', '/auth/providers')).body).toMatchObject({
      signupMode: 'approval',
      guests: false,
    });

    const r = await signup('Esperando');
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ pending: true });
    expect(r.res.cookies.find((c) => c.name === 'tracado_rt')).toBeUndefined();
    const before = await t.login('esperando@teste.dev', 'senha-forte-1');
    expect(before.body.error.code).toBe('ACCOUNT_PENDING');
    // Senha errada não revela a situação.
    expect((await t.login('esperando@teste.dev', 'errada-123')).body.error.code).toBe('INVALID_CREDENTIALS');

    // Convidado não tem como voltar depois da aprovação: é recusado.
    const guest = await t.json('POST', '/auth/guest', { nickname: 'ConvAprov' });
    expect(guest.body.error.code).toBe('SIGNUP_CLOSED');

    const list = (await t.json('GET', '/admin/users?status=pending', undefined, t.admin)).body;
    expect(list.pending).toBe(1);
    expect(list.users.map((u: any) => u.nickname)).toEqual(['Esperando']);
    const ok = await t.json('PUT', `/admin/users/${list.users[0].id}/status`, { status: 'active' }, t.admin);
    expect(ok.body.status).toBe('active');
    expect((await t.login('esperando@teste.dev', 'senha-forte-1')).status).toBe(200);
    await setAccess('open');
  });
  it('fechados: ninguém se cadastra; quem já tem conta entra', async () => {
    const antes = await t.register('JaTinha');
    await setAccess('closed');
    expect((await signup('Atrasado')).body.error.code).toBe('SIGNUP_CLOSED');
    expect((await t.json('POST', '/auth/guest', { nickname: 'ConvFechado' })).body.error.code).toBe(
      'SIGNUP_CLOSED',
    );
    expect((await t.login('jatinha@teste.dev', 'senha-forte-1')).status).toBe(200);
    // O admin ainda cadastra pelo painel.
    const c = await t.json(
      'POST',
      '/admin/users',
      { nickname: 'DoPainel', email: 'Painel@Teste.dev', password: 'senha-painel-1' },
      t.admin,
    );
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ email: 'painel@teste.dev', status: 'active', verified: true });
    expect((await t.login('dopainel', 'senha-painel-1')).status).toBe(200);
    await setAccess('open');
    void antes;
  });
  it('salvar as configurações do jogo não desfaz a regra de cadastros', async () => {
    const got = (await t.json('GET', '/admin/settings', undefined, t.admin)).body.settings;
    // O banco de teste só tem a categoria "teste".
    const stale = { ...got, autoRaces: { ...got.autoRaces, categories: ['teste'] } };
    await setAccess('closed');
    const { access: _a, ...semRegra } = stale;
    expect((await t.json('PUT', '/admin/settings', stale, t.admin)).status).toBe(200);
    expect((await t.json('PUT', '/admin/settings', semRegra, t.admin)).status).toBe(200);
    expect((await t.json('GET', '/admin/access', undefined, t.admin)).body.signupMode).toBe('closed');
    await setAccess('open');
  });
  it('domínios: só e-mails da lista; convidado fica de fora', async () => {
    const r = await setAccess('open', ['@Empresa.com.br', 'empresa.com.br']);
    expect(r.body.signupDomains).toEqual(['empresa.com.br']);
    expect((await signup('Fora', 'fora@gmail.com')).body.error.code).toBe('SIGNUP_CLOSED');
    expect((await signup('Dentro', 'dentro@empresa.com.br')).status).toBe(201);
    expect((await t.json('POST', '/auth/guest', { nickname: 'ConvDominio' })).body.error.code).toBe(
      'SIGNUP_CLOSED',
    );
    expect((await setAccess('open', ['não é domínio'])).status).toBe(400);
    await setAccess('open');
  });
});

describe('bloqueio', () => {
  it('derruba na hora (até o access token em uso), recusa login e refresh; desbloquear devolve', async () => {
    const u = await t.register('Bloqueavel');
    const bearer = { authorization: `Bearer ${u.jwt}` };
    expect((await t.json('GET', '/me', undefined, undefined, bearer)).status).toBe(200);
    const b = await t.json('PUT', `/admin/users/${u.userId}/status`, { status: 'blocked' }, t.admin);
    expect(b.body.status).toBe('blocked');
    expect((await t.json('GET', '/me', undefined, undefined, bearer)).status).toBe(401);
    const refresh = await t.json('POST', '/auth/refresh', undefined, undefined, {
      cookie: `tracado_rt=${u.cookie}`,
      'x-tracado-csrf': '1',
    });
    expect(refresh.status).toBe(401);
    expect((await t.login('bloqueavel@teste.dev', 'senha-forte-1')).body.error.code).toBe('ACCOUNT_BLOCKED');
    await t.json('PUT', `/admin/users/${u.userId}/status`, { status: 'active' }, t.admin);
    const back = await t.login('bloqueavel@teste.dev', 'senha-forte-1');
    expect(back.status).toBe(200);
    expect(
      (await t.json('GET', '/me', undefined, undefined, { authorization: `Bearer ${back.body.accessToken}` }))
        .status,
    ).toBe(200);
  });
  it('o admin não bloqueia a si mesmo', async () => {
    const c = await t.json(
      'POST',
      '/admin/users',
      { nickname: 'AdminDois', email: 'admin2@teste.dev', password: 'senha-admin-2' },
      t.admin,
    );
    await t.json('PATCH', `/admin/users/${c.body.id}`, { roles: ['player', 'admin'] }, t.admin);
    const tok = (await t.login('admin2@teste.dev', 'senha-admin-2')).body.accessToken;
    const self = await t.json('PUT', `/admin/users/${c.body.id}/status`, { status: 'blocked' }, undefined, {
      authorization: `Bearer ${tok}`,
    });
    expect(self.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('edição e exclusão', () => {
  it('edita apelido, e-mail e senha; a senha nova encerra as sessões', async () => {
    const u = await t.register('Editavel');
    const r = await t.json(
      'PATCH',
      `/admin/users/${u.userId}`,
      { nickname: 'Editado', email: 'editado@teste.dev', password: 'outra-senha-1' },
      t.admin,
    );
    expect(r.body).toMatchObject({ nickname: 'Editado', email: 'editado@teste.dev' });
    const old = await t.json('POST', '/auth/refresh', undefined, undefined, {
      cookie: `tracado_rt=${u.cookie}`,
      'x-tracado-csrf': '1',
    });
    expect(old.status).toBe(401);
    expect((await t.login('editado', 'outra-senha-1')).status).toBe(200);
    const dup = await t.json('PATCH', `/admin/users/${u.userId}`, { nickname: 'Apelidado' }, t.admin);
    expect(dup.body.error.code).toBe('NICKNAME_TAKEN');
  });
  it('exclui de vez quem nunca correu; quem tem histórico é anonimizado', async () => {
    const semNada = await t.register('SemHistorico');
    const semFrase = await t.json(
      'DELETE',
      `/admin/users/${semNada.userId}`,
      { confirmation: 'sim' },
      t.admin,
    );
    expect(semFrase.body.error.code).toBe('VALIDATION_ERROR');
    const del = await t.json(
      'DELETE',
      `/admin/users/${semNada.userId}`,
      { confirmation: SAFETY_PHRASE.toLowerCase() },
      t.admin,
    );
    expect(del.body).toEqual({ ok: true, mode: 'deleted' });
    expect(await t.ctx.db.select().from(users).where(eq(users.id, semNada.userId))).toEqual([]);

    const piloto = await t.register('ComHistorico');
    const raceId = await t.createRace();
    expect((await t.json('POST', `/races/${raceId}/entries`, undefined, piloto.token)).status).toBe(201);
    const anon = await t.json(
      'DELETE',
      `/admin/users/${piloto.userId}`,
      { confirmation: SAFETY_PHRASE },
      t.admin,
    );
    expect(anon.body).toEqual({ ok: true, mode: 'anonymized' });
    const row = await userRow(piloto.userId);
    expect(row).toMatchObject({ status: 'blocked', googleSub: null });
    expect(row.email).toMatch(/@removido\.invalid$/);
    const [u] = await listed('Removido');
    expect(u.id).toBe(piloto.userId);
    expect((await t.login('comhistorico@teste.dev', 'senha-forte-1')).status).toBe(401);
    // O e-mail fica livre para uma conta nova.
    expect((await signup('Renascido', 'comhistorico@teste.dev')).status).toBe(201);
  });
});
