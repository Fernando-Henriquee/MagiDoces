import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, n, productId, type Session, TestEnv } from './env';

/**
 * Link de compras: a própria cliente anota a compra, sem login (papel anon).
 * Tudo passa pelas funções storefront_*; anon continua sem acesso às tabelas.
 */

let env: TestEnv;
let ana: string; // owner do negócio A
let edu: string; // editor do negócio A
let vera: string; // viewer do negócio A
let zeca: string; // owner do negócio B
let bizA: string;
let bizB: string;
let token: string;
let bolo: string;
let torta: string;
let morango: string; // sem preço: fora da vitrine
let uva: string; // caro, para o limite de valor
let tortaB: string;
let today: string;

interface Receipt {
  sale_id: string;
  due_date: string;
  payment: string;
  total_cents: number;
  balance_cents: number;
  customer_first_name: string;
  code_status: 'can_create' | 'has_code' | 'ask_business';
  reported_paid: boolean;
  items: Array<{ name: string; quantity: number; unit_price_cents: number; total_cents: number }>;
  pix: { key: string; name: string; city: string | null } | null;
}

interface Statement {
  status: string;
  attempts_left?: number;
  customer_first_name?: string;
  balance_cents?: number;
  overdue_cents?: number;
  sales?: Array<{ balance_cents: number; items_summary: string; reported_paid: boolean }>;
}

function nextDay10(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const date = d < 10 ? new Date(Date.UTC(y, m - 1, 10)) : new Date(Date.UTC(y, m, 10));
  return date.toISOString().slice(0, 10);
}

function purchase(fields: Record<string, unknown>, requestId: string = crypto.randomUUID(), useToken = token, headers?: Record<string, string>) {
  return env.anon(async (s) => {
    if (headers) await s.query(`select set_config('request.headers', $1, true)`, [JSON.stringify(headers)]);
    return s.rpc<Receipt>('storefront_register_purchase', {
      p_token: useToken,
      p_request_id: requestId,
      p_purchase: { name: 'Joana Silva', phone: '(11) 98765-4321', payment: 'due_day', items: [{ product_id: bolo, quantity: 1 }], ...fields },
    });
  });
}

function statement(phone: string, code: string) {
  return env.anon((s) => s.rpc<Statement>('storefront_statement', { p_token: token, p_phone: phone, p_code: code }));
}

async function ownerSession<T>(fn: (s: Session) => Promise<T>) {
  return env.as(ana, fn);
}

beforeAll(async () => {
  env = await TestEnv.create();
  ana = await env.createUser('ana@example.com', 'Ana');
  edu = await env.createUser('edu@example.com', 'Edu');
  vera = await env.createUser('vera@example.com', 'Vera');
  zeca = await env.createUser('zeca@example.com', 'Zeca');
  bizA = await env.createBusiness('Magi Doces', [
    { userId: ana, role: 'owner' },
    { userId: edu, role: 'editor' },
    { userId: vera, role: 'viewer' },
  ]);
  bizB = await env.createBusiness('Outra Confeitaria', [{ userId: zeca, role: 'owner' }]);
  today = await env.today();

  await ownerSession(async (s) => {
    bolo = await productId(s, bizA, 'Bolo de pote');
    torta = await productId(s, bizA, 'Torta de limão');
    morango = await productId(s, bizA, 'Morango cravejado');
    uva = await productId(s, bizA, 'Surpresa de uva');
    await s.query(`update public.products set price_cents = 1200 where id = $1`, [bolo]);
    await s.query(`update public.products set price_cents = 1500 where id = $1`, [torta]);
    await s.query(`update public.products set price_cents = 30000 where id = $1`, [uva]);
  });
  await env.as(zeca, async (s) => {
    tortaB = await productId(s, bizB, 'Torta de limão');
    await s.query(`update public.products set price_cents = 900 where id = $1`, [tortaB]);
  });
});

afterAll(async () => {
  await env.close();
});

