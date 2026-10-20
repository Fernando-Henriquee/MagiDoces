-- =============================================================================
-- Magi Doces — 1000 Link de compras (a própria cliente anota a compra)
--
-- Um link público (ou QR code) por negócio, sem login:
--   * a cliente informa nome, celular, produtos e quando vai pagar (agora por
--     PIX, no dia padrão de vencimento ou em outra data);
--   * a compra vira uma venda normal, com origem 'self_service' e marcada
--     "para revisar" pelas sócias;
--   * a consulta "quanto devo" exige celular + código de 4 números.
--
-- Segurança:
--   * anon continua SEM acesso a tabelas e views. Executa somente as funções
--     storefront_* abaixo, que validam tudo e só devolvem o necessário.
--   * O link tem um token aleatório; desligar ou trocar o link invalida o antigo.
--   * Preço, nome e custo dos itens vêm sempre do cadastro (nunca do cliente).
--   * O código de consulta é guardado como hash com sal. Para um celular que já
--     é cliente, só as sócias geram o código (ninguém cria no lugar da cliente).
--   * Limites de frequência por celular, por origem (IP, guardado como hash) e
--     por negócio; 5 códigos errados bloqueiam a consulta do celular por 15 min.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Estrutura
-- -----------------------------------------------------------------------------

alter table public.businesses
  add column storefront_enabled boolean not null default false,
  add column storefront_token text check (storefront_token is null or storefront_token ~ '^[A-Za-z0-9_-]{16,64}$'),
  add column pix_city text check (pix_city is null or char_length(btrim(pix_city)) between 1 and 15);

create unique index businesses_storefront_token_uq on public.businesses (storefront_token) where storefront_token is not null;

comment on column public.businesses.storefront_token is 'Token do link público de compras (/compra/<token>). Trocar invalida o link antigo.';
comment on column public.businesses.pix_city is 'Cidade exibida no QR code PIX (até 15 caracteres).';

alter table public.sales drop constraint sales_source_check;
alter table public.sales add constraint sales_source_check check (source in ('manual', 'import', 'self_service'));

alter table public.sales
  -- Anotada pela própria cliente: aguarda a revisão de uma sócia.
  add column self_service_review_pending boolean not null default false,
  -- A cliente avisou pelo link que já pagou (a sócia confere e registra o recebimento).
  add column customer_reported_paid_at timestamptz,
  -- Como a cliente se identificou no link: {name, phone, payment, new_customer}.
  add column self_service_contact jsonb check (self_service_contact is null or jsonb_typeof(self_service_contact) = 'object');

create index sales_review_idx on public.sales (business_id) where self_service_review_pending;

