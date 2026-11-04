import { expect, test } from '@playwright/test';
import { createRaceAsAdmin } from './helpers';

test('portal e corrida funcionam no celular sem rolagem horizontal', async ({ page, request }) => {
  const { id } = await createRaceAsAdmin(request, 120);
  for (const url of ['/', '/calendario', `/corridas/${id}`, '/rankings', '/cadastro']) {
    await page.goto(url);
    await page.locator('main').waitFor();
    await page.waitForTimeout(1200);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `rolagem horizontal em ${url}`).toBeLessThanOrEqual(1);
  }
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('navigation', { name: 'Menu móvel' })).toBeVisible();
  await page.goto(`/corridas/${id}`);
  await expect(page.locator('canvas').first()).toBeVisible();
});