describe('configuração do link', () => {
  it('desligado (ou token inventado) não mostra nada', async () => {
    const shown = await env.anon((s) => s.rpc('storefront', { p_token: 'AAAAAAAAAAAAAAAAAAAAAA' }));
    expect(shown).toBeNull();
    expect(await env.anon((s) => s.rpc('storefront', { p_token: "x' or 1=1 --" }))).toBeNull();
  });

  it('somente owner liga o link; editor, viewer e anon não', async () => {
    await expect(env.as(edu, (s) => s.rpc('configure_storefront', { p_business_id: bizA, p_enabled: true }))).rejects.toThrow(/Somente sócias/);
    await expect(env.as(vera, (s) => s.rpc('configure_storefront', { p_business_id: bizA, p_enabled: true }))).rejects.toThrow(/Somente sócias/);
    await expect(env.as(zeca, (s) => s.rpc('configure_storefront', { p_business_id: bizA, p_enabled: true }))).rejects.toThrow(/Acesso negado/);
    await expect(env.anon((s) => s.rpc('configure_storefront', { p_business_id: bizA, p_enabled: true }))).rejects.toThrow(/permission denied/);

    token = await ownerSession((s) => s.rpc<string>('configure_storefront', { p_business_id: bizA, p_enabled: true }));
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const audit = await env.admin().one<{ details: Record<string, unknown> }>(
      `select details from public.audit_logs where business_id = $1 and action = 'business.storefront_configured'`,
      [bizA],
    );
    expect(audit.details).toEqual({ ativo: true, antes_ativo: false, link_trocado: false });
    expect(JSON.stringify(audit.details)).not.toContain(token);
  });

  it('vitrine mostra só produtos ativos com preço, datas e PIX quando cadastrado', async () => {
    const shown = await env.anon((s) => s.rpc<Record<string, unknown>>('storefront', { p_token: token }));
    const products = shown.products as Array<{ id: string; name: string; price_cents: number }>;
    expect(products.map((p) => p.name).sort()).toEqual(['Bolo de pote', 'Surpresa de uva', 'Torta de limão']);
    expect(products.some((p) => p.id === morango)).toBe(false);
    expect(Object.keys(products[0]!).sort()).toEqual(['category', 'description', 'id', 'name', 'price_cents', 'unit']);
    expect(shown).toMatchObject({ business_name: 'Magi Doces', today, due_day: 10, next_due_date: nextDay10(today), max_due_date: addDays(today, 90), pix: null });

    await ownerSession((s) => s.query(`update public.businesses set pix_key = ' gihramos92@gmail.com ', pix_city = 'Curitiba' where id = $1`, [bizA]));
    const withPix = await env.anon((s) => s.rpc<Record<string, unknown>>('storefront', { p_token: token }));
    expect(withPix.pix).toEqual({ key: 'gihramos92@gmail.com', name: 'Magi Doces', city: 'Curitiba' });
  });
});

