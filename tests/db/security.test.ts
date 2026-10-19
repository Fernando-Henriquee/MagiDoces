import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestEnv, productId } from './env';

/**
 * Segurança no banco: RLS, privilégios, isolamento entre negócios, papéis,
 * imutabilidade da auditoria e políticas do Storage.
 */

let env: TestEnv;
let ana: string; // owner do negócio A
let bia: string; // owner do negócio A (segunda sócia)
let edu: string; // editor do negócio A
let vera: string; // viewer do negócio A
let zeca: string; // owner do negócio B
let stranger: string; // usuário autenticado sem negócio
let bizA: string;
let bizB: string;

beforeAll(async () => {
  env = await TestEnv.create();
  ana = await env.createUser('ana@example.com', 'Ana');
  bia = await env.createUser('bia@example.com', 'Bia');
  edu = await env.createUser('edu@example.com', 'Edu');
  vera = await env.createUser('vera@example.com', 'Vera');
  zeca = await env.createUser('zeca@example.com', 'Zeca');
  stranger = await env.createUser('intruso@example.com');
  bizA = await env.createBusiness('Magi Doces', [
    { userId: ana, role: 'owner' },
    { userId: bia, role: 'owner' },
    { userId: edu, role: 'editor' },
    { userId: vera, role: 'viewer' },
  ]);
  bizB = await env.createBusiness('Outra Confeitaria', [{ userId: zeca, role: 'owner' }]);

  // Dados no negócio B, criados pelo dono de B.
  await env.as(zeca, async (s) => {
    await s.query(`insert into public.customers (business_id, name) values ($1, 'Cliente de B')`, [bizB]);
    const torta = await productId(s, bizB, 'Torta de limão');
    await s.rpc('create_sale', {
      p_business_id: bizB,
      p_request_id: crypto.randomUUID(),
      p_sale: { sale_date: '2026-10-01', items: [{ product_id: torta, quantity: 1, unit_price_cents: 1500 }] },
    });
  });
});

afterAll(async () => {
  await env.close();
});

