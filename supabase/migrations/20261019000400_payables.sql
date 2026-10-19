-- =============================================================================
-- Magi Doces — 0400 Compras, despesas e pagamentos (contas a pagar)
--
-- Separação de conceitos:
--   * purchases      → compra de insumos/estoque (compromisso financeiro, com itens)
--   * expenses       → despesa operacional (aluguel, gás, transporte, taxas...)
--   * bill_payments  → pagamentos e parcelas de uma compra OU despesa
--
-- Uma parcela "prevista" tem due_date e paid_on nulo; "paga" tem paid_on.
-- O total do compromisso nunca é recontado por parcela:
--   pago = Σ parcelas pagas válidas; previsto = Σ parcelas não pagas válidas
--   saldo = total − pago;  pago + previsto ≤ total
-- =============================================================================

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  purchase_date date not null,
  supplier_id uuid,
  description text not null check (char_length(btrim(description)) between 1 and 200),
  category text not null default 'Ingredientes' check (char_length(btrim(category)) between 1 and 60),
  payment_method public.payment_method,
  due_date date,
  receipt_path text check (receipt_path is null or char_length(receipt_path) <= 300),
  notes text check (notes is null or char_length(notes) <= 2000),
  -- Frete/taxas e desconto do documento.
  extra_cents integer not null default 0 check (extra_cents between 0 and 100000000),
  discount_cents integer not null default 0 check (discount_cents between 0 and 100000000),
  items_total_cents bigint not null default 0,
  total_cents bigint not null default 0,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 500),
  client_request_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (business_id, id),
  foreign key (business_id, supplier_id) references public.suppliers (business_id, id),
  constraint purchases_total_consistent check (total_cents = items_total_cents + extra_cents - discount_cents),
  constraint purchases_total_non_negative check (total_cents >= 0),
  constraint purchases_cancel_consistent check ((status = 'cancelled') = (cancelled_at is not null))
);

create unique index purchases_request_uq on public.purchases (business_id, client_request_id) where client_request_id is not null;
create index purchases_business_date_idx on public.purchases (business_id, purchase_date desc);

create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  purchase_id uuid not null,
  ingredient_id uuid,
  position smallint not null default 0,
  description text not null check (char_length(btrim(description)) between 1 and 200),
  quantity numeric(14, 3) not null check (quantity > 0 and quantity <= 10000000),
  unit text not null check (char_length(btrim(unit)) between 1 and 20),
  unit_price_cents integer not null check (unit_price_cents between 0 and 100000000),
  line_total_cents bigint generated always as (round(quantity * unit_price_cents)::bigint) stored,
  foreign key (business_id, purchase_id) references public.purchases (business_id, id) on delete cascade,
  foreign key (business_id, ingredient_id) references public.ingredients (business_id, id)
);

create index purchase_items_purchase_idx on public.purchase_items (purchase_id);
create index purchase_items_ingredient_idx on public.purchase_items (ingredient_id) where ingredient_id is not null;

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  -- Data de competência (quando a despesa ocorreu).
  expense_date date not null,
  supplier_id uuid,
  description text not null check (char_length(btrim(description)) between 1 and 200),
  category text not null default 'Outros' check (char_length(btrim(category)) between 1 and 60),
  amount_cents integer not null check (amount_cents > 0 and amount_cents <= 100000000),
  payment_method public.payment_method,
  due_date date,
  receipt_path text check (receipt_path is null or char_length(receipt_path) <= 300),
  notes text check (notes is null or char_length(notes) <= 2000),
  status text not null default 'active' check (status in ('active', 'cancelled')),
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 500),
  client_request_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (business_id, id),
  foreign key (business_id, supplier_id) references public.suppliers (business_id, id),
  constraint expenses_cancel_consistent check ((status = 'cancelled') = (cancelled_at is not null))
);

create unique index expenses_request_uq on public.expenses (business_id, client_request_id) where client_request_id is not null;
create index expenses_business_date_idx on public.expenses (business_id, expense_date desc);

create table public.bill_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  purchase_id uuid,
  expense_id uuid,
  installment_number smallint check (installment_number is null or installment_number between 1 and 120),
  amount_cents integer not null check (amount_cents > 0 and amount_cents <= 100000000),
  due_date date,
  paid_on date,
  method public.payment_method,
  notes text check (notes is null or char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  created_by uuid,
  paid_by uuid,
  paid_recorded_at timestamptz,
  voided_at timestamptz,
  voided_by uuid,
  void_reason text check (void_reason is null or char_length(void_reason) <= 500),
  client_request_id uuid,
  foreign key (business_id, purchase_id) references public.purchases (business_id, id) on delete cascade,
  foreign key (business_id, expense_id) references public.expenses (business_id, id) on delete cascade,
  constraint bill_payments_one_parent check (num_nonnulls(purchase_id, expense_id) = 1),
  constraint bill_payments_scheduled_has_due check (paid_on is not null or due_date is not null),
  constraint bill_payments_void_consistent check ((voided_at is null) = (void_reason is null))
);

