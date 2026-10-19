import { createAccount, expect, login, navigate, test, unique } from './helpers';

test('dados de um negócio não aparecem para outro', async ({ browser }) => {
  const first = await createAccount();
  const second = await createAccount();
  const secret = unique('Cliente Sigiloso');

  const pageA = await (await browser.newContext()).newPage();
  await login(pageA, first.email);
  await navigate(pageA, 'Clientes');
  await pageA.getByRole('button', { name: 'Novo cliente' }).click();
  await pageA.getByRole('dialog').getByRole('textbox', { name: 'Nome', exact: true }).fill(secret);
  await pageA.getByRole('dialog').getByRole('button', { name: 'Salvar' }).click();
  await expect(pageA.getByRole('heading', { name: secret })).toBeVisible();
  const customerUrl = pageA.url();

  const pageB = await (await browser.newContext()).newPage();
  await login(pageB, second.email);
  await navigate(pageB, 'Clientes');
  await expect(pageB.getByText(secret)).toHaveCount(0);
  await pageB.goto(customerUrl);
  await expect(pageB.getByRole('alert')).toContainText(/não encontrado|sem acesso/i);
});

test('perfil somente leitura não vê ações de gravação', async ({ page }) => {
  const viewer = await createAccount({ role: 'viewer' });
  await login(page, viewer.email);
  await expect(page.getByRole('link', { name: 'Nova venda' })).toHaveCount(0);
  await page.goto('/vendas/nova');
  await expect(page.getByText('Seu perfil é somente leitura.')).toBeVisible();
  await navigate(page, 'Clientes');
  await expect(page.getByRole('button', { name: 'Novo cliente' })).toHaveCount(0);
});

test('conta sem negócio associado não acessa dados', async ({ page }) => {
  const response = await fetch('http://127.0.0.1:54361/auth/v1/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: 'local-anon-key' },
    body: JSON.stringify({ email: 'invasor@teste.local', password: 'senha-123456' }),
  });
  expect(response.status).toBe(422);
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill('invasor@teste.local');
  await page.getByLabel('Senha', { exact: true }).fill('senha-123456');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert')).toHaveText('E-mail ou senha incorretos.');
});
