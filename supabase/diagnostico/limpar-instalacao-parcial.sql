-- Magi Doces — LIMPA uma instalação PARCIAL para rodar a instalação completa de novo.
--
-- Use SOMENTE num projeto novo, sem dados reais. O script se recusa a rodar se
-- encontrar qualquer negócio, venda, cliente ou compra cadastrados.
-- Depois dele, rode supabase/.bundle/instalacao-completa.sql (npm run sql:bundle).
begin;

do $$
declare
  v_table text;
  v_has_rows boolean;
begin
  foreach v_table in array array['businesses', 'customers', 'products', 'sales', 'payments', 'purchases', 'expenses', 'import_batches', 'audit_logs'] loop
    if to_regclass('public.' || v_table) is not null then
      -- (EXECUTE não atualiza FOUND: o resultado precisa ser lido com INTO.)
      execute format('select exists (select 1 from public.%I)', v_table) into v_has_rows;
      if v_has_rows then
        raise exception 'A tabela % tem dados. Limpeza cancelada para não apagar informações.', v_table;
      end if;
    end if;
  end loop;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

drop policy if exists magi_files_select on storage.objects;
drop policy if exists magi_files_insert on storage.objects;
drop policy if exists magi_files_update on storage.objects;
drop policy if exists magi_files_delete on storage.objects;

drop view if exists public.v_business_members, public.v_customer_summary, public.v_bill_payments, public.v_bills,
  public.v_expenses, public.v_purchases, public.v_sale_items, public.v_payments, public.v_sales,
  public.v_products, public.v_recipe_costs, public.v_recipe_item_costs cascade;

drop table if exists public.import_rows, public.import_batches, public.bill_payments, public.expenses,
  public.purchase_items, public.purchases, public.payments, public.sale_items, public.sales,
  public.recipe_extra_costs, public.recipe_items, public.recipes, public.ingredients,
  public.product_price_history, public.products, public.suppliers, public.customers,
  public.audit_logs, public.profiles, public.business_members, public.businesses cascade;

do $$
declare
  v_fn record;
begin
  for v_fn in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_sale','update_sale','change_sale_due_date','cancel_sale','register_payment','register_refund',
                        'void_payment','confirm_sale_pending','create_purchase','update_purchase','create_expense',
                        'update_expense','cancel_bill','add_bill_payment','pay_bill_installment','void_bill_payment',
                        'import_sales_batch','import_existing_fingerprints','dashboard_summary','cash_flow_entries',
                        'report_sales_by_period','report_receipts_by_period','report_top_products','report_payables',
                        'report_ingredient_consumption')
  loop
    execute format('drop function if exists %s cascade', v_fn.signature);
  end loop;
end;
$$;

drop domain if exists public.payment_method cascade;
drop domain if exists public.measure_unit cascade;
drop schema if exists private cascade;

-- Os buckets de arquivos (product-photos, receipts) são mantidos: a instalação
-- os reaproveita ("on conflict do nothing").

commit;