create unique index bill_payments_request_uq on public.bill_payments (business_id, client_request_id) where client_request_id is not null;
create index bill_payments_purchase_idx on public.bill_payments (purchase_id) where purchase_id is not null;
create index bill_payments_expense_idx on public.bill_payments (expense_id) where expense_id is not null;
create index bill_payments_business_paid_idx on public.bill_payments (business_id, paid_on) where paid_on is not null;
create index bill_payments_business_due_idx on public.bill_payments (business_id, due_date) where paid_on is null;

-- -----------------------------------------------------------------------------
-- Totais e invariantes
-- -----------------------------------------------------------------------------

create function private.purchases_compute_total()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.items_total_cents := 0;
  end if;
  new.total_cents := new.items_total_cents + new.extra_cents - new.discount_cents;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger purchases_compute_total
  before insert or update on public.purchases
  for each row execute function private.purchases_compute_total();

create trigger expenses_touch
  before update on public.expenses
  for each row execute function private.touch_updated_at();

create function private.refresh_purchase_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase_id uuid := coalesce(new.purchase_id, old.purchase_id);
begin
  update public.purchases p
  set items_total_cents = coalesce((select sum(i.line_total_cents) from public.purchase_items i where i.purchase_id = v_purchase_id), 0)
  where p.id = v_purchase_id;
  return null;
end;
$$;

create trigger purchase_items_refresh_totals
  after insert or update or delete on public.purchase_items
  for each row execute function private.refresh_purchase_totals();

