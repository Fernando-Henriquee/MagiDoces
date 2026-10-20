import { createAccount, expect, login, navigate, test, unique } from './helpers';

test('link de compras: a cliente anota, paga por PIX, cria o código e consulta; a sócia revisa', async ({ page, browser }) => {
  const account = await createAccount();
  await login(page, account.email);

  // Produto com preço (só produtos ativos com preço aparecem no link).
  await navigate(page, 'Produtos');
  const product = unique('Brigadeiro');
  await page.getByRole('button', { name: 'Novo produto' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Nome', exact: true }).fill(product);
  await dialog.getByLabel('Preço de venda').fill('4,50');
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Produto cadastrado.')).toBeVisible();

  // Chave PIX e link ligado nas Configurações.
  await navigate(page, 'Configurações');
  await page.getByLabel('Chave PIX').fill('gihramos92@gmail.com');
  await page.getByLabel('Cidade (para o PIX)').fill('Curitiba');
  await page.getByRole('button', { name: 'Salvar configurações' }).click();
  await expect(page.getByText('Configurações salvas.')).toBeVisible();
  await page.getByRole('button', { name: 'Ligar link de compras' }).click();
  await expect(page.getByText('Link de compras ativado.')).toBeVisible();
  await expect(page.getByRole('img', { name: 'QR code do link de compras' })).toBeVisible();
  const link = await page.getByLabel('Endereço do link').inputValue();
  expect(link).toMatch(/\/compra\/[A-Za-z0-9_-]{22}$/);

  // A cliente: outro navegador, sem login.
  const customerContext = await browser.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', permissions: ['clipboard-read', 'clipboard-write'] });
  const customer = await customerContext.newPage();
  const customerErrors: string[] = [];
  customer.on('pageerror', (error) => customerErrors.push(`pageerror: ${error.message}`));
  customer.on('console', (message) => {
    if (message.type() === 'error') customerErrors.push(message.text());
  });

  await customer.goto(link);
  await expect(customer.getByRole('heading', { name: 'O que você levou?' })).toBeVisible();
  // Produtos sem preço (os iniciais) não aparecem.
  await expect(customer.getByText('Bolo de pote')).toHaveCount(0);

  // Validação antes de enviar.
  await customer.getByRole('button', { name: 'Anotar compra' }).click();
  await expect(customer.getByText('Escolha pelo menos um produto.')).toBeVisible();

  await customer.getByRole('button', { name: `Adicionar ${product}` }).click();
  await customer.getByRole('button', { name: `Adicionar ${product}` }).click();
  await expect(customer.getByLabel(`Quantidade de ${product}`)).toHaveText('2');
  await customer.getByLabel('Seu nome').fill('Joana Cliente');
  await customer.getByLabel('Seu celular (WhatsApp)').fill('11987654321');
  await customer.getByRole('radio', { name: /Agora, no PIX/ }).check();
  await customer.getByRole('button', { name: 'Anotar compra' }).click();

  await expect(customer.getByRole('heading', { name: 'Compra anotada!' })).toBeVisible();
  await expect(customer.getByText(`2× ${product}`)).toBeVisible();
  await expect(customer.getByRole('img', { name: 'QR code PIX de R$ 9,00' })).toBeVisible();
  await customer.getByRole('button', { name: /Copiar código PIX/ }).click();
  const pix = await customer.evaluate(() => navigator.clipboard.readText());
  expect(pix).toMatch(/^000201.+br\.gov\.bcb\.pix.+gihramos92@gmail\.com.+54049\.00.+CURITIBA.+6304[0-9A-F]{4}$/);

  await customer.getByRole('button', { name: 'Já paguei' }).click();
  await expect(customer.getByText(/Você avisou que já pagou/)).toBeVisible();

  // Código de consulta (cliente nova cria o próprio).
  await customer.getByLabel('Código de 4 números').fill('1234');
  await customer.getByRole('button', { name: 'Salvar código' }).click();
  await expect(customer.getByText(/menos óbvio/)).toBeVisible();
  await customer.getByLabel('Código de 4 números').fill('4826');
  await customer.getByRole('button', { name: 'Salvar código' }).click();
  await expect(customer.getByText(/Código criado!/)).toBeVisible();

  // Consulta "quanto eu devo".
  await customer.getByRole('link', { name: 'Ver quanto eu devo' }).click();
  await customer.getByLabel('Seu celular (WhatsApp)').fill('(11) 98765-4321');
  await customer.getByLabel('Código de consulta').fill('0000');
  await customer.getByRole('button', { name: 'Consultar' }).click();
  await expect(customer.getByText(/Restam 4 tentativas/)).toBeVisible();
  await customer.getByLabel('Código de consulta').fill('4826');
  await customer.getByRole('button', { name: 'Consultar' }).click();
  await expect(customer.getByRole('heading', { name: 'Olá, Joana!' })).toBeVisible();
  await expect(customer.getByText('você avisou que pagou')).toBeVisible();
  await expect(customer.getByText('Total em aberto').locator('..')).toContainText('R$ 9,00');

  expect(customerErrors, 'erros no console da cliente').toEqual([]);
  await customerContext.close();

  // A sócia vê o aviso no Início, revisa e registra o recebimento.
  await page.goto('/');
  await page.getByRole('link', { name: /1 compra anotada pelas clientes/ }).click();
  await expect(page.getByRole('combobox', { name: 'Situação' })).toHaveValue('review');
  // Desktop: o link da linha fica na data; celular: o cartão inteiro é o link.
  const row = page.getByRole('row', { name: /Joana Cliente/ });
  if (await row.isVisible().catch(() => false)) await row.getByRole('link').first().click();
  else await page.getByText('Joana Cliente').filter({ visible: true }).first().click();
  await expect(page.getByText('Anotada pela própria cliente no link de compras.')).toBeVisible();
  await expect(page.getByText(/A cliente avisou em .* que já pagou/)).toBeVisible();
  await page.getByRole('button', { name: 'Marcar como revisada' }).click();
  await expect(page.getByText('Venda marcada como revisada.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Marcar como revisada' })).toHaveCount(0);

  // Código de consulta gerado pela loja na ficha da cliente.
  await page.getByRole('link', { name: 'Joana Cliente' }).click();
  await expect(page.getByText('Código ativo')).toBeVisible();
  await page.getByRole('button', { name: 'Gerar novo código' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Gerar novo código' }).click();
  await expect(page.getByLabel('Mensagem para a cliente')).toHaveValue(/use seu celular com o código \d{4}/);
  await expect(page.getByRole('link', { name: 'Enviar no WhatsApp' })).toHaveAttribute('href', /^https:\/\/wa\.me\/5511987654321\?text=/);
});

test('link desligado ou inventado mostra "Link indisponível"', async ({ page }) => {
  await page.goto('/compra/AAAAAAAAAAAAAAAAAAAAAA');
  await expect(page.getByRole('heading', { name: 'Link indisponível' })).toBeVisible();
  await page.goto('/compra/AAAAAAAAAAAAAAAAAAAAAA/consulta');
  await expect(page.getByRole('heading', { name: 'Link indisponível' })).toBeVisible();
});