describe('cliente anota a compra', () => {
  it('cliente nova: cria o cadastro e a venda marcada para revisão', async () => {
    const receipt = await purchase({ items: [{ product_id: bolo, quantity: 2 }, { product_id: torta, quantity: 1 }] });
    expect(receipt).toMatchObject({
      due_date: nextDay10(today),
      payment: 'due_day',
      total_cents: 3900,
      balance_cents: 3900,
      customer_first_name: 'Joana',
      code_status: 'can_create',
      reported_paid: false,
    });
    expect(receipt.items.map((i) => [i.name, n(i.quantity), i.total_cents])).toEqual([
      ['Bolo de pote', 2, 2400],
      ['Torta de limão', 1, 1500],
    ]);

    const sale = await env.admin().one<Record<string, unknown>>(
      `select s.source, s.self_service_review_pending, s.created_by, s.payment_method, s.sale_date::text, c.name as customer, c.phone, c.notes
       from public.sales s join public.customers c on c.id = s.customer_id where s.id = $1`,
      [receipt.sale_id],
    );
    expect(sale).toMatchObject({
      source: 'self_service',
      self_service_review_pending: true,
      created_by: null,
      payment_method: null,
      sale_date: today,
      customer: 'Joana Silva',
      phone: '(11) 98765-4321',
    });
    const audit = await env.admin().one<{ actor_id: string | null; details: Record<string, unknown> }>(
      `select actor_id, details from public.audit_logs where entity_id = $1 and action = 'sale.created'`,
      [receipt.sale_id],
    );
    expect(audit.actor_id).toBeNull();
    expect(audit.details).toMatchObject({ origem: 'link_publico', contato_informado: { nome: 'Joana Silva', celular: '11987654321' } });
  });

  it('reenvio com o mesmo identificador devolve a mesma compra', async () => {
    const requestId = crypto.randomUUID();
    const first = await purchase({ phone: '11 90000-0001', name: 'Rita' }, requestId);
    const again = await purchase({ phone: '11 90000-0001', name: 'Rita', items: [{ product_id: torta, quantity: 9 }] }, requestId);
    expect(again.sale_id).toBe(first.sale_id);
    expect(again.total_cents).toBe(1200);
    const count = await env.admin().one<{ c: number }>(`select count(*)::int as c from public.sales where client_request_id = $1`, [requestId]);
    expect(count.c).toBe(1);
  });

  it('preço, desconto e custo vêm do cadastro, nunca da cliente', async () => {
    const receipt = await purchase({
      phone: '11 90000-0002',
      items: [{ product_id: bolo, quantity: 3, unit_price_cents: 1, discount_cents: 3000, price_inferred: true }],
      discount_cents: 3600,
      payment_method: 'dinheiro',
    });
    expect(receipt.total_cents).toBe(3600);
    const item = await env.admin().one<{ unit_price_cents: number; discount_cents: number; price_inferred: boolean }>(
      `select unit_price_cents, discount_cents, price_inferred from public.sale_items where sale_id = $1`,
      [receipt.sale_id],
    );
    expect(item).toEqual({ unit_price_cents: 1200, discount_cents: 0, price_inferred: false });
  });

  it('valida produtos, quantidades, dados e datas', async () => {
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ items: [{ product_id: morango, quantity: 1 }] }, /não está mais disponível/],
      [{ items: [{ product_id: tortaB, quantity: 1 }] }, /não está mais disponível/],
      [{ items: [{ product_id: 'not-a-uuid', quantity: 1 }] }, /Produto inválido/],
      [{ items: [{ product_id: bolo, quantity: 0 }] }, /de 1 a 50/],
      [{ items: [{ product_id: bolo, quantity: 51 }] }, /de 1 a 50/],
      [{ items: [{ product_id: bolo, quantity: 1.5 }] }, /Quantidade inválida/],
      [{ items: [{ product_id: bolo, quantity: '2' }] }, /Quantidade inválida/],
      [{ items: [{ product_id: bolo, quantity: 1 }, { product_id: bolo, quantity: 1 }] }, /duas vezes/],
      [{ items: [] }, /pelo menos um produto/],
      [{ items: Array.from({ length: 21 }, () => ({ product_id: bolo, quantity: 1 })) }, /no máximo 20/],
      [{ items: [{ product_id: uva, quantity: 17 }] }, /acima de R\$ 5\.000,00/],
      [{ name: 'J' }, /Informe seu nome/],
      [{ phone: '98765-4321' }, /celular com DDD/],
      [{ phone: 'abc' }, /celular com DDD/],
      [{ payment: 'fiado' }, /quando vai pagar/],
      [{ payment: 'date', due_date: addDays(today, -1) }, /entre hoje e os próximos 90 dias/],
      [{ payment: 'date', due_date: addDays(today, 91) }, /entre hoje e os próximos 90 dias/],
      [{ payment: 'date', due_date: 'amanhã' }, /Escolha a data/],
      [{ notes: 'x'.repeat(301) }, /no máximo 300/],
    ];
    for (const [fields, error] of cases) {
      await expect(purchase({ phone: '11 90000-0003', ...fields }), JSON.stringify(fields).slice(0, 80)).rejects.toThrow(error);
    }
    // Nada ficou gravado pelas tentativas inválidas (nem cliente novo).
    const leftovers = await env.admin().query(`select 1 from public.customers where phone = '(11) 90000-0003'`);
    expect(leftovers).toEqual([]);
  });

  it('datas: agora (hoje, PIX), outra data dentro de 90 dias', async () => {
    const now = await purchase({ phone: '11 90000-0004', payment: 'now' });
    expect(now).toMatchObject({ due_date: today, payment: 'now', pix: { key: 'gihramos92@gmail.com' } });
    const method = await env.admin().one<{ payment_method: string }>(`select payment_method from public.sales where id = $1`, [now.sale_id]);
    expect(method.payment_method).toBe('pix');

    const later = await purchase({ phone: '11 90000-0004', payment: 'date', due_date: addDays(today, 90) });
    expect(later.due_date).toBe(addDays(today, 90));
  });

  it('celular já cadastrado: usa a cliente existente sem alterar o nome', async () => {
    const existing = await ownerSession((s) =>
      s.one<{ id: string }>(`insert into public.customers (business_id, name, phone) values ($1, 'Maria Antiga', '11 91234-5678') returning id`, [bizA]),
    );
    const receipt = await purchase({ name: 'Mari', phone: '+55 (11) 91234-5678' });
    const sale = await env.admin().one<{ customer_id: string; name: string }>(
      `select s.customer_id, c.name from public.sales s join public.customers c on c.id = s.customer_id where s.id = $1`,
      [receipt.sale_id],
    );
    expect(sale).toEqual({ customer_id: existing.id, name: 'Maria Antiga' });
    expect(receipt.code_status).toBe('ask_business');
  });

  it('link desligado ou trocado deixa de aceitar compras', async () => {
    await ownerSession((s) => s.rpc('configure_storefront', { p_business_id: bizA, p_enabled: false }));
    await expect(purchase({ phone: '11 90000-0005' })).rejects.toThrow(/não está mais disponível/);
    expect(await env.anon((s) => s.rpc('storefront', { p_token: token }))).toBeNull();

    const sameToken = await ownerSession((s) => s.rpc<string>('configure_storefront', { p_business_id: bizA, p_enabled: true }));
    expect(sameToken).toBe(token);
    const newToken = await ownerSession((s) => s.rpc<string>('configure_storefront', { p_business_id: bizA, p_enabled: true, p_regenerate: true }));
    expect(newToken).not.toBe(token);
    await expect(purchase({ phone: '11 90000-0005' })).rejects.toThrow(/não está mais disponível/);
    await expect(purchase({ phone: '11 90000-0005' }, crypto.randomUUID(), newToken)).resolves.toMatchObject({ total_cents: 1200 });
    token = newToken;
  });
});

