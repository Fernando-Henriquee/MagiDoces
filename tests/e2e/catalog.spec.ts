import { createAccount, expect, login, navigate, test, unique } from './helpers';

test('cadastro de cliente', async ({ page }) => {
  const account = await createAccount();
  await login(page, account.email);
  await navigate(page, 'Clientes');
  const name = unique('Cliente');
  await page.getByRole('button', { name: 'Novo cliente' }).click();
  const form = page.getByRole('dialog');
  await form.getByRole('textbox', { name: 'Nome', exact: true }).fill(name);
  await form.getByLabel('Telefone (opcional)').fill('11988887777');
  await form.getByLabel('Observações').fill('Prefere entrega no sábado');
  await form.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Cliente cadastrado.')).toBeVisible();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByText('(11) 98888-7777')).toBeVisible();

  await page.getByRole('button', { name: 'Editar' }).click();
  await page.getByRole('dialog').getByLabel('Observações').fill('Cliente desde a feira');
  await page.getByRole('dialog').getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Cliente atualizado.')).toBeVisible();
  await expect(page.getByText('Cliente desde a feira')).toBeVisible();

  await navigate(page, 'Clientes');
  await page.getByLabel('Pesquisar por nome ou telefone').fill(name.split(' ')[1]!);
  await expect(page.getByText(name).filter({ visible: true }).first()).toBeVisible();
});

test('cadastro de produto com preço, custo e histórico', async ({ page }) => {
  const account = await createAccount();
  await login(page, account.email);
  await navigate(page, 'Produtos');
  // Produtos iniciais existem como configuração, com preço a definir.
  await expect(page.getByText('Bolo de pote').filter({ visible: true }).first()).toBeVisible();

  const name = unique('Brigadeiro gourmet');
  await page.getByRole('button', { name: 'Novo produto' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Nome', exact: true }).fill(name);
  await dialog.getByLabel('Categoria').fill('Doces finos');
  await dialog.getByLabel('Preço de venda').fill('4,50');
  await dialog.getByLabel('Custo unitário estimado').fill('1,80');
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Produto cadastrado.')).toBeVisible();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByText('Margem 60%')).toBeVisible();

  await page.getByLabel('Preço de venda').fill('5,00');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByText('Produto atualizado.')).toBeVisible();
  await page.getByRole('tab', { name: 'Histórico de preços' }).click();
  await expect(page.getByRole('cell', { name: 'R$ 5,00' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'R$ 4,50' })).toBeVisible();
});
