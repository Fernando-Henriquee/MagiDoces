import { type Page } from '@playwright/test';
import { cents, createAccount, expect, login, test, unique } from './helpers';

async function startSale(page: Page, customer: string) {
  await page.goto('/vendas/nova');
  await page.getByRole('button', { name: 'Escolher cliente' }).click();
  await page.getByLabel(/Pesquisar cliente/).fill(customer);
  await page.getByRole('button', { name: /Cadastrar novo cliente/ }).click();
}

test('criação de venda paga com cliente novo e preço definido na hora', async ({ page }) => {
  const account = await createAccount();
  await login(page, account.email);
  const customer = unique('Dona Rosa');
  await startSale(page, customer);
  await page.getByRole('button', { name: /^Adicionar Bolo de pote/ }).click();
  await page.getByRole('button', { name: 'Aumentar Bolo de pote' }).click();
  await page.getByLabel('Preço unitário').fill('12,00');
  await page.getByRole('button', { name: /^Adicionar Torta de limão/ }).click();
  await page.getByLabel('Preço unitário').nth(1).fill('15,00');
  await page.getByRole('button', { name: '+ desconto na venda' }).click();
  await page.getByLabel('Desconto na venda').fill('2,00');
  await page.getByRole('button', { name: /Registrar venda paga · R\$ 37,00/ }).click();

  await expect(page.getByText('Venda registrada.')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Venda de/ })).toContainText('Paga');
  await expect(page.getByRole('link', { name: customer })).toBeVisible();
  const values = page.locator('dl').first();
  await expect(values).toContainText('Desconto na venda');
  expect(cents(await values.getByText('Total').locator('..').innerText())).toBe(3700);
});

test('pagamento parcial, saldo e quitação', async ({ page }) => {
  const account = await createAccount();
  await login(page, account.email);
  await startSale(page, unique('Seu Carlos'));
  await page.getByRole('button', { name: /^Adicionar Morango cravejado/ }).click();
  await page.getByLabel('Quantidade de Morango cravejado').fill('3');
  await page.getByLabel('Preço unitário').fill('10,00');
  await page.getByRole('radio', { name: 'A receber' }).click();
  await page.getByRole('radio', { name: /^Dia 10/ }).click();
  await page.getByRole('button', { name: 'Registrar venda', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Venda de/ })).toContainText(/Prevista|Pendente|Vence hoje/);

  await page.getByRole('button', { name: 'Receber' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Valor').fill('12,50');
  await expect(dialog.getByText('Restará R$ 17,50 em aberto.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirmar recebimento' }).click();
  await expect(page.getByText('Recebimento registrado.')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Venda de/ })).toContainText('Parcial');
  expect(cents(await page.locator('dl').first().getByText('Saldo').locator('..').innerText())).toBe(1750);

  // Não é possível receber mais que o saldo.
  await page.getByRole('button', { name: 'Receber' }).click();
  await page.getByRole('dialog').getByLabel('Valor').fill('50,00');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar recebimento' }).click();
  await expect(page.getByRole('dialog').getByText(/não pode passar do saldo/)).toBeVisible();
  await page.getByRole('dialog').getByLabel('Valor').fill('17,50');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar recebimento' }).click();
  await expect(page.getByRole('heading', { name: /Venda de/ })).toContainText('Paga');
  await expect(page.getByText(/Recebimento · .* · PIX/)).toHaveCount(2);
});

test('cancelamento rastreável com reembolso', async ({ page }) => {
  const account = await createAccount();
  await login(page, account.email);
  await startSale(page, unique('Cliente Cancela'));
  await page.getByRole('button', { name: /^Adicionar Surpresa de uva/ }).click();
  await page.getByLabel('Preço unitário').fill('9,00');
  await page.getByRole('button', { name: /Registrar venda paga/ }).click();
  await expect(page.getByText('Venda registrada.')).toBeVisible();

  await page.getByRole('button', { name: 'Cancelar venda' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByText(/tem R\$\s9,00 recebidos/)).toBeVisible();
  await dialog.getByLabel(/Motivo do cancelamento/).fill('Cliente desistiu do pedido');
  await dialog.getByRole('button', { name: 'Cancelar venda' }).click();
  await expect(page.getByText(/Venda cancelada em/)).toBeVisible();
  await expect(page.getByText('Motivo: Cliente desistiu do pedido')).toBeVisible();
  await expect(page.getByText(/Reembolso · .*/)).toBeVisible();
});