describe('catálogo do banco', () => {
  it('toda tabela do schema public tem RLS habilitada', async () => {
    const rows = await env.admin().query<{ relname: string }>(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(rows).toEqual([]);
  });

  it('anon não tem nenhum privilégio em tabelas ou views do public', async () => {
    const rows = await env.admin().query<{ table_name: string; privilege_type: string }>(`
      select table_name, privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon', 'PUBLIC')`);
    expect(rows).toEqual([]);
  });

  it('anon não executa nenhuma função do public ou do private', async () => {
    const rows = await env.admin().query<{ proname: string }>(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute')`);
    expect(rows).toEqual([]);
  });

  it('authenticated não pode gravar diretamente nas tabelas financeiras', async () => {
    const rows = await env.admin().query<{ table_name: string; privilege_type: string }>(`
      select table_name, privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'authenticated'
        and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
        and table_name in ('sales', 'sale_items', 'payments', 'purchases', 'purchase_items', 'expenses',
                           'bill_payments', 'import_batches', 'import_rows', 'audit_logs', 'business_members',
                           'product_price_history')`);
    expect(rows).toEqual([]);
  });

  it('todas as views usam security_invoker', async () => {
    const rows = await env.admin().query<{ relname: string }>(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'v'
        and not coalesce((select bool_or(opt = 'security_invoker=true') from unnest(c.reloptions) opt), false)`);
    expect(rows).toEqual([]);
  });

  it('funções SECURITY DEFINER fixam o search_path', async () => {
    const rows = await env.admin().query<{ proname: string }>(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
    expect(rows).toEqual([]);
  });
});

describe('isolamento entre negócios', () => {
  it('membro de A não enxerga nenhum dado de B', async () => {
    await env.as(ana, async (s) => {
      for (const table of ['customers', 'products', 'sales', 'sale_items', 'payments', 'audit_logs', 'v_sales', 'v_customer_summary']) {
        const rows = await s.query(`select 1 from public.${table} where business_id = $1`, [bizB]);
        expect(rows, table).toHaveLength(0);
      }
      const businesses = await s.query<{ id: string }>(`select id from public.businesses`);
      expect(businesses.map((b) => b.id)).toEqual([bizA]);
    });
  });

  it('usuário autenticado sem negócio não enxerga nada', async () => {
    await env.as(stranger, async (s) => {
      expect(await s.query(`select 1 from public.businesses`)).toHaveLength(0);
      expect(await s.query(`select 1 from public.products`)).toHaveLength(0);
      expect(await s.query(`select 1 from public.v_sales`)).toHaveLength(0);
    });
  });

  it('membro de A não consegue gravar no negócio B', async () => {
    await expect(
      env.as(ana, (s) => s.query(`insert into public.customers (business_id, name) values ($1, 'Invasão')`, [bizB])),
    ).rejects.toThrow(/row-level security/);

    const tortaB = await env.as(zeca, (s) => productId(s, bizB, 'Torta de limão'));
    await expect(
      env.as(ana, (s) =>
        s.rpc('create_sale', {
          p_business_id: bizB,
          p_request_id: crypto.randomUUID(),
          p_sale: { sale_date: '2026-10-01', items: [{ product_id: tortaB, quantity: 1, unit_price_cents: 100 }] },
        }),
      ),
    ).rejects.toThrow(/Acesso negado/);
  });

  it('não é possível usar produto ou cliente de outro negócio numa venda própria', async () => {
    const tortaB = await env.as(zeca, (s) => productId(s, bizB, 'Torta de limão'));
    const clienteB = await env.as(zeca, (s) =>
      s.one<{ id: string }>(`select id from public.customers where business_id = $1`, [bizB]),
    );
    await expect(
      env.as(ana, (s) =>
        s.rpc('create_sale', {
          p_business_id: bizA,
          p_request_id: crypto.randomUUID(),
          p_sale: { sale_date: '2026-10-01', items: [{ product_id: tortaB, quantity: 1, unit_price_cents: 100 }] },
        }),
      ),
    ).rejects.toThrow(/Produto não encontrado/);

    const boloA = await env.as(ana, (s) => productId(s, bizA, 'Bolo de pote'));
    await expect(
      env.as(ana, (s) =>
        s.rpc('create_sale', {
          p_business_id: bizA,
          p_request_id: crypto.randomUUID(),
          p_sale: {
            customer_id: clienteB.id,
            sale_date: '2026-10-01',
            items: [{ product_id: boloA, quantity: 1, unit_price_cents: 100 }],
          },
        }),
      ),
    ).rejects.toThrow(/Cliente não encontrado/);
  });

  it('chave estrangeira composta impede referência cruzada mesmo para o superusuário', async () => {
    const tortaB = await env.as(zeca, (s) => productId(s, bizB, 'Torta de limão'));
    await expect(
      env.admin().query(`insert into public.recipes (business_id, product_id, yield_quantity) values ($1, $2, 1)`, [bizA, tortaB]),
    ).rejects.toThrow(/foreign key/);
  });

  it('anon não lê nada', async () => {
    await expect(env.anon((s) => s.query(`select * from public.customers`))).rejects.toThrow(/permission denied/);
    await expect(env.anon((s) => s.query(`select * from public.v_sales`))).rejects.toThrow(/permission denied/);
    await expect(
      env.anon((s) => s.rpc('dashboard_summary', { p_business_id: bizA, p_from: '2026-01-01', p_to: '2026-12-31' })),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('papéis dos membros', () => {
  it('as duas sócias (owners) compartilham os mesmos dados', async () => {
    await env.as(ana, (s) => s.query(`insert into public.customers (business_id, name) values ($1, 'Maria')`, [bizA]));
    const seenByBia = await env.as(bia, (s) =>
      s.query<{ name: string }>(`select name from public.customers where business_id = $1 and name = 'Maria'`, [bizA]),
    );
    expect(seenByBia).toHaveLength(1);
  });

  it('viewer lê, mas não grava', async () => {
    await env.as(vera, async (s) => {
      expect((await s.query(`select 1 from public.products where business_id = $1`, [bizA])).length).toBeGreaterThan(0);
    });
    await expect(
      env.as(vera, (s) => s.query(`insert into public.customers (business_id, name) values ($1, 'X')`, [bizA])),
    ).rejects.toThrow(/row-level security/);
    const bolo = await env.as(vera, (s) => productId(s, bizA, 'Bolo de pote'));
    await expect(
      env.as(vera, (s) =>
        s.rpc('create_sale', {
          p_business_id: bizA,
          p_request_id: crypto.randomUUID(),
          p_sale: { sale_date: '2026-10-01', items: [{ product_id: bolo, quantity: 1, unit_price_cents: 100 }] },
        }),
      ),
    ).rejects.toThrow(/permissão/);
  });

  it('editor opera vendas mas não altera configurações do negócio', async () => {
    const bolo = await env.as(edu, (s) => productId(s, bizA, 'Bolo de pote'));
    const saleId = await env.as(edu, (s) =>
      s.rpc<string>('create_sale', {
        p_business_id: bizA,
        p_request_id: crypto.randomUUID(),
        p_sale: { sale_date: '2026-10-01', items: [{ product_id: bolo, quantity: 1, unit_price_cents: 800 }] },
      }),
    );
    expect(saleId).toMatch(/^[0-9a-f-]{36}$/);
    const updated = await env.as(edu, (s) =>
      s.query(`update public.businesses set name = 'Hack' where id = $1 returning id`, [bizA]),
    );
    expect(updated).toHaveLength(0);
  });

  it('viewer não vê a auditoria; owner vê', async () => {
    expect(await env.as(vera, (s) => s.query(`select 1 from public.audit_logs where business_id = $1`, [bizA]))).toHaveLength(0);
    expect(
      (await env.as(ana, (s) => s.query(`select 1 from public.audit_logs where business_id = $1`, [bizA]))).length,
    ).toBeGreaterThan(0);
  });

  it('não é possível se promover ou se adicionar a outro negócio', async () => {
    await expect(
      env.as(vera, (s) => s.query(`update public.business_members set role = 'owner' where user_id = $1`, [vera])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      env.as(stranger, (s) =>
        s.query(`insert into public.business_members (business_id, user_id, role) values ($1, $2, 'owner')`, [bizA, stranger]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('gravação direta em tabelas financeiras é negada', async () => {
    await expect(
      env.as(ana, (s) => s.query(`update public.sales set total_cents = 0 where business_id = $1`, [bizA])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      env.as(ana, (s) => s.query(`delete from public.payments where business_id = $1`, [bizA])),
    ).rejects.toThrow(/permission denied/);
  });

  it('cliente não consegue alterar business_id nem falsificar autoria', async () => {
    await expect(
      env.as(ana, (s) => s.query(`update public.customers set business_id = $1 where business_id = $2`, [bizB, bizA])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      env.as(ana, (s) =>
        s.query(`insert into public.customers (business_id, name, created_by) values ($1, 'Y', $2)`, [bizA, bia]),
      ),
    ).rejects.toThrow(/permission denied/);
    const row = await env.as(ana, (s) =>
      s.one<{ created_by: string }>(`insert into public.customers (business_id, name) values ($1, 'Z') returning created_by`, [bizA]),
    );
    expect(row.created_by).toBe(ana);
  });
});

describe('perfis', () => {
  it('membro vê o perfil da sócia, mas não de usuários de outro negócio', async () => {
    const names = await env.as(ana, (s) => s.query<{ display_name: string }>(`select display_name from public.profiles order by 1`));
    expect(names.map((p) => p.display_name)).toEqual(['Ana', 'Bia', 'Edu', 'Vera']);
  });

  it('usuário só altera o próprio perfil', async () => {
    const changed = await env.as(ana, (s) =>
      s.query(`update public.profiles set display_name = 'X' where id = $1 returning id`, [bia]),
    );
    expect(changed).toHaveLength(0);
    const own = await env.as(ana, (s) =>
      s.query(`update public.profiles set display_name = 'Ana Paula' where id = $1 returning id`, [ana]),
    );
    expect(own).toHaveLength(1);
  });
});

describe('auditoria imutável', () => {
  it('usuários não alteram nem apagam registros de auditoria', async () => {
    await expect(env.as(ana, (s) => s.query(`update public.audit_logs set action = 'x'`))).rejects.toThrow(/permission denied/);
    await expect(env.as(ana, (s) => s.query(`delete from public.audit_logs`))).rejects.toThrow(/permission denied/);
    await expect(
      env.as(ana, (s) =>
        s.query(`insert into public.audit_logs (business_id, action, entity) values ($1, 'fake', 'sale')`, [bizA]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('nem o superusuário consegue editar um registro de auditoria', async () => {
    await expect(env.admin().query(`update public.audit_logs set action = 'x'`)).rejects.toThrow(/não pode ser alterado/);
  });
});

describe('storage', () => {
  it('membro grava arquivos somente na pasta do próprio negócio', async () => {
    await env.as(ana, (s) =>
      s.query(`insert into storage.objects (bucket_id, name) values ('receipts', $1)`, [`${bizA}/nota.pdf`]),
    );
    await expect(
      env.as(ana, (s) => s.query(`insert into storage.objects (bucket_id, name) values ('receipts', $1)`, [`${bizB}/x.pdf`])),
    ).rejects.toThrow(/row-level security/);
    await expect(
      env.as(ana, (s) => s.query(`insert into storage.objects (bucket_id, name) values ('receipts', 'sem-pasta.pdf')`)),
    ).rejects.toThrow(/row-level security/);
  });

  it('viewer lê, mas não envia arquivos; outro negócio não lê', async () => {
    expect(await env.as(vera, (s) => s.query(`select 1 from storage.objects where bucket_id = 'receipts'`))).toHaveLength(1);
    await expect(
      env.as(vera, (s) => s.query(`insert into storage.objects (bucket_id, name) values ('receipts', $1)`, [`${bizA}/v.pdf`])),
    ).rejects.toThrow(/row-level security/);
    expect(await env.as(zeca, (s) => s.query(`select 1 from storage.objects where bucket_id = 'receipts'`))).toHaveLength(0);
  });
});
