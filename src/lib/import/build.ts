import { formatDateBR, type ISODate } from '../dates';
import { formatBRL, lineSubtotalCents } from '../money';
import { matchProduct } from './detect';
import {
  cellText,
  isEmptyCell,
  normalizeName,
  parseCellDate,
  parseCellMoney,
  parseCellNumber,
  parsePaidFlag,
  parsePaymentMethod,
} from './normalize';
import { sha256Text } from './sha256';
import type {
  CellValue,
  ColumnMapping,
  ColumnRole,
  CustomerRef,
  Layout,
  MigrationRules,
  PreviewItem,
  PreviewRow,
  PreviewSale,
  ProductRef,
} from './types';

/**
 * Constrói a prévia da importação: aplica o mapeamento e as regras de migração,
 * valida cada linha e calcula impressões digitais estáveis.
 *
 * Princípios: nada ausente é inventado. Valores derivados por regra explícita são
 * marcados em `inferredFields`; sem regra, a linha fica inválida. Sem informação de
 * pagamento, a venda fica "pendente de confirmação" (nunca presumida paga).
 */

export interface BuildInput {
  headers: string[];
  rows: Array<{ rowNumber: number; cells: CellValue[] }>;
  columns: ColumnMapping[];
  layout: Layout;
  rules: MigrationRules;
  products: ProductRef[];
  customers: CustomerRef[];
  /** Layout longo: texto normalizado do produto → id do produto (ou null = desconhecido). */
  productAliases: Record<string, string | null>;
  /** Correções feitas pelo usuário: linha → índice da coluna → novo valor. */
  overrides: Record<number, Record<number, string>>;
  today: ISODate;
}

export const FINGERPRINT_VERSION = 'v1';

function column(columns: ColumnMapping[], role: ColumnRole): ColumnMapping | undefined {
  return columns.find((c) => c.role === role);
}

function quantityError(value: number): string | null {
  if (!(value > 0)) return 'deve ser maior que zero';
  if (Math.round(value * 1000) / 1000 !== value) return 'tem mais de 3 casas decimais';
  if (value > 100000) return 'é grande demais';
  return null;
}

/** Deriva o preço unitário de um total preservando o total exato (diferença vira desconto). */
export function priceFromTotal(totalCents: number, quantity: number): { unitPriceCents: number; discountCents: number } {
  const exact = Math.ceil(totalCents / quantity - 1e-9);
  for (let price = Math.max(0, exact - 1); price <= exact + 1; price += 1) {
    const subtotal = lineSubtotalCents(quantity, price);
    if (subtotal === totalCents) return { unitPriceCents: price, discountCents: 0 };
  }
  const subtotal = lineSubtotalCents(quantity, exact);
  return { unitPriceCents: exact, discountCents: Math.max(0, subtotal - totalCents) };
}

export function productTextKey(text: string): string {
  return normalizeName(text);
}

/** Nomes distintos de produto (layout longo) para o mapeamento manual. */
export function distinctProductTexts(input: Pick<BuildInput, 'rows' | 'columns' | 'overrides'>): string[] {
  const productColumn = column(input.columns, 'product');
  if (!productColumn) return [];
  const names = new Map<string, string>();
  for (const row of input.rows) {
    const value = input.overrides[row.rowNumber]?.[productColumn.index] ?? row.cells[productColumn.index] ?? null;
    const text = cellText(value);
    if (text && !names.has(productTextKey(text))) names.set(productTextKey(text), text);
  }
  return [...names.values()];
}

