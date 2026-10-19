import { describe, expect, it } from 'vitest';
import { computePurchaseTotals, effectiveDueDate, ingredientCostUpdateProblem, previewInstallments, suggestedFirstDue } from './bill-calc';

describe('computePurchaseTotals', () => {
  it('soma linhas arredondadas, frete e desconto como o banco', () => {
    const totals = computePurchaseTotals(
      [
        { quantity: 12, unitPriceCents: 650 },
        { quantity: 5, unitPriceCents: 480 },
        { quantity: 1.5, unitPriceCents: 25 },
      ],
      1500,
      500,
    );
    expect(totals.lines).toEqual([7800, 2400, 38]);
    expect(totals.itemsTotalCents).toBe(10238);
    expect(totals.totalCents).toBe(10238 + 1500 - 500);
  });

  it('linhas incompletas valem zero na prévia', () => {
    expect(computePurchaseTotals([{ quantity: null, unitPriceCents: 100 }, { quantity: 2, unitPriceCents: null }], null, null)).toEqual({
      lines: [0, 0],
      itemsTotalCents: 0,
      totalCents: 0,
    });
  });
});

describe('previewInstallments', () => {
  it('divide sem perder centavos e gera vencimentos mensais', () => {
    expect(previewInstallments(100000, 3, '2026-01-31')).toEqual([
      { number: 1, amountCents: 33334, dueDate: '2026-01-31' },
      { number: 2, amountCents: 33333, dueDate: '2026-02-28' },
      { number: 3, amountCents: 33333, dueDate: '2026-03-31' },
    ]);
  });

  it('recusa parcelamentos impossíveis', () => {
    expect(previewInstallments(2, 3, '2026-01-01')).toBeNull();
    expect(previewInstallments(1000, 0, '2026-01-01')).toBeNull();
    expect(previewInstallments(1000, 121, '2026-01-01')).toBeNull();
  });

  it('vencimento mais próximo considera o saldo sem parcela', () => {
    expect(effectiveDueDate({ next_due_date: '2026-12-18', due_date: '2026-11-18', unscheduled_cents: 4600 })).toBe('2026-11-18');
    expect(effectiveDueDate({ next_due_date: '2026-12-18', due_date: '2026-11-18', unscheduled_cents: 0 })).toBe('2026-12-18');
    expect(effectiveDueDate({ next_due_date: null, due_date: '2026-11-18', unscheduled_cents: 100 })).toBe('2026-11-18');
    expect(effectiveDueDate({ next_due_date: null, due_date: null, unscheduled_cents: 100 })).toBeNull();
  });

  it('sugere o 1º vencimento', () => {
    expect(suggestedFirstDue('2026-10-19', null)).toBe('2026-11-18');
    expect(suggestedFirstDue('2026-10-19', '2026-11-10')).toBe('2026-11-10');
  });
});

describe('ingredientCostUpdateProblem', () => {
  it('aceita unidades compatíveis e recusa as demais', () => {
    expect(ingredientCostUpdateProblem('g', 'kg')).toBeNull();
    expect(ingredientCostUpdateProblem(' KG ', 'g')).toBeNull();
    expect(ingredientCostUpdateProblem('l', 'kg')).toMatch(/não é compatível/);
    expect(ingredientCostUpdateProblem('pacote', 'kg')).toMatch(/Use uma unidade de medida/);
    expect(ingredientCostUpdateProblem('pacote', null)).toBeNull();
  });
});
