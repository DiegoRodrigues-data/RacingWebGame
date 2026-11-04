import { expect, test } from '@playwright/test';

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
