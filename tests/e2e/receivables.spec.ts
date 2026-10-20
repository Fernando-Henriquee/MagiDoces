import { cents, createAccount, expect, login, navigate, test, unique } from './helpers';

test('contas a receber: dia 10, agrupamento por cliente e cobrança para WhatsApp', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const account = await createAccount();
  await login(page, account.email);
  const customer = unique('Maria Cobrança');

  for (const quantity of ['2', '1']) {
    await page.goto('/vendas/nova');
    if (quantity === '2') {
      await page.getByRole('button', { name: 'Escolher cliente' }).click();
      await page.getByLabel(/Pesquisar cliente/).fill(customer);
      await page.getByRole('button', { name: /Cadastrar novo cliente/ }).click();
    } else {
      await page.getByRole('button', { name: 'Escolher cliente' }).click();
      await page.getByLabel(/Pesquisar cliente/).fill(customer);
      // Cliente já cadastrado: escolhe na lista (o atalho de cadastro some quando o nome já existe).
      await page.getByRole('dialog').getByRole('button', { name: new RegExp(`^${customer}`) }).click();
    }
    await page.getByRole('button', { name: /^Adicionar Bolo de pote/ }).click();
    await page.getByLabel('Quantidade de Bolo de pote').fill(quantity);
    await page.getByLabel('Preço unitário').fill('12,00');
    await page.getByRole('radio', { name: 'A receber' }).click();
    await page.getByRole('button', { name: 'Registrar venda', exact: true }).click();
    await expect(page.getByText('Venda registrada.')).toBeVisible();
  }

  await navigate(page, 'A receber');
  await expect(page.getByRole('heading', { name: 'Contas a receber' })).toBeVisible();
  // A tela pode mostrar por um instante o valor salvo antes de atualizar: espera o valor final.
  await expect.poll(async () => cents(await page.getByText('Total em aberto').locator('..').locator('..').innerText())).toBe(3600);

  await page.getByRole('radio', { name: /^Dia 10/ }).click();
  await expect(page.getByRole('button', { name: customer, exact: true })).toBeVisible();
  await page.getByRole('button', { name: customer, exact: true }).click();
  await expect(page.getByText('2 vendas · original R$ 36,00')).toBeVisible();

  await page.getByRole('button', { name: 'Cobrar' }).first().click();
  const text = await page.getByLabel('Texto da cobrança').inputValue();
  expect(text).toContain(`Olá, ${customer.split(' ')[0]}!`);
  expect(text).toContain('*Total em aberto: R$ 36,00*');
  await page.getByRole('button', { name: 'Copiar' }).click();
  await expect(page.getByText('Resumo copiado. Cole no WhatsApp.')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text);
  await page.keyboard.press('Escape');

  await page.getByRole('tab', { name: 'Por vencimento' }).click();
  await expect(page.getByText('dia 10').first()).toBeVisible();
});
