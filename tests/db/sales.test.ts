import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, n, productId, type Session, TestEnv } from './env';

let env: TestEnv;
let ana: string;
let biz: string;
let bolo: string;
let torta: string;
let today: string;

interface SaleView {
  total_cents: number;
  items_subtotal_cents: number;
  items_discount_cents: number;
  discount_cents: number;
  net_paid_cents: number;
  balance_cents: number;
  payment_status: string;
  is_overdue: boolean;
  cost_total_cents: number;
  items_without_cost: number;
  status: string;
  payment_confirmation_pending: boolean;
}

async function sale(s: Session, id: string): Promise<SaleView> {
  const row = await s.one<Record<string, unknown>>(`select * from public.v_sales where id = $1`, [id]);
  return {
    total_cents: n(row.total_cents),
    items_subtotal_cents: n(row.items_subtotal_cents),
    items_discount_cents: n(row.items_discount_cents),
    discount_cents: n(row.discount_cents),
    net_paid_cents: n(row.net_paid_cents),
    balance_cents: n(row.balance_cents),
    payment_status: row.payment_status as string,
    is_overdue: row.is_overdue as boolean,
    cost_total_cents: n(row.cost_total_cents),
    items_without_cost: n(row.items_without_cost),
    status: row.status as string,
    payment_confirmation_pending: row.payment_confirmation_pending as boolean,
  };
}

function createSale(payload: Record<string, unknown>, requestId: string = crypto.randomUUID()) {
  return env.as(ana, (s) =>
    s.rpc<string>('create_sale', { p_business_id: biz, p_request_id: requestId, p_sale: { sale_date: today, ...payload } }),
  );
}

function pay(saleId: string, amount: number, extra: Record<string, unknown> = {}) {
  return env.as(ana, (s) =>
    s.rpc<string>('register_payment', {
      p_sale_id: saleId,
      p_request_id: crypto.randomUUID(),
      p_amount_cents: amount,
      p_paid_on: today,
      p_method: 'pix',
      ...extra,
    }),
  );
}

beforeAll(async () => {
  env = await TestEnv.create();
  ana = await env.createUser('ana@example.com', 'Ana');
  biz = await env.createBusiness('Magi Doces', [{ userId: ana, role: 'owner' }]);
  today = await env.today();
  await env.as(ana, async (s) => {
    bolo = await productId(s, biz, 'Bolo de pote');
    torta = await productId(s, biz, 'Torta de limão');
    await s.query(`update public.products set price_cents = 1200, manual_unit_cost_cents = 450 where id = $1`, [bolo]);
    await s.query(`update public.products set price_cents = 1500 where id = $1`, [torta]);
  });
});

afterAll(async () => {
  await env.close();
});