describe('aviso de pagamento e revisão', () => {
  it('"já paguei" exige os identificadores da própria compra', async () => {
    const requestId = crypto.randomUUID();
    const receipt = await purchase({ phone: '11 90000-0006', payment: 'now' }, requestId);
    await expect(
      env.anon((s) => s.rpc('storefront_report_paid', { p_token: token, p_sale_id: receipt.sale_id, p_request_id: crypto.randomUUID() })),
    ).rejects.toThrow(/Compra não encontrada/);

    const reported = await env.anon((s) => s.rpc<Receipt>('storefront_report_paid', { p_token: token, p_sale_id: receipt.sale_id, p_request_id: requestId }));
    expect(reported.reported_paid).toBe(true);
    expect(reported.balance_cents).toBe(1200); // não é recebimento: a sócia confere e registra
    const view = await ownerSession((s) =>
      s.one<{ customer_reported_paid_at: string | null; balance_cents: number }>(`select customer_reported_paid_at, balance_cents from public.v_sales where id = $1`, [receipt.sale_id]),
    );
    expect(view.customer_reported_paid_at).not.toBeNull();
    const audit = await env.admin().query(`select 1 from public.audit_logs where entity_id = $1 and action = 'sale.customer_reported_paid'`, [receipt.sale_id]);
    expect(audit).toHaveLength(1);
  });

  it('owner/editor marcam como revisada; viewer não', async () => {
    const receipt = await purchase({ phone: '11 90000-0007' });
    await expect(env.as(vera, (s) => s.rpc('review_self_service_sale', { p_sale_id: receipt.sale_id }))).rejects.toThrow(/permissão/);
    await env.as(edu, (s) => s.rpc('review_self_service_sale', { p_sale_id: receipt.sale_id }));
    const sale = await env.admin().one<{ self_service_review_pending: boolean }>(`select self_service_review_pending from public.sales where id = $1`, [receipt.sale_id]);
    expect(sale.self_service_review_pending).toBe(false);
    const audit = await env.admin().one<{ actor_id: string }>(`select actor_id from public.audit_logs where entity_id = $1 and action = 'sale.reviewed'`, [receipt.sale_id]);
    expect(audit.actor_id).toBe(edu);
  });
});

