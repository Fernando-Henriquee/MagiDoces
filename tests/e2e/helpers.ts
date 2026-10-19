import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test as base } from '@playwright/test';

export const API = 'http://127.0.0.1:54361';
export const PASSWORD = 'senha-e2e-123';

function adminToken(): string {
  return readFileSync(join(process.cwd(), '.local-backend', 'admin-token-54361'), 'utf8').trim();
}

export function unique(prefix: string): string {
  return `${prefix} ${Math.random().toString(36).slice(2, 7)}`;
}

/** Cria uma conta com um negócio novo e isolado (ou no negócio local padrão). */
export async function createAccount(options: { role?: 'owner' | 'editor' | 'viewer'; isolated?: boolean } = {}) {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@teste.local`;
  const response = await fetch(`${API}/local-admin/users`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-local-admin': adminToken() },
    body: JSON.stringify({
      email,
      password: PASSWORD,
      name: 'Pessoa E2E',
      role: options.role ?? 'owner',
      business_name: options.isolated === false ? undefined : unique('Negócio E2E'),
    }),
  });
  if (!response.ok) throw new Error(`Falha ao criar conta: ${await response.text()}`);
  return { email, password: PASSWORD };
}

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Início', level: 1 })).toBeVisible();
}

/** Converte "R$ 1.234,56" (ou "-R$ 3,00") em centavos. */
export function cents(text: string): number {
  const match = /(-?)\s*R\$\s*([\d.]+,\d{2})/.exec(text.replace(/\u00a0/g, ' '));
  if (!match) throw new Error(`Valor não encontrado em "${text}"`);
  return (match[1] ? -1 : 1) * Number(match[2]!.replace(/\./g, '').replace(',', ''));
}

/** Navega pelo menu (barra inferior + "Mais" no celular; barra lateral no desktop). */
export async function navigate(page: Page, label: string) {
  const sidebar = page.getByRole('complementary').getByRole('link', { name: label, exact: true });
  if (await sidebar.isVisible().catch(() => false)) {
    await sidebar.click();
    return;
  }
  const bottom = page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: label, exact: true });
  if (await bottom.isVisible().catch(() => false)) {
    await bottom.click();
    return;
  }
  await page.getByRole('button', { name: 'Mais' }).click();
  await page.getByRole('dialog').getByRole('link', { name: label, exact: true }).click();
}

/** Falha o teste se houver erros de JavaScript ou violações de CSP na página. */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        const text = message.text();
        // Falhas de rede esperadas nos testes offline não contam.
        if (/net::ERR_INTERNET_DISCONNECTED|Failed to fetch|Failed to load resource/.test(text)) return;
        errors.push(text);
      });
      await use(errors);
      expect(errors, 'erros no console').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