-- Celular brasileiro só com dígitos (DDD + número), sem o 55. NULL se inválido.
create function private.normalize_phone(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when d ~ '^[1-9][0-9]{9,10}$' then d
    when d ~ '^55[1-9][0-9]{9,10}$' then substr(d, 3)
    when d ~ '^0[1-9][0-9]{9,10}$' then substr(d, 2)
  end
  from (select regexp_replace(coalesce(p_value, ''), '[^0-9]', '', 'g') as d) x;
$$;

create function private.format_phone(p_digits text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case char_length(p_digits)
    when 11 then '(' || substr(p_digits, 1, 2) || ') ' || substr(p_digits, 3, 5) || '-' || substr(p_digits, 8)
    when 10 then '(' || substr(p_digits, 1, 2) || ') ' || substr(p_digits, 3, 4) || '-' || substr(p_digits, 7)
    else p_digits
  end;
$$;

-- Código de consulta por celular (um por celular em cada negócio).
create table public.customer_access_codes (
  business_id uuid not null references public.businesses (id) on delete cascade,
  phone_digits text not null check (phone_digits ~ '^[0-9]{10,11}$'),
  code_salt text not null,
  code_hash text not null,
  -- 'customer': criado pela cliente na primeira compra; 'business': gerado por uma sócia.
  set_by text not null check (set_by in ('customer', 'business')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (business_id, phone_digits)
);

comment on table public.customer_access_codes is
  'Código de 4 números para a consulta de saldo no link de compras. Guardado só como hash com sal.';

-- Eventos para limites de frequência (sujeitos sempre como hash; apagados após 2 dias).
create table public.storefront_events (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  kind text not null check (kind in ('purchase', 'lookup_fail')),
  subject text not null check (char_length(subject) = 64),
  created_at timestamptz not null default now()
);

create index storefront_events_lookup_idx on public.storefront_events (business_id, kind, subject, created_at desc);
create index storefront_events_age_idx on public.storefront_events (created_at);

alter table public.customer_access_codes enable row level security;
alter table public.storefront_events enable row level security;
-- Sem políticas: só as funções abaixo (SECURITY DEFINER) leem e gravam.

revoke all on public.customer_access_codes, public.storefront_events from anon, authenticated, public;
revoke all on sequence public.storefront_events_id_seq from anon, authenticated, public;

grant update (pix_city) on public.businesses to authenticated;

-- -----------------------------------------------------------------------------
-- Vendas: novas colunas na view (sempre no final, para manter as dependentes)
-- -----------------------------------------------------------------------------

create or replace view public.v_sales
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
  items.summary as items_summary,
  s.self_service_review_pending,
  s.customer_reported_paid_at,
  s.self_service_contact
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

-- -----------------------------------------------------------------------------
-- Funções internas
-- -----------------------------------------------------------------------------

-- 16 bytes aleatórios em base64url (22 caracteres).
create function private.new_storefront_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select rtrim(translate(encode(uuid_send(gen_random_uuid()), 'base64'), '+/', '-_'), '=');
$$;

-- Códigos fáceis de adivinhar: todos iguais (1111) ou sequências (1234, 9876).
create function private.is_weak_access_code(p_code text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select replace(p_code, left(p_code, 1), '') = ''
      or position(p_code in '0123456789012') > 0
      or position(p_code in '9876543210987') > 0;
$$;

create function private.random_access_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_bytes bytea;
  v_code text;
begin
  loop
    v_bytes := uuid_send(gen_random_uuid());
    v_code := lpad(((get_byte(v_bytes, 0) * 256 + get_byte(v_bytes, 1)) % 10000)::text, 4, '0');
    exit when not private.is_weak_access_code(v_code);
  end loop;
  return v_code;
end;
$$;

create function private.access_code_hash(p_salt text, p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_salt || ':' || p_code, 'UTF8')), 'hex');
$$;

-- Origem da requisição informada pelo proxy da API (NULL fora do PostgREST).
create function private.request_ip()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(btrim(coalesce(h ->> 'cf-connecting-ip', h ->> 'x-real-ip', split_part(h ->> 'x-forwarded-for', ',', 1))), '')
  from (select coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb as h) x;
$$;

create function private.storefront_subject(p_business_id uuid, p_raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_business_id::text || '|' || p_raw, 'UTF8')), 'hex');
$$;

create function private.storefront_recent(p_business_id uuid, p_kind text, p_raw text, p_window interval)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.storefront_events e
  where e.business_id = p_business_id
    and e.kind = p_kind
    and e.subject = private.storefront_subject(p_business_id, p_raw)
    and e.created_at > now() - p_window;
$$;

