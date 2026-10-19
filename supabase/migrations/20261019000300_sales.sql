-- =============================================================================
-- Magi Doces — 0300 Vendas e recebimentos
--
-- Regras:
--   * Linha:  subtotal = round(quantidade × preço unitário)  (meio para longe do zero)
--             total    = subtotal − desconto da linha        (desconto ≤ subtotal)
--   * Venda:  total = Σ subtotais − Σ descontos de linha − desconto da venda  (≥ 0)
--             Totais armazenados são mantidos SOMENTE por trigger a partir dos itens.
--   * Recebido líquido = Σ recebimentos válidos − Σ reembolsos válidos
--             0 ≤ recebido líquido ≤ total (venda cancelada: recebido líquido = 0)
--   * Saldo = total − recebido líquido (derivado; nunca armazenado).
--   * Preço e custo unitário são copiados para o item no momento da venda.
--   * Escrita somente via RPC (SECURITY DEFINER) — sem privilégios diretos.
-- =============================================================================

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  customer_id uuid,
  sale_date date not null,
  due_date date,
  -- Forma de pagamento combinada/esperada. Os recebimentos têm a forma efetiva.
  payment_method public.payment_method,
  discount_cents integer not null default 0 check (discount_cents between 0 and 100000000),
  items_subtotal_cents bigint not null default 0,
  items_discount_cents bigint not null default 0,
  total_cents bigint not null default 0,
  cost_total_cents bigint not null default 0,
  items_without_cost integer not null default 0,
  notes text check (notes is null or char_length(notes) <= 2000),
  status text not null default 'active' check (status in ('active', 'cancelled')),
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 500),
  -- Importada sem informação de pagamento: precisa de confirmação manual.
  payment_confirmation_pending boolean not null default false,
  source text not null default 'manual' check (source in ('manual', 'import')),
  import_batch_id uuid,
  import_fingerprint text check (import_fingerprint is null or char_length(import_fingerprint) <= 128),
  client_request_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (business_id, id),
  foreign key (business_id, customer_id) references public.customers (business_id, id),
  constraint sales_total_consistent check (total_cents = items_subtotal_cents - items_discount_cents - discount_cents),
  constraint sales_total_non_negative check (total_cents >= 0),
  constraint sales_cancel_consistent check ((status = 'cancelled') = (cancelled_at is not null)),
  constraint sales_due_after_sale check (due_date is null or due_date >= sale_date)
);

create unique index sales_request_uq on public.sales (business_id, client_request_id) where client_request_id is not null;
create unique index sales_import_fingerprint_uq on public.sales (business_id, import_fingerprint) where import_fingerprint is not null;
create index sales_business_date_idx on public.sales (business_id, sale_date desc);
create index sales_customer_idx on public.sales (business_id, customer_id);
create index sales_due_idx on public.sales (business_id, due_date) where status = 'active';

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  sale_id uuid not null,
  product_id uuid not null,
  position smallint not null default 0,
  -- Snapshots: preservam o histórico mesmo que o produto mude depois.
  product_name text not null,
  unit text not null default 'un',
  quantity numeric(12, 3) not null check (quantity > 0 and quantity <= 100000),
  unit_price_cents integer not null check (unit_price_cents between 0 and 100000000),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  unit_cost_cents integer check (unit_cost_cents is null or unit_cost_cents between 0 and 100000000),
  cost_source text check (cost_source is null or cost_source in ('manual', 'recipe', 'import_current')),
  price_inferred boolean not null default false,
  line_subtotal_cents bigint generated always as (round(quantity * unit_price_cents)::bigint) stored,
  line_total_cents bigint generated always as (round(quantity * unit_price_cents)::bigint - discount_cents) stored,
  line_cost_cents bigint generated always as (round(quantity * unit_cost_cents)::bigint) stored,
  created_at timestamptz not null default now(),
  foreign key (business_id, sale_id) references public.sales (business_id, id) on delete cascade,
  foreign key (business_id, product_id) references public.products (business_id, id),
  constraint sale_items_discount_le_subtotal check (discount_cents <= round(quantity * unit_price_cents))
);

