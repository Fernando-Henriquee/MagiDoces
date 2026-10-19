import { excelSerialToISO, formatDateBR } from '@/lib/dates';
import { cellText, normalizeName } from '@/lib/import/normalize';
import { type CellValue, COLUMN_ROLE_LABELS, type ColumnMapping, type ColumnRole, type MigrationRules, type PreviewRow, type RowStatus } from '@/lib/import/types';
import { decimalNumberToCents, formatDecimalBR, formatQuantity } from '@/lib/money';

/** Rótulos dos campos que podem ser derivados por regra de migração. */
export const INFERRED_LABELS: Record<string, string> = {
  preco_unitario: 'Preço unitário',
  data_pagamento: 'Data do pagamento',
  quantidade: 'Quantidade',
};

export const STATUS_LABELS: Record<RowStatus | 'ignored', string> = {
  ok: 'Pronta',
  warning: 'Com aviso',
  error: 'Com erro',
  empty: 'Vazia',
  duplicate: 'Já importada',
  ignored: 'Ignorada',
};

export const STATUS_TONES: Record<RowStatus | 'ignored', 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  ok: 'success',
  warning: 'warning',
  error: 'danger',
  empty: 'neutral',
  duplicate: 'info',
  ignored: 'neutral',
};

const DATE_ROLES: ColumnRole[] = ['date', 'due_date', 'payment_date'];
const MONEY_ROLES: ColumnRole[] = ['unit_price', 'line_total', 'paid_amount'];

/** Texto editável de uma célula, conforme o papel da coluna (datas do Excel → DD/MM/AAAA). */
export function editableCellText(value: CellValue, role: ColumnRole): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    if (DATE_ROLES.includes(role)) {
      const iso = excelSerialToISO(value);
      return iso ? formatDateBR(iso) : String(value);
    }
    if (MONEY_ROLES.includes(role)) {
      const cents = decimalNumberToCents(value);
      return cents === null ? String(value) : formatDecimalBR(cents);
    }
    if (role === 'quantity' || role === 'product_quantity') return formatQuantity(value).replace(/\./g, '');
  }
  return cellText(value);
}

/** Primeiros valores não vazios de uma coluna (para mostrar no mapeamento). */
export function sampleValues(rows: Array<{ cells: CellValue[] }>, index: number, role: ColumnRole, limit = 3): string[] {
  const values: string[] = [];
  for (const row of rows) {
    const text = editableCellText(row.cells[index] ?? null, role);
    if (text) values.push(text);
    if (values.length >= limit) break;
  }
  return values;
}

/** Problemas no mapeamento que impedem gerar a prévia. */
export function mappingProblems(columns: ColumnMapping[], layout: 'long' | 'wide'): string[] {
  const problems: string[] = [];
  if (!columns.some((c) => c.role === 'date')) problems.push('Escolha a coluna com a data da venda.');
  if (layout === 'wide') {
    const productColumns = columns.filter((c) => c.role === 'product_quantity');
    if (productColumns.length === 0) problems.push('No formato “uma coluna por produto”, marque ao menos uma coluna como “Quantidade de um produto”.');
    if (productColumns.some((c) => !c.productId)) problems.push('Relacione cada coluna de produto a um produto do cadastro.');
  } else if (!columns.some((c) => c.role === 'product')) {
    problems.push('No formato “uma linha por item”, escolha a coluna com o nome do produto.');
  }
  const single: ColumnRole[] = ['date', 'customer', 'product', 'quantity', 'unit_price', 'line_total', 'paid', 'paid_amount', 'payment_date', 'payment_method', 'due_date', 'notes'];
  for (const role of single) {
    if (columns.filter((c) => c.role === role).length > 1) {
      problems.push(`Mais de uma coluna marcada como “${COLUMN_ROLE_LABELS[role]}”. Deixe apenas uma.`);
    }
  }
  return problems;
}

/** Produtos envolvidos no mapeamento (para preços de migração informados por produto). */
export function productsInMapping(columns: ColumnMapping[], aliasTargets: Array<string | null>): string[] {
  const ids = new Set<string>();
  for (const column of columns) if (column.role === 'product_quantity' && column.productId) ids.add(column.productId);
  for (const id of aliasTargets) if (id) ids.add(id);
  return [...ids];
}

export function rowDisplayStatus(row: PreviewRow, ignored: Set<number>): RowStatus | 'ignored' {
  if (ignored.has(row.rowNumber) && (row.status === 'ok' || row.status === 'warning' || row.status === 'duplicate')) return 'ignored';
  return row.status;
}

export function canIgnore(row: PreviewRow): boolean {
  return row.status === 'ok' || row.status === 'warning' || row.status === 'duplicate';
}

/** Quantas linhas viram vendas novas (prontas ou com aviso, não ignoradas). */
export function importableCount(rows: PreviewRow[], ignored: Set<number>): number {
  return rows.filter((row) => (row.status === 'ok' || row.status === 'warning') && !ignored.has(row.rowNumber)).length;
}

export function rowSearchText(row: PreviewRow): string {
  return normalizeName(`${row.rowNumber} ${Object.values(row.raw).join(' ')} ${row.errors.join(' ')} ${row.warnings.join(' ')}`);
}

export function describeRulesShort(rules: MigrationRules): string[] {
  const lines: string[] = [];
  lines.push(
    rules.missingPrice === 'current_product_price'
      ? 'Preço ausente: preço atual do produto (marcado como inferido)'
      : rules.missingPrice === 'manual_price'
        ? 'Preço ausente: preço informado por produto (marcado como inferido)'
        : 'Preço ausente: linha inválida',
  );
  lines.push(rules.paidWithoutDate === 'use_sale_date' ? 'Pago sem data: data da venda (marcado como inferido)' : 'Pago sem data: linha inválida');
  lines.push(rules.missingQuantity === 'one' ? 'Quantidade ausente: 1 (marcado como inferido)' : 'Quantidade ausente: linha inválida');
  return lines;
}