create function private.storefront_log(p_business_id uuid, p_kind text, p_raw text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.storefront_events (business_id, kind, subject)
  values (p_business_id, p_kind, private.storefront_subject(p_business_id, p_raw));
  -- Os eventos só servem aos limites de frequência: limpeza ocasional dos antigos.
  if random() < 0.02 then
    delete from public.storefront_events where created_at < now() - interval '2 days';
  end if;
end;
$$;

-- Negócio do link (somente se ativo). Campos nulos quando o link não vale.
create function private.storefront_business(p_token text)
returns public.businesses
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business public.businesses;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{16,64}$' then
    return v_business;
  end if;
  select * into v_business from public.businesses b where b.storefront_token = p_token and b.storefront_enabled;
  return v_business;
end;
$$;

create function private.storefront_pix(p_business public.businesses)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case
    when nullif(btrim(p_business.pix_key), '') is null then null
    else jsonb_build_object('key', btrim(p_business.pix_key), 'name', p_business.name, 'city', p_business.pix_city)
  end;
$$;

-- Comprovante da compra para a tela da cliente (sem dados internos como custo).
create function private.storefront_receipt(p_sale_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'sale_id', s.id,
    'sale_date', s.sale_date,
    'due_date', s.due_date,
    'payment', s.self_service_contact ->> 'payment',
    'customer_first_name', split_part(s.self_service_contact ->> 'name', ' ', 1),
    'total_cents', s.total_cents,
    'balance_cents', s.balance_cents,
    'status', s.status,
    'reported_paid', s.customer_reported_paid_at is not null,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', i.product_name,
        'quantity', i.quantity,
        'unit', i.unit,
        'unit_price_cents', i.unit_price_cents,
        'total_cents', i.line_total_cents
      ) order by i.position)
      from public.sale_items i
      where i.sale_id = s.id
    ), '[]'::jsonb),
    'code_status', case
      when exists (
        select 1 from public.customer_access_codes a
        where a.business_id = s.business_id and a.phone_digits = s.self_service_contact ->> 'phone'
      ) then 'has_code'
      when coalesce((s.self_service_contact ->> 'new_customer')::boolean, false) then 'can_create'
      else 'ask_business'
    end,
    'pix', private.storefront_pix(b)
  )
  from public.v_sales s
  join public.businesses b on b.id = s.business_id
  where s.id = p_sale_id;
$$;

-- Venda anotada pelo link, validada pelos segredos que só quem anotou conhece
-- (id da venda + id da requisição, ambos aleatórios).
create function private.storefront_own_sale(p_business_id uuid, p_sale_id uuid, p_request_id uuid)
returns public.sales
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.sales;
begin
  select * into v_sale
  from public.sales s
  where s.id = p_sale_id
    and s.business_id = p_business_id
    and s.client_request_id = p_request_id
    and s.source = 'self_service'
  for update;
  if not found then
    raise exception 'Compra não encontrada.' using errcode = '22023';
  end if;
  return v_sale;
end;
$$;

create function private.storefront_unavailable()
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Este link de compras não está mais disponível. Peça o link atualizado à loja.' using errcode = '22023';
end;
$$;

-- -----------------------------------------------------------------------------
-- Funções do link público (anon)
-- -----------------------------------------------------------------------------

-- Vitrine: nome do negócio, produtos ativos com preço, datas e PIX. NULL se o link não vale.
create function public.storefront(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business public.businesses;
  v_today date;
begin
  v_business := private.storefront_business(p_token);
  if v_business.id is null then
    return null;
  end if;
  v_today := private.business_today(v_business.id);
  return jsonb_build_object(
    'business_name', v_business.name,
    'today', v_today,
    'due_day', v_business.default_due_day,
    'next_due_date', private.next_day_of_month(v_today, v_business.default_due_day, false),
    'max_due_date', v_today + 90,
    'pix', private.storefront_pix(v_business),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'description', p.description,
        'category', p.category,
        'unit', p.unit,
        'price_cents', p.price_cents
      ) order by p.category nulls last, p.name)
      from public.products p
      where p.business_id = v_business.id and p.active and p.price_cents > 0
    ), '[]'::jsonb)
  );
end;
$$;

