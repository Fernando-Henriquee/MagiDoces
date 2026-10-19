-- =============================================================================
-- Magi Doces — 0200 Cadastros
-- Clientes, fornecedores, produtos (com histórico de preço/custo), ingredientes,
-- receitas e cálculo de custo unitário com conversão de unidades compatíveis.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Clientes
-- -----------------------------------------------------------------------------

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  phone text check (phone is null or char_length(phone) <= 30),
  notes text check (notes is null or char_length(notes) <= 2000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  unique (business_id, id)
);

create index customers_business_name_idx on public.customers (business_id, lower(name));

-- -----------------------------------------------------------------------------
-- Fornecedores
-- -----------------------------------------------------------------------------

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  phone text check (phone is null or char_length(phone) <= 30),
  notes text check (notes is null or char_length(notes) <= 2000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  unique (business_id, id)
);

create unique index suppliers_business_name_uq on public.suppliers (business_id, lower(btrim(name)));

-- -----------------------------------------------------------------------------
-- Produtos
-- -----------------------------------------------------------------------------

create table public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text check (description is null or char_length(description) <= 2000),
  category text check (category is null or char_length(category) <= 60),
  unit text not null default 'un' check (char_length(btrim(unit)) between 1 and 20),
  -- Preço de venda atual. NULL = ainda não definido (será informado na venda).
  price_cents integer check (price_cents is null or price_cents between 0 and 100000000),
  -- 'manual': usa manual_unit_cost_cents; 'recipe': usa o custo calculado da receita.
  cost_mode text not null default 'manual' check (cost_mode in ('manual', 'recipe')),
  manual_unit_cost_cents integer check (manual_unit_cost_cents is null or manual_unit_cost_cents between 0 and 100000000),
  photo_path text check (photo_path is null or char_length(photo_path) <= 300),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  unique (business_id, id)
);

create unique index products_business_name_uq on public.products (business_id, lower(btrim(name)));

create table public.product_price_history (
  id bigint generated always as identity primary key,
  business_id uuid not null,
  product_id uuid not null,
  price_cents integer,
  manual_unit_cost_cents integer,
  cost_mode text not null,
  changed_at timestamptz not null default now(),
  changed_by uuid,
  foreign key (business_id, product_id) references public.products (business_id, id) on delete cascade
);

create index product_price_history_product_idx on public.product_price_history (product_id, changed_at desc);

create function private.record_product_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
     or new.price_cents is distinct from old.price_cents
     or new.manual_unit_cost_cents is distinct from old.manual_unit_cost_cents
     or new.cost_mode is distinct from old.cost_mode then
    insert into public.product_price_history (business_id, product_id, price_cents, manual_unit_cost_cents, cost_mode, changed_by)
    values (new.business_id, new.id, new.price_cents, new.manual_unit_cost_cents, new.cost_mode, (select auth.uid()));
  end if;
  return null;
end;
$$;

create trigger products_price_history
  after insert or update on public.products
  for each row execute function private.record_product_price();

-- -----------------------------------------------------------------------------
-- Unidades de medida
-- Dimensões: massa (base g), volume (base ml), contagem (base un).
-- Só há conversão entre unidades da mesma dimensão.
-- -----------------------------------------------------------------------------

create function private.unit_dimension(p_unit text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_unit
    when 'mg' then 'mass' when 'g' then 'mass' when 'kg' then 'mass'
    when 'ml' then 'volume' when 'l' then 'volume'
    when 'un' then 'count' when 'dz' then 'count'
  end;
$$;

create function private.unit_factor(p_unit text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case p_unit
    when 'mg' then 0.001 when 'g' then 1 when 'kg' then 1000
    when 'ml' then 1 when 'l' then 1000
    when 'un' then 1 when 'dz' then 12
  end::numeric;
$$;

-- -----------------------------------------------------------------------------
-- Ingredientes
-- -----------------------------------------------------------------------------

create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  -- Unidade em que o ingrediente é adquirido (ex.: kg de açúcar, l de leite).
  unit public.measure_unit not null,
  -- Quantidade adquirida pelo custo informado (ex.: 5 kg por R$ 25,00).
  purchase_quantity numeric(14, 3) not null check (purchase_quantity > 0),
  purchase_price_cents integer not null check (purchase_price_cents between 0 and 100000000),
  -- Aproveitamento (%): parte utilizável após limpeza/perdas (ex.: morango 85%).
  yield_percent numeric(5, 2) not null default 100 check (yield_percent > 0 and yield_percent <= 100),
  notes text check (notes is null or char_length(notes) <= 2000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  unique (business_id, id)
);

create unique index ingredients_business_name_uq on public.ingredients (business_id, lower(btrim(name)));

-- -----------------------------------------------------------------------------
-- Receitas
-- -----------------------------------------------------------------------------

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  product_id uuid not null,
  -- Quantas unidades do produto a receita rende.
  yield_quantity numeric(12, 3) not null check (yield_quantity > 0),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (product_id),
  foreign key (business_id, product_id) references public.products (business_id, id) on delete cascade
);

create table public.recipe_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  recipe_id uuid not null,
  ingredient_id uuid not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit public.measure_unit not null,
  unique (recipe_id, ingredient_id),
  foreign key (business_id, recipe_id) references public.recipes (business_id, id) on delete cascade,
  foreign key (business_id, ingredient_id) references public.ingredients (business_id, id)
);