export function buildPreview(input: BuildInput): PreviewRow[] {
  const productsById = new Map(input.products.map((p) => [p.id, p]));
  const customersByName = new Map<string, CustomerRef>();
  for (const customer of input.customers) {
    const key = normalizeName(customer.name);
    if (!customersByName.has(key)) customersByName.set(key, customer);
  }
  const newCustomerNames = new Map<string, string>();

  const get = (cells: CellValue[], rowNumber: number, role: ColumnRole): { value: CellValue; header: string } | null => {
    const col = column(input.columns, role);
    if (!col) return null;
    const override = input.overrides[rowNumber]?.[col.index];
    return { value: override !== undefined ? override : (cells[col.index] ?? null), header: col.header };
  };

  const preview = input.rows.map((row): PreviewRow => {
    const cells = row.cells.map((cell, index) => {
      const override = input.overrides[row.rowNumber]?.[index];
      return override !== undefined ? override : cell;
    });
    const raw: Record<string, string> = {};
    input.headers.forEach((header, index) => {
      raw[header] = cellText(cells[index] ?? null);
    });
    const base: PreviewRow = {
      rowNumber: row.rowNumber,
      raw,
      status: 'ok',
      errors: [],
      warnings: [],
      inferredFields: [],
      sale: null,
      contentKey: null,
      fingerprint: null,
      sameAsRow: null,
      alreadyImported: false,
    };

    const relevant = input.columns.filter((c) => c.role !== 'ignore');
    if (relevant.every((c) => isEmptyCell(cells[c.index] ?? null))) {
      return { ...base, status: 'empty' };
    }

    const errors: string[] = [];
    const warnings: string[] = [];
    const inferred: string[] = [];

    // Data da venda
    const dateCell = get(cells, row.rowNumber, 'date');
    let saleDate: ISODate | null = null;
    if (!dateCell) {
      errors.push('Mapeie a coluna de data da venda.');
    } else {
      saleDate = parseCellDate(dateCell.value);
      if (!saleDate) {
        errors.push(isEmptyCell(dateCell.value) ? 'Data da venda vazia.' : `Data inválida: "${cellText(dateCell.value)}".`);
      } else if (saleDate > input.today) {
        warnings.push(`Data da venda no futuro (${formatDateBR(saleDate)}).`);
      }
    }

    // Cliente
    const customerCell = get(cells, row.rowNumber, 'customer');
    const customerText = customerCell ? cellText(customerCell.value) : '';
    let customerId: string | null = null;
    let customerName: string | null = null;
    let isNewCustomer = false;
    if (customerText) {
      const key = normalizeName(customerText);
      const existing = customersByName.get(key);
      if (existing) {
        customerId = existing.id;
        customerName = existing.name;
      } else {
        if (!newCustomerNames.has(key)) newCustomerNames.set(key, customerText.replace(/\s+/g, ' ').slice(0, 120));
        customerName = newCustomerNames.get(key) ?? customerText;
        isNewCustomer = true;
      }
    } else if (customerCell) {
      warnings.push('Sem cliente: a venda ficará sem cliente identificado.');
    }

    // Itens
    const items: PreviewItem[] = [];
    const unitPriceCell = get(cells, row.rowNumber, 'unit_price');
    const totalCell = get(cells, row.rowNumber, 'line_total');
    const sheetTotal = totalCell && !isEmptyCell(totalCell.value) ? parseCellMoney(totalCell.value) : null;
    if (totalCell && !isEmptyCell(totalCell.value) && sheetTotal === null) {
      errors.push(`Valor total inválido: "${cellText(totalCell.value)}".`);
    }

    const resolvePrice = (product: ProductRef, quantity: number, explicitPrice: number | null, derivableTotal: number | null) => {
      if (explicitPrice !== null) return { unitPriceCents: explicitPrice, discountCents: 0, inferred: false };
      if (derivableTotal !== null) {
        const derived = priceFromTotal(derivableTotal, quantity);
        if (derived.discountCents > 0) {
          warnings.push(
            `${product.name}: total ${formatBRL(derivableTotal)} não divide exatamente por ${quantity}; diferença de ${formatBRL(derived.discountCents)} registrada como desconto.`,
          );
        }
        return { ...derived, inferred: false };
      }
      if (input.rules.missingPrice === 'current_product_price') {
        if (product.price_cents === null) {
          errors.push(`${product.name}: sem preço na planilha e sem preço atual cadastrado.`);
          return null;
        }
        return { unitPriceCents: product.price_cents, discountCents: 0, inferred: true };
      }
      if (input.rules.missingPrice === 'manual_price') {
        const manual = input.rules.manualPrices[product.id];
        if (manual === undefined) {
          errors.push(`${product.name}: informe o preço de migração para este produto.`);
          return null;
        }
        return { unitPriceCents: manual, discountCents: 0, inferred: true };
      }
      errors.push(`${product.name}: sem preço na planilha. Defina uma regra de migração para preços.`);
      return null;
    };

    if (input.layout === 'wide') {
      const productColumns = input.columns.filter((c) => c.role === 'product_quantity');
      if (productColumns.length === 0) errors.push('Mapeie ao menos uma coluna de produto.');
      const filled: Array<{ product: ProductRef; quantity: number }> = [];
      for (const col of productColumns) {
        const value = input.overrides[row.rowNumber]?.[col.index] ?? cells[col.index] ?? null;
        if (isEmptyCell(value)) continue;
        const product = col.productId ? productsById.get(col.productId) : undefined;
        if (!product) {
          errors.push(`Coluna "${col.header}" sem produto relacionado ao cadastro.`);
          continue;
        }
        const quantity = parseCellNumber(value);
        if (quantity === null) {
          errors.push(`Quantidade inválida em "${col.header}": "${cellText(value)}".`);
          continue;
        }
        if (quantity === 0) continue;
        const problem = quantityError(quantity);
        if (problem) {
          errors.push(`Quantidade em "${col.header}" ${problem}.`);
          continue;
        }
        filled.push({ product, quantity });
      }
      const unitPrice = unitPriceCell && !isEmptyCell(unitPriceCell.value) ? parseCellMoney(unitPriceCell.value) : null;
      for (const { product, quantity } of filled) {
        const derivable = filled.length === 1 && unitPrice === null ? sheetTotal : null;
        const price = resolvePrice(product, quantity, filled.length === 1 ? unitPrice : null, derivable);
        if (!price) continue;
        if (price.inferred && !inferred.includes('preco_unitario')) inferred.push('preco_unitario');
        items.push({ productId: product.id, productName: product.name, quantity, unitPriceCents: price.unitPriceCents, discountCents: price.discountCents, priceInferred: price.inferred });
      }
      if (filled.length === 0 && productColumns.length > 0 && errors.length === 0) {
        errors.push('Nenhum produto com quantidade nesta linha.');
      }
    } else {
      const productCell = get(cells, row.rowNumber, 'product');
      if (!productCell) {
        errors.push('Mapeie a coluna de produto.');
      } else {
        const text = cellText(productCell.value);
        const alias = input.productAliases[productTextKey(text)];
        const product = alias !== undefined ? (alias ? productsById.get(alias) : undefined) : (matchProduct(text, input.products) ?? undefined);
        if (!text) {
          errors.push('Produto vazio.');
        } else if (!product) {
          errors.push(`Produto desconhecido: "${text}". Relacione-o a um produto do cadastro.`);
        } else {
          const quantityCell = get(cells, row.rowNumber, 'quantity');
          let quantity: number | null = null;
          if (quantityCell && !isEmptyCell(quantityCell.value)) {
            quantity = parseCellNumber(quantityCell.value);
            const problem = quantity === null ? 'é inválida' : quantityError(quantity);
            if (problem) {
              errors.push(`Quantidade ${problem}: "${cellText(quantityCell.value)}".`);
              quantity = null;
            }
          } else if (input.rules.missingQuantity === 'one') {
            quantity = 1;
            inferred.push('quantidade');
          } else {
            errors.push('Quantidade ausente. Mapeie a coluna ou defina a regra de migração.');
          }
          if (quantity !== null) {
            let explicit: number | null = null;
            if (unitPriceCell && !isEmptyCell(unitPriceCell.value)) {
              explicit = parseCellMoney(unitPriceCell.value);
              if (explicit === null || explicit < 0) {
                errors.push(`Preço unitário inválido: "${cellText(unitPriceCell.value)}".`);
                explicit = null;
              }
            }
            if (errors.length === 0) {
              const price = resolvePrice(product, quantity, explicit, explicit === null ? sheetTotal : null);
              if (price) {
                if (price.inferred) inferred.push('preco_unitario');
                items.push({ productId: product.id, productName: product.name, quantity, unitPriceCents: price.unitPriceCents, discountCents: price.discountCents, priceInferred: price.inferred });
              }
            }
          }
        }
      }
    }

    const totalCents = items.reduce((sum, item) => sum + lineSubtotalCents(item.quantity, item.unitPriceCents) - item.discountCents, 0);
    if (sheetTotal !== null && items.length > 0 && sheetTotal !== totalCents && errors.length === 0) {
      warnings.push(`Total calculado (${formatBRL(totalCents)}) difere do total da planilha (${formatBRL(sheetTotal)}).`);
    }

    // Vencimento
    const dueCell = get(cells, row.rowNumber, 'due_date');
    let dueDate: ISODate | null = null;
    if (dueCell && !isEmptyCell(dueCell.value)) {
      dueDate = parseCellDate(dueCell.value);
      if (!dueDate) errors.push(`Vencimento inválido: "${cellText(dueCell.value)}".`);
      else if (saleDate && dueDate < saleDate) errors.push('Vencimento anterior à data da venda.');
    }

    // Pagamento
    const paidCell = get(cells, row.rowNumber, 'paid');
    const amountCell = get(cells, row.rowNumber, 'paid_amount');
    const paymentDateCell = get(cells, row.rowNumber, 'payment_date');
    const methodCell = get(cells, row.rowNumber, 'payment_method');
    const method = methodCell ? parsePaymentMethod(methodCell.value) : null;

    let paymentDate: ISODate | null = null;
    if (paymentDateCell && !isEmptyCell(paymentDateCell.value)) {
      paymentDate = parseCellDate(paymentDateCell.value);
      if (!paymentDate) errors.push(`Data de pagamento inválida: "${cellText(paymentDateCell.value)}".`);
      else if (paymentDate > input.today) errors.push('Data de pagamento no futuro.');
    }

    let paymentStatus: PreviewSale['payment']['status'] = 'unknown';
    let amountCents: number | null = null;
    if (amountCell && !isEmptyCell(amountCell.value)) {
      amountCents = parseCellMoney(amountCell.value);
      if (amountCents === null || amountCents < 0) {
        errors.push(`Valor pago inválido: "${cellText(amountCell.value)}".`);
        amountCents = null;
      } else if (amountCents === 0) {
        paymentStatus = 'unpaid';
      } else if (amountCents > totalCents && items.length > 0) {
        errors.push(`Valor pago (${formatBRL(amountCents)}) maior que o total (${formatBRL(totalCents)}).`);
      } else {
        paymentStatus = amountCents >= totalCents ? 'paid' : 'partial';
      }
    } else if (paidCell) {
      const flag = parsePaidFlag(paidCell.value);
      if (flag === 'paid') paymentStatus = 'paid';
      else if (flag === 'unpaid') paymentStatus = 'unpaid';
      else if (paymentDate) paymentStatus = 'paid';
      else if (!isEmptyCell(paidCell.value)) warnings.push(`Situação de pagamento não reconhecida: "${cellText(paidCell.value)}". Ficará pendente de confirmação.`);
    } else if (paymentDate) {
      paymentStatus = 'paid';
    }

    let paidOn: ISODate | null = paymentDate;
    let paidOnInferred = false;
    if ((paymentStatus === 'paid' || paymentStatus === 'partial') && !paidOn) {
      if (input.rules.paidWithoutDate === 'use_sale_date' && saleDate) {
        paidOn = saleDate;
        paidOnInferred = true;
        inferred.push('data_pagamento');
      } else {
        errors.push('Marcada como paga, mas sem data de pagamento. Defina a regra de migração.');
      }
    }
    if (paymentStatus === 'unknown') {
      warnings.push('Sem informação de pagamento: será importada como pendente de confirmação.');
    }

    const notesCell = get(cells, row.rowNumber, 'notes');
    const notes = notesCell ? cellText(notesCell.value).slice(0, 2000) || null : null;

    if (items.length === 0 && errors.length === 0) errors.push('Nenhum item válido.');

    const sale: PreviewSale | null =
      saleDate && items.length > 0
        ? {
            customerId,
            customerName,
            isNewCustomer,
            saleDate,
            dueDate,
            notes,
            paymentMethod: method,
            items,
            totalCents,
            payment: {
              status: paymentStatus,
              amountCents: paymentStatus === 'partial' ? amountCents : paymentStatus === 'paid' ? totalCents : null,
              paidOn: paymentStatus === 'paid' || paymentStatus === 'partial' ? paidOn : null,
              paidOnInferred,
              method,
            },
          }
        : null;

    const contentKey =
      sale && errors.length === 0
        ? JSON.stringify([
            sale.saleDate,
            normalizeName(sale.customerName),
            [...sale.items]
              .map((item) => [item.productId, item.quantity, item.unitPriceCents, item.discountCents])
              .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
          ])
        : null;

    return {
      ...base,
      status: errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'ok',
      errors,
      warnings,
      inferredFields: inferred,
      sale: errors.length > 0 ? null : sale,
      contentKey,
    };
  });

  // Impressões digitais: conteúdo + ocorrência no arquivo (linhas idênticas legítimas
  // continuam distintas, e reprocessar o mesmo arquivo gera as mesmas impressões).
  const occurrences = new Map<string, number[]>();
  for (const row of preview) {
    if (!row.contentKey) continue;
    const previous = occurrences.get(row.contentKey) ?? [];
    row.fingerprint = `${FINGERPRINT_VERSION}:${sha256Text(`${row.contentKey}#${previous.length}`)}`;
    if (previous.length > 0) {
      row.sameAsRow = previous[0] ?? null;
      row.warnings.push(`Mesmo conteúdo da linha ${previous[0]}: possível duplicidade. Ignore se for repetição.`);
      if (row.status === 'ok') row.status = 'warning';
    }
    previous.push(row.rowNumber);
    occurrences.set(row.contentKey, previous);
  }
  return preview;
}