describe('código de consulta e extrato', () => {
  const phone = '(21) 99876-5432';
  let firstSale: { id: string; requestId: string };

  it('cliente nova cria o próprio código (sem códigos óbvios, uma vez só)', async () => {
    const requestId = crypto.randomUUID();
    const receipt = await purchase({ name: 'Bruna Costa', phone, items: [{ product_id: bolo, quantity: 2 }] }, requestId);
    firstSale = { id: receipt.sale_id, requestId };
    const create = (code: string, sale = firstSale) =>
      env.anon((s) => s.rpc<Receipt>('storefront_create_code', { p_token: token, p_sale_id: sale.id, p_request_id: sale.requestId, p_code: code }));

    await expect(create('1234')).rejects.toThrow(/menos óbvio/);
    await expect(create('7777')).rejects.toThrow(/menos óbvio/);
    await expect(create('12a4')).rejects.toThrow(/4 números/);
    await expect(
      env.anon((s) => s.rpc('storefront_create_code', { p_token: token, p_sale_id: receipt.sale_id, p_request_id: crypto.randomUUID(), p_code: '4826' })),
    ).rejects.toThrow(/Compra não encontrada/);

    expect((await create('4826')).code_status).toBe('has_code');
    await expect(create('5937')).rejects.toThrow(/já tem um código/);

    // Segunda compra do mesmo celular: já tem código.
    const second = await purchase({ name: 'Bruna', phone: '21998765432', items: [{ product_id: torta, quantity: 1 }] });
    expect(second.code_status).toBe('has_code');
  });

  it('o código fica guardado só como hash; ninguém lê a tabela diretamente', async () => {
    const row = await env.admin().one<{ code_hash: string; code_salt: string; set_by: string }>(
      `select code_hash, code_salt, set_by from public.customer_access_codes where phone_digits = '21998765432'`,
    );
    expect(row.set_by).toBe('customer');
    expect(row.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.code_hash).not.toContain('4826');
    await expect(env.anon((s) => s.query(`select * from public.customer_access_codes`))).rejects.toThrow(/permission denied/);
    await expect(ownerSession((s) => s.query(`select * from public.customer_access_codes`))).rejects.toThrow(/permission denied/);
    await expect(ownerSession((s) => s.query(`select * from public.storefront_events`))).rejects.toThrow(/permission denied/);
  });

  it('extrato com celular + código mostra só as compras em aberto daquele celular', async () => {
    // Compra paga e compra cancelada não aparecem; outra cliente também não.
    const paid = await purchase({ name: 'Bruna', phone, items: [{ product_id: bolo, quantity: 1 }] });
    const cancelled = await purchase({ name: 'Bruna', phone, items: [{ product_id: bolo, quantity: 1 }] });
    await ownerSession(async (s) => {
      await s.rpc('register_payment', { p_sale_id: paid.sale_id, p_request_id: crypto.randomUUID(), p_amount_cents: 1200, p_paid_on: today, p_method: 'pix' });
      await s.rpc('cancel_sale', { p_sale_id: cancelled.sale_id, p_reason: 'Anotada por engano' });
    });

    const result = await statement('21 99876 5432', '4826');
    expect(result).toMatchObject({ status: 'ok', customer_first_name: 'Bruna', balance_cents: 2400 + 1500, overdue_cents: 0 });
    expect(result.sales?.map((sale) => sale.balance_cents)).toEqual([2400, 1500]);
    expect(Object.keys(result).sort()).toEqual(['balance_cents', 'customer_first_name', 'overdue_cents', 'pix', 'sales', 'status']);
  });

  it('código errado: 5 tentativas bloqueiam o celular por 15 minutos', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(await statement(phone, '0000')).toEqual({ status: 'invalid', attempts_left: 4 - attempt });
    }
    expect(await statement(phone, '4826')).toEqual({ status: 'locked', retry_minutes: 15 });
    // Celular sem código responde igual a código errado (não revela quem é cliente).
    expect(await statement('11 95555-0000', '4826')).toEqual({ status: 'invalid', attempts_left: 4 });
    expect(await statement('123', '4826')).toEqual({ status: 'invalid_input' });

    const info = await ownerSession(async (s) => {
      const customer = await s.one<{ id: string }>(`select id from public.customers where phone = '(21) 99876-5432'`);
      return s.rpc<Record<string, unknown>>('customer_access_code_info', { p_customer_id: customer.id });
    });
    expect(info).toMatchObject({ phone_valid: true, has_code: true, set_by: 'customer', locked: true });
  });

  it('sócia gera um código novo: desbloqueia e o antigo deixa de valer', async () => {
    const customerId = await ownerSession(async (s) => (await s.one<{ id: string }>(`select id from public.customers where phone = '(21) 99876-5432'`)).id);
    await expect(env.as(vera, (s) => s.rpc('set_customer_access_code', { p_customer_id: customerId }))).rejects.toThrow(/permissão/);
    await expect(env.as(zeca, (s) => s.rpc('set_customer_access_code', { p_customer_id: customerId }))).rejects.toThrow(/Acesso negado/);
    await expect(env.as(zeca, (s) => s.rpc('customer_access_code_info', { p_customer_id: customerId }))).rejects.toThrow(/Acesso negado/);

    const code = await ownerSession((s) => s.rpc<string>('set_customer_access_code', { p_customer_id: customerId }));
    expect(code).toMatch(/^\d{4}$/);
    expect((await statement(phone, code)).status).toBe('ok');
    if (code !== '4826') expect((await statement(phone, '4826')).status).toBe('invalid');

    const audit = await env.admin().one<{ details: Record<string, unknown> }>(
      `select details from public.audit_logs where entity_id = $1 and action = 'customer.access_code_set'`,
      [customerId],
    );
    expect(JSON.stringify(audit.details)).not.toContain(code);

    await ownerSession((s) => s.rpc('remove_customer_access_code', { p_customer_id: customerId }));
    expect((await statement(phone, code)).status).toBe('invalid');
  });

  it('cliente que a loja já tinha não cria código pelo link; a loja gera', async () => {
    const requestId = crypto.randomUUID();
    const receipt = await purchase({ name: 'Maria', phone: '11 91234-5678' }, requestId);
    await expect(
      env.anon((s) => s.rpc('storefront_create_code', { p_token: token, p_sale_id: receipt.sale_id, p_request_id: requestId, p_code: '4826' })),
    ).rejects.toThrow(/enviado pela loja/);
  });

  it('cliente sem celular válido: a loja não gera código', async () => {
    const customer = await ownerSession((s) => s.one<{ id: string }>(`insert into public.customers (business_id, name) values ($1, 'Sem Fone') returning id`, [bizA]));
    await expect(ownerSession((s) => s.rpc('set_customer_access_code', { p_customer_id: customer.id }))).rejects.toThrow(/Cadastre o celular/);
    expect(await ownerSession((s) => s.rpc('customer_access_code_info', { p_customer_id: customer.id }))).toEqual({ phone_valid: false, has_code: false });
  });
});

