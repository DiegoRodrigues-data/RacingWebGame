import { expect, test } from '@playwright/test';
import { advanceClock, advanceTo, createRaceAsAdmin, race, signUp } from './helpers';

test('fluxo crítico do jogador: inscrição → setup → traçado na janela → corrida ao vivo → resultado → ranking', async ({
  page,
  request,
}) => {
  const { id } = await createRaceAsAdmin(request, 20);
  const nick = await signUp(page);

  await page.goto(`/corridas/${id}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('E2E');
  await page.getByRole('button', { name: 'Inscrever-se' }).click();
  await expect(page.getByText('Confirmado')).toBeVisible();

  // Setup do carro.
  await page.getByRole('link', { name: /Ir para o box/ }).click();
  await page.getByRole('tab', { name: /Setup/ }).click();
  await page.getByRole('radio', { name: 'Macio' }).first().click();
  await page.getByRole('radio', { name: /Potência/ }).click();
  await page.getByRole('button', { name: 'Salvar setup' }).click();
  await expect(page.getByText('Setup salvo ✅')).toBeVisible();

  // Traçado: arrasta sobre o canvas (fora dos pontos de controle move a câmera) e aplica a linha sugerida
  // (salvo no servidor desde já).
  await page.getByRole('tab', { name: /Traçado/ }).click();
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.3);
  await page.mouse.down();
  for (let k = 1; k <= 12; k++)
    await page.mouse.move(box.x + box.width * (0.45 + k * 0.01), box.y + box.height * (0.3 + k * 0.01));
  await page.mouse.up();
  await page.getByRole('button', { name: 'Linha sugerida' }).click();
  // O traçado já fica salvo no servidor antes da janela.
  await expect(page.getByText(/Traçado oficial v\d+ salvo/)).toBeVisible({ timeout: 15_000 });

  // Abre a janela de traçado: o traçado salvo continua valendo.
  const r = await race(request, id);
  await advanceTo(request, r.timeline.traceWindowAt, 300);
  await expect(page.getByText(/Traçado oficial v\d+ salvo/)).toBeVisible({ timeout: 30_000 });

  // Classificação e corrida.
  await advanceTo(request, r.timeline.qualifyingAt, 300);
  await advanceTo(request, r.timeline.raceAt, 100);
  await page.goto(`/corridas/${id}/ao-vivo`);
  await advanceClock(request, 10_000);
  await expect(page.getByText('Classificação', { exact: true })).toBeVisible();
  await expect(page.locator('aside ol').first()).toContainText(nick, { timeout: 30_000 });

  // Bandeira quadriculada.
  const r2 = await race(request, id);
  await advanceTo(request, r2.timeline.raceEndsAt, 500);
  await expect(page.getByText('Bandeira quadriculada!')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('link', { name: 'Ver resultado' }).click();
  await expect(page.getByRole('heading', { name: 'Resultado' })).toBeVisible();
  await expect(page.getByRole('table')).toContainText(nick);

  // Ranking mundial inclui o jogador.
  await page.goto('/rankings');
  await page.getByRole('tab', { name: 'Mundial' }).click();
  await expect(page.getByRole('table')).toContainText(nick);
});

test('visitante entra no grid só com apelido, sem cadastro', async ({ page, request }) => {
  const { id } = await createRaceAsAdmin(request, 90);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Desenhe a linha/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Próximas largadas' })).toBeVisible();
  // O box exige sessão.
  await page.goto(`/corridas/${id}/box`);
  await expect(page).toHaveURL(/entrar/);
  await page.goto(`/corridas/${id}`);
  await expect(page.getByRole('link', { name: 'Já tenho conta' })).toHaveAttribute('href', /entrar\?voltar=/);
  await page.getByRole('link', { name: 'Correr só com apelido' }).click();
  await expect(page).toHaveURL(/jogar\?corrida=/);
  await page.getByLabel('Seu apelido').fill(`v${Date.now().toString(36).slice(-8)}`);
  await page.getByRole('button', { name: /Entrar no grid/ }).click();
  await expect(page).toHaveURL(new RegExp(`/corridas/${id}/box`));
  await expect(page.getByText('convidado', { exact: true })).toBeVisible();
});