create index sale_items_sale_idx on public.sale_items (sale_id);
create index sale_items_product_idx on public.sale_items (business_id, product_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  sale_id uuid not null,
  -- receipt: recebimento do cliente; refund: devolução de dinheiro ao cliente.
  kind text not null default 'receipt' check (kind in ('receipt', 'refund')),
  amount_cents integer not null check (amount_cents > 0 and amount_cents <= 100000000),
  paid_on date not null,
  method public.payment_method not null,
  notes text check (notes is null or char_length(notes) <= 500),
  received_by uuid,
  created_at timestamptz not null default now(),
  -- Estorno/anulação: o registro é mantido, mas deixa de contar em qualquer total.
  voided_at timestamptz,
  voided_by uuid,
  void_reason text check (void_reason is null or char_length(void_reason) <= 500),
  -- Data inferida na importação (ex.: planilha dizia "pago" sem data).
  is_inferred boolean not null default false,
  import_batch_id uuid,
  client_request_id uuid,
  foreign key (business_id, sale_id) references public.sales (business_id, id) on delete cascade,
  constraint payments_void_consistent check ((voided_at is null) = (void_reason is null))
);

create unique index payments_request_uq on public.payments (business_id, client_request_id) where client_request_id is not null;
create index payments_sale_idx on public.payments (sale_id);
create index payments_business_date_idx on public.payments (business_id, paid_on);

-- -----------------------------------------------------------------------------
-- Manutenção dos totais da venda
-- -----------------------------------------------------------------------------

create function private.sales_compute_total()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Totais nunca vêm do cliente: começam zerados e são calculados pelos itens.
    new.items_subtotal_cents := 0;
    new.items_discount_cents := 0;
    new.cost_total_cents := 0;
    new.items_without_cost := 0;
  end if;
  new.total_cents := new.items_subtotal_cents - new.items_discount_cents - new.discount_cents;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger sales_compute_total
  before insert or update on public.sales
  for each row execute function private.sales_compute_total();

create function private.refresh_sale_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale_id uuid := coalesce(new.sale_id, old.sale_id);
begin
  update public.sales s
  set items_subtotal_cents = x.subtotal,
      items_discount_cents = x.discount,
      cost_total_cents = x.cost,
      items_without_cost = x.without_cost
  from (
    select
      coalesce(sum(i.line_subtotal_cents), 0) as subtotal,
      coalesce(sum(i.discount_cents), 0) as discount,
      coalesce(sum(i.line_cost_cents), 0) as cost,
      count(*) filter (where i.unit_cost_cents is null)::integer as without_cost
    from public.sale_items i
    where i.sale_id = v_sale_id
  ) x
  where s.id = v_sale_id;
  return null;
end;
$$;

create trigger sale_items_refresh_totals
  after insert or update or delete on public.sale_items
  for each row execute function private.refresh_sale_totals();

-- -----------------------------------------------------------------------------
-- Invariantes de pagamento (verificadas no COMMIT, para permitir edições em etapas)
-- -----------------------------------------------------------------------------

create function private.sale_net_paid(p_sale_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(case when p.kind = 'receipt' then p.amount_cents else -p.amount_cents end), 0)::bigint
  from public.payments p
  where p.sale_id = p_sale_id and p.voided_at is null;
$$;

create function private.check_sale_payment_bounds()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale_id uuid;
  v_sale record;
  v_net bigint;
begin
  if tg_table_name = 'sales' then
    v_sale_id := new.id;
  else
    v_sale_id := new.sale_id;
  end if;

  select s.total_cents, s.status into v_sale from public.sales s where s.id = v_sale_id;
  if not found then
    return null;
  end if;

  v_net := private.sale_net_paid(v_sale_id);
  if v_net < 0 then
    raise exception 'Reembolsos maiores que o valor recebido na venda.' using errcode = '23514';
  end if;
  if v_sale.status = 'cancelled' and v_net <> 0 then
    raise exception 'Venda cancelada não pode manter recebimentos válidos.' using errcode = '23514';
  end if;
  if v_net > v_sale.total_cents then
    raise exception 'O valor recebido excede o total da venda.' using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger sales_payment_bounds
  after insert or update on public.sales
  deferrable initially deferred
  for each row execute function private.check_sale_payment_bounds();

create constraint trigger payments_payment_bounds
  after insert or update on public.payments
  deferrable initially deferred
  for each row execute function private.check_sale_payment_bounds();

-- Pagamentos são imutáveis, exceto pela anulação (estorno).
create function private.guard_payment_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.voided_at is not null then
    raise exception 'Recebimento já estornado não pode ser alterado.' using errcode = '23514';
  end if;
  if new.amount_cents <> old.amount_cents or new.kind <> old.kind or new.sale_id <> old.sale_id
     or new.paid_on <> old.paid_on or new.method <> old.method or new.business_id <> old.business_id then
    raise exception 'Recebimentos não podem ser editados; estorne e registre novamente.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger payments_guard_update
  before update on public.payments
  for each row execute function private.guard_payment_update();

