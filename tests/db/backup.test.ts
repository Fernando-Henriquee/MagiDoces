import { pgDump } from '@electric-sql/pglite-tools/pg_dump';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, n, productId, TestEnv } from './env';

/**
 * Backup e restauração (docs/BACKUP.md): dump somente de dados com os mesmos
 * parâmetros de scripts/backup-db.sh, restaurado num banco novo com as migrations
 * e os gatilhos suspensos (session_replication_role = replica). Os totais, saldos
 * e o histórico precisam sair idênticos, e o sistema precisa continuar operando.
 */

export const BACKUP_ARGS = [
  '--data-only',
  '--no-owner',
  '--no-privileges',
  '--schema=public',
  // Atenção: não usar --table junto com --schema (o pg_dump passaria a exportar só a tabela).
  // Dependem das contas do Auth (fora do dump): recriadas pelo provisionamento.
  '--exclude-table-data=public.business_members',
  '--exclude-table-data=public.profiles',
];

let source: TestEnv;
let target: TestEnv;
let dumpSql: string;
let businessId: string;

const snapshot = async (env: TestEnv) => {
  const admin = env.admin();
  const sales = await admin.query<{ id: string; total_cents: string; net_paid_cents: string; balance_cents: string; payment_status: string; cost_total_cents: string }>(
    `select id, total_cents, net_paid_cents, balance_cents, payment_status, cost_total_cents from public.v_sales order by id`,
  );
  const bills = await admin.query<{ id: string; total_cents: string; paid_cents: string; scheduled_cents: string }>(
    `select id, total_cents, paid_cents, scheduled_cents from public.v_bills order by id`,
  );
  const counts = await admin.one<Record<string, number>>(`
    select (select count(*)::int from public.audit_logs) as audit, (select count(*)::int from public.payments) as payments,
           (select count(*)::int from public.product_price_history) as price_history, (select count(*)::int from public.import_rows) as import_rows`);
  return { sales: sales.map((s) => ({ ...s, total_cents: n(s.total_cents), net_paid_cents: n(s.net_paid_cents), balance_cents: n(s.balance_cents), cost_total_cents: n(s.cost_total_cents) })), bills: bills.map((b) => ({ ...b, total_cents: n(b.total_cents), paid_cents: n(b.paid_cents), scheduled_cents: n(b.scheduled_cents) })), counts };
};

beforeAll(async () => {
  source = await TestEnv.create();
  const ana = await source.createUser('ana@example.com', 'Ana');
  businessId = await source.createBusiness('Magi Doces', [{ userId: ana, role: 'owner' }]);
  const today = await source.today();
  await source.as(ana, async (s) => {
    const bolo = await productId(s, businessId, 'Bolo de pote');
    await s.query(`update public.products set price_cents = 1200, manual_unit_cost_cents = 450 where id = $1`, [bolo]);
    const saleId = await s.rpc<string>('create_sale', {
      p_business_id: businessId,
      p_request_id: crypto.randomUUID(),
      p_sale: { sale_date: today, discount_cents: 300, new_customer: { name: 'Maria' }, items: [{ product_id: bolo, quantity: 3 }], payment: { amount_cents: 1000, method: 'pix' } },
    });
    await s.rpc('register_refund', { p_sale_id: saleId, p_request_id: crypto.randomUUID(), p_amount_cents: 200, p_paid_on: today, p_method: 'pix', p_notes: 'Troco devolvido' });
    await s.rpc('create_purchase', {
      p_business_id: businessId,
      p_request_id: crypto.randomUUID(),
      p_purchase: {
        purchase_date: today, description: 'Insumos', new_supplier_name: 'Atacado',
        items: [{ description: 'Farinha', quantity: 10, unit: 'kg', unit_price_cents: 500 }],
        plan: { mode: 'installments', count: 3, first_due_date: addDays(today, 30) },
      },
    });
    await s.rpc('import_sales_batch', {
      p_business_id: businessId,
      p_batch: { file_name: 'antiga.xlsx', file_sha256: 'c'.repeat(64), layout: 'wide' },
      p_rows: [{ row_number: 2, raw: { Cliente: 'João' }, fingerprint: 'fp-1', action: 'import', sale: { customer_name: 'João', sale_date: '2025-03-05', items: [{ product_id: bolo, quantity: 1, unit_price_cents: 1200 }], payment: { status: 'unknown' } } }],
    });
  });

  const file = await pgDump({ pg: source.db, args: BACKUP_ARGS });
  dumpSql = await file.text();
  // O pg_dump roda na mesma conexão do PGlite: desfaz as configurações de sessão dele.
  await source.db.exec('reset all');

  target = await TestEnv.create();
  // Restauração com gatilhos suspensos, como em docs/BACKUP.md (o psql encerra a sessão ao final).
  await target.db.exec(`set session_replication_role = replica;\n${dumpSql}`);
  await target.db.exec('reset all');
});

