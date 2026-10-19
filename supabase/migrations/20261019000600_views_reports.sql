-- =============================================================================
-- Magi Doces — 0600 Views de leitura, indicadores e relatórios
--
-- Todas as views usam security_invoker = true: respeitam a RLS de quem consulta.
-- Funções de leitura são SECURITY INVOKER e validam a associação ao negócio.
-- Fórmulas documentadas em docs/FINANCEIRO.md.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Vendas com recebido, saldo e situação derivados
-- -----------------------------------------------------------------------------

create view public.v_sales
with (security_invoker = true) as
select
  s.id,
  s.business_id,
  s.customer_id,
  c.name as customer_name,
  c.phone as customer_phone,
  s.sale_date,
  s.due_date,
  s.payment_method,
  s.discount_cents,
  s.items_subtotal_cents,
  s.items_discount_cents,
  s.total_cents,
  s.cost_total_cents,
  s.items_without_cost,
  s.notes,
  s.status,
  s.cancelled_at,
  s.cancel_reason,
  s.payment_confirmation_pending,
  s.source,
  s.import_batch_id,
  s.created_at,
  s.created_by,
  s.updated_at,
  pay.received_cents,
  pay.refunded_cents,
  pay.received_cents - pay.refunded_cents as net_paid_cents,
  case when s.status = 'cancelled' then 0 else s.total_cents - (pay.received_cents - pay.refunded_cents) end as balance_cents,
  pay.last_paid_on,
  case
    when s.status = 'cancelled' then 'cancelled'
    when s.total_cents - (pay.received_cents - pay.refunded_cents) <= 0 then 'paid'
    when pay.received_cents - pay.refunded_cents > 0 then 'partial'
    else 'pending'
  end as payment_status,
  (
    s.status = 'active'
    and s.total_cents - (pay.received_cents - pay.refunded_cents) > 0
    and s.due_date is not null
    and s.due_date < (now() at time zone b.timezone)::date
  ) as is_overdue,
  items.item_count,
  items.summary as items_summary
from public.sales s
join public.businesses b on b.id = s.business_id
left join public.customers c on c.id = s.customer_id
cross join lateral (
  select
    coalesce(sum(p.amount_cents) filter (where p.kind = 'receipt'), 0)::bigint as received_cents,
    coalesce(sum(p.amount_cents) filter (where p.kind = 'refund'), 0)::bigint as refunded_cents,
    max(p.paid_on) filter (where p.kind = 'receipt') as last_paid_on
  from public.payments p
  where p.sale_id = s.id and p.voided_at is null
) pay
cross join lateral (
  select
    count(*)::integer as item_count,
    string_agg(replace(trim_scale(i.quantity)::text, '.', ',') || '× ' || i.product_name, ', ' order by i.position) as summary
  from public.sale_items i
  where i.sale_id = s.id
) items;

-- Movimentações de recebimento (inclui estornadas, para histórico).
create view public.v_payments
with (security_invoker = true) as
select
  p.id,
  p.business_id,
  p.sale_id,
  p.kind,
  p.amount_cents,
  p.paid_on,
  p.method,
  p.notes,
  p.received_by,
  rb.display_name as received_by_name,
  p.created_at,
  p.voided_at,
  p.voided_by,
  vb.display_name as voided_by_name,
  p.void_reason,
  p.is_inferred,
  p.import_batch_id,
  s.sale_date,
  s.due_date as sale_due_date,
  s.total_cents as sale_total_cents,
  s.status as sale_status,
  s.customer_id,
  c.name as customer_name
from public.payments p
join public.sales s on s.id = p.sale_id
left join public.customers c on c.id = s.customer_id
left join public.profiles rb on rb.id = p.received_by
left join public.profiles vb on vb.id = p.voided_by;

