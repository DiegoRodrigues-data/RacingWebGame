import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const API_PORT = 3101;
const WEB_PORT = 5174;
export const API = `http://localhost:${API_PORT}`;

export default defineConfig({
  testDir: './tests',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 860 } },
      testIgnore: /mobile/,
    },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile/ },
  ],
  webServer: [
    {
      command: `rm -rf "${resolve(here, '.data')}" && cd "${resolve(here, '../apps/api')}" && npx tsx src/server.ts`,
      url: `${API}/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'development',
        PORT: String(API_PORT),
        PGLITE_DIR: resolve(here, '.data/pglite'),
        SEED_DEMO: 'true',
        DEMO_BOTS: '6',
        SIMULATED_DRIVERS: 'false',
        ENABLE_DEV_ROUTES: 'true',
        ENGINE_TICK_MS: '200',
        LOG_LEVEL: 'warn',
        MAX_SIGNUPS_PER_IP_PER_DAY: '1000',
        FLAG_SIGNUPS_PER_IP_PER_DAY: '1000',
        RATE_LIMIT_PER_MINUTE: '10000',
        WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
      },
      stdout: 'pipe',
    },
    {
      command: `cd "${resolve(here, '../apps/web')}" && npx vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: { VITE_API_PROXY: API },
    },
  ],
});