afterAll(async () => {
  await source?.close();
  await target?.close();
});

describe('backup e restauração', () => {
  it('o dump não contém contas, membros nem perfis', () => {
    expect(dumpSql).not.toMatch(/INSERT INTO public\.business_members/);
    expect(dumpSql).not.toMatch(/INSERT INTO public\.profiles/);
    expect(dumpSql).not.toMatch(/auth\.users/);
    expect(dumpSql).toMatch(/INSERT INTO public\.sales/);
  });

  it('restaura vendas, saldos, contas a pagar e histórico idênticos', async () => {
    const before = await snapshot(source);
    const after = await snapshot(target);
    expect(after.sales).toEqual(before.sales);
    expect(after.bills).toEqual(before.bills);
    expect(after.counts).toEqual(before.counts);
    // 3 × 12,00 − 3,00 = 33,00; recebido 10,00 − 2,00 de reembolso
    expect(after.sales.find((s) => s.total_cents === 3300)).toMatchObject({ net_paid_cents: 800, balance_cents: 2500, payment_status: 'partial' });
  });

  it('o sistema continua operando após restaurar e reassociar as usuárias', async () => {
    const bia = await target.createUser('bia@example.com', 'Bia');
    await target.admin().query(`insert into public.business_members (business_id, user_id, role) values ($1, $2, 'owner')`, [businessId, bia]);
    const today = await target.today();
    const result = await target.as(bia, async (s) => {
      const visible = await s.query(`select 1 from public.v_sales where business_id = $1`, [businessId]);
      const bolo = await productId(s, businessId, 'Bolo de pote');
      const saleId = await s.rpc<string>('create_sale', {
        p_business_id: businessId,
        p_request_id: crypto.randomUUID(),
        p_sale: { sale_date: today, items: [{ product_id: bolo, quantity: 1 }] },
      });
      const sale = await s.one<{ total_cents: string; cost_total_cents: string }>(`select total_cents, cost_total_cents from public.v_sales where id = $1`, [saleId]);
      return { visible: visible.length, sale };
    });
    expect(result.visible).toBe(2);
    expect(n(result.sale.total_cents)).toBe(1200);
    expect(n(result.sale.cost_total_cents)).toBe(450);
    // Sequências restauradas: a auditoria continua numerando sem colisão.
    const audit = await target.admin().one<{ c: number }>(`select count(*)::int as c from public.audit_logs`);
    expect(audit.c).toBeGreaterThan(0);
  });

  it('reimportar o mesmo arquivo depois da restauração continua idempotente', async () => {
    const bia = (await target.admin().one<{ id: string }>(`select id from auth.users where email = 'bia@example.com'`)).id;
    const bolo = await target.as(bia, (s) => productId(s, businessId, 'Bolo de pote'));
    const result = await target.as(bia, (s) =>
      s.rpc<Record<string, number>>('import_sales_batch', {
        p_business_id: businessId,
        p_batch: { file_name: 'antiga.xlsx', file_sha256: 'c'.repeat(64), layout: 'wide' },
        p_rows: [{ row_number: 2, raw: {}, fingerprint: 'fp-1', action: 'import', sale: { customer_name: 'João', sale_date: '2025-03-05', items: [{ product_id: bolo, quantity: 1, unit_price_cents: 1200 }] } }],
      }),
    );
    expect(result).toMatchObject({ imported: 0, duplicates: 1 });
  });
});
