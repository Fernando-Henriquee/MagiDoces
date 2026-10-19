import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { applyExistingFingerprints, buildPreview, type BuildInput, priceFromTotal, summarize, toRpcRows } from './build';
import { matchProduct, suggestMapping } from './detect';
import { normalizeName, parseCellDate, parseCellMoney, parseCellNumber, parsePaidFlag, parsePaymentMethod } from './normalize';
import { sha256Bytes, sha256Text } from './sha256';
import { DEFAULT_RULES, type MigrationRules, type ProductRef } from './types';
import { detectHeaderRow, readWorkbookFromBuffer, sheetDataRows, sheetHeaders } from './workbook';

const products: ProductRef[] = [
  { id: 'p-bolo', name: 'Bolo de pote', price_cents: 1200, active: true },
  { id: 'p-torta', name: 'Torta de limão', price_cents: 1500, active: true },
  { id: 'p-morango', name: 'Morango cravejado', price_cents: null, active: true },
  { id: 'p-uva', name: 'Surpresa de uva', price_cents: 900, active: true },
];

const serial = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000 + 25569;

function toArrayBuffer(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function xlsxBuffer(rows: unknown[][], sheetName = 'Vendas'): ArrayBuffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return toArrayBuffer(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

function input(partial: Partial<BuildInput> & Pick<BuildInput, 'headers' | 'rows' | 'columns' | 'layout'>): BuildInput {
  return { rules: DEFAULT_RULES, products, customers: [], productAliases: {}, overrides: {}, today: '2026-10-19', ...partial };
}

// Planilha no formato "largo": uma coluna por produto com a quantidade.
const wideRows: unknown[][] = [
  ['Controle de vendas — Magi Doces'],
  [],
  ['Data', 'Cliente', 'Bolo de pote', 'Torta de Limão', 'Morango cravejado', 'Brigadeiro', 'Total', 'Pago?'],
  [serial('2025-03-05'), 'Maria', 2, null, null, null, 24, 'sim'],
  [serial('2025-03-06'), 'joão ', null, 1, null, null, 15, 'não'],
  [serial('2025-03-06'), 'Ana', 1, 1, null, null, 27, null],
  [null, null, null, null, null, null, null, null],
  ['31/02/2025', 'Bia', 1, null, null, null, 12, 'sim'],
  [serial('2025-03-07'), 'Maria', 2, null, null, null, 24, 'sim'],
  [serial('2025-03-08'), 'Carla', null, null, 2, null, 30, 'ok'],
  [serial('2025-03-08'), 'Duda', null, null, null, 3, 9, 'sim'],
  [serial('2025-03-09'), 'Eva', 'dois', null, null, null, 24, 'sim'],
  [serial('2025-03-05'), 'maria', 2, null, null, null, 24, 'sim'],
];

describe('leitura de planilhas', () => {
  it('lê XLSX, detecta a linha de cabeçalho e mantém números de linha', () => {
    const [sheet] = readWorkbookFromBuffer(XLSX, xlsxBuffer(wideRows), 'vendas.xlsx');
    expect(sheet?.name).toBe('Vendas');
    expect(sheet?.headerRowIndex).toBe(2);
    expect(sheetHeaders(sheet!)).toEqual(['Data', 'Cliente', 'Bolo de pote', 'Torta de Limão', 'Morango cravejado', 'Brigadeiro', 'Total', 'Pago?']);
    const rows = sheetDataRows(sheet!);
    expect(rows[0]?.rowNumber).toBe(4);
    expect(rows[0]?.cells[0]).toBe(serial('2025-03-05'));
  });

  it('lê CSV com ";" em Windows-1252 preservando texto', () => {
    const csv = 'Data;Cliente;Produto;Qtd;Valor unitário;Pago;Data pagamento\r\n05/03/2025;Joana;Torta de limão;2;15,00;sim;06/03/2025\r\n';
    const bytes = new Uint8Array([...csv].map((char) => char.charCodeAt(0))); // latin1 ≈ windows-1252 aqui
    const [sheet] = readWorkbookFromBuffer(XLSX, toArrayBuffer(bytes), 'vendas.csv');
    expect(sheetHeaders(sheet!)).toEqual(['Data', 'Cliente', 'Produto', 'Qtd', 'Valor unitário', 'Pago', 'Data pagamento']);
    expect(sheetDataRows(sheet!)[0]?.cells).toEqual(['05/03/2025', 'Joana', 'Torta de limão', '2', '15,00', 'sim', '06/03/2025']);
  });

  it('lê CSV UTF-8 com vírgula', () => {
    const csv = '﻿Data,Cliente,Produto\n2025-03-05,Zé,Bolo de pote\n';
    const [sheet] = readWorkbookFromBuffer(XLSX, toArrayBuffer(new TextEncoder().encode(csv)), 'v.csv');
    expect(sheetDataRows(sheet!)[0]?.cells).toEqual(['2025-03-05', 'Zé', 'Bolo de pote']);
  });

  it('cabeçalho padrão na primeira linha de texto', () => {
    expect(detectHeaderRow([[1, 2], ['Data', 'Cliente'], ['05/03', 'x']])).toBe(1);
  });
});

describe('normalização', () => {
  it('datas, números, dinheiro, pago e forma de pagamento', () => {
    expect(parseCellDate(serial('2025-03-05'))).toBe('2025-03-05');
    expect(parseCellDate('5/3/25')).toBe('2025-03-05');
    expect(parseCellDate('2025-03-05')).toBe('2025-03-05');
    expect(parseCellDate('31/02/2025')).toBeNull();
    expect(parseCellNumber('1,5')).toBe(1.5);
    expect(parseCellNumber('1.234,5')).toBe(1234.5);
    expect(parseCellNumber('dois')).toBeNull();
    expect(parseCellMoney(12.5)).toBe(1250);
    expect(parseCellMoney('R$ 1.234,56')).toBe(123456);
    expect(parsePaidFlag('Sim')).toBe('paid');
    expect(parsePaidFlag('✓')).toBe('paid');
    expect(parsePaidFlag('não')).toBe('unpaid');
    expect(parsePaidFlag('fiado')).toBe('unpaid');
    expect(parsePaidFlag('')).toBe('unknown');
    expect(parsePaidFlag('talvez')).toBe('unknown');
    expect(parsePaymentMethod('Pix')).toBe('pix');
    expect(parsePaymentMethod('Cartão de crédito')).toBe('cartao_credito');
    expect(parsePaymentMethod('espécie')).toBe('dinheiro');
    expect(normalizeName('  João   da Silva ')).toBe('joao da silva');
  });

  it('casa produtos por nome ignorando acentos, caixa e plural', () => {
    expect(matchProduct('TORTA DE LIMAO', products)?.id).toBe('p-torta');
    expect(matchProduct('Bolos de pote', products)?.id).toBe('p-bolo');
    expect(matchProduct('Morango', products)?.id).toBe('p-morango');
    expect(matchProduct('Brigadeiro', products)).toBeNull();
  });
});

describe('sugestão de mapeamento', () => {
  it('reconhece colunas candidatas e produtos pelos cabeçalhos', () => {
    const [sheet] = readWorkbookFromBuffer(XLSX, xlsxBuffer(wideRows), 'vendas.xlsx');
    const headers = sheetHeaders(sheet!);
    const suggestion = suggestMapping(headers, sheetDataRows(sheet!).map((r) => r.cells), products);
    expect(suggestion.layout).toBe('wide');
    expect(suggestion.columns.map((c) => [c.header, c.role, c.productId ?? null])).toEqual([
      ['Data', 'date', null],
      ['Cliente', 'customer', null],
      ['Bolo de pote', 'product_quantity', 'p-bolo'],
      ['Torta de Limão', 'product_quantity', 'p-torta'],
      ['Morango cravejado', 'product_quantity', 'p-morango'],
      ['Brigadeiro', 'ignore', null],
      ['Total', 'line_total', null],
      ['Pago?', 'paid', null],
    ]);
  });

  it('reconhece layout longo', () => {
    const headers = ['Data', 'Nome', 'Produto', 'Qtde', 'Preço unitário', 'Valor pago', 'Data do pagamento', 'Forma de pagamento', 'Vencimento', 'Obs'];
    const rows = [['05/03/2025', 'Ana', 'Bolo de pote', '2', '12,00', '24,00', '05/03/2025', 'pix', '10/03/2025', '']];
    const suggestion = suggestMapping(headers, rows, products);
    expect(suggestion.layout).toBe('long');
    expect(suggestion.columns.map((c) => c.role)).toEqual([
      'date', 'customer', 'product', 'quantity', 'unit_price', 'paid_amount', 'payment_date', 'payment_method', 'due_date', 'notes',
    ]);
  });
});

describe('prévia e validação (layout largo)', () => {
  const [sheet] = readWorkbookFromBuffer(XLSX, xlsxBuffer(wideRows), 'vendas.xlsx');
  const headers = sheetHeaders(sheet!);
  const rows = sheetDataRows(sheet!);
  const { columns } = suggestMapping(headers, rows.map((r) => r.cells), products);
  const rules: MigrationRules = { ...DEFAULT_RULES, missingPrice: 'current_product_price', paidWithoutDate: 'use_sale_date' };
  const preview = buildPreview(
    input({ headers, rows, columns, layout: 'wide', rules, customers: [{ id: 'c-joao', name: 'João' }] }),
  );
  const byRow = new Map(preview.map((row) => [row.rowNumber, row]));

  it('importa linha paga inferindo preço e data de pagamento por regra explícita', () => {
    const row = byRow.get(4)!;
    expect(row.status).toBe('ok');
    expect(row.inferredFields).toEqual(['data_pagamento']);
    expect(row.sale).toMatchObject({
      customerName: 'Maria',
      isNewCustomer: true,
      saleDate: '2025-03-05',
      totalCents: 2400,
      payment: { status: 'paid', paidOn: '2025-03-05', paidOnInferred: true, amountCents: 2400 },
    });
    // Preço derivado do total da planilha (um único produto): não é inferido.
    expect(row.sale?.items).toEqual([
      { productId: 'p-bolo', productName: 'Bolo de pote', quantity: 2, unitPriceCents: 1200, discountCents: 0, priceInferred: false },
    ]);
  });

  it('casa cliente existente com acento e espaço diferentes', () => {
    expect(byRow.get(5)!.sale).toMatchObject({ customerId: 'c-joao', customerName: 'João', isNewCustomer: false, payment: { status: 'unpaid' } });
  });

  it('vários produtos sem preço unitário usam o preço atual (inferido) e comparam com o total', () => {
    const row = byRow.get(6)!;
    expect(row.inferredFields).toContain('preco_unitario');
    expect(row.sale?.totalCents).toBe(2700);
    expect(row.sale?.payment.status).toBe('unknown');
    expect(row.warnings).toContain('Sem informação de pagamento: será importada como pendente de confirmação.');
  });

  it('linha vazia, data inválida e quantidade inválida', () => {
    expect(byRow.get(7)!.status).toBe('empty');
    expect(byRow.get(8)!.errors).toContain('Data inválida: "31/02/2025".');
    expect(byRow.get(12)!.errors).toContain('Quantidade inválida em "Bolo de pote": "dois".');
  });

  it('produto sem preço atual e sem preço na planilha deriva do total quando possível', () => {
    expect(byRow.get(10)!.sale?.items[0]).toMatchObject({ productId: 'p-morango', unitPriceCents: 1500, priceInferred: false });
  });

  it('coluna de produto desconhecido (não relacionada) é ignorada, e a linha fica sem itens', () => {
    expect(byRow.get(11)!.errors).toContain('Nenhum produto com quantidade nesta linha.');
  });

  it('sinaliza duplicidade interna e gera impressões distintas por ocorrência', () => {
    const first = byRow.get(4)!;
    const repeated = byRow.get(13)!; // mesma data, "maria", mesmos itens
    expect(repeated.sameAsRow).toBe(4);
    expect(repeated.warnings.some((w) => w.includes('possível duplicidade'))).toBe(true);
    expect(repeated.fingerprint).not.toBe(first.fingerprint);
    expect(byRow.get(9)!.sameAsRow).toBeNull(); // outra data: não é duplicidade
  });

  it('impressões digitais são estáveis ao reprocessar o mesmo arquivo', () => {
    const again = buildPreview(input({ headers, rows, columns, layout: 'wide', rules, customers: [{ id: 'c-joao', name: 'João' }] }));
    expect(again.map((r) => r.fingerprint)).toEqual(preview.map((r) => r.fingerprint));
  });

  it('marca como duplicada a linha já importada', () => {
    const marked = applyExistingFingerprints(preview, new Set([byRow.get(4)!.fingerprint!]));
    expect(marked.find((r) => r.rowNumber === 4)?.status).toBe('duplicate');
  });

  it('gera o payload da RPC respeitando linhas ignoradas e inválidas', () => {
    const payload = toRpcRows(preview, new Set([13]));
    const actions = Object.fromEntries(payload.map((r) => [r.row_number, r.action]));
    expect(actions).toMatchObject({ 4: 'import', 5: 'import', 6: 'import', 7: 'ignore', 8: 'invalid', 12: 'invalid', 13: 'ignore' });
    expect(payload.find((r) => r.row_number === 4)?.sale).toMatchObject({
      customer_name: 'Maria',
      sale_date: '2025-03-05',
      payment: { status: 'paid', paid_on: '2025-03-05', paid_on_inferred: true },
    });
    const summary = summarize(preview, new Set([13]));
    expect(summary.newCustomers).toEqual(['Ana', 'Carla', 'Maria']);
    expect(summary.error).toBe(3); // linhas 8, 11 e 12
  });
});

describe('regras de migração', () => {
  const headers = ['Data', 'Cliente', 'Produto', 'Qtd', 'Pago'];
  const columns = [
    { index: 0, header: 'Data', role: 'date' as const },
    { index: 1, header: 'Cliente', role: 'customer' as const },
    { index: 2, header: 'Produto', role: 'product' as const },
    { index: 3, header: 'Qtd', role: 'quantity' as const },
    { index: 4, header: 'Pago', role: 'paid' as const },
  ];
  const rows = [{ rowNumber: 2, cells: ['05/03/2025', 'Ana', 'Surpresa de Uva', '3', 'sim'] }];

  it('sem regra, preço ausente e pagamento sem data invalidam a linha (nada é inventado)', () => {
    const [row] = buildPreview(input({ headers, rows, columns, layout: 'long' }));
    expect(row?.status).toBe('error');
    expect(row?.errors[0]).toMatch(/Defina uma regra de migração para preços/);
  });

  it('preço de migração informado por produto', () => {
    const [row] = buildPreview(
      input({ headers, rows, columns, layout: 'long', rules: { ...DEFAULT_RULES, missingPrice: 'manual_price', manualPrices: { 'p-uva': 1000 }, paidWithoutDate: 'use_sale_date' } }),
    );
    expect(row?.sale?.items[0]).toMatchObject({ unitPriceCents: 1000, priceInferred: true });
    expect(row?.inferredFields).toEqual(['preco_unitario', 'data_pagamento']);
  });

  it('produto desconhecido pode ser relacionado manualmente', () => {
    const unknown = [{ rowNumber: 2, cells: ['05/03/2025', 'Ana', 'Uvinha', '1', 'não'] }];
    const rules = { ...DEFAULT_RULES, missingPrice: 'current_product_price' as const };
    expect(buildPreview(input({ headers, rows: unknown, columns, layout: 'long', rules }))[0]?.errors[0]).toMatch(/Produto desconhecido: "Uvinha"/);
    const mapped = buildPreview(input({ headers, rows: unknown, columns, layout: 'long', rules, productAliases: { uvinha: 'p-uva' } }))[0];
    expect(mapped?.status).toBe('ok');
    expect(mapped?.sale?.items[0]?.productId).toBe('p-uva');
  });

  it('correção manual de uma célula revalida a linha', () => {
    const bad = [{ rowNumber: 2, cells: ['32/03/2025', 'Ana', 'Bolo de pote', '1', 'não'] }];
    const rules = { ...DEFAULT_RULES, missingPrice: 'current_product_price' as const };
    expect(buildPreview(input({ headers, rows: bad, columns, layout: 'long', rules }))[0]?.status).toBe('error');
    const fixed = buildPreview(input({ headers, rows: bad, columns, layout: 'long', rules, overrides: { 2: { 0: '31/03/2025' } } }))[0];
    expect(fixed?.status).toBe('ok');
    expect(fixed?.sale?.saleDate).toBe('2025-03-31');
  });

  it('valor pago parcial e maior que o total', () => {
    const cols = [...columns.slice(0, 4), { index: 4, header: 'Valor pago', role: 'paid_amount' as const }, { index: 5, header: 'Data pgto', role: 'payment_date' as const }];
    const rules = { ...DEFAULT_RULES, missingPrice: 'current_product_price' as const };
    const partial = buildPreview(input({ headers: [...headers, 'Data pgto'], rows: [{ rowNumber: 2, cells: ['05/03/2025', 'Ana', 'Bolo de pote', '2', '10,00', '06/03/2025'] }], columns: cols, layout: 'long', rules }))[0];
    expect(partial?.sale?.payment).toMatchObject({ status: 'partial', amountCents: 1000, paidOn: '2025-03-06', paidOnInferred: false });
    const over = buildPreview(input({ headers: [...headers, 'Data pgto'], rows: [{ rowNumber: 2, cells: ['05/03/2025', 'Ana', 'Bolo de pote', '1', '50,00', '06/03/2025'] }], columns: cols, layout: 'long', rules }))[0];
    expect(over?.errors[0]).toMatch(/maior que o total/);
  });
});

describe('preço a partir do total', () => {
  it('preserva o total exato', () => {
    expect(priceFromTotal(2400, 2)).toEqual({ unitPriceCents: 1200, discountCents: 0 });
    expect(priceFromTotal(38, 1.5)).toEqual({ unitPriceCents: 25, discountCents: 0 });
    expect(priceFromTotal(1000, 3)).toEqual({ unitPriceCents: 334, discountCents: 2 });
  });
});

describe('sha256', () => {
  it('confere com vetores conhecidos', () => {
    expect(sha256Text('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Text('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Bytes(new Uint8Array(1000).fill(97))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  });
});
