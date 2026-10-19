import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, n, productId, TestEnv } from './env';

let env: TestEnv;
let ana: string;
let biz: string;
let today: string;
let bolo: string;
let nextTenth: string;

type Summary = Record<string, number | string>;

function rpcSale(payload: Record<string, unknown>) {
  return env.as(ana, (s) =>
    s.rpc<string>('create_sale', { p_business_id: biz, p_request_id: crypto.randomUUID(), p_sale: payload }),
  );
}

beforeAll(async () => {
  env = await TestEnv.create();
  ana = await env.createUser('ana@example.com');
  biz = await env.createBusiness('Magi Doces', [{ userId: ana, role: 'owner' }]);
  today = await env.today();
  nextTenth = (
    await env.admin().one<{ d: string }>(`select to_char(private.next_day_of_month($1::date, 10, true), 'YYYY-MM-DD') as d`, [today])
  ).d;

  await env.as(ana, async (s) => {
    bolo = await productId(s, biz, 'Bolo de pote');
    await s.query(`update public.products set price_cents = 1000, manual_unit_cost_cents = 400 where id = $1`, [bolo]);
  });

  // S1: hoje, 3 bolos (R$ 30), recebido R$ 10 hoje.
  await rpcSale({
    sale_date: today,
    items: [{ product_id: bolo, quantity: 3 }],
    payment: { amount_cents: 1000, method: 'pix', paid_on: today },
  });
  // S2: hoje, 2 bolos (R$ 20), vence no próximo dia 10.
  await rpcSale({ sale_date: today, due_date: nextTenth, items: [{ product_id: bolo, quantity: 2 }] });
  // S3: venda antiga (fora do período), recebida hoje.
  const s3 = await rpcSale({ sale_date: addDays(today, -40), items: [{ product_id: bolo, quantity: 1 }] });
  await env.as(ana, (s) =>
    s.rpc('register_payment', {
      p_sale_id: s3, p_request_id: crypto.randomUUID(), p_amount_cents: 1000, p_paid_on: today, p_method: 'dinheiro',
    }),
  );
  // S4: cancelada hoje — não entra em nada.
  const s4 = await rpcSale({ sale_date: today, items: [{ product_id: bolo, quantity: 5 }] });
  await env.as(ana, (s) => s.rpc('cancel_sale', { p_sale_id: s4, p_reason: 'Teste de cancelamento' }));

  // Compra de estoque hoje: R$ 50, paga R$ 20 hoje, saldo vence em 15 dias.
  const purchase = await env.as(ana, (s) =>
    s.rpc<string>('create_purchase', {
      p_business_id: biz,
      p_request_id: crypto.randomUUID(),
      p_purchase: {
        purchase_date: today, description: 'Insumos do mês', due_date: addDays(today, 15),
        items: [{ description: 'Farinha', quantity: 10, unit: 'kg', unit_price_cents: 500 }], plan: { mode: 'pending' },
      },
    }),
  );
  await env.as(ana, (s) =>
    s.rpc('add_bill_payment', {
      p_kind: 'purchase', p_bill_id: purchase, p_request_id: crypto.randomUUID(), p_amount_cents: 2000,
      p_paid_on: today, p_due_date: null, p_method: 'pix',
    }),
  );
  // Despesa de hoje, paga hoje: R$ 8.
  await env.as(ana, (s) =>
    s.rpc('create_expense', {
      p_business_id: biz,
      p_request_id: crypto.randomUUID(),
      p_expense: { expense_date: today, description: 'Gás', amount_cents: 800, plan: { mode: 'paid' } },
    }),
  );
  // Despesa antiga (competência fora do período), paga hoje: R$ 3.
  await env.as(ana, (s) =>
    s.rpc('create_expense', {
      p_business_id: biz,
      p_request_id: crypto.randomUUID(),
      p_expense: { expense_date: addDays(today, -40), description: 'Taxa', amount_cents: 300, plan: { mode: 'paid', paid_on: today } },
    }),
  );
});

afterAll(async () => {
  await env.close();
});

describe('dashboard_summary', () => {
  it('diferencia faturamento, recebimento, fluxo de caixa e lucro estimado', async () => {
    const summary = await env.as(ana, (s) =>
      s.rpc<Summary>('dashboard_summary', { p_business_id: biz, p_from: addDays(today, -7), p_to: today }),
    );
    const v = (key: string) => n(summary[key]);

    expect(v('sales_count')).toBe(2);
    expect(v('cancelled_count')).toBe(1);
    expect(v('revenue_cents')).toBe(5000); // S1 + S2 (S3 fora do período, S4 cancelada)
    expect(v('cogs_cents')).toBe(2000); // 5 bolos × R$ 4
    expect(v('gross_profit_cents')).toBe(3000);
    expect(v('expenses_cents')).toBe(800); // competência no período
    expect(v('estimated_result_cents')).toBe(2200); // 5000 − 2000 − 800
    expect(v('purchases_cents')).toBe(5000); // registrada, mas fora do resultado

    expect(v('net_received_cents')).toBe(2000); // S1 parcial + S3 antiga recebida hoje
    expect(v('purchases_paid_cents')).toBe(2000);
    expect(v('expenses_paid_cents')).toBe(1100); // inclui a despesa antiga paga hoje
    expect(v('cash_flow_cents')).toBe(2000 - 2000 - 1100);

    expect(v('open_receivables_cents')).toBe(4000); // S1 (2000) + S2 (2000)
    expect(v('overdue_cents')).toBe(0);
    expect(summary.next_due_day).toBe(nextTenth);
    expect(v('next_due_day_cents')).toBe(2000);
    expect(v('open_payables_cents')).toBe(3000);
  });

  it('o lucro não subtrai compras de estoque: só o custo dos produtos vendidos', async () => {
    const summary = await env.as(ana, (s) =>
      s.rpc<Summary>('dashboard_summary', { p_business_id: biz, p_from: today, p_to: today }),
    );
    const naive = n(summary.revenue_cents) - n(summary.purchases_cents);
    expect(n(summary.estimated_result_cents)).not.toBe(naive);
    expect(n(summary.estimated_result_cents)).toBe(n(summary.revenue_cents) - n(summary.cogs_cents) - n(summary.expenses_cents));
  });

  it('rejeita período inválido e usuário sem acesso', async () => {
    await expect(
      env.as(ana, (s) => s.rpc('dashboard_summary', { p_business_id: biz, p_from: today, p_to: addDays(today, -1) })),
    ).rejects.toThrow(/Período inválido/);
    const other = await env.createUser('outro@example.com');
    await expect(
      env.as(other, (s) => s.rpc('dashboard_summary', { p_business_id: biz, p_from: today, p_to: today })),
    ).rejects.toThrow(/Acesso negado/);
  });
});

