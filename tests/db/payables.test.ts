import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, n, TestEnv } from './env';

let env: TestEnv;
let ana: string;
let biz: string;
let today: string;
let farinha: string;

interface Bill {
  total_cents: number;
  paid_cents: number;
  scheduled_cents: number;
  balance_cents: number;
  unscheduled_cents: number;
  payment_status: string;
  is_overdue: boolean;
}

async function bill(view: 'v_purchases' | 'v_expenses', id: string): Promise<Bill> {
  const row = await env.as(ana, (s) => s.one<Record<string, unknown>>(`select * from public.${view} where id = $1`, [id]));
  return {
    total_cents: n(row.total_cents),
    paid_cents: n(row.paid_cents),
    scheduled_cents: n(row.scheduled_cents),
    balance_cents: n(row.balance_cents),
    unscheduled_cents: n(row.unscheduled_cents),
    payment_status: row.payment_status as string,
    is_overdue: row.is_overdue as boolean,
  };
}

function createPurchase(payload: Record<string, unknown>) {
  return env.as(ana, (s) =>
    s.rpc<string>('create_purchase', {
      p_business_id: biz,
      p_request_id: crypto.randomUUID(),
      p_purchase: { purchase_date: today, description: 'Compra de insumos', ...payload },
    }),
  );
}

beforeAll(async () => {
  env = await TestEnv.create();
  ana = await env.createUser('ana@example.com');
  biz = await env.createBusiness('Magi Doces', [{ userId: ana, role: 'owner' }]);
  today = await env.today();
  farinha = await env.as(ana, async (s) => {
    const row = await s.one<{ id: string }>(
      `insert into public.ingredients (business_id, name, unit, purchase_quantity, purchase_price_cents) values ($1, 'Farinha', 'kg', 1, 500) returning id`,
      [biz],
    );
    return row.id;
  });
});

afterAll(async () => {
  await env.close();
});