describe('totais e descontos', () => {
  it('calcula subtotal, descontos de item e da venda no banco', async () => {
    const id = await createSale({
      discount_cents: 200,
      items: [
        { product_id: bolo, quantity: 3, unit_price_cents: 1200, discount_cents: 100 },
        { product_id: torta, quantity: 2 },
      ],
    });
    const v = await env.as(ana, (s) => sale(s, id));
    expect(v.items_subtotal_cents).toBe(3 * 1200 + 2 * 1500);
    expect(v.items_discount_cents).toBe(100);
    expect(v.discount_cents).toBe(200);
    expect(v.total_cents).toBe(6600 - 100 - 200);
    expect(v.balance_cents).toBe(6300);
    expect(v.payment_status).toBe('pending');
  });

  it('ignora totais enviados pelo navegador', async () => {
    const id = await createSale({
      total_cents: 1,
      items: [{ product_id: bolo, quantity: 1, unit_price_cents: 1200, line_total_cents: 1 }],
    });
    expect((await env.as(ana, (s) => sale(s, id))).total_cents).toBe(1200);
  });

  it('arredonda meio centavo para longe do zero em quantidades fracionadas', async () => {
    // 1,5 × R$ 0,25 = 37,5 centavos → 38
    const id = await createSale({ items: [{ product_id: bolo, quantity: 1.5, unit_price_cents: 25 }] });
    expect((await env.as(ana, (s) => sale(s, id))).total_cents).toBe(38);
    // 0,333 × R$ 10,00 = 333 centavos exatos
    const id2 = await createSale({ items: [{ product_id: bolo, quantity: 0.333, unit_price_cents: 1000 }] });
    expect((await env.as(ana, (s) => sale(s, id2))).total_cents).toBe(333);
  });

  it('rejeita desconto maior que o item ou que a venda', async () => {
    await expect(
      createSale({ items: [{ product_id: bolo, quantity: 1, unit_price_cents: 1200, discount_cents: 1201 }] }),
    ).rejects.toThrow(/Desconto inválido/);
    await expect(
      createSale({ discount_cents: 1300, items: [{ product_id: bolo, quantity: 1, unit_price_cents: 1200 }] }),
    ).rejects.toThrow(/desconto da venda/);
  });

  it('exige preço quando o produto não tem preço definido', async () => {
    const surpresa = await env.as(ana, (s) => productId(s, biz, 'Surpresa de uva'));
    await expect(createSale({ items: [{ product_id: surpresa, quantity: 1 }] })).rejects.toThrow(/não tem preço definido/);
  });

  it('rejeita venda sem itens, quantidade inválida e produto desativado', async () => {
    await expect(createSale({ items: [] })).rejects.toThrow(/pelo menos um item/);
    await expect(createSale({ items: [{ product_id: bolo, quantity: 0 }] })).rejects.toThrow(/Quantidade inválida/);
    await expect(createSale({ items: [{ product_id: bolo, quantity: 1.0001 }] })).rejects.toThrow(/Quantidade inválida/);
    const morango = await env.as(ana, (s) => productId(s, biz, 'Morango cravejado'));
    await env.as(ana, (s) => s.query(`update public.products set active = false, price_cents = 900 where id = $1`, [morango]));
    await expect(createSale({ items: [{ product_id: morango, quantity: 1 }] })).rejects.toThrow(/desativado/);
  });

  it('rejeita vencimento anterior à data da venda', async () => {
    await expect(
      createSale({ due_date: addDays(today, -1), items: [{ product_id: bolo, quantity: 1 }] }),
    ).rejects.toThrow(/vencimento não pode ser anterior/);
  });
});

describe('preço e custo históricos', () => {
  it('mudanças no produto não alteram vendas passadas', async () => {
    const id = await createSale({ items: [{ product_id: bolo, quantity: 2 }] });
    await env.as(ana, (s) =>
      s.query(`update public.products set price_cents = 2000, manual_unit_cost_cents = 900 where id = $1`, [bolo]),
    );
    const v = await env.as(ana, (s) => sale(s, id));
    expect(v.total_cents).toBe(2400);
    expect(v.cost_total_cents).toBe(900);
    const item = await env.as(ana, (s) =>
      s.one<{ unit_price_cents: number; unit_cost_cents: number; cost_source: string }>(
        `select unit_price_cents, unit_cost_cents, cost_source from public.sale_items where sale_id = $1`,
        [id],
      ),
    );
    expect(item).toMatchObject({ unit_price_cents: 1200, unit_cost_cents: 450, cost_source: 'manual' });
    await env.as(ana, (s) =>
      s.query(`update public.products set price_cents = 1200, manual_unit_cost_cents = 450 where id = $1`, [bolo]),
    );
  });

  it('registra histórico de preços do produto', async () => {
    const history = await env.as(ana, (s) =>
      s.query<{ price_cents: number | null }>(
        `select price_cents from public.product_price_history where product_id = $1 order by id`,
        [bolo],
      ),
    );
    expect(history.map((h) => h.price_cents)).toEqual([null, 1200, 2000, 1200]);
  });

  it('itens sem custo informado são contados para sinalizar o lucro estimado', async () => {
    const id = await createSale({ items: [{ product_id: torta, quantity: 1 }, { product_id: bolo, quantity: 1 }] });
    const v = await env.as(ana, (s) => sale(s, id));
    expect(v.items_without_cost).toBe(1);
    expect(v.cost_total_cents).toBe(450);
  });
});

