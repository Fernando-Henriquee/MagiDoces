-- Magi Doces — verifica o que já está instalado no banco (somente leitura).
-- Cole no Supabase → SQL Editor → Run. Resultado esperado de uma instalação completa:
--   tabelas = 21, views = 12, funcoes_app = 25, todas as colunas "tem_..." = true.
--   (tem_1000_link_compras = false: falta aplicar só 20261020001000_storefront.sql.)
select
  (select count(*) from pg_tables where schemaname = 'public'
     and tablename in ('businesses','business_members','profiles','audit_logs','customers','suppliers','products',
                       'product_price_history','ingredients','recipes','recipe_items','recipe_extra_costs','sales',
                       'sale_items','payments','purchases','purchase_items','expenses','bill_payments',
                       'import_batches','import_rows')) as tabelas,
  (select count(*) from pg_views where schemaname = 'public' and viewname like 'v\_%') as views,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
     and p.proname in ('create_sale','update_sale','change_sale_due_date','cancel_sale','register_payment','register_refund',
                       'void_payment','confirm_sale_pending','create_purchase','update_purchase','create_expense',
                       'update_expense','cancel_bill','add_bill_payment','pay_bill_installment','void_bill_payment',
                       'import_sales_batch','import_existing_fingerprints','dashboard_summary','cash_flow_entries',
                       'report_sales_by_period','report_receipts_by_period','report_top_products','report_payables',
                       'report_ingredient_consumption')) as funcoes_app,
  exists (select 1 from pg_namespace where nspname = 'private') as tem_0100_fundacao,
  to_regclass('public.products') is not null as tem_0200_cadastros,
  to_regclass('public.sales') is not null as tem_0300_vendas,
  to_regclass('public.bill_payments') is not null as tem_0400_contas,
  to_regclass('public.import_batches') is not null as tem_0500_importacao,
  to_regclass('public.v_sales') is not null as tem_0600_views,
  exists (select 1 from storage.buckets where id = 'receipts') as tem_0700_storage,
  exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'magi_files_select') as tem_0700_politicas,
  case when to_regclass('public.businesses') is null then false
       else has_table_privilege('service_role', 'public.businesses', 'insert') end as tem_0900_privilegios,
  to_regclass('public.customer_access_codes') is not null as tem_1000_link_compras;
