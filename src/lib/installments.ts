import { addMonths, type ISODate } from './dates';

/**
 * Divide um total em N parcelas inteiras; a diferença de centavos fica na 1ª.
 * Mesma regra de private.split_installments no banco (prévia no formulário).
 */
export function splitInstallments(totalCents: number, count: number): number[] {
  if (!Number.isInteger(count) || count < 1) throw new Error('Número de parcelas inválido');
  if (!Number.isInteger(totalCents) || totalCents < count) throw new Error('Total insuficiente para o parcelamento');
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  return Array.from({ length: count }, (_, index) => (index === 0 ? base + remainder : base));
}

/** Vencimentos mensais a partir do primeiro, ajustando fim de mês. */
export function installmentDates(firstDueDate: ISODate, count: number): ISODate[] {
  return Array.from({ length: count }, (_, index) => addMonths(firstDueDate, index));
}
