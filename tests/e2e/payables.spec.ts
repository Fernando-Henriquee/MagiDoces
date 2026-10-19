import { createAccount, expect, login, test, unique } from './helpers';

test('registro de compra parcelada, pagamento de parcela e despesa paga', async ({ page }) => {
  const account = await createAccount();
  await login(page, account.email);

  await page.goto('/compras/nova');
  await page.getByPlaceholder('Ex.: Compra do mês no atacado').fill('Insumos do mês');
  await page.getByRole('button', { name: 'Fornecedor', exact: true }).click();
  const supplier = unique('Atacado');
  await page.getByRole('searchbox', { name: /Pesquisar fornecedor/ }).fill(supplier);
  await page.getByRole('button', { name: new RegExp(`Cadastrar fornecedor “${supplier}”`) }).click();
  await page.getByPlaceholder(/Ex.: Leite condensado/).first().fill('Farinha 5 kg');
  await page.getByLabel('Quantidade').nth(0).fill('2');
  await page.getByLabel('Unidade').nth(0).fill('pct');
  await page.getByLabel('Valor unit.').nth(0).fill('25,00');
  await page.getByRole('button', { name: 'Item', exact: true }).click();
  await page.getByPlaceholder(/Ex.: Leite condensado/).nth(1).fill('Leite condensado');
  await page.getByLabel('Quantidade').nth(1).fill('12');
  await page.getByLabel('Unidade').nth(1).fill('un');
  await page.getByLabel('Valor unit.').nth(1).fill('6,50');
  await page.getByLabel('Frete e taxas').fill('10,00');
  await page.locator('input[name=plan-mode][value=installments]').check();
  await page.getByRole('spinbutton', { name: 'Parcelas' }).fill('3');
  await page.getByRole('button', { name: 'Registrar compra' }).click();
  await expect(page).toHaveURL(/\/compras\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Compra registrada.')).toBeVisible();
  // 2 × 25 + 12 × 6,50 + 10 = 138 → 3 parcelas de R$ 46,00
  await expect(page.getByText('R$ 138,00').first()).toBeVisible();
  await expect(page.getByText('R$ 46,00').first()).toBeVisible();

  await page.getByRole('button', { name: 'Pagar', exact: true }).first().click();
  await page.getByRole('button', { name: 'Confirmar pagamento' }).click();
  await expect(page.getByText('Parcela marcada como paga.')).toBeVisible();

  await page.goto('/despesas/nova');
  await page.getByPlaceholder('Ex.: Conta de luz de outubro').fill('Conta de luz');
  await page.getByLabel(/^Valor/).fill('189,90');
  await page.getByLabel('Categoria').fill('Energia');
  await page.getByLabel('Forma de pagamento').selectOption('pix');
  await page.getByRole('button', { name: 'Registrar despesa' }).click();
  await expect(page).toHaveURL(/\/despesas\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Despesa registrada.')).toBeVisible();

  await page.goto('/financeiro');
  await expect(page.getByRole('heading', { name: 'Financeiro' })).toBeVisible();
  await expect(page.getByText('Conta de luz').first()).toBeVisible();
});
