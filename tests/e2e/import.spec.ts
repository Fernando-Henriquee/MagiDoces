import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { createAccount, expect, login, test } from './helpers';

const serial = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000 + 25569;

function spreadsheet(): string {
  const rows = [
    ['Controle de vendas'],
    [],
    ['Data', 'Cliente', 'Bolo de pote', 'Torta de limão', 'Total', 'Pago'],
    [serial('2025-03-05'), 'Maria Planilha', 2, null, 24, 'sim'],
    [serial('2025-03-06'), 'João Planilha', null, 1, 15, 'não'],
    [serial('2025-03-06'), 'Ana Planilha', 1, 1, 27, null],
    [null, null, null, null, null, null],
    ['31/02/2025', 'Bia Planilha', 1, null, 12, 'sim'],
  ];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Vendas');
  const path = join(mkdtempSync(join(tmpdir(), 'magi-e2e-')), 'vendas-antigas.xlsx');
  writeFileSync(path, XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
  return path;
}

async function toPreview(page: import('@playwright/test').Page, file: string, alreadyImported = false) {
  await page.goto('/importar');
  await page.getByLabel('Arquivo da planilha').setInputFiles(file);
  await expect(page.getByRole('heading', { name: 'Primeiras linhas' })).toBeVisible();
  if (alreadyImported) await expect(page.getByText('Este arquivo já foi importado').filter({ visible: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Mapear colunas' }).click();
  await expect(page.getByRole('heading', { name: 'Regras de migração' })).toBeVisible();
  await page.getByLabel('Usar o preço atual do produto').check();
  await page.getByLabel('Considerar pago na data da venda').check();
  await page.getByRole('button', { name: 'Ver prévia' }).click();
  await expect(page.getByText('Valor a importar')).toBeVisible();
  await expect(page.getByText('Verificando linhas já importadas…')).toHaveCount(0, { timeout: 20_000 });
}

test('importação de planilha com prévia, validação e reprocessamento idempotente', async ({ page }) => {
  const account = await createAccount();
  await login(page, account.email);
  const file = spreadsheet();

  await toPreview(page, file);
  await expect(page.getByText('Data inválida: "31/02/2025".').filter({ visible: true }).first()).toBeVisible();
  // Negócio novo: produtos sem preço. Linha com 2 produtos e só o total não permite
  // deduzir o preço de cada um — fica com erro em vez de inventar valores.
  await expect(page.getByText(/sem preço na planilha e sem preço atual cadastrado/).filter({ visible: true }).first()).toBeVisible();
  const importButton = page.getByRole('button', { name: 'Importar 2 vendas' });
  await expect(importButton).toBeEnabled();
  await importButton.click();
  await page.getByRole('button', { name: 'Importar agora' }).click();
  await expect(page.getByRole('heading', { name: 'Importação concluída' })).toBeVisible();
  await expect(page.getByRole('main')).toContainText('2');

  // Mesmo arquivo de novo: nada é duplicado.
  await page.getByRole('button', { name: 'Importar outro arquivo' }).click();
  await toPreview(page, file, true);
  await expect(page.getByRole('button', { name: /^Importar \d+ venda/ })).toBeDisabled();

  await page.goto('/vendas?periodo=custom&de=2025-03-01&ate=2025-03-31');
  await expect(page.getByText(/^2 vendas ·/)).toBeVisible();
  await expect(page.getByText('Paga', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText('Pendente', { exact: true }).filter({ visible: true }).first()).toBeVisible();
});