describe('idempotência', () => {
  it('reenviar a mesma requisição devolve a mesma venda sem duplicar', async () => {
    const requestId = crypto.randomUUID();
    const payload = { items: [{ product_id: bolo, quantity: 1 }], payment: { full: true, method: 'pix' } };
    const first = await createSale(payload, requestId);
    const second = await createSale(payload, requestId);
    expect(second).toBe(first);
    const count = await env.as(ana, (s) =>
      s.one<{ c: number }>(`select count(*)::int as c from public.sales where client_request_id = $1`, [requestId]),
    );
    expect(count.c).toBe(1);
    const payments = await env.as(ana, (s) => s.query(`select 1 from public.payments where sale_id = $1`, [first]));
    expect(payments).toHaveLength(1);
  });

  it('recebimento repetido com o mesmo identificador não é lançado duas vezes', async () => {
    const id = await createSale({ items: [{ product_id: bolo, quantity: 2 }] });
    const requestId = crypto.randomUUID();
    const args = { p_sale_id: id, p_request_id: requestId, p_amount_cents: 500, p_paid_on: today, p_method: 'dinheiro' };
    const a = await env.as(ana, (s) => s.rpc<string>('register_payment', args));
    const b = await env.as(ana, (s) => s.rpc<string>('register_payment', args));
    expect(b).toBe(a);
    expect((await env.as(ana, (s) => sale(s, id))).net_paid_cents).toBe(500);
  });
});

describe('pagamentos parciais e saldo', () => {
  it('vários pagamentos parciais reduzem o saldo até quitar', async () => {
    const id = await createSale({ items: [{ product_id: bolo, quantity: 3 }] }); // 3600
    await pay(id, 1000);
    let v = await env.as(ana, (s) => sale(s, id));
    expect(v).toMatchObject({ net_paid_cents: 1000, balance_cents: 2600, payment_status: 'partial' });
    await pay(id, 2600);
    v = await env.as(ana, (s) => sale(s, id));
    expect(v).toMatchObject({ net_paid_cents: 3600, balance_cents: 0, payment_status: 'paid' });
  });

  it('não permite receber mais que o saldo', async () => {
    const id = await createSale({ items: [{ product_id: bolo, quantity: 1 }] });
    await pay(id, 700);
    await expect(pay(id, 501)).rejects.toThrow(/maior que o saldo devedor/);
  });

  it('não permite recebimento com data futura', async () => {
    const id = await createSale({ items: [{ product_id: bolo, quantity: 1 }] });
    await expect(pay(id, 100, { p_paid_on: addDays(today, 1) })).rejects.toThrow(/futuro/);
  });

  it('pagamento inicial integral na criação quita a venda', async () => {
    const id = await createSale({ items: [{ product_id: torta, quantity: 2 }], payment: { full: true, method: 'pix' } });
    expect((await env.as(ana, (s) => sale(s, id))).payment_status).toBe('paid');
  });

  it('vencimento passado nunca quita a venda: fica vencida e com saldo', async () => {
    const id = await env.as(ana, (s) =>
      s.rpc<string>('create_sale', {
        p_business_id: biz,
        p_request_id: crypto.randomUUID(),
        p_sale: { sale_date: addDays(today, -40), due_date: addDays(today, -30), items: [{ product_id: bolo, quantity: 1 }] },
      }),
    );
    const v = await env.as(ana, (s) => sale(s, id));
    expect(v).toMatchObject({ payment_status: 'pending', is_overdue: true, balance_cents: 1200 });
  });

  it('venda com vencimento futuro fica pendente e não vencida', async () => {
    const id = await createSale({ due_date: addDays(today, 10), items: [{ product_id: bolo, quantity: 1 }] });
    expect(await env.as(ana, (s) => sale(s, id))).toMatchObject({ payment_status: 'pending', is_overdue: false });
  });
});