-- Registra a compra anotada pela cliente. Idempotente por p_request_id.
--
-- p_purchase = {
--   name, phone, notes?,
--   items: [{product_id, quantity}],          (quantidade inteira de 1 a 50)
--   payment: 'now' | 'due_day' | 'date', due_date?   ('date': até 90 dias)
-- }
create function public.storefront_register_purchase(p_token text, p_request_id uuid, p_purchase jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business public.businesses;
  v_today date;
  v_name text;
  v_phone text;
  v_notes text;
  v_choice text;
  v_due date;
  v_ip text;
  v_sale_id uuid;
  v_customer_id uuid;
  v_new_customer boolean := false;
  v_item jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_seen uuid[] := '{}';
  v_position integer := 0;
  v_total bigint;
begin
  v_business := private.storefront_business(p_token);
  if v_business.id is null then
    perform private.storefront_unavailable();
  end if;
  if p_request_id is null then
    raise exception 'Identificador da requisição é obrigatório.' using errcode = '22023';
  end if;

  -- Reenvio da mesma compra (toque duplo, internet instável): devolve a já registrada.
  select s.id into v_sale_id from public.sales s
  where s.business_id = v_business.id and s.client_request_id = p_request_id;
  if found then
    return private.storefront_receipt(v_sale_id);
  end if;

  if jsonb_typeof(p_purchase) is distinct from 'object' then
    raise exception 'Dados da compra inválidos.' using errcode = '22023';
  end if;

  v_name := regexp_replace(btrim(coalesce(p_purchase ->> 'name', '')), '\s+', ' ', 'g');
  if char_length(v_name) < 2 or char_length(v_name) > 80 then
    raise exception 'Informe seu nome (de 2 a 80 letras).' using errcode = '22023';
  end if;
  v_phone := private.normalize_phone(p_purchase ->> 'phone');
  if v_phone is null then
    raise exception 'Informe seu celular com DDD, por exemplo (11) 98765-4321.' using errcode = '22023';
  end if;
  v_notes := nullif(btrim(coalesce(p_purchase ->> 'notes', '')), '');
  if char_length(v_notes) > 300 then
    raise exception 'A observação pode ter no máximo 300 caracteres.' using errcode = '22023';
  end if;

  v_today := private.business_today(v_business.id);
  v_choice := p_purchase ->> 'payment';
  if v_choice = 'now' then
    v_due := v_today;
  elsif v_choice = 'due_day' then
    v_due := private.next_day_of_month(v_today, v_business.default_due_day, false);
  elsif v_choice = 'date' then
    if coalesce(p_purchase ->> 'due_date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Escolha a data em que vai pagar.' using errcode = '22023';
    end if;
    v_due := (p_purchase ->> 'due_date')::date;
    if v_due < v_today or v_due > v_today + 90 then
      raise exception 'Escolha uma data de pagamento entre hoje e os próximos 90 dias.' using errcode = '22023';
    end if;
  else
    raise exception 'Escolha quando vai pagar.' using errcode = '22023';
  end if;

  if jsonb_typeof(p_purchase -> 'items') is distinct from 'array' or jsonb_array_length(p_purchase -> 'items') = 0 then
    raise exception 'Escolha pelo menos um produto.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_purchase -> 'items') > 20 then
    raise exception 'Uma compra pode ter no máximo 20 produtos diferentes.' using errcode = '22023';
  end if;

  v_ip := private.request_ip();
  if private.storefront_recent(v_business.id, 'purchase', 'phone:' || v_phone, interval '1 hour') >= 8
     or (v_ip is not null and private.storefront_recent(v_business.id, 'purchase', 'ip:' || v_ip, interval '1 hour') >= 20)
     or private.storefront_recent(v_business.id, 'purchase', 'all', interval '1 hour') >= 120 then
    raise exception 'Muitas compras anotadas em pouco tempo. Aguarde um pouco ou fale direto com a loja.';
  end if;

  -- Cliente pelo celular; sem cadastro, cria um novo com o nome informado.
  select c.id into v_customer_id
  from public.customers c
  where c.business_id = v_business.id and private.normalize_phone(c.phone) = v_phone
  order by c.active desc, c.created_at
  limit 1;
  if v_customer_id is null then
    insert into public.customers (business_id, name, phone, notes)
    values (v_business.id, v_name, private.format_phone(v_phone), 'Cadastro feito pela própria cliente no link de compras.')
    returning id into v_customer_id;
    v_new_customer := true;
  end if;

  perform private.set_audit_skip(true);

  insert into public.sales (
    business_id, customer_id, sale_date, due_date, payment_method, notes, source,
    client_request_id, self_service_review_pending, self_service_contact
  ) values (
    v_business.id, v_customer_id, v_today, v_due,
    case when v_choice = 'now' then 'pix' end::public.payment_method,
    v_notes, 'self_service', p_request_id, true,
    jsonb_build_object('name', v_name, 'phone', v_phone, 'payment', v_choice, 'new_customer', v_new_customer)
  )
  returning id into v_sale_id;

  for v_item in select value from jsonb_array_elements(p_purchase -> 'items') loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or coalesce(v_item ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Produto inválido na compra.' using errcode = '22023';
    end if;
    v_product_id := (v_item ->> 'product_id')::uuid;
    if v_product_id = any (v_seen) then
      raise exception 'O mesmo produto aparece duas vezes na compra.' using errcode = '22023';
    end if;
    v_seen := v_seen || v_product_id;
    if jsonb_typeof(v_item -> 'quantity') is distinct from 'number' or (v_item ->> 'quantity') !~ '^[0-9]{1,3}$' then
      raise exception 'Quantidade inválida.' using errcode = '22023';
    end if;
    v_quantity := (v_item ->> 'quantity')::integer;
    if v_quantity < 1 or v_quantity > 50 then
      raise exception 'Cada produto pode ter de 1 a 50 unidades por compra.' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.products p
      where p.id = v_product_id and p.business_id = v_business.id and p.active and p.price_cents > 0
    ) then
      raise exception 'Um dos produtos escolhidos não está mais disponível. Atualize a página.' using errcode = '22023';
    end if;
    -- Só produto e quantidade vêm da cliente: nome, preço e custo são os do cadastro.
    perform private.insert_sale_item(v_business.id, v_sale_id,
      jsonb_build_object('product_id', v_product_id, 'quantity', v_quantity), v_position, true);
    v_position := v_position + 1;
  end loop;

  select s.total_cents into v_total from public.sales s where s.id = v_sale_id;
  if v_total > 500000 then
    raise exception 'Compras acima de % precisam ser combinadas direto com a loja.', private.fmt_brl(500000) using errcode = '22023';
  end if;

  perform private.set_audit_skip(false);
  perform private.write_audit(v_business.id, 'sale.created', 'sale', v_sale_id, jsonb_build_object(
    'venda', private.sale_snapshot(v_sale_id),
    'origem', 'link_publico',
    'contato_informado', jsonb_build_object('nome', v_name, 'celular', v_phone)
  ));

  perform private.storefront_log(v_business.id, 'purchase', 'phone:' || v_phone);
  if v_ip is not null then
    perform private.storefront_log(v_business.id, 'purchase', 'ip:' || v_ip);
  end if;
  perform private.storefront_log(v_business.id, 'purchase', 'all');

  return private.storefront_receipt(v_sale_id);
exception
  when unique_violation then
    -- Mesma compra enviada em paralelo: devolve a que foi gravada primeiro.
    select s.id into v_sale_id from public.sales s
    where s.business_id = v_business.id and s.client_request_id = p_request_id;
    if v_sale_id is not null then
      return private.storefront_receipt(v_sale_id);
    end if;
    raise;
end;
$$;

-- A cliente avisa que já pagou (não registra recebimento: a sócia confere e lança).
create function public.storefront_report_paid(p_token text, p_sale_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business public.businesses;
  v_sale public.sales;
begin
  v_business := private.storefront_business(p_token);
  if v_business.id is null then
    perform private.storefront_unavailable();
  end if;
  v_sale := private.storefront_own_sale(v_business.id, p_sale_id, p_request_id);
  if v_sale.status = 'active' and v_sale.customer_reported_paid_at is null then
    perform private.set_audit_skip(true);
    update public.sales set customer_reported_paid_at = now() where id = p_sale_id;
    perform private.set_audit_skip(false);
    perform private.write_audit(v_business.id, 'sale.customer_reported_paid', 'sale', p_sale_id, jsonb_build_object('origem', 'link_publico'));
  end if;
  return private.storefront_receipt(p_sale_id);
end;
$$;

-- Primeira compra de um celular novo: a cliente cria o próprio código de consulta.
create function public.storefront_create_code(p_token text, p_sale_id uuid, p_request_id uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business public.businesses;
  v_sale public.sales;
  v_phone text;
  v_salt text;
begin
  v_business := private.storefront_business(p_token);
  if v_business.id is null then
    perform private.storefront_unavailable();
  end if;
  v_sale := private.storefront_own_sale(v_business.id, p_sale_id, p_request_id);
  if not coalesce((v_sale.self_service_contact ->> 'new_customer')::boolean, false) then
    raise exception 'Para este celular, o código de consulta é enviado pela loja. Peça o seu pelo WhatsApp.' using errcode = '22023';
  end if;
  if p_code is null or p_code !~ '^[0-9]{4}$' then
    raise exception 'O código precisa ter 4 números.' using errcode = '22023';
  end if;
  if private.is_weak_access_code(p_code) then
    raise exception 'Escolha um código menos óbvio (evite sequências como 1234 ou repetições como 1111).' using errcode = '22023';
  end if;

  v_phone := v_sale.self_service_contact ->> 'phone';
  v_salt := replace(gen_random_uuid()::text, '-', '');
  insert into public.customer_access_codes (business_id, phone_digits, code_salt, code_hash, set_by)
  values (v_business.id, v_phone, v_salt, private.access_code_hash(v_salt, p_code), 'customer')
  on conflict (business_id, phone_digits) do nothing;
  if not found then
    raise exception 'Este celular já tem um código de consulta. Se esqueceu, peça um novo à loja.' using errcode = '22023';
  end if;
  return private.storefront_receipt(p_sale_id);
end;
$$;

-- Consulta "quanto devo": celular + código. Nunca lança erro por código errado
-- (a tentativa precisa ser gravada para o bloqueio funcionar).
-- status: ok | invalid | locked | invalid_input | unavailable
create function public.storefront_statement(p_token text, p_phone text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business public.businesses;
  v_phone text;
  v_ip text;
  v_fails integer;
  v_access public.customer_access_codes;
begin
  v_business := private.storefront_business(p_token);
  if v_business.id is null then
    return jsonb_build_object('status', 'unavailable');
  end if;
  v_phone := private.normalize_phone(p_phone);
  if v_phone is null or p_code is null or p_code !~ '^[0-9]{4}$' then
    return jsonb_build_object('status', 'invalid_input');
  end if;

  v_ip := private.request_ip();
  v_fails := private.storefront_recent(v_business.id, 'lookup_fail', 'phone:' || v_phone, interval '15 minutes');
  if v_fails >= 5
     or (v_ip is not null and private.storefront_recent(v_business.id, 'lookup_fail', 'ip:' || v_ip, interval '15 minutes') >= 20)
     or private.storefront_recent(v_business.id, 'lookup_fail', 'all', interval '1 hour') >= 300 then
    return jsonb_build_object('status', 'locked', 'retry_minutes', 15);
  end if;

  select * into v_access from public.customer_access_codes a where a.business_id = v_business.id and a.phone_digits = v_phone;
  if v_access.business_id is null or v_access.code_hash <> private.access_code_hash(v_access.code_salt, p_code) then
    perform private.storefront_log(v_business.id, 'lookup_fail', 'phone:' || v_phone);
    if v_ip is not null then
      perform private.storefront_log(v_business.id, 'lookup_fail', 'ip:' || v_ip);
    end if;
    perform private.storefront_log(v_business.id, 'lookup_fail', 'all');
    return jsonb_build_object('status', 'invalid', 'attempts_left', greatest(0, 4 - v_fails));
  end if;

  return (
    with mine as (
      select s.*
      from public.v_sales s
      join public.customers c on c.id = s.customer_id
      where s.business_id = v_business.id
        and private.normalize_phone(c.phone) = v_phone
        and s.status = 'active'
        and s.balance_cents > 0
    )
    select jsonb_build_object(
      'status', 'ok',
      'customer_first_name', (
        select split_part(c.name, ' ', 1) from public.customers c
        where c.business_id = v_business.id and private.normalize_phone(c.phone) = v_phone
        order by c.active desc, c.created_at
        limit 1
      ),
      'balance_cents', coalesce((select sum(m.balance_cents) from mine m), 0),
      'overdue_cents', coalesce((select sum(m.balance_cents) from mine m where m.is_overdue), 0),
      'sales', coalesce((
        select jsonb_agg(jsonb_build_object(
          'sale_date', m.sale_date,
          'due_date', m.due_date,
          'items_summary', m.items_summary,
          'total_cents', m.total_cents,
          'paid_cents', m.net_paid_cents,
          'balance_cents', m.balance_cents,
          'is_overdue', m.is_overdue,
          'reported_paid', m.customer_reported_paid_at is not null
        ) order by coalesce(m.due_date, m.sale_date), m.sale_date, m.created_at)
        from mine m
      ), '[]'::jsonb),
      'pix', private.storefront_pix(v_business)
    )
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Funções das sócias (authenticated)
-- -----------------------------------------------------------------------------

-- Liga/desliga o link e, se pedido, troca o token (o link antigo para de funcionar).
create function public.configure_storefront(p_business_id uuid, p_enabled boolean, p_regenerate boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_enabled boolean;
begin
  perform private.assert_member(p_business_id);
  if not private.has_role(p_business_id, array['owner']) then
    raise exception 'Somente sócias/administradoras podem configurar o link de compras.' using errcode = '42501';
  end if;
  select b.storefront_token, b.storefront_enabled into v_token, v_enabled
  from public.businesses b where b.id = p_business_id for update;
  if v_token is null or coalesce(p_regenerate, false) then
    v_token := private.new_storefront_token();
  end if;

  -- O token não vai para a auditoria (é a "chave" do link).
  perform private.set_audit_skip(true);
  update public.businesses
  set storefront_enabled = coalesce(p_enabled, false), storefront_token = v_token
  where id = p_business_id;
  perform private.set_audit_skip(false);
  perform private.write_audit(p_business_id, 'business.storefront_configured', 'business', p_business_id, jsonb_build_object(
    'ativo', coalesce(p_enabled, false),
    'antes_ativo', v_enabled,
    'link_trocado', coalesce(p_regenerate, false)
  ));
  return v_token;
end;
$$;

-- Gera (ou troca) o código de consulta do celular da cliente. Devolve o código
-- uma única vez, para a sócia enviar à cliente; só o hash fica guardado.
create function public.set_customer_access_code(p_customer_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer public.customers;
  v_phone text;
  v_code text;
  v_salt text;
begin
  select * into v_customer from public.customers c where c.id = p_customer_id;
  if not found then
    raise exception 'Cliente não encontrado.' using errcode = '22023';
  end if;
  perform private.assert_can_write(v_customer.business_id);
  v_phone := private.normalize_phone(v_customer.phone);
  if v_phone is null then
    raise exception 'Cadastre o celular da cliente (com DDD) antes de gerar o código.' using errcode = '22023';
  end if;

  v_code := private.random_access_code();
  v_salt := replace(gen_random_uuid()::text, '-', '');
  insert into public.customer_access_codes (business_id, phone_digits, code_salt, code_hash, set_by)
  values (v_customer.business_id, v_phone, v_salt, private.access_code_hash(v_salt, v_code), 'business')
  on conflict (business_id, phone_digits) do update
  set code_salt = excluded.code_salt, code_hash = excluded.code_hash, set_by = 'business', updated_at = now();

  -- Código novo libera a consulta na hora (zera o bloqueio por tentativas erradas).
  delete from public.storefront_events e
  where e.business_id = v_customer.business_id
    and e.kind = 'lookup_fail'
    and e.subject = private.storefront_subject(v_customer.business_id, 'phone:' || v_phone);

  perform private.write_audit(v_customer.business_id, 'customer.access_code_set', 'customer', p_customer_id,
    jsonb_build_object('cliente', v_customer.name));
  return v_code;
end;
$$;

create function public.remove_customer_access_code(p_customer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer public.customers;
begin
  select * into v_customer from public.customers c where c.id = p_customer_id;
  if not found then
    raise exception 'Cliente não encontrado.' using errcode = '22023';
  end if;
  perform private.assert_can_write(v_customer.business_id);
  delete from public.customer_access_codes a
  where a.business_id = v_customer.business_id and a.phone_digits = private.normalize_phone(v_customer.phone);
  if found then
    perform private.write_audit(v_customer.business_id, 'customer.access_code_removed', 'customer', p_customer_id,
      jsonb_build_object('cliente', v_customer.name));
  end if;
end;
$$;

-- Situação do código de consulta da cliente (sem o código, que não é recuperável).
create function public.customer_access_code_info(p_customer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_customer public.customers;
  v_phone text;
  v_access public.customer_access_codes;
begin
  select * into v_customer from public.customers c where c.id = p_customer_id;
  if not found then
    raise exception 'Cliente não encontrado.' using errcode = '22023';
  end if;
  perform private.assert_member(v_customer.business_id);
  v_phone := private.normalize_phone(v_customer.phone);
  if v_phone is null then
    return jsonb_build_object('phone_valid', false, 'has_code', false);
  end if;
  select * into v_access from public.customer_access_codes a where a.business_id = v_customer.business_id and a.phone_digits = v_phone;
  return jsonb_build_object(
    'phone_valid', true,
    'has_code', v_access.business_id is not null,
    'set_by', v_access.set_by,
    'updated_at', v_access.updated_at,
    'locked', private.storefront_recent(v_customer.business_id, 'lookup_fail', 'phone:' || v_phone, interval '15 minutes') >= 5
  );
end;
$$;

-- Marca a venda anotada pela cliente como conferida.
create function public.review_self_service_sale(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.sales;
begin
  v_sale := private.lock_sale(p_sale_id);
  if v_sale.self_service_review_pending then
    perform private.set_audit_skip(true);
    update public.sales set self_service_review_pending = false, updated_by = (select auth.uid()) where id = p_sale_id;
    perform private.set_audit_skip(false);
    perform private.write_audit(v_sale.business_id, 'sale.reviewed', 'sale', p_sale_id, '{}'::jsonb);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Privilégios
-- -----------------------------------------------------------------------------

revoke all on function
  private.normalize_phone(text),
  private.format_phone(text),
  private.new_storefront_token(),
  private.is_weak_access_code(text),
  private.random_access_code(),
  private.access_code_hash(text, text),
  private.request_ip(),
  private.storefront_subject(uuid, text),
  private.storefront_recent(uuid, text, text, interval),
  private.storefront_log(uuid, text, text),
  private.storefront_business(text),
  private.storefront_pix(public.businesses),
  private.storefront_receipt(uuid),
  private.storefront_own_sale(uuid, uuid, uuid),
  private.storefront_unavailable()
from public, anon, authenticated;

revoke all on function
  public.storefront(text),
  public.storefront_register_purchase(text, uuid, jsonb),
  public.storefront_report_paid(text, uuid, uuid),
  public.storefront_create_code(text, uuid, uuid, text),
  public.storefront_statement(text, text, text),
  public.configure_storefront(uuid, boolean, boolean),
  public.set_customer_access_code(uuid),
  public.remove_customer_access_code(uuid),
  public.customer_access_code_info(uuid),
  public.review_self_service_sale(uuid)
from public, anon, authenticated;

-- Link público: as ÚNICAS funções que anon executa.
grant execute on function
  public.storefront(text),
  public.storefront_register_purchase(text, uuid, jsonb),
  public.storefront_report_paid(text, uuid, uuid),
  public.storefront_create_code(text, uuid, uuid, text),
  public.storefront_statement(text, text, text)
to anon, authenticated;

grant execute on function
  public.configure_storefront(uuid, boolean, boolean),
  public.set_customer_access_code(uuid),
  public.remove_customer_access_code(uuid),
  public.customer_access_code_info(uuid),
  public.review_self_service_sale(uuid)
to authenticated;
