import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { API, createRaceAsAdmin, race } from './helpers';

const OUT = process.env.SHOTS_DIR ?? 'test-results/shots';

test('admin cria pista especial válida, publica e agenda corrida com ela', async ({ page }) => {
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill('admin@tracado.local');
  await page.getByLabel('Senha').fill('admin12345');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('link', { name: 'Admin' })).toBeVisible();

  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: /direção de prova/ })).toBeVisible();

  await page.goto('/admin/pistas/editor');
  await expect(page.getByText('✅ Pista válida')).toBeVisible();
  await page.getByLabel('Nome', { exact: true }).fill(`Especial ${Date.now().toString(36)}`);
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Pista criada como rascunho')).toBeVisible();
  await expect(page).toHaveURL(/editor\/[0-9a-f-]{36}/);
  await page.getByRole('button', { name: 'Publicar' }).click();
  await expect(page.getByText('Pista publicada! 🎉')).toBeVisible();

  await page.goto('/admin/corridas');
  await page.locator('select[name="track"]').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Criar corrida' }).click();
  await expect(page.getByText('Corrida criada')).toBeVisible();

  await page.goto('/admin/auditoria');
  await expect(page.getByText('track.version.publish').first()).toBeVisible();
});

test('jogador comum não acessa o painel administrativo', async ({ page }) => {
  await page.goto('/admin/corridas');
  await expect(page).toHaveURL(/entrar/);
});

test('admin vê as pistas do dia e troca a pista de uma corrida por uma especial', async ({
  page,
  request,
}) => {
  const name = `Dia ${Date.now().toString(36)}`;
  const { id } = await createRaceAsAdmin(request, 30, { name });
  // Dia da corrida no horário de Brasília (perto da meia-noite, cai no dia seguinte).
  const practiceAt = Date.parse((await race(request, id)).timeline.practiceAt);
  const dia = new Date(practiceAt - 3 * 3_600_000).toISOString().slice(0, 10);
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill('admin@tracado.local');
  await page.getByLabel('Senha').fill('admin12345');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('link', { name: 'Admin' })).toBeVisible();

  await page.goto(`/admin/pistas-do-dia?dia=${dia}`);
  await expect(page.getByRole('heading', { name: 'Pistas do dia' })).toBeVisible();
  const row = page.locator('li', { hasText: name });
  await expect(row).toContainText('Pista gerada');
  await expect(row).toContainText('Gerada');
  // Opções: manter a gerada, gerar outra, depois as especiais publicadas (a do seed de demonstração).
  await row.getByRole('combobox').selectOption({ index: 2 });
  // Com gente inscrita, pede confirmação (o traçado salvo de cada um é apagado).
  await row.getByRole('button', { name: 'Trocar' }).click();
  await expect(page.getByText('Pista trocada')).toBeVisible();
  await expect(row).toContainText('Escolhida');
  await expect(page.getByRole('complementary', { name: 'Pistas especiais' })).toContainText(
    'Entra 1× neste dia',
  );
  if (process.env.SHOTS)
    await page.screenshot({ path: 'test-results/shots/14-pistas-do-dia.png', fullPage: true });
});

test('cadastro sob aprovação: o piloto espera, o admin aprova no painel e ele entra pelo apelido', async ({
  browser,
  request,
}) => {
  const login = await request.post(`${API}/auth/login`, {
    data: { login: 'admin@tracado.local', password: 'admin12345' },
  });
  const headers = { authorization: `Bearer ${(await login.json()).accessToken}`, 'x-tracado-csrf': '1' };
  const setAccess = (signupMode: string) =>
    request.put(`${API}/admin/access`, { headers, data: { signupMode, signupDomains: [] } });
  const nickname = `Aprov${Date.now().toString(36)}`;
  expect((await setAccess('approval')).ok()).toBeTruthy();
  try {
    const visitor = await browser.newPage();
    await visitor.goto('/cadastro');
    await expect(visitor.getByText(/passam pela aprovação da organização/)).toBeVisible();
    await visitor.getByLabel('Apelido de piloto').fill(nickname);
    await visitor.getByLabel('E-mail').fill(`${nickname.toLowerCase()}@e2e.dev`);
    await visitor.getByLabel('Senha (mín. 8)').fill('senha-e2e-123');
    await visitor.getByLabel('Estado/Região').fill('SP');
    await visitor.getByLabel('Cidade').fill('Campinas');
    await visitor.getByRole('button', { name: 'Criar conta' }).click();
    await expect(visitor.getByRole('status')).toContainText('Cadastro recebido');
    await visitor.goto('/entrar');
    await visitor.getByLabel('E-mail ou apelido').fill(nickname);
    await visitor.getByLabel('Senha').fill('senha-e2e-123');
    await visitor.getByRole('button', { name: 'Entrar' }).click();
    await expect(visitor.getByRole('alert')).toContainText('aguarda a aprovação');

    const admin = await browser.newPage();
    await admin.goto('/entrar');
    await admin.getByLabel('E-mail ou apelido').fill('admin@tracado.local');
    await admin.getByLabel('Senha').fill('admin12345');
    await admin.getByRole('button', { name: 'Entrar' }).click();
    await expect(admin.getByRole('link', { name: 'Admin' })).toBeVisible();
    await admin.goto('/admin/usuarios');
    await expect(admin.getByText('Com aprovação')).toBeVisible();
    await expect(admin.getByText(/aguarda(m)? a sua aprovação/)).toBeVisible();
    if (process.env.SHOTS) {
      mkdirSync(OUT, { recursive: true });
      await admin.screenshot({ path: `${OUT}/12-admin-usuarios.png`, fullPage: true });
    }
    const row = admin.locator('tr', { hasText: nickname });
    await row.getByRole('button', { name: /Aprovar/ }).click();
    await expect(admin.getByText(`${nickname} aprovado`)).toBeVisible();
    await expect(row).not.toContainText('aguardando aprovação');
    await admin.getByRole('button', { name: 'Alterar regra' }).click();
    if (process.env.SHOTS) await admin.screenshot({ path: `${OUT}/13-admin-regra.png` });
    await admin.getByRole('radio', { name: /Liberados/ }).check();
    await admin.getByRole('button', { name: 'Salvar regra' }).click();
    await expect(admin.getByText('Regra de cadastro atualizada')).toBeVisible();

    await visitor.getByRole('button', { name: 'Entrar' }).click();
    await expect(visitor).toHaveURL(/\/$/);
  } finally {
    await setAccess('open');
  }
});