-- Itens com dados da venda (relatórios por produto, histórico).
create view public.v_sale_items
with (security_invoker = true) as
select
  i.id,
  i.business_id,
  i.sale_id,
  i.product_id,
  i.position,
  i.product_name,
  i.unit,
  i.quantity,
  i.unit_price_cents,
  i.discount_cents,
  i.unit_cost_cents,
  i.cost_source,
  i.price_inferred,
  i.line_subtotal_cents,
  i.line_total_cents,
  i.line_cost_cents,
  s.sale_date,
  s.status as sale_status,
  s.customer_id
from public.sale_items i
join public.sales s on s.id = i.sale_id;

-- -----------------------------------------------------------------------------
-- Compras e despesas com pago, previsto, saldo e situação
-- -----------------------------------------------------------------------------

create view public.v_purchases
with (security_invoker = true) as
select
  p.id,
  p.business_id,
  p.purchase_date,
  p.supplier_id,
  sup.name as supplier_name,
  p.description,
  p.category,
  p.payment_method,
  p.due_date,
  p.receipt_path,
  p.notes,
  p.items_total_cents,
  p.extra_cents,
  p.discount_cents,
  p.total_cents,
  p.status,
  p.cancelled_at,
  p.cancel_reason,
  p.created_at,
  p.created_by,
  bp.paid_cents,
  bp.scheduled_cents,
  case when p.status = 'cancelled' then 0 else p.total_cents - bp.paid_cents end as balance_cents,
  case when p.status = 'cancelled' then 0 else greatest(p.total_cents - bp.paid_cents - bp.scheduled_cents, 0) end as unscheduled_cents,
  bp.next_due_date,
  bp.last_paid_on,
  bp.installment_count,
  case
    when p.status = 'cancelled' then 'cancelled'
    when p.total_cents - bp.paid_cents <= 0 then 'paid'
    when bp.paid_cents > 0 then 'partial'
    else 'pending'
  end as payment_status,
  (
    p.status = 'active' and p.total_cents - bp.paid_cents > 0 and (
      bp.overdue_scheduled_cents > 0
      or (p.total_cents - bp.paid_cents - bp.scheduled_cents > 0 and p.due_date is not null
          and p.due_date < (now() at time zone b.timezone)::date)
    )
  ) as is_overdue,
  items.item_count
from public.purchases p
join public.businesses b on b.id = p.business_id
left join public.suppliers sup on sup.id = p.supplier_id
cross join lateral (
  select
    coalesce(sum(x.amount_cents) filter (where x.paid_on is not null), 0)::bigint as paid_cents,
    coalesce(sum(x.amount_cents) filter (where x.paid_on is null), 0)::bigint as scheduled_cents,
    coalesce(sum(x.amount_cents) filter (where x.paid_on is null and x.due_date < (now() at time zone b.timezone)::date), 0)::bigint
      as overdue_scheduled_cents,
    min(x.due_date) filter (where x.paid_on is null) as next_due_date,
    max(x.paid_on) as last_paid_on,
    count(*)::integer as installment_count
  from public.bill_payments x
  where x.purchase_id = p.id and x.voided_at is null
) bp
cross join lateral (
  select count(*)::integer as item_count from public.purchase_items i where i.purchase_id = p.id
) items;

create view public.v_expenses
with (security_invoker = true) as
select
  e.id,
  e.business_id,
  e.expense_date,
  e.supplier_id,
  sup.name as supplier_name,
  e.description,
  e.category,
  e.amount_cents as total_cents,
  e.payment_method,
  e.due_date,
  e.receipt_path,
  e.notes,
  e.status,
  e.cancelled_at,
  e.cancel_reason,
  e.created_at,
  e.created_by,
  bp.paid_cents,
  bp.scheduled_cents,
  case when e.status = 'cancelled' then 0 else e.amount_cents - bp.paid_cents end as balance_cents,
  case when e.status = 'cancelled' then 0 else greatest(e.amount_cents - bp.paid_cents - bp.scheduled_cents, 0) end as unscheduled_cents,
  bp.next_due_date,
  bp.last_paid_on,
  bp.installment_count,
  case
    when e.status = 'cancelled' then 'cancelled'
    when e.amount_cents - bp.paid_cents <= 0 then 'paid'
    when bp.paid_cents > 0 then 'partial'
    else 'pending'
  end as payment_status,
  (
    e.status = 'active' and e.amount_cents - bp.paid_cents > 0 and (
      bp.overdue_scheduled_cents > 0
      or (e.amount_cents - bp.paid_cents - bp.scheduled_cents > 0 and e.due_date is not null
          and e.due_date < (now() at time zone b.timezone)::date)
    )
  ) as is_overdue
