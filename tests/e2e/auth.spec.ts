import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAccount, expect, login, test } from './helpers';

test.describe('Login', () => {
  test('entra, mostra erro com senha errada e sai limpando a sessão', async ({ page }) => {
    const account = await createAccount();
    await page.goto('/');
    await expect(page).toHaveURL(/\/entrar$/);
    await expect(page.getByRole('link', { name: /cadastr/i })).toHaveCount(0);

    await page.getByLabel('E-mail').fill(account.email);
    await page.getByLabel('Senha', { exact: true }).fill('senha-errada-1');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByRole('alert')).toHaveText('E-mail ou senha incorretos.');

    await login(page, account.email);
    await page.getByRole('button', { name: 'Menu da conta' }).click();
    await page.getByRole('menuitem', { name: 'Sair' }).click();
    await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
    const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('magi')));
    expect(stored).toEqual([]);
    await page.goto('/vendas');
    await expect(page).toHaveURL(/\/entrar$/);
  });

  test('recupera a senha pelo link enviado por e-mail', async ({ page }) => {
    const account = await createAccount();
    await page.goto('/recuperar-senha');
    await page.getByLabel('E-mail').fill(account.email);
    await page.getByRole('button', { name: 'Enviar link' }).click();
    await expect(page.getByRole('status')).toContainText('Se houver uma conta com este e-mail');

    // No ambiente local o "e-mail" fica num arquivo; no Supabase real ele é enviado.
    const link = readFileSync(join(process.cwd(), '.local-backend', 'last-recovery-link-54361.txt'), 'utf8');
    const url = new URL(link);
    await page.goto(`/redefinir-senha${url.hash}`);
    await expect(page.getByRole('heading', { name: 'Definir nova senha' })).toBeVisible();
    await page.getByLabel('Nova senha', { exact: true }).fill('nova-senha-456');
    await page.getByLabel('Confirme a nova senha').fill('nova-senha-456');
    await page.getByRole('button', { name: 'Salvar senha' }).click();
    await expect(page.getByRole('heading', { name: 'Início', level: 1 })).toBeVisible();

    await page.getByRole('button', { name: 'Menu da conta' }).click();
    await page.getByRole('menuitem', { name: 'Sair' }).click();
    await login(page, account.email, 'nova-senha-456');
  });
});
