import { cents, createAccount, expect, login, test, unique } from './helpers';

function stat(page: import('@playwright/test').Page, label: string) {
  return page.getByRole('main').getByText(label, { exact: true }).filter({ visible: true }).first().locator('..').locator('..');
}

test('dashboard reflete vendas, recebimentos e despesas com fórmulas distintas', async ({ page }) => {
  const account = await createAccount();
  await login(page, account.email);

  // Venda de R$ 30,00 com R$ 10,00 recebidos agora.
  await page.goto('/vendas/nova');
  await page.getByRole('button', { name: 'Escolher cliente' }).click();
  await page.getByLabel(/Pesquisar cliente/).fill(unique('Cliente Painel'));
  await page.getByRole('button', { name: /Cadastrar novo cliente/ }).click();
  await page.getByRole('button', { name: /^Adicionar Bolo de pote/ }).click();
  await page.getByLabel('Quantidade de Bolo de pote').fill('3');
  await page.getByLabel('Preço unitário').fill('10,00');
  await page.getByRole('radio', { name: 'Parcial' }).click();
  await page.getByLabel('Valor recebido agora').fill('10,00');
  await page.getByRole('button', { name: 'Registrar venda', exact: true }).click();
  await expect(page.getByText('Venda registrada.')).toBeVisible();

  // Despesa paga de R$ 5,00.
  await page.goto('/despesas/nova');
  await page.getByPlaceholder('Ex.: Conta de luz de outubro').fill('Sacolas');
  await page.getByLabel(/^Valor/).fill('5,00');
  await page.getByLabel('Categoria').fill('Embalagens');
  await page.getByLabel('Forma de pagamento').selectOption('dinheiro');
  await page.getByRole('button', { name: 'Registrar despesa' }).click();
  await expect(page.getByText('Despesa registrada.')).toBeVisible();

  await page.goto('/');
  await expect(stat(page, 'Faturamento')).toContainText('1 venda');
  expect(cents(await stat(page, 'Faturamento').innerText())).toBe(3000);
  expect(cents(await stat(page, 'Recebido').innerText())).toBe(1000);
  expect(cents(await stat(page, 'Contas a receber').innerText())).toBe(2000);
  expect(cents(await stat(page, 'Despesas do período').innerText())).toBe(500);
  // Sem custo informado: CMV 0 e lucro marcado como parcial.
  expect(cents(await stat(page, 'Lucro estimado').innerText())).toBe(2500);
  await expect(stat(page, 'Lucro estimado')).toContainText('parcial');
  expect(cents(await stat(page, 'Fluxo de caixa').innerText())).toBe(500);

  // "Dia" a partir do mês atual mostra hoje; o dia anterior não tem vendas.
  await page.getByRole('radio', { name: 'Dia' }).click();
  await expect(stat(page, 'Faturamento')).toContainText('1 venda');
  await page.getByRole('button', { name: 'Período anterior' }).click();
  await expect(stat(page, 'Faturamento')).toContainText('0 vendas');
  expect(cents(await stat(page, 'Faturamento').innerText())).toBe(0);
});