from public.expenses e
join public.businesses b on b.id = e.business_id
left join public.suppliers sup on sup.id = e.supplier_id
cross join lateral (
  select
    coalesce(sum(x.amount_cents) filter (where x.paid_on is not null), 0)::bigint as paid_cents,
    coalesce(sum(x.amount_cents) filter (where x.paid_on is null), 0)::bigint as scheduled_cents,
    coalesce(sum(x.amount_cents) filter (where x.paid_on is null and x.due_date < (now() at time zone b.timezone)::date), 0)::bigint
      as overdue_scheduled_cents,
    min(x.due_date) filter (where x.paid_on is null) as next_due_date,
    max(x.paid_on) as last_paid_on,
    count(*)::integer as installment_count
  from public.bill_payments x
  where x.expense_id = e.id and x.voided_at is null
) bp;

-- Contas a pagar unificadas (compras + despesas).
create view public.v_bills
with (security_invoker = true) as
select
  'purchase'::text as kind, id, business_id, purchase_date as bill_date, supplier_id, supplier_name, description,
  category, total_cents, paid_cents, scheduled_cents, balance_cents, unscheduled_cents, due_date, next_due_date,
  payment_status, is_overdue, status, payment_method, receipt_path, created_at
from public.v_purchases
union all
select
  'expense'::text, id, business_id, expense_date, supplier_id, supplier_name, description,
  category, total_cents, paid_cents, scheduled_cents, balance_cents, unscheduled_cents, due_date, next_due_date,
  payment_status, is_overdue, status, payment_method, receipt_path, created_at
from public.v_expenses;

create view public.v_bill_payments
with (security_invoker = true) as
select
  x.id,
  x.business_id,
  case when x.purchase_id is not null then 'purchase' else 'expense' end as kind,
  coalesce(x.purchase_id, x.expense_id) as bill_id,
  x.purchase_id,
  x.expense_id,
  x.installment_number,
  x.amount_cents,
  x.due_date,
  x.paid_on,
  x.method,
  x.notes,
  x.created_at,
  x.created_by,
  x.paid_by,
  pb.display_name as paid_by_name,
  x.voided_at,
  x.voided_by,
  x.void_reason,
  coalesce(p.description, e.description) as bill_description,
  coalesce(p.category, e.category) as bill_category,
  coalesce(p.status, e.status) as bill_status,
  sup.name as supplier_name,
  (x.paid_on is null and x.voided_at is null and x.due_date < (now() at time zone b.timezone)::date) as is_overdue
from public.bill_payments x
join public.businesses b on b.id = x.business_id
left join public.purchases p on p.id = x.purchase_id
left join public.expenses e on e.id = x.expense_id
left join public.suppliers sup on sup.id = coalesce(p.supplier_id, e.supplier_id)
left join public.profiles pb on pb.id = x.paid_by;

-- -----------------------------------------------------------------------------
-- Clientes com consolidado financeiro
-- -----------------------------------------------------------------------------

create view public.v_customer_summary
with (security_invoker = true) as
select
  c.id,
  c.business_id,
  c.name,
  c.phone,
  c.notes,
  c.active,
  c.created_at,
  coalesce(x.sales_count, 0)::integer as sales_count,
  coalesce(x.total_cents, 0)::bigint as total_purchased_cents,
  coalesce(x.net_paid_cents, 0)::bigint as total_paid_cents,
  coalesce(x.balance_cents, 0)::bigint as open_balance_cents,
  coalesce(x.overdue_cents, 0)::bigint as overdue_balance_cents,
  coalesce(x.open_sales_count, 0)::integer as open_sales_count,
  x.next_due_date,
  x.last_sale_date
