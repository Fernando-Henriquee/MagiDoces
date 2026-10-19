-- =============================================================================
-- Magi Doces — 0800 Correções
--
-- 1. Auditoria de alterações em businesses: o gatilho genérico lia business_id da
--    linha, coluna que não existe em businesses; todo UPDATE das configurações do
--    negócio falhava (audit_logs.business_id nulo). Agora usa o próprio id.
-- 2. next_due_date de compras/despesas passa a considerar também o vencimento do
--    saldo sem parcela (antes, só as parcelas previstas).
-- =============================================================================

create or replace function private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_key text;
  v_action text;
  v_entity text := tg_argv[0];
  v_ignored text[] := array['updated_at', 'updated_by', 'items_subtotal_cents', 'items_discount_cents',
                            'total_cents', 'cost_total_cents', 'items_without_cost', 'items_total_cents'];
begin
  if coalesce(current_setting('magi.audit_skip', true), '') = 'on' then
    return null;
  end if;

  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    v_row := v_new;
    v_action := 'created';
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_row := v_new;
    for v_key in select jsonb_object_keys(v_new) loop
      if not (v_key = any (v_ignored)) and (v_new -> v_key) is distinct from (v_old -> v_key) then
        v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object('de', v_old -> v_key, 'para', v_new -> v_key));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then
      return null;
    end if;
    v_action := 'updated';
    if v_changes ? 'status' and v_new ->> 'status' = 'cancelled' then
      v_action := 'cancelled';
    elsif v_changes ? 'voided_at' and v_new ->> 'voided_at' is not null then
      v_action := 'voided';
    elsif v_changes ? 'paid_on' and v_old ->> 'paid_on' is null then
      v_action := 'paid';
    elsif v_changes ? 'due_date' and (select count(*) from jsonb_object_keys(v_changes)) = 1 then
      v_action := 'due_date_changed';
    end if;
  else
    v_old := to_jsonb(old);
    v_row := v_old;
    v_action := 'deleted';
  end if;

  if v_entity = 'payment' and v_row ->> 'kind' = 'refund' and v_action = 'created' then
    v_action := 'refunded';
  end if;

  insert into public.audit_logs (business_id, actor_id, action, entity, entity_id, details)
  values (
    -- Em businesses o próprio id é o negócio (a tabela não tem business_id).
    coalesce((v_row ->> 'business_id')::uuid, case when tg_table_name = 'businesses' then (v_row ->> 'id')::uuid end),
    (select auth.uid()),
    v_entity || '.' || v_action,
    v_entity,
    (v_row ->> 'id')::uuid,
    case
      when tg_op = 'UPDATE' then jsonb_build_object('alteracoes', v_changes)
      when tg_op = 'INSERT' then jsonb_build_object('registro', v_new)
      else jsonb_build_object('registro', v_old)
    end
  );
  return null;
end;
$$;

create or replace view public.v_purchases
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
  -- Vencimento efetivo: a parcela prevista mais próxima ou o vencimento do saldo sem parcela.
  case when p.status = 'cancelled' then null else least(
    bp.next_due_date,
    case when p.total_cents - bp.paid_cents - bp.scheduled_cents > 0 then p.due_date end
  ) end as next_due_date,
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

create or replace view public.v_expenses
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
  case when e.status = 'cancelled' then null else least(
    bp.next_due_date,
    case when e.amount_cents - bp.paid_cents - bp.scheduled_cents > 0 then e.due_date end
  ) end as next_due_date,
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

revoke all on public.v_purchases, public.v_expenses from anon, authenticated, public;
grant select on public.v_purchases, public.v_expenses to authenticated;

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
  private.next_day_of_month(date, integer, boolean),
  private.storage_business_id(text)
to authenticated;
