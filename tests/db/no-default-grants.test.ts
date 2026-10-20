import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { n, productId, TestEnv } from './env';

/**
 * Projeto criado com "Automatically expose new tables" DESLIGADO (recomendado):
 * nenhum privilégio automático. O sistema precisa funcionar só com as
 * concessões explícitas das migrations.
 */

let env: TestEnv;
let ana: string;

beforeAll(async () => {
  env = await TestEnv.create({ defaultGrants: false });
  ana = await env.createUser('ana@example.com', 'Ana');
});

afterAll(async () => {
  await env.close();
});

describe('sem privilégios automáticos do Supabase', () => {
  let businessId: string;

  it('provisionamento com a service_role (como scripts/provision-users.ts)', async () => {
    businessId = await env.serviceRole(async (s) => {
      const business = await s.one<{ id: string }>(`insert into public.businesses (name) values ('Magi Doces') returning id`);
      await s.query(`insert into public.products (business_id, name, category, unit) values ($1, 'Bolo de pote', 'Doces', 'un')`, [business.id]);
      await s.query(
        `insert into public.business_members (business_id, user_id, role) values ($1, $2, 'owner')
         on conflict (business_id, user_id) do update set role = excluded.role`,
        [business.id, ana],
      );
      return business.id;
    });
    expect(businessId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sócia cadastra, vende, recebe e consulta indicadores', async () => {
    const today = await env.today();
    const result = await env.as(ana, async (s) => {
      const bolo = await productId(s, businessId, 'Bolo de pote');
      await s.query(`update public.products set price_cents = 1200 where id = $1`, [bolo]);
      const customer = await s.one<{ id: string }>(`insert into public.customers (business_id, name) values ($1, 'Maria') returning id`, [businessId]);
      const saleId = await s.rpc<string>('create_sale', {
        p_business_id: businessId,
        p_request_id: crypto.randomUUID(),
        p_sale: { customer_id: customer.id, sale_date: today, items: [{ product_id: bolo, quantity: 2 }], payment: { amount_cents: 1000, method: 'pix' } },
      });
      const sale = await s.one<{ balance_cents: string; payment_status: string }>(`select balance_cents, payment_status from public.v_sales where id = $1`, [saleId]);
      const summary = await s.rpc<Record<string, number>>('dashboard_summary', { p_business_id: businessId, p_from: today, p_to: today });
      const audit = await s.query(`select 1 from public.audit_logs where business_id = $1`, [businessId]);
      return { sale, summary, audit: audit.length };
    });
    expect(n(result.sale.balance_cents)).toBe(1400);
    expect(result.sale.payment_status).toBe('partial');
    expect(n(result.summary.revenue_cents)).toBe(2400);
    expect(result.audit).toBeGreaterThan(0);
  });

  it('link de compras funciona para anon só com as concessões explícitas', async () => {
    const token = await env.as(ana, (s) => s.rpc<string>('configure_storefront', { p_business_id: businessId, p_enabled: true }));
    const bolo = await env.as(ana, (s) => productId(s, businessId, 'Bolo de pote'));
    const shown = await env.anon((s) => s.rpc<{ products: unknown[] }>('storefront', { p_token: token }));
    expect(shown.products).toHaveLength(1);
    const receipt = await env.anon((s) =>
      s.rpc<{ total_cents: number; code_status: string }>('storefront_register_purchase', {
        p_token: token,
        p_request_id: crypto.randomUUID(),
        p_purchase: { name: 'Joana', phone: '11 98765-4321', payment: 'now', items: [{ product_id: bolo, quantity: 1 }] },
      }),
    );
    expect(receipt).toMatchObject({ total_cents: 1200, code_status: 'can_create' });
  });

  it('anon continua sem acesso algum', async () => {
    await expect(env.anon((s) => s.query(`select * from public.v_sales`))).rejects.toThrow(/permission denied/);
    const grants = await env.admin().query(`select 1 from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'PUBLIC')`);
    expect(grants).toEqual([]);
  });

  it('a mesma verificação de catálogo vale neste modo: toda tabela com RLS', async () => {
    const rows = await env.admin().query(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(rows).toEqual([]);
  });
});