-- -----------------------------------------------------------------------------
-- Auditoria
-- -----------------------------------------------------------------------------

create trigger sales_audit
  after insert or update on public.sales
  for each row execute function private.audit_row('sale');

create trigger payments_audit
  after insert or update on public.payments
  for each row execute function private.audit_row('payment');

-- -----------------------------------------------------------------------------
-- Funções internas
-- -----------------------------------------------------------------------------

create function private.fmt_brl(p_cents bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'R$ ' || replace(replace(replace(to_char(p_cents / 100.0, 'FM999,999,999,990.00'), ',', '#'), '.', ','), '#', '.');
$$;

create function private.jsonb_int(p_value jsonb, p_field text)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value -> p_field is null or jsonb_typeof(p_value -> p_field) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_value -> p_field) <> 'number' or (p_value ->> p_field) !~ '^-?[0-9]+$' then
    raise exception 'Campo "%" deve ser um número inteiro de centavos.', p_field using errcode = '22023';
  end if;
  return (p_value ->> p_field)::integer;
end;
$$;

-- Insere um item de venda copiando nome, unidade, preço padrão e custo vigente.
-- p_keep_cost preserva o custo histórico (p_kept_*) ao editar uma venda.
create function private.insert_sale_item(
  p_business_id uuid,
  p_sale_id uuid,
  p_item jsonb,
  p_position integer,
  p_require_active boolean,
  p_keep_cost boolean default false,
  p_kept_unit_cost_cents integer default null,
  p_kept_cost_source text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product record;
  v_quantity numeric;
  v_price integer;
  v_discount integer;
  v_cost integer;
  v_cost_source text;
begin
  if jsonb_typeof(p_item) <> 'object' then
    raise exception 'Item de venda inválido.' using errcode = '22023';
  end if;

  select vp.id, vp.name, vp.unit, vp.price_cents, vp.active, vp.effective_unit_cost_cents, vp.cost_source
  into v_product
  from public.v_products vp
  where vp.id = (p_item ->> 'product_id')::uuid and vp.business_id = p_business_id;

  if not found then
    raise exception 'Produto não encontrado neste negócio.' using errcode = '22023';
  end if;
  if p_require_active and not v_product.active then
    raise exception 'O produto "%" está desativado.', v_product.name using errcode = '22023';
  end if;

  if jsonb_typeof(p_item -> 'quantity') not in ('number', 'string') then
    raise exception 'Quantidade inválida para "%".', v_product.name using errcode = '22023';
  end if;
  v_quantity := (p_item ->> 'quantity')::numeric;
  if v_quantity is null or v_quantity <= 0 or v_quantity > 100000 or v_quantity <> round(v_quantity, 3) then
    raise exception 'Quantidade inválida para "%".', v_product.name using errcode = '22023';
  end if;

  v_price := coalesce(private.jsonb_int(p_item, 'unit_price_cents'), v_product.price_cents);
  if v_price is null then
    raise exception 'O produto "%" não tem preço definido; informe o preço unitário.', v_product.name using errcode = '22023';
  end if;
  if v_price < 0 then
    raise exception 'Preço unitário inválido para "%".', v_product.name using errcode = '22023';
  end if;

  v_discount := coalesce(private.jsonb_int(p_item, 'discount_cents'), 0);
  if v_discount < 0 or v_discount > round(v_quantity * v_price) then
    raise exception 'Desconto inválido para "%": não pode ser negativo nem maior que o valor do item.', v_product.name
      using errcode = '22023';
  end if;

  if p_keep_cost then
    v_cost := p_kept_unit_cost_cents;
    v_cost_source := p_kept_cost_source;
  else
    v_cost := v_product.effective_unit_cost_cents;
    v_cost_source := v_product.cost_source;
  end if;

  insert into public.sale_items (
    business_id, sale_id, product_id, position, product_name, unit,
    quantity, unit_price_cents, discount_cents, unit_cost_cents, cost_source, price_inferred
  ) values (
    p_business_id, p_sale_id, v_product.id, p_position, v_product.name, v_product.unit,
    v_quantity, v_price, v_discount, v_cost, v_cost_source,
    coalesce((p_item ->> 'price_inferred')::boolean, false)
  );
end;
$$;

create function private.validate_sale_header(p_business_id uuid, p_sale jsonb)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sale_date date;
  v_due_date date;
begin
  if jsonb_typeof(p_sale) <> 'object' then
    raise exception 'Dados da venda inválidos.' using errcode = '22023';
  end if;
  v_sale_date := (p_sale ->> 'sale_date')::date;
  if v_sale_date is null then
    raise exception 'Informe a data da venda.' using errcode = '22023';
  end if;
  if v_sale_date > private.business_today(p_business_id) + 366 or v_sale_date < date '2000-01-01' then
    raise exception 'Data da venda fora do intervalo permitido.' using errcode = '22023';
  end if;
  v_due_date := nullif(p_sale ->> 'due_date', '')::date;
  if v_due_date is not null and v_due_date < v_sale_date then
    raise exception 'O vencimento não pode ser anterior à data da venda.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_sale -> 'items') is distinct from 'array' or jsonb_array_length(p_sale -> 'items') = 0 then
    raise exception 'A venda precisa ter pelo menos um item.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_sale -> 'items') > 100 then
    raise exception 'Uma venda pode ter no máximo 100 itens.' using errcode = '22023';
  end if;
end;
$$;

create function private.resolve_sale_customer(p_business_id uuid, p_sale jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid := nullif(p_sale ->> 'customer_id', '')::uuid;
  v_new jsonb := p_sale -> 'new_customer';
begin
  if v_customer_id is not null then
    if not exists (select 1 from public.customers c where c.id = v_customer_id and c.business_id = p_business_id) then
      raise exception 'Cliente não encontrado neste negócio.' using errcode = '22023';
    end if;
    return v_customer_id;
  end if;

  if jsonb_typeof(v_new) = 'object' and nullif(btrim(v_new ->> 'name'), '') is not null then
    insert into public.customers (business_id, name, phone, created_by)
    values (p_business_id, btrim(v_new ->> 'name'), nullif(btrim(v_new ->> 'phone'), ''), (select auth.uid()))
    returning id into v_customer_id;
  end if;

  return v_customer_id;
end;
$$;

-- Retrato completo da venda para a auditoria (cabeçalho + itens + totais).
create function private.sale_snapshot(p_sale_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'cliente_id', s.customer_id,
    'cliente', c.name,
    'data_venda', s.sale_date,
    'vencimento', s.due_date,
    'forma_pagamento', s.payment_method,
    'desconto_venda_cents', s.discount_cents,
    'total_cents', s.total_cents,
    'observacoes', s.notes,
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object(
        'produto', i.product_name,
        'quantidade', i.quantity,
        'preco_unitario_cents', i.unit_price_cents,
        'desconto_cents', i.discount_cents,
        'custo_unitario_cents', i.unit_cost_cents
      ) order by i.position)
      from public.sale_items i
      where i.sale_id = s.id
    ), '[]'::jsonb)
  )
  from public.sales s
  left join public.customers c on c.id = s.customer_id
  where s.id = p_sale_id;
