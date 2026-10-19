import { createAccount, expect, login, navigate, test } from './helpers';

test('sócia salva as configurações do negócio e a chave PIX entra na cobrança', async ({ page }) => {
  const account = await createAccount();
  await login(page, account.email);
  await navigate(page, 'Configurações');
  await page.getByLabel('Chave PIX').fill('pix@magidoces.test');
  await page.getByRole('button', { name: 'Salvar configurações' }).click();
  await expect(page.getByText('Configurações salvas.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Chave PIX')).toHaveValue('pix@magidoces.test');

  await navigate(page, 'Auditoria');
  await expect(page.getByText('Configurações alteradas').filter({ visible: true }).first()).toBeVisible();
});