describe('compras', () => {
  it('calcula o total a partir dos itens, frete e desconto', async () => {
    const id = await createPurchase({
      extra_cents: 1500,
      discount_cents: 500,
      new_supplier_name: 'Atacadão',
      items: [
        { description: 'Leite condensado', quantity: 12, unit: 'un', unit_price_cents: 650 },
        { ingredient_id: farinha, quantity: 5, unit: 'kg', unit_price_cents: 480 },
      ],
      plan: { mode: 'pending' },
    });
    const b = await bill('v_purchases', id);
    expect(b.total_cents).toBe(12 * 650 + 5 * 480 + 1500 - 500);
    expect(b).toMatchObject({ paid_cents: 0, payment_status: 'pending' });
    const supplier = await env.as(ana, (s) =>
      s.one<{ supplier_name: string }>(`select supplier_name from public.v_purchases where id = $1`, [id]),
    );
    expect(supplier.supplier_name).toBe('Atacadão');
  });

  it('compra paga à vista gera um único pagamento do total', async () => {
    const id = await createPurchase({
      items: [{ description: 'Embalagens', quantity: 100, unit: 'un', unit_price_cents: 35 }],
      plan: { mode: 'paid', method: 'pix' },
    });
    expect(await bill('v_purchases', id)).toMatchObject({ total_cents: 3500, paid_cents: 3500, balance_cents: 0, payment_status: 'paid' });
  });

  it('parcelamento divide o total sem perder centavos e não reconta o total por parcela', async () => {
    const id = await createPurchase({
      due_date: addDays(today, 30),
      items: [{ description: 'Batedeira', quantity: 1, unit: 'un', unit_price_cents: 100000 }],
      plan: { mode: 'installments', count: 3, first_due_date: addDays(today, 30) },
    });
    const installments = await env.as(ana, (s) =>
      s.query<{ installment_number: number; amount_cents: number; due_date: string }>(
        `select installment_number, amount_cents, to_char(due_date, 'YYYY-MM-DD') as due_date
         from public.bill_payments where purchase_id = $1 order by installment_number`,
        [id],
      ),
    );
    expect(installments.map((i) => i.amount_cents)).toEqual([33334, 33333, 33333]);
    expect(installments.reduce((sum, i) => sum + i.amount_cents, 0)).toBe(100000);
    expect(await bill('v_purchases', id)).toMatchObject({
      total_cents: 100000,
      paid_cents: 0,
      scheduled_cents: 100000,
      unscheduled_cents: 0,
      balance_cents: 100000,
    });

    const first = await env.as(ana, (s) =>
      s.one<{ id: string }>(`select id from public.bill_payments where purchase_id = $1 and installment_number = 1`, [id]),
    );
    await env.as(ana, (s) => s.rpc('pay_bill_installment', { p_bill_payment_id: first.id, p_paid_on: today, p_method: 'pix' }));
    expect(await bill('v_purchases', id)).toMatchObject({
      total_cents: 100000,
      paid_cents: 33334,
      scheduled_cents: 66666,
      balance_cents: 66666,
      payment_status: 'partial',
    });
    await expect(
      env.as(ana, (s) => s.rpc('pay_bill_installment', { p_bill_payment_id: first.id, p_paid_on: today, p_method: 'pix' })),
    ).rejects.toThrow(/já foi paga/);

    // O total registrado da compra continua um só nos relatórios.
    const report = await env.as(ana, (s) =>
      s.query<{ registered_cents: string; paid_in_period_cents: string }>(
        `select registered_cents, paid_in_period_cents from public.report_payables($1, $2, $3) where kind = 'purchase' and category = 'Ingredientes'`,
        [biz, addDays(today, -1), addDays(today, 1)],
      ),
    );
    expect(report).toHaveLength(1);
    expect(n(report[0]?.paid_in_period_cents)).toBe(3500 + 33334);
  });

  it('não permite pagamentos acima do total', async () => {
    const id = await createPurchase({
      items: [{ description: 'Açúcar', quantity: 1, unit: 'kg', unit_price_cents: 1000 }],
      plan: { mode: 'pending' },
    });
    await env.as(ana, (s) =>
      s.rpc('add_bill_payment', {
        p_kind: 'purchase', p_bill_id: id, p_request_id: crypto.randomUUID(), p_amount_cents: 600,
        p_paid_on: today, p_due_date: null, p_method: 'dinheiro',
      }),
    );
    await expect(
      env.as(ana, (s) =>
        s.rpc('add_bill_payment', {
          p_kind: 'purchase', p_bill_id: id, p_request_id: crypto.randomUUID(), p_amount_cents: 401,
          p_paid_on: today, p_due_date: null, p_method: 'dinheiro',
        }),
      ),
    ).rejects.toThrow(/excede o saldo/);
    expect(await bill('v_purchases', id)).toMatchObject({ paid_cents: 600, balance_cents: 400, payment_status: 'partial' });
  });

  it('cancelamento exige estorno explícito de pagamentos realizados', async () => {
    const id = await createPurchase({
      items: [{ description: 'Chocolate', quantity: 2, unit: 'kg', unit_price_cents: 4000 }],
      plan: { mode: 'paid' },
    });
    await expect(
      env.as(ana, (s) => s.rpc('cancel_bill', { p_kind: 'purchase', p_id: id, p_reason: 'Devolvido' })),
    ).rejects.toThrow(/estorno dos pagamentos/);
    await env.as(ana, (s) =>
      s.rpc('cancel_bill', { p_kind: 'purchase', p_id: id, p_reason: 'Devolvido ao fornecedor', p_void_payments: true }),
    );
    expect(await bill('v_purchases', id)).toMatchObject({ payment_status: 'cancelled', paid_cents: 0, balance_cents: 0 });
  });

  it('atualiza o custo do ingrediente convertendo a unidade da compra', async () => {
    await createPurchase({
      items: [{ ingredient_id: farinha, quantity: 2500, unit: 'g', unit_price_cents: 1, update_ingredient_cost: true }],
      plan: { mode: 'pending' },
    });
    const ing = await env.as(ana, (s) =>
      s.one<{ purchase_quantity: string; purchase_price_cents: number }>(
        `select purchase_quantity, purchase_price_cents from public.ingredients where id = $1`,
        [farinha],
      ),
    );
    expect(n(ing.purchase_quantity)).toBe(2.5); // 2500 g → 2,5 kg
    expect(ing.purchase_price_cents).toBe(2500);
    await expect(
      createPurchase({
        items: [{ ingredient_id: farinha, quantity: 1, unit: 'l', unit_price_cents: 100, update_ingredient_cost: true }],
        plan: { mode: 'pending' },
      }),
    ).rejects.toThrow(/não é compatível/);
  });

  it('edição não pode reduzir o total abaixo do pago + previsto', async () => {
    const id = await createPurchase({
      items: [{ description: 'Forma', quantity: 1, unit: 'un', unit_price_cents: 5000 }],
      plan: { mode: 'installments', count: 2, first_due_date: addDays(today, 10) },
    });
    await expect(
      env.as(ana, (s) =>
        s.rpc('update_purchase', {
          p_purchase_id: id,
          p_purchase: { purchase_date: today, description: 'Forma', items: [{ description: 'Forma', quantity: 1, unit: 'un', unit_price_cents: 4000 }] },
        }),
      ),
    ).rejects.toThrow(/menor que pagamentos e parcelas/);
  });
});

