import { describe, expect, it } from 'vitest';
import type { CashFlowEntry } from '@/data/types';
import { entryHref, groupCashFlowByDay, summarizeCashFlow } from './cash-flow';

function entry(overrides: Partial<CashFlowEntry>): CashFlowEntry {
  return {
    entry_date: '2026-10-10',
    direction: 'in',
    realized: true,
    category: 'Recebimento de venda',
    description: 'Maria',
    amount_cents: 1000,
    ref_kind: 'sale',
    ref_id: 's1',
    is_overdue: false,
    ...overrides,
  };
}

const entries: CashFlowEntry[] = [
  entry({ entry_date: '2026-10-01', amount_cents: 5000 }),
  entry({ entry_date: '2026-10-01', direction: 'out', category: 'Pagamento de compra', description: 'Insumos', amount_cents: 2000, ref_kind: 'purchase', ref_id: 'p1' }),
  entry({ entry_date: '2026-10-03', direction: 'out', category: 'Reembolso a cliente', amount_cents: 500 }),
  entry({ entry_date: '2026-10-05', realized: false, category: 'A receber', description: 'João', amount_cents: 3000, is_overdue: true }),
  entry({ entry_date: '2026-10-05', direction: 'out', realized: false, category: 'Parcela de compra', amount_cents: 1500, ref_kind: 'purchase', ref_id: 'p1' }),
  entry({ entry_date: '2026-10-08', direction: 'out', category: 'Pagamento de despesa', description: 'Gás', amount_cents: 1200, ref_kind: 'expense', ref_id: 'e1' }),
];

describe('summarizeCashFlow', () => {
  it('separa realizado e previsto, com vencidos', () => {
    expect(summarizeCashFlow(entries)).toEqual({
      realizedIn: 5000,
      realizedOut: 2000 + 500 + 1200,
      realizedNet: 5000 - 3700,
      forecastIn: 3000,
      forecastOut: 1500,
      forecastNet: 1500,
      overdueIn: 3000,
      overdueOut: 0,
    });
  });

  it('aceita valores numéricos vindos como texto', () => {
    expect(summarizeCashFlow([entry({ amount_cents: '250' as unknown as number })]).realizedIn).toBe(250);
  });
});

describe('groupCashFlowByDay', () => {
  it('agrupa por dia em ordem, com saldo realizado acumulado', () => {
    const days = groupCashFlowByDay(entries);
    expect(days.map((d) => [d.date, d.realizedIn, d.realizedOut, d.forecastIn, d.forecastOut, d.runningRealized])).toEqual([
      ['2026-10-01', 5000, 2000, 0, 0, 3000],
      ['2026-10-03', 0, 500, 0, 0, 2500],
      ['2026-10-05', 0, 0, 3000, 1500, 2500],
      ['2026-10-08', 0, 1200, 0, 0, 1300],
    ]);
    expect(days[0]?.entries.map((e) => e.direction)).toEqual(['in', 'out']);
  });

  it('filtra realizado ou previsto sem alterar o saldo acumulado', () => {
    const forecast = groupCashFlowByDay(entries, 'forecast');
    expect(forecast.map((d) => d.date)).toEqual(['2026-10-05']);
    expect(forecast[0]?.runningRealized).toBe(2500);
    expect(groupCashFlowByDay(entries, 'realized').map((d) => d.date)).toEqual(['2026-10-01', '2026-10-03', '2026-10-08']);
  });
});

describe('entryHref', () => {
  it('aponta para o registro de origem', () => {
    expect(entryHref({ ref_kind: 'sale', ref_id: 'a' })).toBe('/vendas/a');
    expect(entryHref({ ref_kind: 'purchase', ref_id: 'b' })).toBe('/compras/b');
    expect(entryHref({ ref_kind: 'expense', ref_id: 'c' })).toBe('/despesas/c');
  });
});
