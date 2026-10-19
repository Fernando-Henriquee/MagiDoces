import { addDays, type ISODate } from '@/lib/dates';
import { installmentDates, splitInstallments } from '@/lib/installments';
import { lineSubtotalCents } from '@/lib/money';
import { areCompatible, isMeasureUnit } from '@/lib/units';

/**
 * Prévia dos totais de compras/despesas no formulário. O banco recalcula na
 * gravação (create_purchase/update_purchase) com as mesmas regras:
 *   linha = round(quantidade × valor unitário); total = Σ linhas + frete − desconto.
 */

export interface PurchaseLineInput {
  quantity: number | null;
  unitPriceCents: number | null;
}

export interface PurchaseTotals {
  lines: number[];
  itemsTotalCents: number;
  totalCents: number;
}

export function computePurchaseTotals(items: PurchaseLineInput[], extraCents: number | null, discountCents: number | null): PurchaseTotals {
  const lines = items.map((item) =>
    item.quantity !== null && item.quantity > 0 && item.unitPriceCents !== null && item.unitPriceCents >= 0
      ? lineSubtotalCents(item.quantity, item.unitPriceCents)
      : 0,
  );
  const itemsTotalCents = lines.reduce((sum, line) => sum + line, 0);
  return { lines, itemsTotalCents, totalCents: itemsTotalCents + (extraCents ?? 0) - (discountCents ?? 0) };
}

export interface InstallmentPreview {
  number: number;
  amountCents: number;
  dueDate: ISODate;
}

/** Mesma divisão do banco: parcelas inteiras, diferença de centavos na 1ª. */
export function previewInstallments(totalCents: number, count: number, firstDueDate: ISODate): InstallmentPreview[] | null {
  if (!Number.isInteger(count) || count < 1 || count > 120 || totalCents < count) return null;
  const amounts = splitInstallments(totalCents, count);
  const dates = installmentDates(firstDueDate, count);
  return amounts.map((amountCents, index) => ({ number: index + 1, amountCents, dueDate: dates[index]! }));
}

/**
 * Vencimento mais próximo de uma conta: a próxima parcela prevista ou, se houver
 * saldo sem parcela definida, o vencimento do documento — o que vier primeiro.
 */
export function effectiveDueDate(bill: { next_due_date: ISODate | null; due_date: ISODate | null; unscheduled_cents: number }): ISODate | null {
  const candidates = [bill.next_due_date, bill.unscheduled_cents > 0 ? bill.due_date : null].filter((d): d is ISODate => Boolean(d));
  return candidates.sort()[0] ?? null;
}

/** 1º vencimento sugerido: o vencimento informado ou 30 dias após a data. */
export function suggestedFirstDue(baseDate: ISODate, dueDate: ISODate | null | undefined): ISODate {
  return dueDate || addDays(baseDate, 30);
}

/**
 * A atualização do custo do ingrediente só é possível com unidade de medida
 * conhecida e da mesma dimensão (o banco recusa a gravação caso contrário).
 */
export function ingredientCostUpdateProblem(itemUnit: string, ingredientUnit: string | null): string | null {
  if (!ingredientUnit) return null;
  const unit = itemUnit.trim().toLowerCase();
  if (!isMeasureUnit(unit)) return `Use uma unidade de medida (g, kg, ml, l, un, dz) compatível com “${ingredientUnit}” para atualizar o custo.`;
  if (!isMeasureUnit(ingredientUnit) || !areCompatible(unit, ingredientUnit)) {
    return `A unidade “${unit}” não é compatível com “${ingredientUnit}” do ingrediente; o custo não pode ser atualizado.`;
  }
  return null;
}