describe('cash_flow_entries', () => {
  it('cada movimentação aparece uma única vez (realizado + previsto = compromisso)', async () => {
    const rows = await env.as(ana, (s) =>
      s.query<{ direction: string; realized: boolean; category: string; amount_cents: string; ref_kind: string }>(
        `select direction, realized, category, amount_cents, ref_kind from public.cash_flow_entries($1, $2, $3)`,
        [biz, addDays(today, -7), addDays(today, 60)],
      ),
    );
    const sum = (filter: (r: (typeof rows)[number]) => boolean) =>
      rows.filter(filter).reduce((total, r) => total + n(r.amount_cents), 0);

    expect(sum((r) => r.direction === 'in' && r.realized)).toBe(2000);
    expect(sum((r) => r.direction === 'out' && r.realized)).toBe(2000 + 800 + 300);
    // A compra de R$ 50 aparece como R$ 20 pagos + R$ 30 previstos, nunca R$ 50 de novo.
    expect(sum((r) => r.ref_kind === 'purchase')).toBe(5000);
    expect(sum((r) => r.ref_kind === 'purchase' && !r.realized)).toBe(3000);
    // A receber previsto: somente S2 tem vencimento (S1 não tem).
    expect(sum((r) => r.direction === 'in' && !r.realized)).toBe(2000);
  });
});

describe('relatórios', () => {
  it('vendas por dia e produtos mais vendidos', async () => {
    const byDay = await env.as(ana, (s) =>
      s.query<{ period_start: string; sales_count: number; revenue_cents: string; gross_profit_cents: string }>(
        `select to_char(period_start, 'YYYY-MM-DD') as period_start, sales_count, revenue_cents, gross_profit_cents
         from public.report_sales_by_period($1, $2, $3, 'day')`,
        [biz, addDays(today, -7), today],
      ),
    );
    expect(byDay).toHaveLength(1);
    expect(byDay[0]).toMatchObject({ period_start: today, sales_count: 2 });
    expect(n(byDay[0]?.revenue_cents)).toBe(5000);
    expect(n(byDay[0]?.gross_profit_cents)).toBe(3000);

    const top = await env.as(ana, (s) =>
      s.query<{ product_name: string; quantity: string; revenue_cents: string; margin_percent: string }>(
        `select product_name, quantity, revenue_cents, margin_percent from public.report_top_products($1, $2, $3)`,
        [biz, addDays(today, -7), today],
      ),
    );
    expect(top).toHaveLength(1);
    expect(top[0]?.product_name).toBe('Bolo de pote');
    expect(n(top[0]?.quantity)).toBe(5);
    expect(n(top[0]?.margin_percent)).toBe(60);
  });

  it('recebimentos por forma de pagamento', async () => {
    const rows = await env.as(ana, (s) =>
      s.query<{ method: string; net_cents: string }>(
        `select method, net_cents from public.report_receipts_by_period($1, $2, $3, 'month') order by method`,
        [biz, addDays(today, -7), today],
      ),
    );
    expect(rows.map((r) => [r.method, n(r.net_cents)])).toEqual([
      ['dinheiro', 1000],
      ['pix', 1000],
    ]);
  });

  it('rejeita agrupamento inválido (sem injeção no date_trunc)', async () => {
    await expect(
      env.as(ana, (s) =>
        s.query(`select * from public.report_sales_by_period($1, $2, $3, 'year; drop table x')`, [biz, today, today]),
      ),
    ).rejects.toThrow(/Agrupamento inválido/);
  });
});

describe('vencimento no dia do mês', () => {
  it.each([
    ['2026-10-05', 10, true, '2026-10-10'],
    ['2026-10-10', 10, true, '2026-10-10'],
    ['2026-10-10', 10, false, '2026-11-10'],
    ['2026-10-11', 10, true, '2026-11-10'],
    ['2026-12-15', 10, true, '2027-01-10'],
    ['2026-01-31', 31, false, '2026-02-28'],
    ['2028-02-15', 31, true, '2028-02-29'],
  ])('a partir de %s, dia %i (inclusivo=%s) → %s', async (from, day, inclusive, expected) => {
    const row = await env.admin().one<{ d: string }>(
      `select to_char(private.next_day_of_month($1::date, $2, $3), 'YYYY-MM-DD') as d`,
      [from, day, inclusive],
    );
    expect(row.d).toBe(expected);
  });
});