describe('limites de frequência', () => {
  it('no máximo 8 compras por celular por hora', async () => {
    for (let i = 0; i < 8; i += 1) await purchase({ phone: '31 98888-0000' });
    await expect(purchase({ phone: '31 98888-0000' })).rejects.toThrow(/Muitas compras/);
    await expect(purchase({ phone: '31 98888-0001' })).resolves.toMatchObject({ total_cents: 1200 });
  });

  it('no máximo 20 compras por origem (IP) por hora', async () => {
    const headers = { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' };
    for (let i = 0; i < 20; i += 1) await purchase({ phone: `41 97777-${String(i).padStart(4, '0')}` }, crypto.randomUUID(), token, headers);
    await expect(purchase({ phone: '41 97777-9999' }, crypto.randomUUID(), token, headers)).rejects.toThrow(/Muitas compras/);
    await expect(purchase({ phone: '41 97777-9999' }, crypto.randomUUID(), token, { 'x-forwarded-for': '198.51.100.7' })).resolves.toBeTruthy();
  });

  it('eventos guardam só hashes (nada de celular ou IP em texto)', async () => {
    const rows = await env.admin().query<{ subject: string }>(`select subject from public.storefront_events`);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.subject).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(JSON.stringify(rows)).not.toMatch(/31988880000|203\.0\.113\.9/);
  });
});
