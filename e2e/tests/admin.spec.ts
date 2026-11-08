import { expect, test } from '@playwright/test';
import { createRaceAsAdmin, race } from './helpers';

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
