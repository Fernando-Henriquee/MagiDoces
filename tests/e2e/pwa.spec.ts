import { createAccount, expect, login, test } from './helpers';

test('manifest instalável e service worker de produção', async ({ page, request }) => {
  const manifestResponse = await request.get('/manifest.webmanifest');
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json();
  expect(manifest).toMatchObject({ name: 'Magi Doces', short_name: 'Magi Doces', display: 'standalone', start_url: '/', lang: 'pt-BR' });
  const sizes = manifest.icons.map((icon: { sizes: string; purpose?: string }) => `${icon.sizes}${icon.purpose ? `:${icon.purpose}` : ''}`);
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512', '512x512:maskable']));
  for (const icon of manifest.icons) expect((await request.get(`/${icon.src}`)).ok()).toBe(true);

  const sw = await request.get('/sw.js');
  expect(sw.ok()).toBe(true);
  expect(sw.headers()['cache-control']).toContain('no-cache');
  const index = await request.get('/vendas');
  expect(index.headers()['content-security-policy']).toContain("script-src 'self'");
  expect(index.headers()['x-frame-options']).toBe('DENY');

  const account = await createAccount();
  await login(page, account.email);
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toMatch(/\/$/);
});

test('telas carregadas abrem offline, com aviso, e gravação fica bloqueada', async ({ page, context }) => {
  const account = await createAccount();
  await login(page, account.email);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // Recarrega para a página passar a ser controlada pelo service worker e salvar o cache de dados.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Início', level: 1 })).toBeVisible();
  await expect(page.getByText('Faturamento', { exact: true }).first()).toBeVisible();
  // Navega pelo app (como uma pessoa) para carregar e salvar os dados das telas.
  await page.getByRole('link', { name: 'Nova venda' }).first().click();
  await expect(page.getByRole('button', { name: /^Adicionar Bolo de pote/ })).toBeVisible();
  await page.getByRole('link', { name: 'Início' }).first().click();
  await expect(page.getByText('Faturamento', { exact: true }).first()).toBeVisible();
  await page.waitForTimeout(1500);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Início', level: 1 })).toBeVisible();
  await expect(page.getByText('Sem conexão.')).toBeVisible();
  await expect(page.getByText('Faturamento', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Dados salvos em .* podem estar desatualizados/).first()).toBeVisible();

  await page.getByRole('link', { name: 'Nova venda' }).first().click();
  await page.getByRole('button', { name: /^Adicionar Bolo de pote/ }).click();
  await expect(page.getByText('Sem conexão: a venda só pode ser gravada com internet.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Registrar venda/ })).toBeDisabled();

  // Tela nunca aberta antes: explica que não há dados salvos, sem carregar para sempre.
  await page.goto('/relatorios');
  await expect(page.getByText('Esta tela ainda não tem dados salvos neste aparelho.').first()).toBeVisible();
  await context.setOffline(false);
});