from public.customers c
left join lateral (
  select
    count(*) filter (where vs.status = 'active') as sales_count,
    sum(vs.total_cents) filter (where vs.status = 'active') as total_cents,
    sum(vs.net_paid_cents) filter (where vs.status = 'active') as net_paid_cents,
    sum(vs.balance_cents) filter (where vs.status = 'active') as balance_cents,
    sum(vs.balance_cents) filter (where vs.is_overdue) as overdue_cents,
    count(*) filter (where vs.status = 'active' and vs.balance_cents > 0) as open_sales_count,
    min(vs.due_date) filter (where vs.status = 'active' and vs.balance_cents > 0) as next_due_date,
    max(vs.sale_date) filter (where vs.status = 'active') as last_sale_date
  from public.v_sales vs
  where vs.customer_id = c.id
) x on true;

-- Membros do negócio com nome de exibição (tela de configurações).
create view public.v_business_members
with (security_invoker = true) as
select m.business_id, m.user_id, m.role, m.created_at, p.display_name
from public.business_members m
left join public.profiles p on p.id = m.user_id;

-- -----------------------------------------------------------------------------
-- Funções auxiliares de leitura
-- -----------------------------------------------------------------------------

create function private.assert_period(p_from date, p_to date)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Período inválido.' using errcode = '22023';
  end if;
  if p_to - p_from > 3700 then
    raise exception 'Período muito longo (máximo de 10 anos).' using errcode = '22023';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Dashboard
--
--   revenue_cents            Faturamento: Σ total das vendas ativas com data no período
--   net_received_cents       Recebido: recebimentos − reembolsos com data de pagamento no período
--   cogs_cents               CMV estimado: Σ quantidade × custo unitário histórico dos itens
--   expenses_cents           Despesas operacionais incorridas (data de competência no período)
--   gross_profit_cents       Lucro bruto estimado = faturamento − CMV estimado
--   estimated_result_cents   Resultado estimado = faturamento − CMV estimado − despesas
--   purchases_cents          Compras registradas no período (NÃO entram no resultado)
--   cash_flow_cents          Fluxo de caixa = recebido − pagamentos de compras − pagamentos de despesas
--   open_receivables_cents   Contas a receber em aberto hoje (todas as datas)
--   overdue_cents            Saldo vencido hoje
-- -----------------------------------------------------------------------------

