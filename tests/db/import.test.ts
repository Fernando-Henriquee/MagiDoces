import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { n, productId, TestEnv } from './env';

let env: TestEnv;
let ana: string;
let biz: string;
let bolo: string;
let torta: string;

const batch = {
  file_name: 'vendas-2025.xlsx',
  file_sha256: 'a'.repeat(64),
  file_size_bytes: 12345,
  sheet_name: 'Vendas',
  layout: 'wide',
  mapping: { date: 'Data', customer: 'Cliente' },
  rules: { missing_price: 'current_product_price' },
};

function rows() {
  return [
    {
      row_number: 2,
      raw: { Data: '05/03/2025', Cliente: 'Maria', 'Bolo de pote': 2, Pago: 'sim' },
      fingerprint: 'fp-maria-0503',
      action: 'import',
      inferred_fields: ['data_pagamento'],
      sale: {
        customer_name: 'Maria',
        sale_date: '2025-03-05',
        items: [{ product_id: bolo, quantity: 2, unit_price_cents: 1200 }],
        payment: { status: 'paid', paid_on: '2025-03-05', paid_on_inferred: true, method: 'outro' },
      },
    },
    {
      row_number: 3,
      raw: { Data: '06/03/2025', Cliente: 'joão ', 'Torta de limão': 1 },
      fingerprint: 'fp-joao-0603',
      action: 'import',
      inferred_fields: ['preco_unitario'],
      sale: {
        customer_name: 'joão ',
        sale_date: '2025-03-06',
        items: [{ product_id: torta, quantity: 1, unit_price_cents: 1500, price_inferred: true }],
        payment: { status: 'unknown' },
      },
    },
    {
      row_number: 4,
      raw: { Data: '', Cliente: '', 'Bolo de pote': '' },
      action: 'ignore',
      messages: ['Linha vazia'],
    },
    {
      row_number: 5,
      raw: { Data: '31/02/2025', Cliente: 'Ana' },
      action: 'invalid',
      messages: ['Data inválida'],
    },
  ];
}

function runImport(payloadRows: unknown[], payloadBatch = batch) {
  return env.as(ana, (s) =>
    s.rpc<Record<string, unknown>>('import_sales_batch', { p_business_id: biz, p_batch: payloadBatch, p_rows: payloadRows }),
  );
}

beforeAll(async () => {
  env = await TestEnv.create();
  ana = await env.createUser('ana@example.com');
  biz = await env.createBusiness('Magi Doces', [{ userId: ana, role: 'owner' }]);
  await env.as(ana, async (s) => {
    bolo = await productId(s, biz, 'Bolo de pote');
    torta = await productId(s, biz, 'Torta de limão');
    await s.query(`update public.products set manual_unit_cost_cents = 400 where id = $1`, [bolo]);
    // Cliente já existente com acento: "João" deve casar com "joão " da planilha.
    await s.query(`insert into public.customers (business_id, name) values ($1, 'João')`, [biz]);
  });
});

afterAll(async () => {
  await env.close();
});