/** Marca linhas cuja impressão digital já existe no banco. */
export function applyExistingFingerprints(rows: PreviewRow[], existing: Set<string>): PreviewRow[] {
  return rows.map((row) =>
    row.fingerprint && existing.has(row.fingerprint) ? { ...row, alreadyImported: true, status: 'duplicate' } : row,
  );
}

export interface ImportSummary {
  total: number;
  ok: number;
  warning: number;
  error: number;
  empty: number;
  duplicate: number;
  newCustomers: string[];
  inferred: number;
  totalCents: number;
}

export function summarize(rows: PreviewRow[], ignored: Set<number>): ImportSummary {
  const newCustomers = new Set<string>();
  const summary: ImportSummary = { total: rows.length, ok: 0, warning: 0, error: 0, empty: 0, duplicate: 0, newCustomers: [], inferred: 0, totalCents: 0 };
  for (const row of rows) {
    summary[row.status] += 1;
    const importable = (row.status === 'ok' || row.status === 'warning') && !ignored.has(row.rowNumber);
    if (importable && row.sale) {
      summary.totalCents += row.sale.totalCents;
      if (row.inferredFields.length > 0) summary.inferred += 1;
      if (row.sale.isNewCustomer && row.sale.customerName) newCustomers.add(row.sale.customerName);
    }
  }
  summary.newCustomers = [...newCustomers].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  return summary;
}