describe('estornos, reembolsos e cancelamentos', () => {
  it('estorno remove o recebimento dos totais, mantendo o histórico', async () => {
    const id = await createSale({ items: [{ product_id: bolo, quantity: 1 }] });
    const paymentId = await pay(id, 1200);
    await env.as(ana, (s) => s.rpc('void_payment', { p_payment_id: paymentId, p_reason: 'Lançado em duplicidade' }));
    const v = await env.as(ana, (s) => sale(s, id));
    expect(v).toMatchObject({ net_paid_cents: 0, balance_cents: 1200, payment_status: 'pending' });
    const row = await env.as(ana, (s) =>
      s.one<{ voided_by: string; void_reason: string }>(`select voided_by, void_reason from public.payments where id = $1`, [paymentId]),
    );
    expect(row).toEqual({ voided_by: ana, void_reason: 'Lançado em duplicidade' });
    await expect(
      env.as(ana, (s) => s.rpc('void_payment', { p_payment_id: paymentId, p_reason: 'De novo' })),
    ).rejects.toThrow(/já foi estornado/);
  });

  it('reembolso reduz o recebido líquido e não pode exceder o recebido', async () => {
    const id = await createSale({ items: [{ product_id: bolo, quantity: 2 }] });
    await pay(id, 2400);
    await expect(
      env.as(ana, (s) =>
        s.rpc('register_refund', {
          p_sale_id: id, p_request_id: crypto.randomUUID(), p_amount_cents: 2401, p_paid_on: today, p_method: 'pix',
          p_notes: 'Devolução',
        }),
      ),
    ).rejects.toThrow(/maior que o valor recebido/);
    await env.as(ana, (s) =>
      s.rpc('register_refund', {
        p_sale_id: id, p_request_id: crypto.randomUUID(), p_amount_cents: 1200, p_paid_on: today, p_method: 'pix',
        p_notes: 'Um bolo veio errado',
      }),
    );
    expect(await env.as(ana, (s) => sale(s, id))).toMatchObject({ net_paid_cents: 1200, balance_cents: 1200, payment_status: 'partial' });
  });

  it('não é possível estornar um recebimento que já tem reembolso vinculado', async () => {
    const id = await createSale({ items: [{ product_id: bolo, quantity: 1 }] });
    const receipt = await pay(id, 1200);
    await env.as(ana, (s) =>
      s.rpc('register_refund', {
        p_sale_id: id, p_request_id: crypto.randomUUID(), p_amount_cents: 1200, p_paid_on: today, p_method: 'pix',
        p_notes: 'Desistiu',
      }),
    );
    await expect(
      env.as(ana, (s) => s.rpc('void_payment', { p_payment_id: receipt, p_reason: 'Engano' })),
    ).rejects.toThrow(/reembolso/);
  });

  it('cancelamento sem recebimentos é rastreável', async () => {
    const id = await createSale({ items: [{ product_id: bolo, quantity: 1 }] });
    await expect(env.as(ana, (s) => s.rpc('cancel_sale', { p_sale_id: id, p_reason: '' }))).rejects.toThrow(/motivo/);
    await env.as(ana, (s) => s.rpc('cancel_sale', { p_sale_id: id, p_reason: 'Cliente desistiu' }));
    const v = await env.as(ana, (s) => sale(s, id));
    expect(v).toMatchObject({ status: 'cancelled', payment_status: 'cancelled', balance_cents: 0 });
    const audit = await env.as(ana, (s) =>
      s.query<{ action: string }>(`select action from public.audit_logs where entity_id = $1 order by id`, [id]),
    );
    expect(audit.map((a) => a.action)).toEqual(['sale.created', 'sale.cancelled']);
    await expect(pay(id, 100)).rejects.toThrow(/cancelada/);
  });

  it('cancelamento com recebimentos exige escolher estorno ou reembolso', async () => {
    const id = await createSale({ items: [{ product_id: bolo, quantity: 1 }] });
    await pay(id, 600);
    await expect(env.as(ana, (s) => s.rpc('cancel_sale', { p_sale_id: id, p_reason: 'Desistência' }))).rejects.toThrow(
      /estornar os lançamentos ou registrar o reembolso/,
    );
    await env.as(ana, (s) =>
      s.rpc('cancel_sale', { p_sale_id: id, p_reason: 'Desistência', p_payment_action: 'refund' }),
    );
    const movements = await env.as(ana, (s) =>
      s.query<{ kind: string; amount_cents: number }>(
        `select kind, amount_cents from public.payments where sale_id = $1 and voided_at is null order by created_at`,
        [id],
      ),
    );
    expect(movements).toEqual([
      { kind: 'receipt', amount_cents: 600 },
      { kind: 'refund', amount_cents: 600 },
    ]);
  });

  it('cancelamento com estorno anula os recebimentos', async () => {
    const id = await createSale({ items: [{ product_id: bolo, quantity: 1 }] });
    await pay(id, 1200);
    await env.as(ana, (s) => s.rpc('cancel_sale', { p_sale_id: id, p_reason: 'Venda duplicada', p_payment_action: 'void' }));
    const valid = await env.as(ana, (s) =>
      s.query(`select 1 from public.payments where sale_id = $1 and voided_at is null`, [id]),
    );
    expect(valid).toHaveLength(0);
  });
});

