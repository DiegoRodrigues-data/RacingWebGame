import { expect, test } from '@playwright/test';
import { determinismProbe } from '@tracado/sim';

test('pista e simulação geram os mesmos hashes no navegador e no Node', async ({ page }) => {
  await page.goto('/dev/determinismo');
  const browser = JSON.parse((await page.getByTestId('determinism').textContent())!);
  const node = determinismProbe();
  expect(browser).toEqual(node);
});