create index recipe_items_ingredient_idx on public.recipe_items (ingredient_id);

-- Custos adicionais por receita (por lote): embalagem, gás, energia etc.
create table public.recipe_extra_costs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  recipe_id uuid not null,
  description text not null check (char_length(btrim(description)) between 1 and 120),
  amount_cents integer not null check (amount_cents between 0 and 100000000),
  foreign key (business_id, recipe_id) references public.recipes (business_id, id) on delete cascade
);

create index recipe_extra_costs_recipe_idx on public.recipe_extra_costs (recipe_id);

-- Unidade do item da receita precisa ser da mesma dimensão do ingrediente.
create function private.validate_recipe_item()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ingredient_unit text;
  v_ingredient_name text;
begin
  select i.unit, i.name into v_ingredient_unit, v_ingredient_name
  from public.ingredients i
  where i.id = new.ingredient_id and i.business_id = new.business_id;

  if private.unit_dimension(new.unit) is distinct from private.unit_dimension(v_ingredient_unit) then
    raise exception 'Unidade incompatível: "%" é medido em %, não é possível usar %.',
      v_ingredient_name, v_ingredient_unit, new.unit
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger recipe_items_validate
  before insert or update on public.recipe_items
  for each row execute function private.validate_recipe_item();

-- Mudança de dimensão de um ingrediente usado em receitas é bloqueada.
create function private.validate_ingredient_unit_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.unit_dimension(new.unit) is distinct from private.unit_dimension(old.unit)
     and exists (select 1 from public.recipe_items ri where ri.ingredient_id = new.id) then
    raise exception 'O ingrediente "%" é usado em receitas; não é possível trocar % por %.',
      new.name, old.unit, new.unit
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger ingredients_unit_change
  before update of unit on public.ingredients
  for each row execute function private.validate_ingredient_unit_change();

-- -----------------------------------------------------------------------------
-- Custos (views com security_invoker: respeitam a RLS de quem consulta)
--
-- custo por unidade-base do ingrediente =
--     preço de aquisição / (quantidade adquirida × fator da unidade × aproveitamento)
-- custo do item da receita = quantidade × fator da unidade do item × custo por unidade-base
-- custo do lote = Σ itens + Σ custos adicionais
-- custo unitário = round(custo do lote / rendimento)   (meio para longe do zero)
-- -----------------------------------------------------------------------------

create view public.v_recipe_item_costs
with (security_invoker = true) as
select
  ri.id as recipe_item_id,
  ri.business_id,
  ri.recipe_id,
  ri.ingredient_id,
  i.name as ingredient_name,
  ri.quantity,
  ri.unit,
  i.unit as ingredient_unit,
  ri.quantity * private.unit_factor(ri.unit) * i.purchase_price_cents
    / (i.purchase_quantity * private.unit_factor(i.unit) * i.yield_percent / 100) as cost_cents_exact
from public.recipe_items ri
join public.ingredients i on i.id = ri.ingredient_id;

create view public.v_recipe_costs
with (security_invoker = true) as
select
  r.id as recipe_id,
  r.business_id,
  r.product_id,
  r.yield_quantity,
  coalesce(ing.ingredient_count, 0)::integer as ingredient_count,
  coalesce(ing.ingredients_cost, 0) as ingredients_cost_cents_exact,
  coalesce(ext.extra_count, 0)::integer as extra_cost_count,
  coalesce(ext.extra_cost, 0)::bigint as extra_costs_cents,
  coalesce(ing.ingredients_cost, 0) + coalesce(ext.extra_cost, 0) as batch_cost_cents_exact,
  round((coalesce(ing.ingredients_cost, 0) + coalesce(ext.extra_cost, 0)) / r.yield_quantity)::integer as unit_cost_cents
from public.recipes r
left join lateral (
  select count(*) as ingredient_count, sum(c.cost_cents_exact) as ingredients_cost
  from public.v_recipe_item_costs c
  where c.recipe_id = r.id
) ing on true
left join lateral (
  select count(*) as extra_count, sum(e.amount_cents) as extra_cost
  from public.recipe_extra_costs e
  where e.recipe_id = r.id
) ext on true;

-- Custo efetivo do produto: receita (se cost_mode = 'recipe' e houver receita com
-- componentes) ou custo manual. NULL quando nenhum custo foi informado.
create view public.v_products
with (security_invoker = true) as
select
  p.id,
  p.business_id,
  p.name,
  p.description,
  p.category,
  p.unit,
  p.price_cents,
  p.cost_mode,
  p.manual_unit_cost_cents,
  p.photo_path,
  p.active,
  p.created_at,
  p.updated_at,
  rc.recipe_id,
  rc.unit_cost_cents as recipe_unit_cost_cents,
  case
    when p.cost_mode = 'recipe' and rc.recipe_id is not null and (rc.ingredient_count + rc.extra_cost_count) > 0
      then rc.unit_cost_cents
    else p.manual_unit_cost_cents
  end as effective_unit_cost_cents,
  case
    when p.cost_mode = 'recipe' and rc.recipe_id is not null and (rc.ingredient_count + rc.extra_cost_count) > 0
      then 'recipe'
    when p.manual_unit_cost_cents is not null then 'manual'
  end as cost_source