describe('import_sales_batch', () => {
  it('importa vendas, registra linhas ignoradas e inválidas e o relatório do lote', async () => {
    const result = await runImport(rows());
    expect(result).toMatchObject({ imported: 2, duplicates: 0, ignored: 1, invalid: 1, created_customers: 1, inferred: 2 });

    const sales = await env.as(ana, (s) =>
      s.query<{ customer_name: string; total_cents: string; payment_status: string; payment_confirmation_pending: boolean; source: string }>(
        `select customer_name, total_cents, payment_status, payment_confirmation_pending, source
         from public.v_sales where business_id = $1 order by sale_date`,
        [biz],
      ),
    );
    expect(sales.map((s) => ({ ...s, total_cents: n(s.total_cents) }))).toEqual([
      { customer_name: 'Maria', total_cents: 2400, payment_status: 'paid', payment_confirmation_pending: false, source: 'import' },
      // Sem informação de pagamento: pendente de confirmação, nunca presumida paga.
      { customer_name: 'João', total_cents: 1500, payment_status: 'pending', payment_confirmation_pending: true, source: 'import' },
    ]);

    const payment = await env.as(ana, (s) =>
      s.one<{ is_inferred: boolean; import_batch_id: string }>(`select is_inferred, import_batch_id from public.payments`),
    );
    expect(payment).toEqual({ is_inferred: true, import_batch_id: result.batch_id });

    const items = await env.as(ana, (s) =>
      s.query<{ product_name: string; cost_source: string | null; price_inferred: boolean }>(
        `select product_name, cost_source, price_inferred from public.sale_items order by product_name`,
      ),
    );
    expect(items).toEqual([
      { product_name: 'Bolo de pote', cost_source: 'import_current', price_inferred: false },
      { product_name: 'Torta de limão', cost_source: null, price_inferred: true },
    ]);

    const importRows = await env.as(ana, (s) =>
      s.query<{ row_number: number; status: string }>(
        `select row_number, status from public.import_rows where batch_id = $1 order by row_number`,
        [result.batch_id],
      ),
    );
    expect(importRows).toEqual([
      { row_number: 2, status: 'imported' },
      { row_number: 3, status: 'imported' },
      { row_number: 4, status: 'ignored' },
      { row_number: 5, status: 'invalid' },
    ]);

    const batchRow = await env.as(ana, (s) =>
      s.one<{ file_name: string; created_by: string; imported_count: number }>(
        `select file_name, created_by, imported_count from public.import_batches where id = $1`,
        [result.batch_id],
      ),
    );
    expect(batchRow).toEqual({ file_name: 'vendas-2025.xlsx', created_by: ana, imported_count: 2 });

    // Um único evento de auditoria para o lote (sem um evento por venda importada).
    const audit = await env.as(ana, (s) =>
      s.query<{ action: string }>(`select action from public.audit_logs where entity <> 'member' order by id`),
    );
    expect(audit.map((a) => a.action)).toEqual(['import.completed']);
  });

  it('é idempotente: reprocessar o mesmo arquivo não duplica vendas', async () => {
    const result = await runImport(rows());
    expect(result).toMatchObject({ imported: 0, duplicates: 2 });
    const count = await env.as(ana, (s) => s.one<{ c: number }>(`select count(*)::int as c from public.sales`));
    expect(count.c).toBe(2);
    const duplicates = await env.as(ana, (s) =>
      s.query<{ messages: string[] }>(`select messages from public.import_rows where batch_id = $1 and status = 'duplicate'`, [
        result.batch_id,
      ]),
    );
    expect(duplicates[0]?.messages).toContain('Já importada anteriormente; nada foi alterado.');
  });

  it('não sobrescreve vendas já importadas que foram alteradas manualmente', async () => {
    const sale = await env.as(ana, (s) =>
      s.one<{ id: string }>(`select id from public.sales where import_fingerprint = 'fp-joao-0603'`),
    );
    await env.as(ana, (s) =>
      s.rpc('register_payment', {
        p_sale_id: sale.id, p_request_id: crypto.randomUUID(), p_amount_cents: 1500, p_paid_on: '2025-03-10', p_method: 'pix',
      }),
    );
    await runImport(rows());
    const v = await env.as(ana, (s) =>
      s.one<{ payment_status: string; payment_confirmation_pending: boolean }>(
        `select payment_status, payment_confirmation_pending from public.v_sales where id = $1`,
        [sale.id],
      ),
    );
    expect(v).toEqual({ payment_status: 'paid', payment_confirmation_pending: false });
  });

  it('é transacional: um erro em qualquer linha desfaz o lote inteiro', async () => {
    const bad = [
      {
        row_number: 2,
        raw: {},
        fingerprint: 'fp-novo-1',
        action: 'import',
        sale: { customer_name: 'Nova', sale_date: '2025-04-01', items: [{ product_id: bolo, quantity: 1, unit_price_cents: 1200 }] },
      },
      {
        row_number: 3,
        raw: {},
        fingerprint: 'fp-novo-2',
        action: 'import',
        sale: {
          customer_name: 'Outra',
          sale_date: '2025-04-02',
          items: [{ product_id: crypto.randomUUID(), quantity: 1, unit_price_cents: 100 }],
        },
      },
    ];
    await expect(runImport(bad, { ...batch, file_sha256: 'b'.repeat(64) })).rejects.toThrow(/Linha 3: Produto não encontrado/);
    const leftovers = await env.as(ana, (s) =>
      s.query(`select 1 from public.sales where import_fingerprint in ('fp-novo-1', 'fp-novo-2')`),
    );
    expect(leftovers).toHaveLength(0);
    const customers = await env.as(ana, (s) => s.query(`select 1 from public.customers where name in ('Nova', 'Outra')`));
    expect(customers).toHaveLength(0);
  });

  it('não inventa data de pagamento: exige que a regra de migração seja explícita', async () => {
    await expect(
      runImport([
        {
          row_number: 2,
          raw: {},
          fingerprint: 'fp-sem-data',
          action: 'import',
          sale: {
            sale_date: '2025-05-01',
            items: [{ product_id: bolo, quantity: 1, unit_price_cents: 1200 }],
            payment: { status: 'paid' },
          },
        },
      ]),
    ).rejects.toThrow(/data de pagamento ausente/);
  });

  it('valida limites e papéis', async () => {
    await expect(runImport([])).rejects.toThrow(/Nenhuma linha/);
    const viewer = await env.createUser('viewer@example.com');
    await env.admin().query(`insert into public.business_members values ($1, $2, 'viewer')`, [biz, viewer]);
    await expect(
      env.as(viewer, (s) => s.rpc('import_sales_batch', { p_business_id: biz, p_batch: batch, p_rows: rows() })),
    ).rejects.toThrow(/permissão/);
  });

  it('consulta de impressões digitais existentes para a prévia', async () => {
    const found = await env.as(ana, (s) =>
      s.query<{ fingerprint: string }>(`select fingerprint from public.import_existing_fingerprints($1, $2)`, [
        biz,
        ['fp-maria-0503', 'fp-inexistente'],
      ]),
    );
    expect(found.map((f) => f.fingerprint)).toEqual(['fp-maria-0503']);
  });
});