-- Total do compromisso (compra ou despesa) e status.
create function private.bill_total(p_purchase_id uuid, p_expense_id uuid)
returns table (total_cents bigint, status text, business_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select p.total_cents, p.status, p.business_id from public.purchases p where p.id = p_purchase_id
  union all
  select e.amount_cents::bigint, e.status, e.business_id from public.expenses e where e.id = p_expense_id;
$$;

create function private.bill_committed(p_purchase_id uuid, p_expense_id uuid)
returns table (paid_cents bigint, scheduled_cents bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(sum(b.amount_cents) filter (where b.paid_on is not null), 0)::bigint,
    coalesce(sum(b.amount_cents) filter (where b.paid_on is null), 0)::bigint
  from public.bill_payments b
  where b.voided_at is null
    and ((p_purchase_id is not null and b.purchase_id = p_purchase_id)
      or (p_expense_id is not null and b.expense_id = p_expense_id));
$$;

create function private.check_bill_bounds()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase_id uuid;
  v_expense_id uuid;
  v_total bigint;
  v_status text;
  v_paid bigint;
  v_scheduled bigint;
begin
  if tg_table_name = 'purchases' then
    v_purchase_id := new.id;
  elsif tg_table_name = 'expenses' then
    v_expense_id := new.id;
  else
    v_purchase_id := new.purchase_id;
    v_expense_id := new.expense_id;
  end if;

  select t.total_cents, t.status into v_total, v_status from private.bill_total(v_purchase_id, v_expense_id) t;
  if v_total is null then
    return null;
  end if;
  select c.paid_cents, c.scheduled_cents into v_paid, v_scheduled from private.bill_committed(v_purchase_id, v_expense_id) c;

  if v_status = 'cancelled' and (v_paid + v_scheduled) <> 0 then
    raise exception 'Compromisso cancelado não pode manter pagamentos ou parcelas válidas.' using errcode = '23514';
  end if;
  if v_paid + v_scheduled > v_total then
    raise exception 'Pagamentos e parcelas excedem o total do compromisso.' using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger purchases_bill_bounds after insert or update on public.purchases
  deferrable initially deferred for each row execute function private.check_bill_bounds();
create constraint trigger expenses_bill_bounds after insert or update on public.expenses
  deferrable initially deferred for each row execute function private.check_bill_bounds();
create constraint trigger bill_payments_bill_bounds after insert or update on public.bill_payments
  deferrable initially deferred for each row execute function private.check_bill_bounds();

create function private.guard_bill_payment_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.voided_at is not null then
    raise exception 'Pagamento estornado não pode ser alterado.' using errcode = '23514';
  end if;
  if old.paid_on is not null and (new.paid_on is distinct from old.paid_on or new.amount_cents <> old.amount_cents) then
    raise exception 'Pagamentos realizados não podem ser editados; estorne e registre novamente.' using errcode = '23514';
  end if;
  if new.purchase_id is distinct from old.purchase_id or new.expense_id is distinct from old.expense_id
     or new.business_id <> old.business_id then
    raise exception 'Não é possível mover um pagamento para outro compromisso.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger bill_payments_guard_update
  before update on public.bill_payments
  for each row execute function private.guard_bill_payment_update();

create trigger purchases_audit after insert or update on public.purchases
  for each row execute function private.audit_row('purchase');
create trigger expenses_audit after insert or update on public.expenses
  for each row execute function private.audit_row('expense');
create trigger bill_payments_audit after insert or update on public.bill_payments
  for each row execute function private.audit_row('bill_payment');

-- -----------------------------------------------------------------------------
-- Funções internas
-- -----------------------------------------------------------------------------

-- Divide um total em N parcelas inteiras; a diferença de centavos fica na 1ª.
create function private.split_installments(p_total bigint, p_count integer)
returns table (installment_number integer, amount_cents bigint)
language sql
immutable
set search_path = ''
as $$
  select n, (p_total / p_count) + case when n = 1 then p_total % p_count else 0 end
  from generate_series(1, p_count) as n;
$$;

-- Cria o plano de pagamento de um compromisso recém-criado.
-- p_plan = {mode: 'paid'|'pending'|'installments', paid_on?, method?, count?, first_due_date?}
create function private.apply_payment_plan(
  p_business_id uuid,
  p_purchase_id uuid,
  p_expense_id uuid,
  p_total bigint,
  p_base_date date,
  p_due_date date,
  p_default_method public.payment_method,
  p_plan jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text := coalesce(p_plan ->> 'mode', 'pending');
  v_count integer;
  v_first date;
  v_paid_on date;
  v_method public.payment_method := coalesce(nullif(p_plan ->> 'method', '')::public.payment_method, p_default_method);
begin
  if p_total <= 0 or v_mode = 'pending' then
    return;
  elsif v_mode = 'paid' then
    v_paid_on := coalesce(nullif(p_plan ->> 'paid_on', '')::date, p_base_date);
    if v_paid_on > private.business_today(p_business_id) then
      raise exception 'A data do pagamento não pode estar no futuro.' using errcode = '22023';
    end if;
    insert into public.bill_payments (business_id, purchase_id, expense_id, amount_cents, paid_on, method, created_by, paid_by, paid_recorded_at)
    values (p_business_id, p_purchase_id, p_expense_id, p_total, v_paid_on, coalesce(v_method, 'outro'),
            (select auth.uid()), (select auth.uid()), now());
  elsif v_mode = 'installments' then
    v_count := (p_plan ->> 'count')::integer;
    if v_count is null or v_count < 1 or v_count > 120 then
      raise exception 'Número de parcelas inválido (1 a 120).' using errcode = '22023';
    end if;
    if v_count > p_total then
      raise exception 'Número de parcelas maior que o total em centavos.' using errcode = '22023';
    end if;
    v_first := coalesce(nullif(p_plan ->> 'first_due_date', '')::date, p_due_date, p_base_date);
    insert into public.bill_payments (business_id, purchase_id, expense_id, installment_number, amount_cents, due_date, method, created_by)
    select p_business_id, p_purchase_id, p_expense_id, s.installment_number, s.amount_cents,
           (v_first + make_interval(months => s.installment_number - 1))::date, v_method, (select auth.uid())
    from private.split_installments(p_total, v_count) s;
  else
    raise exception 'Plano de pagamento inválido.' using errcode = '22023';
  end if;
end;
$$;

create function private.validate_supplier(p_business_id uuid, p_supplier_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_supplier_id is not null
     and not exists (select 1 from public.suppliers s where s.id = p_supplier_id and s.business_id = p_business_id) then
    raise exception 'Fornecedor não encontrado neste negócio.' using errcode = '22023';
  end if;
end;
$$;

create function private.resolve_supplier(p_business_id uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supplier_id uuid := nullif(p_data ->> 'supplier_id', '')::uuid;
  v_name text := nullif(btrim(p_data ->> 'new_supplier_name'), '');
begin
  if v_supplier_id is not null then
    perform private.validate_supplier(p_business_id, v_supplier_id);
    return v_supplier_id;
  end if;
  if v_name is not null then
    select s.id into v_supplier_id from public.suppliers s
    where s.business_id = p_business_id and lower(btrim(s.name)) = lower(v_name);
    if v_supplier_id is null then
      insert into public.suppliers (business_id, name, created_by)
      values (p_business_id, v_name, (select auth.uid()))
      returning id into v_supplier_id;
    end if;
  end if;
  return v_supplier_id;
end;
$$;

create function private.validate_bill_header(p_business_id uuid, p_data jsonb, p_date_field text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_date date;
begin
  if jsonb_typeof(p_data) <> 'object' then
    raise exception 'Dados inválidos.' using errcode = '22023';
  end if;
  v_date := (p_data ->> p_date_field)::date;
  if v_date is null then
    raise exception 'Informe a data.' using errcode = '22023';
  end if;
  if v_date < date '2000-01-01' or v_date > private.business_today(p_business_id) + 366 then
    raise exception 'Data fora do intervalo permitido.' using errcode = '22023';
  end if;
  if nullif(btrim(p_data ->> 'description'), '') is null then
    raise exception 'Informe a descrição.' using errcode = '22023';
  end if;
end;
$$;

-- Insere os itens de uma compra; opcionalmente atualiza o custo do ingrediente.
create function private.insert_purchase_items(p_business_id uuid, p_purchase_id uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_position integer := 0;
  v_ingredient_id uuid;
  v_ingredient_name text;
  v_ingredient_unit text;
  v_quantity numeric;
  v_price integer;
  v_unit text;
  v_line bigint;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'A compra precisa ter pelo menos um item.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'Uma compra pode ter no máximo 200 itens.' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_ingredient_id := nullif(v_item ->> 'ingredient_id', '')::uuid;
    v_quantity := (v_item ->> 'quantity')::numeric;
    v_price := private.jsonb_int(v_item, 'unit_price_cents');
    v_unit := nullif(btrim(v_item ->> 'unit'), '');
    if v_quantity is null or v_quantity <= 0 or v_quantity <> round(v_quantity, 3) then
      raise exception 'Quantidade inválida no item %.', v_position + 1 using errcode = '22023';
    end if;
    if v_price is null or v_price < 0 then
      raise exception 'Valor unitário inválido no item %.', v_position + 1 using errcode = '22023';
    end if;

    v_ingredient_name := null;
    v_ingredient_unit := null;
    if v_ingredient_id is not null then
      select i.name, i.unit into v_ingredient_name, v_ingredient_unit from public.ingredients i
      where i.id = v_ingredient_id and i.business_id = p_business_id;
      if not found then
        raise exception 'Ingrediente não encontrado neste negócio.' using errcode = '22023';
      end if;
      v_unit := coalesce(v_unit, v_ingredient_unit);
    end if;
    if v_unit is null then
      raise exception 'Informe a unidade do item %.', v_position + 1 using errcode = '22023';
    end if;

    insert into public.purchase_items (business_id, purchase_id, ingredient_id, position, description, quantity, unit, unit_price_cents)
    values (p_business_id, p_purchase_id, v_ingredient_id, v_position,
            coalesce(nullif(btrim(v_item ->> 'description'), ''), v_ingredient_name),
            v_quantity, v_unit, v_price);

    -- Atualiza o custo de aquisição do ingrediente com o preço desta compra.
    if v_ingredient_id is not null and coalesce((v_item ->> 'update_ingredient_cost')::boolean, false) then
      if private.unit_dimension(v_unit) is null
         or private.unit_dimension(v_unit) is distinct from private.unit_dimension(v_ingredient_unit) then
        raise exception 'A unidade "%" do item não é compatível com "%" do ingrediente "%"; o custo não pode ser atualizado.',
          v_unit, v_ingredient_unit, v_ingredient_name using errcode = '22023';
      end if;
      v_line := round(v_quantity * v_price);
      update public.ingredients
      set purchase_quantity = round(v_quantity * private.unit_factor(v_unit) / private.unit_factor(v_ingredient_unit), 3),
          purchase_price_cents = v_line
      where id = v_ingredient_id;
    end if;

    v_position := v_position + 1;
  end loop;
end;
$$;

create function private.lock_bill(p_kind text, p_id uuid)
returns table (business_id uuid, total_cents bigint, status text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_kind = 'purchase' then
    return query select p.business_id, p.total_cents, p.status from public.purchases p where p.id = p_id for update;
  elsif p_kind = 'expense' then
    return query select e.business_id, e.amount_cents::bigint, e.status from public.expenses e where e.id = p_id for update;
  else
    raise exception 'Tipo de compromisso inválido.' using errcode = '22023';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPCs — compras
-- -----------------------------------------------------------------------------

-- p_purchase = {purchase_date, supplier_id?|new_supplier_name?, description, category?,
--   payment_method?, due_date?, receipt_path?, notes?, extra_cents?, discount_cents?,
--   items: [{ingredient_id?, description?, quantity, unit?, unit_price_cents, update_ingredient_cost?}],
--   plan: {mode: 'paid'|'pending'|'installments', paid_on?, method?, count?, first_due_date?}}
create function public.create_purchase(p_business_id uuid, p_request_id uuid, p_purchase jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_supplier_id uuid;
  v_total bigint;
begin
  perform private.assert_can_write(p_business_id);
  if p_request_id is null then
    raise exception 'Identificador da requisição é obrigatório.' using errcode = '22023';
  end if;
  select p.id into v_id from public.purchases p where p.business_id = p_business_id and p.client_request_id = p_request_id;
  if found then
    return v_id;
  end if;

  perform private.validate_bill_header(p_business_id, p_purchase, 'purchase_date');
  v_supplier_id := private.resolve_supplier(p_business_id, p_purchase);

  perform private.set_audit_skip(true);
  insert into public.purchases (
    business_id, purchase_date, supplier_id, description, category, payment_method, due_date,
    receipt_path, notes, client_request_id, created_by, updated_by
  ) values (
    p_business_id, (p_purchase ->> 'purchase_date')::date, v_supplier_id, btrim(p_purchase ->> 'description'),
    coalesce(nullif(btrim(p_purchase ->> 'category'), ''), 'Ingredientes'),
    nullif(p_purchase ->> 'payment_method', '')::public.payment_method, nullif(p_purchase ->> 'due_date', '')::date,
    nullif(p_purchase ->> 'receipt_path', ''), nullif(btrim(p_purchase ->> 'notes'), ''),
    p_request_id, (select auth.uid()), (select auth.uid())
  ) returning id into v_id;

  perform private.insert_purchase_items(p_business_id, v_id, p_purchase -> 'items');

  update public.purchases
  set extra_cents = coalesce(private.jsonb_int(p_purchase, 'extra_cents'), 0),
      discount_cents = coalesce(private.jsonb_int(p_purchase, 'discount_cents'), 0)
  where id = v_id
  returning total_cents into v_total;
  perform private.set_audit_skip(false);

  perform private.write_audit(p_business_id, 'purchase.created', 'purchase', v_id,
    jsonb_build_object('compra', (select to_jsonb(p) from public.purchases p where p.id = v_id),
                       'itens', (select jsonb_agg(to_jsonb(i) order by i.position) from public.purchase_items i where i.purchase_id = v_id)));

  perform private.apply_payment_plan(p_business_id, v_id, null, v_total,
    (p_purchase ->> 'purchase_date')::date, nullif(p_purchase ->> 'due_date', '')::date,
    nullif(p_purchase ->> 'payment_method', '')::public.payment_method, p_purchase -> 'plan');

  return v_id;
exception
  when unique_violation then
    select p.id into v_id from public.purchases p where p.business_id = p_business_id and p.client_request_id = p_request_id;
    if v_id is not null then
      return v_id;
    end if;
    raise;
end;
$$;

-- Edita cabeçalho e itens. O novo total precisa comportar o que já foi pago + previsto.
create function public.update_purchase(p_purchase_id uuid, p_purchase jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill record;
  v_supplier_id uuid;
  v_total bigint;
  v_paid bigint;
  v_scheduled bigint;
  v_before jsonb;
begin
  select * into v_bill from private.lock_bill('purchase', p_purchase_id);
  if v_bill.business_id is null then
    raise exception 'Compra não encontrada.' using errcode = '22023';
  end if;
  perform private.assert_can_write(v_bill.business_id);
  if v_bill.status <> 'active' then
    raise exception 'Compra cancelada não pode ser editada.' using errcode = '22023';
  end if;
  perform private.validate_bill_header(v_bill.business_id, p_purchase, 'purchase_date');
  v_supplier_id := private.resolve_supplier(v_bill.business_id, p_purchase);

  select jsonb_build_object('compra', to_jsonb(p), 'itens',
           (select jsonb_agg(to_jsonb(i) order by i.position) from public.purchase_items i where i.purchase_id = p.id))
  into v_before from public.purchases p where p.id = p_purchase_id;

  perform private.set_audit_skip(true);
  update public.purchases
  set purchase_date = (p_purchase ->> 'purchase_date')::date,
      supplier_id = v_supplier_id,
      description = btrim(p_purchase ->> 'description'),
      category = coalesce(nullif(btrim(p_purchase ->> 'category'), ''), 'Ingredientes'),
      payment_method = nullif(p_purchase ->> 'payment_method', '')::public.payment_method,
      due_date = nullif(p_purchase ->> 'due_date', '')::date,
      receipt_path = nullif(p_purchase ->> 'receipt_path', ''),
      notes = nullif(btrim(p_purchase ->> 'notes'), ''),
      extra_cents = 0,
      discount_cents = 0,
      updated_by = (select auth.uid())
  where id = p_purchase_id;

  delete from public.purchase_items where purchase_id = p_purchase_id;
  perform private.insert_purchase_items(v_bill.business_id, p_purchase_id, p_purchase -> 'items');

  update public.purchases
  set extra_cents = coalesce(private.jsonb_int(p_purchase, 'extra_cents'), 0),
      discount_cents = coalesce(private.jsonb_int(p_purchase, 'discount_cents'), 0)
  where id = p_purchase_id
  returning total_cents into v_total;
  perform private.set_audit_skip(false);

  select c.paid_cents, c.scheduled_cents into v_paid, v_scheduled from private.bill_committed(p_purchase_id, null) c;
  if v_paid + v_scheduled > v_total then
    raise exception 'O novo total (%) é menor que pagamentos e parcelas já lançados (%). Ajuste-os antes.',
      private.fmt_brl(v_total), private.fmt_brl(v_paid + v_scheduled) using errcode = '22023';
  end if;

  perform private.write_audit(v_bill.business_id, 'purchase.updated', 'purchase', p_purchase_id,
    jsonb_build_object('antes', v_before, 'depois',
      (select jsonb_build_object('compra', to_jsonb(p), 'itens',
         (select jsonb_agg(to_jsonb(i) order by i.position) from public.purchase_items i where i.purchase_id = p.id))
       from public.purchases p where p.id = p_purchase_id)));
  return p_purchase_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPCs — despesas
-- -----------------------------------------------------------------------------

-- p_expense = {expense_date, supplier_id?|new_supplier_name?, description, category?, amount_cents,
--   payment_method?, due_date?, receipt_path?, notes?, plan: {...}}
create function public.create_expense(p_business_id uuid, p_request_id uuid, p_expense jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_supplier_id uuid;
  v_amount integer;
begin
  perform private.assert_can_write(p_business_id);
  if p_request_id is null then
    raise exception 'Identificador da requisição é obrigatório.' using errcode = '22023';
  end if;
  select e.id into v_id from public.expenses e where e.business_id = p_business_id and e.client_request_id = p_request_id;
  if found then
    return v_id;
  end if;

  perform private.validate_bill_header(p_business_id, p_expense, 'expense_date');
  v_amount := private.jsonb_int(p_expense, 'amount_cents');
  if v_amount is null or v_amount <= 0 then
    raise exception 'Informe um valor maior que zero.' using errcode = '22023';
  end if;
  v_supplier_id := private.resolve_supplier(p_business_id, p_expense);

  insert into public.expenses (
    business_id, expense_date, supplier_id, description, category, amount_cents, payment_method, due_date,
    receipt_path, notes, client_request_id, created_by, updated_by
  ) values (
    p_business_id, (p_expense ->> 'expense_date')::date, v_supplier_id, btrim(p_expense ->> 'description'),
    coalesce(nullif(btrim(p_expense ->> 'category'), ''), 'Outros'), v_amount,
    nullif(p_expense ->> 'payment_method', '')::public.payment_method, nullif(p_expense ->> 'due_date', '')::date,
    nullif(p_expense ->> 'receipt_path', ''), nullif(btrim(p_expense ->> 'notes'), ''),
    p_request_id, (select auth.uid()), (select auth.uid())
  ) returning id into v_id;

  perform private.apply_payment_plan(p_business_id, null, v_id, v_amount,
    (p_expense ->> 'expense_date')::date, nullif(p_expense ->> 'due_date', '')::date,
    nullif(p_expense ->> 'payment_method', '')::public.payment_method, p_expense -> 'plan');

  return v_id;
exception
  when unique_violation then
    select e.id into v_id from public.expenses e where e.business_id = p_business_id and e.client_request_id = p_request_id;
    if v_id is not null then
      return v_id;
    end if;
    raise;
end;
$$;

create function public.update_expense(p_expense_id uuid, p_expense jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill record;
  v_supplier_id uuid;
  v_amount integer;
  v_paid bigint;
  v_scheduled bigint;
begin
  select * into v_bill from private.lock_bill('expense', p_expense_id);
  if v_bill.business_id is null then
    raise exception 'Despesa não encontrada.' using errcode = '22023';
  end if;
  perform private.assert_can_write(v_bill.business_id);
  if v_bill.status <> 'active' then
    raise exception 'Despesa cancelada não pode ser editada.' using errcode = '22023';
  end if;
  perform private.validate_bill_header(v_bill.business_id, p_expense, 'expense_date');
  v_amount := private.jsonb_int(p_expense, 'amount_cents');
  if v_amount is null or v_amount <= 0 then
    raise exception 'Informe um valor maior que zero.' using errcode = '22023';
  end if;
  select c.paid_cents, c.scheduled_cents into v_paid, v_scheduled from private.bill_committed(null, p_expense_id) c;
  if v_paid + v_scheduled > v_amount then
    raise exception 'O novo valor (%) é menor que pagamentos e parcelas já lançados (%). Ajuste-os antes.',
      private.fmt_brl(v_amount), private.fmt_brl(v_paid + v_scheduled) using errcode = '22023';
  end if;
  v_supplier_id := private.resolve_supplier(v_bill.business_id, p_expense);

  update public.expenses
  set expense_date = (p_expense ->> 'expense_date')::date,
      supplier_id = v_supplier_id,
      description = btrim(p_expense ->> 'description'),
      category = coalesce(nullif(btrim(p_expense ->> 'category'), ''), 'Outros'),
      amount_cents = v_amount,
      payment_method = nullif(p_expense ->> 'payment_method', '')::public.payment_method,
      due_date = nullif(p_expense ->> 'due_date', '')::date,
      receipt_path = nullif(p_expense ->> 'receipt_path', ''),
      notes = nullif(btrim(p_expense ->> 'notes'), ''),
      updated_by = (select auth.uid())
  where id = p_expense_id;
  return p_expense_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPCs — cancelamento e pagamentos (compras e despesas)
-- -----------------------------------------------------------------------------

-- Cancela compra/despesa. Parcelas previstas são anuladas automaticamente;
-- pagamentos realizados exigem p_void_payments = true (estorno explícito).
create function public.cancel_bill(p_kind text, p_id uuid, p_reason text, p_void_payments boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill record;
  v_paid bigint;
begin
  select * into v_bill from private.lock_bill(p_kind, p_id);
  if v_bill.business_id is null then
    raise exception 'Registro não encontrado.' using errcode = '22023';
  end if;
  perform private.assert_can_write(v_bill.business_id);
  if v_bill.status = 'cancelled' then
    raise exception 'O registro já está cancelado.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Informe o motivo do cancelamento.' using errcode = '22023';
  end if;

  if p_kind = 'purchase' then
    select c.paid_cents into v_paid from private.bill_committed(p_id, null) c;
  else
    select c.paid_cents into v_paid from private.bill_committed(null, p_id) c;
  end if;
  if v_paid > 0 and not p_void_payments then
    raise exception 'Há % em pagamentos realizados. Confirme o estorno dos pagamentos para cancelar.',
      private.fmt_brl(v_paid) using errcode = '22023';
  end if;

  update public.bill_payments
  set voided_at = now(), voided_by = (select auth.uid()),
      void_reason = left('Cancelamento: ' || btrim(p_reason), 500)
  where voided_at is null
    and ((p_kind = 'purchase' and purchase_id = p_id) or (p_kind = 'expense' and expense_id = p_id));

  if p_kind = 'purchase' then
    update public.purchases set status = 'cancelled', cancelled_at = now(), cancelled_by = (select auth.uid()),
      cancel_reason = btrim(p_reason), updated_by = (select auth.uid()) where id = p_id;
  else
    update public.expenses set status = 'cancelled', cancelled_at = now(), cancelled_by = (select auth.uid()),
      cancel_reason = btrim(p_reason), updated_by = (select auth.uid()) where id = p_id;
  end if;
end;
$$;

-- Lança um pagamento realizado (p_paid_on) ou uma parcela prevista (p_due_date).
create function public.add_bill_payment(
  p_kind text,
  p_bill_id uuid,
  p_request_id uuid,
  p_amount_cents integer,
  p_paid_on date,
  p_due_date date,
  p_method public.payment_method,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill record;
  v_id uuid;
  v_paid bigint;
  v_scheduled bigint;
  v_purchase_id uuid := case when p_kind = 'purchase' then p_bill_id end;
  v_expense_id uuid := case when p_kind = 'expense' then p_bill_id end;
begin
  select * into v_bill from private.lock_bill(p_kind, p_bill_id);
  if v_bill.business_id is null then
    raise exception 'Registro não encontrado.' using errcode = '22023';
  end if;
  perform private.assert_can_write(v_bill.business_id);
  if p_request_id is null then
    raise exception 'Identificador da requisição é obrigatório.' using errcode = '22023';
  end if;
  select b.id into v_id from public.bill_payments b where b.business_id = v_bill.business_id and b.client_request_id = p_request_id;
  if found then
    return v_id;
  end if;
  if v_bill.status <> 'active' then
    raise exception 'Registro cancelado não aceita pagamentos.' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Informe um valor maior que zero.' using errcode = '22023';
  end if;
  if p_paid_on is null and p_due_date is null then
    raise exception 'Informe a data do pagamento ou o vencimento da parcela.' using errcode = '22023';
  end if;
  if p_paid_on is not null and p_paid_on > private.business_today(v_bill.business_id) then
    raise exception 'A data do pagamento não pode estar no futuro.' using errcode = '22023';
  end if;

  select c.paid_cents, c.scheduled_cents into v_paid, v_scheduled from private.bill_committed(v_purchase_id, v_expense_id) c;
  if v_paid + v_scheduled + p_amount_cents > v_bill.total_cents then
    raise exception 'O valor (%) excede o saldo sem parcela definida (%).',
      private.fmt_brl(p_amount_cents), private.fmt_brl(v_bill.total_cents - v_paid - v_scheduled) using errcode = '22023';
  end if;

  insert into public.bill_payments (
    business_id, purchase_id, expense_id, amount_cents, due_date, paid_on, method, notes,
    created_by, paid_by, paid_recorded_at, client_request_id
  ) values (
    v_bill.business_id, v_purchase_id, v_expense_id, p_amount_cents, p_due_date, p_paid_on,
    case when p_paid_on is not null then coalesce(p_method, 'outro') else p_method end,
    nullif(btrim(p_notes), ''), (select auth.uid()),
    case when p_paid_on is not null then (select auth.uid()) end,
    case when p_paid_on is not null then now() end,
    p_request_id
  ) returning id into v_id;
  return v_id;
end;
$$;

-- Marca uma parcela prevista como paga.
create function public.pay_bill_installment(p_bill_payment_id uuid, p_paid_on date, p_method public.payment_method)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.bill_payments;
  v_bill record;
begin
  select * into v_payment from public.bill_payments b where b.id = p_bill_payment_id;
  if not found then
    raise exception 'Parcela não encontrada.' using errcode = '22023';
  end if;
  if v_payment.purchase_id is not null then
    select * into v_bill from private.lock_bill('purchase', v_payment.purchase_id);
  else
    select * into v_bill from private.lock_bill('expense', v_payment.expense_id);
  end if;
  perform private.assert_can_write(v_bill.business_id);
  if v_payment.voided_at is not null then
    raise exception 'Parcela estornada.' using errcode = '22023';
  end if;
  if v_payment.paid_on is not null then
    raise exception 'Esta parcela já foi paga.' using errcode = '22023';
  end if;
  if p_paid_on is null or p_paid_on > private.business_today(v_bill.business_id) then
    raise exception 'Informe uma data de pagamento que não esteja no futuro.' using errcode = '22023';
  end if;
  update public.bill_payments
  set paid_on = p_paid_on, method = coalesce(p_method, method, 'outro'),
      paid_by = (select auth.uid()), paid_recorded_at = now()
  where id = p_bill_payment_id;
end;
$$;

create function public.void_bill_payment(p_bill_payment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.bill_payments;
  v_bill record;
begin
  select * into v_payment from public.bill_payments b where b.id = p_bill_payment_id;
  if not found then
    raise exception 'Pagamento não encontrado.' using errcode = '22023';
  end if;
  if v_payment.purchase_id is not null then
    select * into v_bill from private.lock_bill('purchase', v_payment.purchase_id);
  else
    select * into v_bill from private.lock_bill('expense', v_payment.expense_id);
  end if;
  perform private.assert_can_write(v_bill.business_id);
  if v_payment.voided_at is not null then
    raise exception 'Este lançamento já foi estornado.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Informe o motivo do estorno.' using errcode = '22023';
  end if;
  update public.bill_payments
  set voided_at = now(), voided_by = (select auth.uid()), void_reason = btrim(p_reason)
  where id = p_bill_payment_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS e privilégios
-- -----------------------------------------------------------------------------

alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;
alter table public.expenses enable row level security;
alter table public.bill_payments enable row level security;

create policy purchases_select on public.purchases for select to authenticated using (private.is_member(business_id));
create policy purchase_items_select on public.purchase_items for select to authenticated using (private.is_member(business_id));
create policy expenses_select on public.expenses for select to authenticated using (private.is_member(business_id));
create policy bill_payments_select on public.bill_payments for select to authenticated using (private.is_member(business_id));

revoke all on public.purchases, public.purchase_items, public.expenses, public.bill_payments from anon, authenticated, public;
grant select on public.purchases, public.purchase_items, public.expenses, public.bill_payments to authenticated;

revoke all on function
  public.create_purchase(uuid, uuid, jsonb),
  public.update_purchase(uuid, jsonb),
  public.create_expense(uuid, uuid, jsonb),
  public.update_expense(uuid, jsonb),
  public.cancel_bill(text, uuid, text, boolean),
  public.add_bill_payment(text, uuid, uuid, integer, date, date, public.payment_method, text),
  public.pay_bill_installment(uuid, date, public.payment_method),
  public.void_bill_payment(uuid, text)
from public, anon;

grant execute on function
  public.create_purchase(uuid, uuid, jsonb),
  public.update_purchase(uuid, jsonb),
  public.create_expense(uuid, uuid, jsonb),
  public.update_expense(uuid, jsonb),
  public.cancel_bill(text, uuid, text, boolean),
  public.add_bill_payment(text, uuid, uuid, integer, date, date, public.payment_method, text),
  public.pay_bill_installment(uuid, date, public.payment_method),
  public.void_bill_payment(uuid, text)
to authenticated;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_member(uuid),
  private.has_role(uuid, text[]),
  private.can_write(uuid),
  private.shares_business(uuid),
  private.unit_dimension(text),
  private.unit_factor(text)
to authenticated;