from public.products p
left join public.v_recipe_costs rc on rc.product_id = p.id;

-- -----------------------------------------------------------------------------
-- Triggers de autoria / atualização
-- -----------------------------------------------------------------------------

create trigger customers_created_by before insert or update on public.customers
  for each row execute function private.stamp_created_by();
create trigger customers_touch before update on public.customers
  for each row execute function private.touch_updated_at();

create trigger suppliers_created_by before insert or update on public.suppliers
  for each row execute function private.stamp_created_by();
create trigger suppliers_touch before update on public.suppliers
  for each row execute function private.touch_updated_at();

create trigger products_created_by before insert or update on public.products
  for each row execute function private.stamp_created_by();
create trigger products_touch before update on public.products
  for each row execute function private.touch_updated_at();

create trigger ingredients_created_by before insert or update on public.ingredients
  for each row execute function private.stamp_created_by();
create trigger ingredients_touch before update on public.ingredients
  for each row execute function private.touch_updated_at();

create trigger recipes_touch before update on public.recipes
  for each row execute function private.touch_updated_at();

-- -----------------------------------------------------------------------------
-- RLS — leitura para membros; escrita para owner/editor
-- -----------------------------------------------------------------------------

alter table public.customers enable row level security;
alter table public.suppliers enable row level security;
alter table public.products enable row level security;
alter table public.product_price_history enable row level security;
alter table public.ingredients enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_items enable row level security;
alter table public.recipe_extra_costs enable row level security;

do $$
declare
  v_table text;
begin
  foreach v_table in array array['customers', 'suppliers', 'products', 'ingredients', 'recipes', 'recipe_items', 'recipe_extra_costs'] loop
    execute format('create policy %I on public.%I for select to authenticated using (private.is_member(business_id))', v_table || '_select', v_table);
    execute format('create policy %I on public.%I for insert to authenticated with check (private.can_write(business_id))', v_table || '_insert', v_table);
    execute format('create policy %I on public.%I for update to authenticated using (private.can_write(business_id)) with check (private.can_write(business_id))', v_table || '_update', v_table);
    execute format('create policy %I on public.%I for delete to authenticated using (private.can_write(business_id))', v_table || '_delete', v_table);
  end loop;
end;
$$;

create policy product_price_history_select on public.product_price_history
  for select to authenticated
  using (private.is_member(business_id));

-- -----------------------------------------------------------------------------
-- Privilégios
-- -----------------------------------------------------------------------------

revoke all on public.customers, public.suppliers, public.products, public.product_price_history,
  public.ingredients, public.recipes, public.recipe_items, public.recipe_extra_costs,
  public.v_recipe_item_costs, public.v_recipe_costs, public.v_products
from anon, authenticated, public;

grant select on public.customers, public.suppliers, public.products, public.product_price_history,
  public.ingredients, public.recipes, public.recipe_items, public.recipe_extra_costs,
  public.v_recipe_item_costs, public.v_recipe_costs, public.v_products
to authenticated;

-- Privilégios por coluna: business_id, id e campos de autoria nunca são graváveis
-- pelo cliente após a criação.
grant insert (business_id, name, phone, notes, active) on public.customers to authenticated;
grant update (name, phone, notes, active) on public.customers to authenticated;

grant insert (business_id, name, phone, notes, active) on public.suppliers to authenticated;
grant update (name, phone, notes, active) on public.suppliers to authenticated;

grant insert (business_id, name, description, category, unit, price_cents, cost_mode, manual_unit_cost_cents, photo_path, active)
  on public.products to authenticated;
grant update (name, description, category, unit, price_cents, cost_mode, manual_unit_cost_cents, photo_path, active)
  on public.products to authenticated;

grant insert (business_id, name, unit, purchase_quantity, purchase_price_cents, yield_percent, notes, active)
  on public.ingredients to authenticated;
grant update (name, unit, purchase_quantity, purchase_price_cents, yield_percent, notes, active)
  on public.ingredients to authenticated;

grant insert (business_id, product_id, yield_quantity, notes) on public.recipes to authenticated;
grant update (yield_quantity, notes) on public.recipes to authenticated;

grant insert (business_id, recipe_id, ingredient_id, quantity, unit) on public.recipe_items to authenticated;
grant update (quantity, unit) on public.recipe_items to authenticated;

grant insert (business_id, recipe_id, description, amount_cents) on public.recipe_extra_costs to authenticated;
grant update (description, amount_cents) on public.recipe_extra_costs to authenticated;

grant delete on public.customers, public.suppliers, public.products,
  public.ingredients, public.recipes, public.recipe_items, public.recipe_extra_costs
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
