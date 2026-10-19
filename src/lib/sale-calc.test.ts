import { describe, expect, it } from 'vitest';
import { computeSaleTotals } from './sale-calc';

describe('computeSaleTotals', () => {
  it('soma itens, descontos de item e desconto da venda', () => {
    const totals = computeSaleTotals(
      [
        { quantity: 3, unitPriceCents: 1200, discountCents: 100 },
        { quantity: 2, unitPriceCents: 1500, discountCents: 0 },
      ],
      200,
    );
    expect(totals).toMatchObject({
      itemsSubtotalCents: 6600,
      itemsDiscountCents: 100,
      saleDiscountCents: 200,
      totalCents: 6300,
      errors: [],
    });
    expect(totals.lines.map((line) => line.totalCents)).toEqual([3500, 3000]);
  });

  it('arredonda cada linha como o banco', () => {
    expect(computeSaleTotals([{ quantity: 1.5, unitPriceCents: 25, discountCents: 0 }], 0).totalCents).toBe(38);
  });

  it('aponta descontos inválidos e venda vazia', () => {
    expect(computeSaleTotals([{ quantity: 1, unitPriceCents: 1000, discountCents: 1001 }], 0).errors[0]).toMatch(/desconto/);
    expect(computeSaleTotals([{ quantity: 1, unitPriceCents: 1000, discountCents: 0 }], 1001).errors[0]).toMatch(/desconto da venda/);
    expect(computeSaleTotals([], 0).errors).toContain('Adicione pelo menos um item.');
    expect(computeSaleTotals([{ quantity: 0, unitPriceCents: 1000, discountCents: 0 }], 0).errors[0]).toMatch(/quantidade/);
  });
});
