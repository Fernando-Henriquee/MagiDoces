import { formatBRL, lineSubtotalCents } from './money';

/**
 * Prévia dos totais da venda no formulário. O banco recalcula tudo na gravação
 * (create_sale/update_sale); estas regras são as mesmas, para que a prévia nunca
 * divirja do valor gravado.
 */

export interface SaleItemInput {
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
}

export interface LineTotals {
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
}

export interface SaleTotals {
  lines: LineTotals[];
  itemsSubtotalCents: number;
  itemsDiscountCents: number;
  saleDiscountCents: number;
  totalCents: number;
  errors: string[];
}

export function computeLine(item: SaleItemInput): LineTotals {
  const subtotalCents = lineSubtotalCents(item.quantity, item.unitPriceCents);
  return { subtotalCents, discountCents: item.discountCents, totalCents: subtotalCents - item.discountCents };
}

export function computeSaleTotals(items: SaleItemInput[], saleDiscountCents: number): SaleTotals {
  const errors: string[] = [];
  const lines = items.map((item, index) => {
    if (!(item.quantity > 0)) errors.push(`Item ${index + 1}: quantidade deve ser maior que zero.`);
    if (item.unitPriceCents < 0) errors.push(`Item ${index + 1}: preço não pode ser negativo.`);
    const line = computeLine(item);
    if (item.discountCents < 0 || item.discountCents > line.subtotalCents) {
      errors.push(`Item ${index + 1}: desconto não pode ser maior que ${formatBRL(line.subtotalCents)}.`);
    }
    return line;
  });
  const itemsSubtotalCents = lines.reduce((sum, line) => sum + line.subtotalCents, 0);
  const itemsDiscountCents = lines.reduce((sum, line) => sum + line.discountCents, 0);
  const itemsNet = itemsSubtotalCents - itemsDiscountCents;
  if (saleDiscountCents < 0 || saleDiscountCents > itemsNet) {
    errors.push(`O desconto da venda não pode ser maior que ${formatBRL(itemsNet)}.`);
  }
  if (items.length === 0) errors.push('Adicione pelo menos um item.');
  return {
    lines,
    itemsSubtotalCents,
    itemsDiscountCents,
    saleDiscountCents,
    totalCents: itemsNet - saleDiscountCents,
    errors,
  };
}