describe('despesas', () => {
  it('despesa pendente vencida aparece como vencida, sem ser considerada paga', async () => {
    const id = await env.as(ana, (s) =>
      s.rpc<string>('create_expense', {
        p_business_id: biz,
        p_request_id: crypto.randomUUID(),
        p_expense: {
          expense_date: addDays(today, -20), description: 'Conta de luz', category: 'Energia', amount_cents: 18990,
          due_date: addDays(today, -5), plan: { mode: 'pending' },
        },
      }),
    );
    expect(await bill('v_expenses', id)).toMatchObject({ total_cents: 18990, paid_cents: 0, payment_status: 'pending', is_overdue: true });
    await env.as(ana, (s) =>
      s.rpc('add_bill_payment', {
        p_kind: 'expense', p_bill_id: id, p_request_id: crypto.randomUUID(), p_amount_cents: 18990,
        p_paid_on: today, p_due_date: null, p_method: 'boleto',
      }),
    );
    expect(await bill('v_expenses', id)).toMatchObject({ payment_status: 'paid', is_overdue: false });
  });

  it('estorno de pagamento de despesa volta o saldo', async () => {
    const id = await env.as(ana, (s) =>
      s.rpc<string>('create_expense', {
        p_business_id: biz,
        p_request_id: crypto.randomUUID(),
        p_expense: { expense_date: today, description: 'Gás', category: 'Gás', amount_cents: 12000, plan: { mode: 'paid', method: 'dinheiro' } },
      }),
    );
    const payment = await env.as(ana, (s) => s.one<{ id: string }>(`select id from public.bill_payments where expense_id = $1`, [id]));
    await env.as(ana, (s) => s.rpc('void_bill_payment', { p_bill_payment_id: payment.id, p_reason: 'Pago pela outra sócia' }));
    expect(await bill('v_expenses', id)).toMatchObject({ paid_cents: 0, balance_cents: 12000 });
  });

  it('idempotência na criação de despesa', async () => {
    const requestId = crypto.randomUUID();
    const args = {
      p_business_id: biz,
      p_request_id: requestId,
      p_expense: { expense_date: today, description: 'Anúncio', category: 'Marketing', amount_cents: 5000, plan: { mode: 'paid' } },
    };
    const a = await env.as(ana, (s) => s.rpc<string>('create_expense', args));
    const b = await env.as(ana, (s) => s.rpc<string>('create_expense', args));
    expect(a).toBe(b);
    const payments = await env.as(ana, (s) => s.query(`select 1 from public.bill_payments where expense_id = $1`, [a]));
    expect(payments).toHaveLength(1);
  });
});

describe('vencimento efetivo', () => {
  it('considera o saldo sem parcela quando ele vence antes da próxima parcela', async () => {
    const id = await createPurchase({
      due_date: addDays(today, 5),
      items: [{ description: 'Formas', quantity: 1, unit: 'un', unit_price_cents: 9000 }],
      plan: { mode: 'pending' },
    });
    await env.as(ana, (s) =>
      s.rpc('add_bill_payment', {
        p_kind: 'purchase', p_bill_id: id, p_request_id: crypto.randomUUID(), p_amount_cents: 3000,
        p_paid_on: null, p_due_date: addDays(today, 30), p_method: 'pix',
      }),
    );
    const row = await env.as(ana, (s) =>
      s.one<{ next_due_date: string; unscheduled_cents: string }>(
        `select to_char(next_due_date, 'YYYY-MM-DD') as next_due_date, unscheduled_cents from public.v_purchases where id = $1`,
        [id],
      ),
    );
    expect(n(row.unscheduled_cents)).toBe(6000);
    expect(row.next_due_date).toBe(addDays(today, 5));
  });
});