create function public.dashboard_summary(p_business_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_today date;
  v_due_day integer;
  v_next_due date;
  v_sales record;
  v_cash record;
  v_open record;
  v_bills record;
  v_bill_open record;
  v_next record;
begin
  perform private.assert_member(p_business_id);
  perform private.assert_period(p_from, p_to);

  select (now() at time zone b.timezone)::date, b.default_due_day into v_today, v_due_day
  from public.businesses b where b.id = p_business_id;
  v_next_due := private.next_day_of_month(v_today, v_due_day, true);

  select
    count(*) filter (where s.status = 'active') as sales_count,
    count(*) filter (where s.status = 'cancelled') as cancelled_count,
    coalesce(sum(s.total_cents) filter (where s.status = 'active'), 0) as revenue,
    coalesce(sum(s.items_discount_cents + s.discount_cents) filter (where s.status = 'active'), 0) as discounts,
    coalesce(sum(s.cost_total_cents) filter (where s.status = 'active'), 0) as cogs,
    coalesce(sum(s.items_without_cost) filter (where s.status = 'active'), 0) as items_without_cost,
    coalesce(sum(s.balance_cents) filter (where s.status = 'active'), 0) as period_balance
  into v_sales
  from public.v_sales s
  where s.business_id = p_business_id and s.sale_date between p_from and p_to;

  select
    coalesce(sum(p.amount_cents) filter (where p.kind = 'receipt'), 0) as receipts,
    coalesce(sum(p.amount_cents) filter (where p.kind = 'refund'), 0) as refunds
  into v_cash
  from public.payments p
  where p.business_id = p_business_id and p.voided_at is null and p.paid_on between p_from and p_to;

  select
    coalesce(sum(s.balance_cents), 0) as open_cents,
    count(*) as open_count,
    coalesce(sum(s.balance_cents) filter (where s.is_overdue), 0) as overdue_cents,
    count(*) filter (where s.is_overdue) as overdue_count,
    coalesce(sum(s.balance_cents) filter (where s.due_date is null), 0) as no_due_cents,
    count(*) filter (where s.payment_confirmation_pending) as pending_confirmation_count
  into v_open
  from public.v_sales s
  where s.business_id = p_business_id and s.status = 'active' and s.balance_cents > 0;

  select
    coalesce(sum(s.balance_cents), 0) as due_cents,
    count(*) as due_count
  into v_next
  from public.v_sales s
  where s.business_id = p_business_id and s.status = 'active' and s.balance_cents > 0 and s.due_date = v_next_due;

  select
    coalesce((select sum(p.total_cents) from public.purchases p
              where p.business_id = p_business_id and p.status = 'active' and p.purchase_date between p_from and p_to), 0) as purchases,
    coalesce((select sum(e.amount_cents) from public.expenses e
              where e.business_id = p_business_id and e.status = 'active' and e.expense_date between p_from and p_to), 0) as expenses,
    coalesce((select sum(x.amount_cents) from public.bill_payments x
              where x.business_id = p_business_id and x.voided_at is null and x.purchase_id is not null
                and x.paid_on between p_from and p_to), 0) as purchases_paid,
    coalesce((select sum(x.amount_cents) from public.bill_payments x
              where x.business_id = p_business_id and x.voided_at is null and x.expense_id is not null
                and x.paid_on between p_from and p_to), 0) as expenses_paid
  into v_bills;

  select
    coalesce(sum(vb.balance_cents), 0) as open_cents,
    coalesce(sum(vb.balance_cents) filter (where vb.is_overdue), 0) as overdue_cents
  into v_bill_open
  from public.v_bills vb
  where vb.business_id = p_business_id and vb.status = 'active' and vb.balance_cents > 0;

  return jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'today', v_today,
    'sales_count', v_sales.sales_count,
    'cancelled_count', v_sales.cancelled_count,
    'revenue_cents', v_sales.revenue,
    'discounts_cents', v_sales.discounts,
    'cogs_cents', v_sales.cogs,
    'items_without_cost', v_sales.items_without_cost,
    'period_receivable_cents', v_sales.period_balance,
    'receipts_cents', v_cash.receipts,
    'refunds_cents', v_cash.refunds,
    'net_received_cents', v_cash.receipts - v_cash.refunds,
    'open_receivables_cents', v_open.open_cents,
    'open_receivables_count', v_open.open_count,
    'overdue_cents', v_open.overdue_cents,
    'overdue_count', v_open.overdue_count,
    'receivables_without_due_cents', v_open.no_due_cents,
    'pending_confirmation_count', v_open.pending_confirmation_count,
    'next_due_day', v_next_due,
    'next_due_day_cents', v_next.due_cents,
    'next_due_day_count', v_next.due_count,
    'purchases_cents', v_bills.purchases,
    'purchases_paid_cents', v_bills.purchases_paid,
    'expenses_cents', v_bills.expenses,
    'expenses_paid_cents', v_bills.expenses_paid,
    'open_payables_cents', v_bill_open.open_cents,
    'overdue_payables_cents', v_bill_open.overdue_cents,
    'gross_profit_cents', v_sales.revenue - v_sales.cogs,
    'estimated_result_cents', v_sales.revenue - v_sales.cogs - v_bills.expenses,
    'cash_flow_cents', (v_cash.receipts - v_cash.refunds) - v_bills.purchases_paid - v_bills.expenses_paid
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Fluxo de caixa: entradas e saídas realizadas e previstas, sem dupla contagem.
--   Realizado: recebimentos, reembolsos, pagamentos de compras/despesas (por data paga).
--   Previsto:  saldos de vendas a receber (por vencimento), parcelas previstas a pagar
--              (por vencimento) e saldo sem parcela de compras/despesas (vencimento do documento).
-- -----------------------------------------------------------------------------

create function public.cash_flow_entries(p_business_id uuid, p_from date, p_to date)
returns table (
  entry_date date,
  direction text,
  realized boolean,
  category text,
  description text,
  amount_cents bigint,
  ref_kind text,
  ref_id uuid,
  is_overdue boolean
)
language plpgsql
stable
set search_path = ''
as $$
begin
  perform private.assert_member(p_business_id);
  perform private.assert_period(p_from, p_to);

  return query
  select p.paid_on, 'in'::text, true, 'Recebimento de venda'::text,
         coalesce(p.customer_name, 'Venda sem cliente'), p.amount_cents::bigint, 'sale'::text, p.sale_id, false
  from public.v_payments p
  where p.business_id = p_business_id and p.voided_at is null and p.kind = 'receipt'
    and p.paid_on between p_from and p_to
  union all
  select p.paid_on, 'out', true, 'Reembolso a cliente',
         coalesce(p.customer_name, 'Venda sem cliente'), p.amount_cents::bigint, 'sale', p.sale_id, false
  from public.v_payments p
  where p.business_id = p_business_id and p.voided_at is null and p.kind = 'refund'
    and p.paid_on between p_from and p_to
  union all
  select x.paid_on, 'out', true,
         case when x.kind = 'purchase' then 'Pagamento de compra' else 'Pagamento de despesa' end,
         x.bill_description, x.amount_cents::bigint, x.kind, x.bill_id, false
  from public.v_bill_payments x
  where x.business_id = p_business_id and x.voided_at is null and x.paid_on between p_from and p_to
  union all
  select s.due_date, 'in', false, 'A receber',
         coalesce(s.customer_name, 'Venda sem cliente'), s.balance_cents, 'sale', s.id, s.is_overdue
  from public.v_sales s
  where s.business_id = p_business_id and s.status = 'active' and s.balance_cents > 0
    and s.due_date between p_from and p_to
  union all
  select x.due_date, 'out', false,
         case when x.kind = 'purchase' then 'Parcela de compra' else 'Parcela de despesa' end,
         x.bill_description, x.amount_cents::bigint, x.kind, x.bill_id, x.is_overdue
  from public.v_bill_payments x
  where x.business_id = p_business_id and x.voided_at is null and x.paid_on is null and x.bill_status = 'active'
    and x.due_date between p_from and p_to
  union all
  select b.due_date, 'out', false,
         case when b.kind = 'purchase' then 'Compra a pagar' else 'Despesa a pagar' end,
         b.description, b.unscheduled_cents, b.kind, b.id, b.is_overdue
  from public.v_bills b
  where b.business_id = p_business_id and b.status = 'active' and b.unscheduled_cents > 0
    and b.due_date between p_from and p_to
  order by 1, 2, 4;
end;
$$;

-- -----------------------------------------------------------------------------
-- Relatórios
-- -----------------------------------------------------------------------------

create function private.assert_granularity(p_granularity text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_granularity not in ('day', 'week', 'month') then
    raise exception 'Agrupamento inválido.' using errcode = '22023';
  end if;
end;
$$;

-- Vendas por período (semana começa na segunda-feira).
create function public.report_sales_by_period(p_business_id uuid, p_from date, p_to date, p_granularity text)
returns table (
  period_start date,
  sales_count integer,
  cancelled_count integer,
  revenue_cents bigint,
  discounts_cents bigint,
  cogs_cents bigint,
  gross_profit_cents bigint,
  items_without_cost integer
)
language plpgsql
stable
set search_path = ''
as $$
begin
  perform private.assert_member(p_business_id);
  perform private.assert_period(p_from, p_to);
  perform private.assert_granularity(p_granularity);
  return query
  select
    date_trunc(p_granularity, s.sale_date)::date,
    (count(*) filter (where s.status = 'active'))::integer,
    (count(*) filter (where s.status = 'cancelled'))::integer,
    coalesce(sum(s.total_cents) filter (where s.status = 'active'), 0)::bigint,
    coalesce(sum(s.items_discount_cents + s.discount_cents) filter (where s.status = 'active'), 0)::bigint,
    coalesce(sum(s.cost_total_cents) filter (where s.status = 'active'), 0)::bigint,
    coalesce(sum(s.total_cents - s.cost_total_cents) filter (where s.status = 'active'), 0)::bigint,
    coalesce(sum(s.items_without_cost) filter (where s.status = 'active'), 0)::integer
  from public.sales s
  where s.business_id = p_business_id and s.sale_date between p_from and p_to
  group by 1
  order by 1;
end;
$$;

create function public.report_receipts_by_period(p_business_id uuid, p_from date, p_to date, p_granularity text)
returns table (
  period_start date,
  method text,
  receipts_count integer,
  receipts_cents bigint,
  refunds_cents bigint,
  net_cents bigint
)
language plpgsql
stable
set search_path = ''
as $$
begin
  perform private.assert_member(p_business_id);
  perform private.assert_period(p_from, p_to);
  perform private.assert_granularity(p_granularity);
  return query
  select
    date_trunc(p_granularity, p.paid_on)::date,
    p.method::text,
    (count(*) filter (where p.kind = 'receipt'))::integer,
    coalesce(sum(p.amount_cents) filter (where p.kind = 'receipt'), 0)::bigint,
    coalesce(sum(p.amount_cents) filter (where p.kind = 'refund'), 0)::bigint,
    coalesce(sum(case when p.kind = 'receipt' then p.amount_cents else -p.amount_cents end), 0)::bigint
  from public.payments p
  where p.business_id = p_business_id and p.voided_at is null and p.paid_on between p_from and p_to
  group by 1, 2
  order by 1, 2;
end;
$$;

-- Produtos mais vendidos e margem estimada. O faturamento por produto é a soma
-- das linhas (após desconto da linha). Descontos aplicados no total da venda não
-- são rateados por produto e aparecem em sale_discounts_cents.
create function public.report_top_products(p_business_id uuid, p_from date, p_to date)
returns table (
  product_id uuid,
  product_name text,
  unit text,
  quantity numeric,
  sales_count integer,
  revenue_cents bigint,
  cogs_cents bigint,
  gross_profit_cents bigint,
  items_without_cost integer,
  margin_percent numeric
)
language plpgsql
stable
set search_path = ''
as $$
begin
  perform private.assert_member(p_business_id);
  perform private.assert_period(p_from, p_to);
  return query
  select
    i.product_id,
    (array_agg(i.product_name order by i.sale_date desc))[1],
    (array_agg(i.unit order by i.sale_date desc))[1],
    sum(i.quantity),
    count(distinct i.sale_id)::integer,
    sum(i.line_total_cents)::bigint,
    coalesce(sum(i.line_cost_cents), 0)::bigint,
    (sum(i.line_total_cents) - coalesce(sum(i.line_cost_cents), 0))::bigint,
    (count(*) filter (where i.unit_cost_cents is null))::integer,
    case
      when sum(i.line_total_cents) filter (where i.unit_cost_cents is not null) > 0 then
        round(100.0 * (sum(i.line_total_cents) filter (where i.unit_cost_cents is not null) - coalesce(sum(i.line_cost_cents), 0))
              / (sum(i.line_total_cents) filter (where i.unit_cost_cents is not null)), 1)
    end
  from public.v_sale_items i
  where i.business_id = p_business_id and i.sale_status = 'active' and i.sale_date between p_from and p_to
  group by i.product_id
  order by 6 desc;
end;
$$;

create function public.report_payables(p_business_id uuid, p_from date, p_to date)
returns table (
  kind text,
  category text,
  records_count integer,
  registered_cents bigint,
  paid_in_period_cents bigint,
  open_cents bigint
)
language plpgsql
stable
set search_path = ''
as $$
begin
  perform private.assert_member(p_business_id);
  perform private.assert_period(p_from, p_to);
  return query
  with registered as (
    select b.kind, b.category, count(*)::integer as n, sum(b.total_cents)::bigint as total, sum(b.balance_cents)::bigint as open
    from public.v_bills b
    where b.business_id = p_business_id and b.status = 'active' and b.bill_date between p_from and p_to
    group by 1, 2
  ),
  paid as (
    select x.kind, x.bill_category as category, sum(x.amount_cents)::bigint as total
    from public.v_bill_payments x
    where x.business_id = p_business_id and x.voided_at is null and x.paid_on between p_from and p_to
    group by 1, 2
  )
  select coalesce(r.kind, p.kind), coalesce(r.category, p.category), coalesce(r.n, 0),
         coalesce(r.total, 0)::bigint, coalesce(p.total, 0)::bigint, coalesce(r.open, 0)::bigint
  from registered r
  full join paid p on p.kind = r.kind and p.category = r.category
  order by 1, 4 desc;
end;
$$;

-- Consumo estimado de ingredientes: itens vendidos × receita ATUAL do produto.
-- Quantidade na unidade-base (g, ml ou un). É uma estimativa, não controle de estoque.
create function public.report_ingredient_consumption(p_business_id uuid, p_from date, p_to date)
returns table (
  ingredient_id uuid,
  ingredient_name text,
  base_unit text,
  quantity_base numeric,
  estimated_cost_cents bigint
)
language plpgsql
stable
set search_path = ''
as $$
begin
  perform private.assert_member(p_business_id);
  perform private.assert_period(p_from, p_to);
  return query
  select
    ing.id,
    ing.name,
    case private.unit_dimension(ing.unit) when 'mass' then 'g' when 'volume' then 'ml' else 'un' end,
    round(sum(si.quantity / r.yield_quantity * ri.quantity * private.unit_factor(ri.unit)), 3),
    round(sum(si.quantity / r.yield_quantity * c.cost_cents_exact))::bigint
  from public.v_sale_items si
  join public.recipes r on r.product_id = si.product_id
  join public.recipe_items ri on ri.recipe_id = r.id
  join public.ingredients ing on ing.id = ri.ingredient_id
  join public.v_recipe_item_costs c on c.recipe_item_id = ri.id
  where si.business_id = p_business_id and si.sale_status = 'active' and si.sale_date between p_from and p_to
  group by ing.id, ing.name, ing.unit
  order by 5 desc;
end;
$$;

-- -----------------------------------------------------------------------------
-- Privilégios
-- -----------------------------------------------------------------------------

revoke all on public.v_sales, public.v_payments, public.v_sale_items, public.v_purchases, public.v_expenses,
  public.v_bills, public.v_bill_payments, public.v_customer_summary, public.v_business_members
from anon, authenticated, public;

grant select on public.v_sales, public.v_payments, public.v_sale_items, public.v_purchases, public.v_expenses,
  public.v_bills, public.v_bill_payments, public.v_customer_summary, public.v_business_members
to authenticated;

revoke all on function
  public.dashboard_summary(uuid, date, date),
  public.cash_flow_entries(uuid, date, date),
  public.report_sales_by_period(uuid, date, date, text),
  public.report_receipts_by_period(uuid, date, date, text),
  public.report_top_products(uuid, date, date),
  public.report_payables(uuid, date, date),
  public.report_ingredient_consumption(uuid, date, date)
from public, anon;

grant execute on function
  public.dashboard_summary(uuid, date, date),
  public.cash_flow_entries(uuid, date, date),
  public.report_sales_by_period(uuid, date, date, text),
  public.report_receipts_by_period(uuid, date, date, text),
  public.report_top_products(uuid, date, date),
  public.report_payables(uuid, date, date),
  public.report_ingredient_consumption(uuid, date, date)
to authenticated;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_member(uuid),
  private.has_role(uuid, text[]),
  private.can_write(uuid),
  private.shares_business(uuid),
  private.unit_dimension(text),
  private.unit_factor(text),
  private.assert_member(uuid),
  private.assert_period(date, date),
  private.assert_granularity(text),
  private.next_day_of_month(date, integer, boolean)
to authenticated;