describe('edição de venda', () => {
  it('substitui itens preservando o custo histórico de itens mantidos', async () => {
    const id = await createSale({ items: [{ product_id: bolo, quantity: 1 }] });
    const original = await env.as(ana, (s) =>
      s.one<{ id: string }>(`select id from public.sale_items where sale_id = $1`, [id]),
    );
    await env.as(ana, (s) => s.query(`update public.products set manual_unit_cost_cents = 999 where id = $1`, [bolo]));
    await env.as(ana, (s) =>
      s.rpc('update_sale', {
        p_sale_id: id,
        p_sale: {
          sale_date: today,
          items: [
            { id: original.id, product_id: bolo, quantity: 2, unit_price_cents: 1200 },
            { product_id: torta, quantity: 1 },
          ],
        },
      }),
    );
    const items = await env.as(ana, (s) =>
      s.query<{ product_id: string; unit_cost_cents: number | null }>(
        `select product_id, unit_cost_cents from public.sale_items where sale_id = $1 order by position`,
        [id],
      ),
    );
    expect(items).toEqual([
      { product_id: bolo, unit_cost_cents: 450 },
      { product_id: torta, unit_cost_cents: null },
    ]);
    expect((await env.as(ana, (s) => sale(s, id))).total_cents).toBe(2400 + 1500);
    const audit = await env.as(ana, (s) =>
      s.query<{ action: string }>(`select action from public.audit_logs where entity_id = $1 order by id`, [id]),
    );
    expect(audit.map((a) => a.action)).toEqual(['sale.created', 'sale.updated']);
    await env.as(ana, (s) => s.query(`update public.products set manual_unit_cost_cents = 450 where id = $1`, [bolo]));
  });

  it('não permite reduzir o total abaixo do valor já recebido', async () => {
    const id = await createSale({ items: [{ product_id: bolo, quantity: 2 }] });
    await pay(id, 2000);
    await expect(
      env.as(ana, (s) =>
        s.rpc('update_sale', { p_sale_id: id, p_sale: { sale_date: today, items: [{ product_id: bolo, quantity: 1 }] } }),
      ),
    ).rejects.toThrow(/menor que o valor já recebido/);
    expect((await env.as(ana, (s) => sale(s, id))).total_cents).toBe(2400);
  });

  it('alteração de vencimento é auditada com ação própria', async () => {
    const id = await createSale({ items: [{ product_id: bolo, quantity: 1 }] });
    await env.as(ana, (s) => s.rpc('change_sale_due_date', { p_sale_id: id, p_due_date: addDays(today, 5) }));
    const audit = await env.as(ana, (s) =>
      s.query<{ action: string; actor_id: string }>(
        `select action, actor_id from public.audit_logs where entity_id = $1 order by id`,
        [id],
      ),
    );
    expect(audit).toEqual([
      { action: 'sale.created', actor_id: ana },
      { action: 'sale.due_date_changed', actor_id: ana },
    ]);
  });

  it('a verificação no commit impede recebimento acima do total mesmo fora das RPCs', async () => {
    const id = await createSale({ items: [{ product_id: bolo, quantity: 1 }] });
    await expect(
      env
        .admin()
        .query(
          `insert into public.payments (business_id, sale_id, amount_cents, paid_on, method) values ($1, $2, 5000, $3, 'pix')`,
          [biz, id, today],
        ),
    ).rejects.toThrow(/excede o total/);
  });
});

describe('cadastro rápido de cliente na venda', () => {
  it('cria o cliente e vincula à venda na mesma transação', async () => {
    const id = await createSale({ new_customer: { name: '  Joana  ', phone: '11999990000' }, items: [{ product_id: bolo, quantity: 1 }] });
    const row = await env.as(ana, (s) =>
      s.one<{ customer_name: string; customer_phone: string }>(
        `select customer_name, customer_phone from public.v_sales where id = $1`,
        [id],
      ),
    );
    expect(row).toEqual({ customer_name: 'Joana', customer_phone: '11999990000' });
  });

  it('cliente com histórico não pode ser excluído', async () => {
    const customer = await env.as(ana, (s) =>
      s.one<{ id: string }>(`insert into public.customers (business_id, name) values ($1, 'Com histórico') returning id`, [biz]),
    );
    await createSale({ customer_id: customer.id, items: [{ product_id: bolo, quantity: 1 }] });
    await expect(
      env.as(ana, (s) => s.query(`delete from public.customers where id = $1`, [customer.id])),
    ).rejects.toThrow(/foreign key/);
  });
});
