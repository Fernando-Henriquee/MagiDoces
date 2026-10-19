import { describe, expect, it } from 'vitest';
import { installmentDates, splitInstallments } from './installments';
import { computeRecipeCost } from './recipe-cost';
import { convert, IncompatibleUnitsError } from './units';

const farinha = { name: 'Farinha', unit: 'kg' as const, purchaseQuantity: 5, purchasePriceCents: 2500, yieldPercent: 100 };
const leite = { name: 'Leite', unit: 'l' as const, purchaseQuantity: 1, purchasePriceCents: 600, yieldPercent: 100 };
const ovos = { name: 'Ovos', unit: 'dz' as const, purchaseQuantity: 1, purchasePriceCents: 1200, yieldPercent: 100 };
const morango = { name: 'Morango', unit: 'g' as const, purchaseQuantity: 1000, purchasePriceCents: 3000, yieldPercent: 75 };

describe('conversão de unidades', () => {
  it('converte unidades compatíveis', () => {
    expect(convert(1.5, 'kg', 'g')).toBe(1500);
    expect(convert(250, 'ml', 'l')).toBe(0.25);
    expect(convert(2, 'dz', 'un')).toBe(24);
    expect(convert(500, 'mg', 'g')).toBe(0.5);
  });

  it('não converte unidades incompatíveis', () => {
    expect(() => convert(1, 'kg', 'l')).toThrow(IncompatibleUnitsError);
    expect(() => convert(1, 'un', 'g')).toThrow(/incompatíveis/);
  });
});

describe('custo de receita (mesmos valores do teste de banco)', () => {
  const items = [
    { ingredient: farinha, quantity: 500, unit: 'g' as const },
    { ingredient: leite, quantity: 0.3, unit: 'l' as const },
    { ingredient: ovos, quantity: 4, unit: 'un' as const },
    { ingredient: morango, quantity: 0.2, unit: 'kg' as const },
  ];

  it('calcula custo por item, lote e unidade com rendimento', () => {
    const result = computeRecipeCost({ yieldQuantity: 12, items, extraCosts: [] });
    expect(result.items.map((i) => i.costCents)).toEqual([250, 180, 400, 800]);
    expect(result.batchCostCents).toBe(1630);
    expect(result.unitCostCents).toBe(136);
    expect(result.errors).toEqual([]);
  });

  it('inclui custos adicionais', () => {
    const result = computeRecipeCost({ yieldQuantity: 12, items, extraCosts: [{ description: 'Potes', amountCents: 600 }] });
    expect(result.extraCostsCents).toBe(600);
    expect(result.unitCostCents).toBe(186);
  });

  it('é exato com frações (sem erro de ponto flutuante)', () => {
    const acucar = { name: 'Açúcar', unit: 'kg' as const, purchaseQuantity: 3, purchasePriceCents: 1000, yieldPercent: 100 };
    // 1 kg de 3 kg por R$ 10,00 = 333,33... centavos; 3 unidades → 111,11 → 111
    const result = computeRecipeCost({ yieldQuantity: 3, items: [{ ingredient: acucar, quantity: 1, unit: 'kg' }], extraCosts: [] });
    expect(result.unitCostCents).toBe(111);
    // Exatamente ,5: 1 g de R$ 0,01/g ÷ 2 unidades = 0,5 → 1
    const sal = { name: 'Sal', unit: 'g' as const, purchaseQuantity: 1, purchasePriceCents: 1, yieldPercent: 100 };
    expect(computeRecipeCost({ yieldQuantity: 2, items: [{ ingredient: sal, quantity: 1, unit: 'g' }], extraCosts: [] }).unitCostCents).toBe(1);
  });

  it('aponta unidade incompatível sem converter', () => {
    const result = computeRecipeCost({ yieldQuantity: 1, items: [{ ingredient: farinha, quantity: 1, unit: 'ml' }], extraCosts: [] });
    expect(result.errors[0]).toMatch(/Farinha: Unidades incompatíveis/);
    expect(result.unitCostCents).toBe(0);
  });

  it('aponta rendimento inválido', () => {
    expect(computeRecipeCost({ yieldQuantity: 0, items, extraCosts: [] }).errors).toContain('O rendimento da receita deve ser maior que zero.');
  });
});

describe('parcelamento (mesma regra do banco)', () => {
  it('divide sem perder centavos, diferença na 1ª parcela', () => {
    expect(splitInstallments(100000, 3)).toEqual([33334, 33333, 33333]);
    expect(splitInstallments(1000, 4)).toEqual([250, 250, 250, 250]);
    expect(splitInstallments(10, 3).reduce((a, b) => a + b, 0)).toBe(10);
    expect(() => splitInstallments(2, 3)).toThrow();
  });

  it('gera vencimentos mensais ajustando o fim do mês', () => {
    expect(installmentDates('2026-01-31', 3)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });
});