$$;

create function private.set_audit_skip(p_skip boolean)
returns void
language sql
set search_path = ''
as $$
  select set_config('magi.audit_skip', case when p_skip then 'on' else 'off' end, true);
$$;

-- Bloqueia a venda para escrita e valida acesso. Retorna a linha bloqueada.
create function private.lock_sale(p_sale_id uuid)
returns public.sales
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.sales;
begin
  select * into v_sale from public.sales s where s.id = p_sale_id for update;
  if not found then
    raise exception 'Venda não encontrada.' using errcode = '22023';
  end if;
  perform private.assert_can_write(v_sale.business_id);
  return v_sale;
end;
$$;

-- Aplica o desconto da venda validando contra o total dos itens.
create function private.apply_sale_discount(p_sale_id uuid, p_sale jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_discount integer := coalesce(private.jsonb_int(p_sale, 'discount_cents'), 0);
  v_items_total bigint;
begin
  select s.items_subtotal_cents - s.items_discount_cents into v_items_total from public.sales s where s.id = p_sale_id;
  if v_discount < 0 or v_discount > v_items_total then
    raise exception 'O desconto da venda (%) não pode ser maior que o total dos itens (%).',
      private.fmt_brl(v_discount), private.fmt_brl(v_items_total) using errcode = '22023';
  end if;
  update public.sales set discount_cents = v_discount where id = p_sale_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPCs públicas
-- -----------------------------------------------------------------------------

-- Cria uma venda completa (itens + recebimento inicial opcional) numa transação.
-- Idempotente por p_request_id: reenviar a mesma requisição devolve a mesma venda.
--
-- p_sale = {
--   customer_id?, new_customer?: {name, phone?}, sale_date, due_date?, payment_method?,
--   discount_cents?, notes?,
--   items: [{product_id, quantity, unit_price_cents?, discount_cents?}],
--   payment?: {full?: boolean, amount_cents?, paid_on?, method?}
-- }
create function public.create_sale(p_business_id uuid, p_request_id uuid, p_sale jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale_id uuid;
  v_customer_id uuid;
  v_item jsonb;
  v_position integer := 0;
  v_total bigint;
  v_payment jsonb := p_sale -> 'payment';
  v_amount bigint;
  v_paid_on date;
begin
  perform private.assert_can_write(p_business_id);
  if p_request_id is null then
    raise exception 'Identificador da requisição é obrigatório.' using errcode = '22023';
  end if;

  select s.id into v_sale_id from public.sales s
  where s.business_id = p_business_id and s.client_request_id = p_request_id;
  if found then
    return v_sale_id;
  end if;

  perform private.validate_sale_header(p_business_id, p_sale);
  v_customer_id := private.resolve_sale_customer(p_business_id, p_sale);

  -- Etapas intermediárias não geram auditoria; um único evento é gravado ao final.
  perform private.set_audit_skip(true);

  insert into public.sales (
    business_id, customer_id, sale_date, due_date, payment_method, notes,
    client_request_id, created_by, updated_by
  ) values (
    p_business_id, v_customer_id, (p_sale ->> 'sale_date')::date, nullif(p_sale ->> 'due_date', '')::date,
    nullif(p_sale ->> 'payment_method', '')::public.payment_method, nullif(btrim(p_sale ->> 'notes'), ''),
    p_request_id, (select auth.uid()), (select auth.uid())
  )
  returning id into v_sale_id;

  for v_item in select value from jsonb_array_elements(p_sale -> 'items') loop
    perform private.insert_sale_item(p_business_id, v_sale_id, v_item, v_position, true);
    v_position := v_position + 1;
  end loop;

  perform private.apply_sale_discount(v_sale_id, p_sale);

  perform private.set_audit_skip(false);
  perform private.write_audit(p_business_id, 'sale.created', 'sale', v_sale_id,
    jsonb_build_object('venda', private.sale_snapshot(v_sale_id)));

  if jsonb_typeof(v_payment) = 'object' then
    select s.total_cents into v_total from public.sales s where s.id = v_sale_id;
    if coalesce((v_payment ->> 'full')::boolean, false) then
      v_amount := v_total;
    else
      v_amount := coalesce(private.jsonb_int(v_payment, 'amount_cents'), 0);
    end if;
    if v_amount < 0 or v_amount > v_total then
      raise exception 'O valor recebido (%) não pode ser maior que o total da venda (%).',
        private.fmt_brl(v_amount), private.fmt_brl(v_total) using errcode = '22023';
    end if;
    if v_amount > 0 then
      v_paid_on := coalesce(nullif(v_payment ->> 'paid_on', '')::date, (p_sale ->> 'sale_date')::date);
      if v_paid_on > private.business_today(p_business_id) then
        raise exception 'A data do recebimento não pode estar no futuro.' using errcode = '22023';
      end if;
      insert into public.payments (business_id, sale_id, kind, amount_cents, paid_on, method, received_by)
      values (p_business_id, v_sale_id, 'receipt', v_amount, v_paid_on,
              coalesce(nullif(v_payment ->> 'method', ''), nullif(p_sale ->> 'payment_method', ''), 'outro')::public.payment_method,
              (select auth.uid()));
    end if;
  end if;

  return v_sale_id;
exception
  when unique_violation then
    -- Requisição concorrente idêntica (duplo clique em duas abas): devolve a existente.
    select s.id into v_sale_id from public.sales s
    where s.business_id = p_business_id and s.client_request_id = p_request_id;
    if v_sale_id is not null then
      return v_sale_id;
    end if;
    raise;
end;
$$;

-- Edita uma venda ativa. Itens são substituídos; itens mantidos (mesmo id e mesmo
-- produto) preservam o custo histórico. Produtos já presentes na venda podem
-- continuar mesmo que tenham sido desativados. O novo total não pode ser menor
-- que o valor já recebido.
create function public.update_sale(p_sale_id uuid, p_sale jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.sales;
  v_before jsonb;
  v_after jsonb;
  v_kept jsonb;
  v_kept_item jsonb;
  v_item jsonb;
  v_product_id uuid;
  v_position integer := 0;
  v_total bigint;
  v_net bigint;
  v_customer_id uuid;
begin
  v_sale := private.lock_sale(p_sale_id);
  if v_sale.status <> 'active' then
    raise exception 'Venda cancelada não pode ser editada.' using errcode = '22023';
  end if;
  perform private.validate_sale_header(v_sale.business_id, p_sale);
  v_customer_id := private.resolve_sale_customer(v_sale.business_id, p_sale);
  v_before := private.sale_snapshot(p_sale_id);

  -- Custos históricos dos itens atuais, por id do item.
  select coalesce(jsonb_object_agg(i.id::text, jsonb_build_object(
           'product_id', i.product_id, 'unit_cost_cents', i.unit_cost_cents, 'cost_source', i.cost_source)), '{}'::jsonb)
  into v_kept
  from public.sale_items i where i.sale_id = p_sale_id;

  perform private.set_audit_skip(true);

  update public.sales
  set customer_id = v_customer_id,
      sale_date = (p_sale ->> 'sale_date')::date,
      due_date = nullif(p_sale ->> 'due_date', '')::date,
      payment_method = nullif(p_sale ->> 'payment_method', '')::public.payment_method,
      notes = nullif(btrim(p_sale ->> 'notes'), ''),
      discount_cents = 0,
      updated_by = (select auth.uid())
  where id = p_sale_id;

  delete from public.sale_items where sale_id = p_sale_id;

  for v_item in select value from jsonb_array_elements(p_sale -> 'items') loop
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_kept_item := v_kept -> (v_item ->> 'id');
    if v_kept_item is not null and (v_kept_item ->> 'product_id')::uuid = v_product_id then
      perform private.insert_sale_item(v_sale.business_id, p_sale_id, v_item, v_position, false,
        true, (v_kept_item ->> 'unit_cost_cents')::integer, v_kept_item ->> 'cost_source');
    else
      perform private.insert_sale_item(v_sale.business_id, p_sale_id, v_item, v_position,
        not exists (select 1 from jsonb_each(v_kept) k where (k.value ->> 'product_id')::uuid = v_product_id));
    end if;
    v_position := v_position + 1;
  end loop;

  perform private.apply_sale_discount(p_sale_id, p_sale);
  perform private.set_audit_skip(false);

  select s.total_cents into v_total from public.sales s where s.id = p_sale_id;
  v_net := private.sale_net_paid(p_sale_id);
  if v_net > v_total then
    raise exception 'O novo total (%) é menor que o valor já recebido (%). Estorne ou reembolse a diferença antes.',
      private.fmt_brl(v_total), private.fmt_brl(v_net) using errcode = '22023';
  end if;

  v_after := private.sale_snapshot(p_sale_id);
  if v_after is distinct from v_before then
    perform private.write_audit(v_sale.business_id, 'sale.updated', 'sale', p_sale_id,
      jsonb_build_object('antes', v_before, 'depois', v_after));
  end if;

  return p_sale_id;
end;
$$;

-- Altera somente o vencimento (ação rápida na tela de contas a receber).
create function public.change_sale_due_date(p_sale_id uuid, p_due_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.sales;
begin
  v_sale := private.lock_sale(p_sale_id);
  if v_sale.status <> 'active' then
    raise exception 'Venda cancelada não pode ter o vencimento alterado.' using errcode = '22023';
  end if;
  if p_due_date is not null and p_due_date < v_sale.sale_date then
    raise exception 'O vencimento não pode ser anterior à data da venda.' using errcode = '22023';
  end if;
  update public.sales set due_date = p_due_date, updated_by = (select auth.uid()) where id = p_sale_id;
end;
$$;

-- Cancela a venda de forma rastreável.
-- p_payment_action: 'none' (exige que não haja recebimentos), 'void' (estorna os
-- recebimentos — lançados por engano) ou 'refund' (registra devolução ao cliente hoje).
create function public.cancel_sale(p_sale_id uuid, p_reason text, p_payment_action text default 'none')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.sales;
  v_net bigint;
  v_method public.payment_method;
begin
  v_sale := private.lock_sale(p_sale_id);
  if v_sale.status = 'cancelled' then
    raise exception 'A venda já está cancelada.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Informe o motivo do cancelamento.' using errcode = '22023';
  end if;
  if p_payment_action not in ('none', 'void', 'refund') then
    raise exception 'Ação inválida para os recebimentos.' using errcode = '22023';
  end if;

  v_net := private.sale_net_paid(p_sale_id);
  if v_net > 0 then
    if p_payment_action = 'none' then
      raise exception 'A venda tem % recebidos. Escolha estornar os lançamentos ou registrar o reembolso.',
        private.fmt_brl(v_net) using errcode = '22023';
    elsif p_payment_action = 'void' then
      update public.payments
      set voided_at = now(), voided_by = (select auth.uid()),
          void_reason = left('Cancelamento da venda: ' || btrim(p_reason), 500)
      where sale_id = p_sale_id and voided_at is null;
    else
      select p.method into v_method from public.payments p
      where p.sale_id = p_sale_id and p.voided_at is null and p.kind = 'receipt'
      order by p.paid_on desc, p.created_at desc limit 1;
      insert into public.payments (business_id, sale_id, kind, amount_cents, paid_on, method, notes, received_by)
      values (v_sale.business_id, p_sale_id, 'refund', v_net, private.business_today(v_sale.business_id),
              coalesce(v_method, 'outro'), left('Reembolso por cancelamento: ' || btrim(p_reason), 500), (select auth.uid()));
    end if;
  end if;

  update public.sales
  set status = 'cancelled', cancelled_at = now(), cancelled_by = (select auth.uid()),
      cancel_reason = btrim(p_reason), updated_by = (select auth.uid())
  where id = p_sale_id;
end;
$$;

create function private.validate_payment_input(p_business_id uuid, p_amount_cents integer, p_paid_on date)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Informe um valor maior que zero.' using errcode = '22023';
  end if;
  if p_paid_on is null then
    raise exception 'Informe a data.' using errcode = '22023';
  end if;
  if p_paid_on > private.business_today(p_business_id) then
    raise exception 'A data não pode estar no futuro.' using errcode = '22023';
  end if;
end;
$$;

-- Registra um recebimento (total ou parcial). Idempotente por p_request_id.
create function public.register_payment(
  p_sale_id uuid,
  p_request_id uuid,
  p_amount_cents integer,
  p_paid_on date,
  p_method public.payment_method,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.sales;
  v_payment_id uuid;
  v_balance bigint;
begin
  v_sale := private.lock_sale(p_sale_id);
  if p_request_id is null then
    raise exception 'Identificador da requisição é obrigatório.' using errcode = '22023';
  end if;

  select p.id into v_payment_id from public.payments p
  where p.business_id = v_sale.business_id and p.client_request_id = p_request_id;
  if found then
    return v_payment_id;
  end if;

  if v_sale.status <> 'active' then
    raise exception 'Não é possível receber em uma venda cancelada.' using errcode = '22023';
  end if;
  perform private.validate_payment_input(v_sale.business_id, p_amount_cents, p_paid_on);
  if p_method is null then
    raise exception 'Informe a forma de pagamento.' using errcode = '22023';
  end if;

  v_balance := v_sale.total_cents - private.sale_net_paid(p_sale_id);
  if p_amount_cents > v_balance then
    raise exception 'O valor (%) é maior que o saldo devedor (%).',
      private.fmt_brl(p_amount_cents), private.fmt_brl(v_balance) using errcode = '22023';
  end if;

  insert into public.payments (business_id, sale_id, kind, amount_cents, paid_on, method, notes, received_by, client_request_id)
  values (v_sale.business_id, p_sale_id, 'receipt', p_amount_cents, p_paid_on, p_method,
          nullif(btrim(p_notes), ''), (select auth.uid()), p_request_id)
  returning id into v_payment_id;

  if v_sale.payment_confirmation_pending then
    perform private.set_audit_skip(true);
    update public.sales set payment_confirmation_pending = false, updated_by = (select auth.uid()) where id = p_sale_id;
    perform private.set_audit_skip(false);
  end if;

  return v_payment_id;
end;
$$;

-- Registra devolução de dinheiro ao cliente (saída de caixa). Idempotente.
create function public.register_refund(
  p_sale_id uuid,
  p_request_id uuid,
  p_amount_cents integer,
  p_paid_on date,
  p_method public.payment_method,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.sales;
  v_payment_id uuid;
  v_net bigint;
begin
  v_sale := private.lock_sale(p_sale_id);
  if p_request_id is null then
    raise exception 'Identificador da requisição é obrigatório.' using errcode = '22023';
  end if;

  select p.id into v_payment_id from public.payments p
  where p.business_id = v_sale.business_id and p.client_request_id = p_request_id;
  if found then
    return v_payment_id;
  end if;

  perform private.validate_payment_input(v_sale.business_id, p_amount_cents, p_paid_on);
  if char_length(btrim(coalesce(p_notes, ''))) < 3 then
    raise exception 'Informe o motivo do reembolso.' using errcode = '22023';
  end if;
  v_net := private.sale_net_paid(p_sale_id);
  if p_amount_cents > v_net then
    raise exception 'O reembolso (%) é maior que o valor recebido (%).',
      private.fmt_brl(p_amount_cents), private.fmt_brl(v_net) using errcode = '22023';
  end if;

  insert into public.payments (business_id, sale_id, kind, amount_cents, paid_on, method, notes, received_by, client_request_id)
  values (v_sale.business_id, p_sale_id, 'refund', p_amount_cents, p_paid_on, coalesce(p_method, 'outro'),
          btrim(p_notes), (select auth.uid()), p_request_id)
  returning id into v_payment_id;

  return v_payment_id;
end;
$$;

-- Estorna (anula) um recebimento ou reembolso lançado por engano. O registro
-- permanece no histórico com motivo, autor e data.
create function public.void_payment(p_payment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments;
  v_sale public.sales;
  v_net_after bigint;
begin
  select * into v_payment from public.payments p where p.id = p_payment_id;
  if not found then
    raise exception 'Recebimento não encontrado.' using errcode = '22023';
  end if;
  v_sale := private.lock_sale(v_payment.sale_id);
  if v_payment.voided_at is not null then
    raise exception 'Este lançamento já foi estornado.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Informe o motivo do estorno.' using errcode = '22023';
  end if;

  v_net_after := private.sale_net_paid(v_sale.id)
    - case when v_payment.kind = 'receipt' then v_payment.amount_cents else -v_payment.amount_cents end;
  if v_net_after < 0 then
    raise exception 'Estorne antes o reembolso vinculado a este recebimento.' using errcode = '22023';
  end if;
  if v_net_after > v_sale.total_cents then
    raise exception 'Estornar este reembolso deixaria a venda com recebimento acima do total.' using errcode = '22023';
  end if;

  update public.payments
  set voided_at = now(), voided_by = (select auth.uid()), void_reason = btrim(p_reason)
  where id = p_payment_id;
end;
$$;

-- Confirma que uma venda importada sem informação de pagamento está de fato em aberto.
create function public.confirm_sale_pending(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.sales;
begin
  v_sale := private.lock_sale(p_sale_id);
  if v_sale.payment_confirmation_pending then
    update public.sales set payment_confirmation_pending = false, updated_by = (select auth.uid()) where id = p_sale_id;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS — somente leitura direta; escrita apenas pelas RPCs acima
-- -----------------------------------------------------------------------------

alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.payments enable row level security;

create policy sales_select on public.sales for select to authenticated using (private.is_member(business_id));
create policy sale_items_select on public.sale_items for select to authenticated using (private.is_member(business_id));
create policy payments_select on public.payments for select to authenticated using (private.is_member(business_id));

revoke all on public.sales, public.sale_items, public.payments from anon, authenticated, public;
grant select on public.sales, public.sale_items, public.payments to authenticated;

revoke all on function
  public.create_sale(uuid, uuid, jsonb),
  public.update_sale(uuid, jsonb),
  public.change_sale_due_date(uuid, date),
  public.cancel_sale(uuid, text, text),
  public.register_payment(uuid, uuid, integer, date, public.payment_method, text),
  public.register_refund(uuid, uuid, integer, date, public.payment_method, text),
  public.void_payment(uuid, text),
  public.confirm_sale_pending(uuid)
from public, anon;

grant execute on function
  public.create_sale(uuid, uuid, jsonb),
  public.update_sale(uuid, jsonb),
  public.change_sale_due_date(uuid, date),
  public.cancel_sale(uuid, text, text),
  public.register_payment(uuid, uuid, integer, date, public.payment_method, text),
  public.register_refund(uuid, uuid, integer, date, public.payment_method, text),
  public.void_payment(uuid, text),
  public.confirm_sale_pending(uuid)
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
