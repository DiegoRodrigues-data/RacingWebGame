import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const API = 'http://localhost:3101';

export async function advanceClock(request: APIRequestContext, ms: number) {
  const r = await request.post(`${API}/dev/clock/advance`, { data: { ms } });
  expect(r.ok()).toBeTruthy();
  return (await r.json()).now as number;
}
export async function serverNow(request: APIRequestContext) {
  return (await (await request.get(`${API}/dev/clock`)).json()).now as number;
}
export async function advanceTo(request: APIRequestContext, iso: string, extraMs = 0) {
  const now = await serverNow(request);
  const delta = Date.parse(iso) + extraMs - now;
  if (delta > 0) await advanceClock(request, delta);
  else await request.post(`${API}/dev/engine/tick`);
}
export async function race(request: APIRequestContext, id: string) {
  return (await request.get(`${API}/races/${id}`)).json();
}

let counter = 0;
export async function signUp(page: Page, nick?: string) {
  const nickname = nick ?? `E2E${Date.now().toString(36)}${counter++}`;
  await page.goto('/cadastro');
  await page.getByLabel('Apelido de piloto').fill(nickname);
  await page.getByLabel('E-mail').fill(`${nickname.toLowerCase()}@e2e.dev`);
  await page.getByLabel('Senha (mín. 8)').fill('senha-e2e-123');
  await page.getByLabel('Estado/Região').fill('SP');
  await page.getByLabel('Cidade').fill('Campinas');
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page).toHaveURL(/calendario/);
  return nickname;
}

/** Cria, via API de admin, uma corrida que começa em `startInMin` minutos com inscrições já abertas. */
export async function createRaceAsAdmin(
  request: APIRequestContext,
  startInMin = 20,
  extra: Record<string, unknown> = {},
) {
  const login = await request.post(`${API}/auth/login`, {
    data: { email: 'admin@tracado.local', password: 'admin12345' },
  });
  const token = (await login.json()).accessToken as string;
  const cats = await (await request.get(`${API}/categories`)).json();
  const cat = cats.find((c: { slug: string }) => c.slug === 'copa-novatos');
  const now = await serverNow(request);
  const r = await request.post(`${API}/admin/races`, {
    headers: { authorization: `Bearer ${token}` },
    data: {
      name: `E2E ${Date.now().toString(36)}`,
      categoryId: cat.id,
      startAt: new Date(now + startInMin * 60_000).toISOString(),
      registrationLeadMinutes: startInMin + 10,
      practiceMinutes: 2,
      setupLockSeconds: 10,
      qualifyingSeconds: 15,
      track: { type: 'procedural', seed: `e2e-${Date.now()}` },
      ...extra,
    },
  });
  expect(r.status(), await r.text()).toBe(201);
  const id = (await r.json()).id as string;
  await request.post(`${API}/dev/engine/tick`);
  return { id, token };
}