export interface RpcImportRow {
  row_number: number;
  raw: Record<string, string>;
  fingerprint: string | null;
  action: 'import' | 'ignore' | 'invalid';
  messages: string[];
  inferred_fields: string[];
  sale?: Record<string, unknown>;
}

/** Converte a prévia no payload da RPC import_sales_batch. */
export function toRpcRows(rows: PreviewRow[], ignored: Set<number>): RpcImportRow[] {
  return rows.map((row) => {
    const common = { row_number: row.rowNumber, raw: row.raw, fingerprint: row.fingerprint, inferred_fields: row.inferredFields };
    if (row.status === 'empty') return { ...common, action: 'ignore', messages: ['Linha vazia'] };
    if (row.status === 'error' || !row.sale) return { ...common, action: 'invalid', messages: row.errors };
    if (ignored.has(row.rowNumber)) return { ...common, action: 'ignore', messages: ['Ignorada na revisão'] };
    const sale = row.sale;
    return {
      ...common,
      action: 'import',
      messages: row.warnings,
      sale: {
        customer_id: sale.customerId,
        customer_name: sale.customerName,
        sale_date: sale.saleDate,
        due_date: sale.dueDate,
        payment_method: sale.paymentMethod,
        notes: sale.notes,
        items: sale.items.map((item) => ({
          product_id: item.productId,
          quantity: item.quantity,
          unit_price_cents: item.unitPriceCents,
          discount_cents: item.discountCents,
          price_inferred: item.priceInferred,
        })),
        payment: {
          status: sale.payment.status,
          amount_cents: sale.payment.amountCents,
          paid_on: sale.payment.paidOn,
          paid_on_inferred: sale.payment.paidOnInferred,
          method: sale.payment.method,
        },
      },
    };
  });
}
