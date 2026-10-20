import { defineConfig, devices } from '@playwright/test';

/**
 * Testes E2E contra o BUILD DE PRODUÇÃO (com os cabeçalhos do vercel.json, CSP e
 * service worker) e o emulador local da API Supabase em memória (migrations reais).
 * Cada teste cria a própria conta e o próprio negócio: rodam em paralelo sem
 * interferir uns nos outros. Nada toca dados reais.
 */
export const E2E_API = 'http://127.0.0.1:54361';
export const E2E_APP = 'http://127.0.0.1:4183';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  // Paralelismo moderado: cada teste abre um navegador e o build é servido localmente.
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: E2E_APP,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'celular', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    {
      command: 'npx tsx tools/local-backend/server.ts --memory --port 54361',
      url: `${E2E_API}/auth/v1/health`,
      reuseExistingServer: false,
      timeout: 90_000,
      stdout: 'ignore',
    },
    {
      command: 'npx vite build --outDir dist-e2e --emptyOutDir && npx tsx scripts/serve-dist.ts --dir dist-e2e --port 4183 --api http://127.0.0.1:54361',
      url: E2E_APP,
      reuseExistingServer: false,
      timeout: 240_000,
      env: { VITE_SUPABASE_URL: E2E_API, VITE_SUPABASE_ANON_KEY: 'local-anon-key', VITE_APP_ENV: 'local' },
    },
  ],
});
