import { describe, expect, it } from 'vitest';
import { nextDayOfMonth } from './dates';
import { describeStatus, dueOn, dueOnDayOfMonth, groupByCustomer, groupByDueDate, type ReceivableSale, sumBalance } from './receivables';

const today = '2026-10-19';

function sale(overrides: Partial<ReceivableSale>): ReceivableSale {
  return {
    id: crypto.randomUUID(),
    customer_id: 'c1',
    customer_name: 'Maria Souza',
    customer_phone: '11988887777',
    sale_date: '2026-10-01',
    due_date: null,
    total_cents: 1000,
    net_paid_cents: 0,
    balance_cents: 1000,
    payment_status: 'pending',
    is_overdue: false,
    payment_confirmation_pending: false,
    items_summary: '1× Bolo de pote',
    status: 'active',
    ...overrides,
  };
}

const sales: ReceivableSale[] = [
  sale({ id: 'a', due_date: '2026-10-10', is_overdue: true }),
  sale({ id: 'b', sale_date: '2026-10-15', due_date: '2026-11-10', total_cents: 3000, net_paid_cents: 1000, balance_cents: 2000, payment_status: 'partial' }),
  sale({ id: 'c', customer_id: 'c2', customer_name: 'João', due_date: '2026-11-10', total_cents: 500, balance_cents: 500 }),
  sale({ id: 'd', customer_id: 'c2', customer_name: 'João', due_date: today, total_cents: 700, balance_cents: 700 }),
  sale({ id: 'e', customer_id: null, customer_name: null, total_cents: 900, balance_cents: 900 }),
  // Fora das contas a receber:
  sale({ id: 'paid', total_cents: 800, net_paid_cents: 800, balance_cents: 0, payment_status: 'paid' }),
  sale({ id: 'cancelled', status: 'cancelled', payment_status: 'cancelled', balance_cents: 0 }),
];

describe('groupByCustomer', () => {
  it('consolida por cliente mantendo cada venda', () => {
    const groups = groupByCustomer(sales);
    expect(groups.map((g) => g.customerName)).toEqual(['Maria Souza', 'João', 'Sem cliente identificado']);
    const maria = groups[0];
    expect(maria).toMatchObject({ originalCents: 4000, receivedCents: 1000, balanceCents: 3000, overdueCents: 1000, nextDueDate: '2026-10-10' });
    expect(maria?.sales.map((s) => s.id)).toEqual(['a', 'b']);
    expect(groups[1]).toMatchObject({ balanceCents: 1200, overdueCents: 0 });
  });

  it('ignora vendas pagas e canceladas', () => {
    const ids = groupByCustomer(sales).flatMap((g) => g.sales.map((s) => s.id));
    expect(ids).not.toContain('paid');
    expect(ids).not.toContain('cancelled');
    expect(sumBalance(sales)).toBe(1000 + 2000 + 500 + 700 + 900);
  });
});

describe('groupByDueDate', () => {
  it('ordena vencidos, hoje, futuros e sem vencimento', () => {
    const groups = groupByDueDate(sales, today);
    expect(groups.map((g) => [g.label, g.balanceCents])).toEqual([
      ['Vencidos', 1000],
      ['Vencem hoje', 700],
      ['10/11/2026', 2500],
      ['Sem vencimento', 900],
    ]);
  });
});

describe('recebimentos do dia 10', () => {
  it('filtra o próximo dia 10', () => {
    const next10 = nextDayOfMonth(today, 10, true);
    expect(next10).toBe('2026-11-10');
    expect(dueOn(sales, next10).map((s) => s.id)).toEqual(['b', 'c']);
  });

  it('filtra vencimentos em qualquer dia 10 (inclui vencidos)', () => {
    expect(dueOnDayOfMonth(sales, 10).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('describeStatus', () => {
  it('nunca trata vencimento passado como pago', () => {
    expect(describeStatus({ payment_status: 'pending', is_overdue: true, due_date: '2026-10-10', payment_confirmation_pending: false }, today)).toEqual({
      label: 'Vencida há 9 dias',
      tone: 'danger',
    });
    expect(describeStatus({ payment_status: 'partial', is_overdue: true, due_date: '2026-10-18', payment_confirmation_pending: false }, today).label).toBe(
      'Parcial · Vencida há 1 dia',
    );
  });

  it('distingue paga, parcial, prevista, a confirmar e cancelada', () => {
    const base = { is_overdue: false, due_date: null, payment_confirmation_pending: false };
    expect(describeStatus({ ...base, payment_status: 'paid' }, today).label).toBe('Paga');
    expect(describeStatus({ ...base, payment_status: 'partial' }, today).label).toBe('Parcial');
    expect(describeStatus({ ...base, payment_status: 'pending', due_date: '2026-11-10' }, today).label).toBe('Prevista 10/11/2026');
    expect(describeStatus({ ...base, payment_status: 'pending', due_date: today }, today).label).toBe('Vence hoje');
    expect(describeStatus({ ...base, payment_status: 'pending', payment_confirmation_pending: true }, today).label).toBe('A confirmar');
    expect(describeStatus({ ...base, payment_status: 'cancelled' }, today).label).toBe('Cancelada');
  });
});
