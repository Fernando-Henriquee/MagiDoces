-- =============================================================================
-- Magi Doces — 0100 Fundação
-- Negócios, membros, perfis, funções de autorização e infraestrutura de auditoria.
--
-- Convenções:
--   * Valores monetários em centavos inteiros (integer/bigint). Nunca float.
--   * Toda tabela privada tem business_id e RLS habilitada.
--   * Funções internas ficam no schema "private" (não exposto pela API).
--   * Funções SECURITY DEFINER usam search_path vazio e nomes qualificados.
-- =============================================================================

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- -----------------------------------------------------------------------------
-- Domínios compartilhados
-- -----------------------------------------------------------------------------

-- Formas de pagamento aceitas em todo o sistema.
create domain public.payment_method as text
  check (value in ('pix', 'dinheiro', 'cartao_credito', 'cartao_debito', 'transferencia', 'boleto', 'outro'));

-- Unidades de medida com conversão conhecida (ingredientes e receitas).
create domain public.measure_unit as text
  check (value in ('mg', 'g', 'kg', 'ml', 'l', 'un', 'dz'));

-- -----------------------------------------------------------------------------
-- Negócios e membros
-- -----------------------------------------------------------------------------

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  timezone text not null default 'America/Sao_Paulo',
  default_due_day smallint not null default 10 check (default_due_day between 1 and 31),
  pix_key text check (pix_key is null or char_length(pix_key) <= 140),
  charge_message_footer text check (charge_message_footer is null or char_length(charge_message_footer) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.businesses is 'Negócio (tenant). Todos os dados privados pertencem a um negócio.';
comment on column public.businesses.timezone is 'Fuso horário operacional (IANA). Define o "hoje" para vencimentos e relatórios.';
comment on column public.businesses.default_due_day is 'Dia do mês usado como vencimento padrão (ex.: 10).';

create table public.business_members (
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);

create index business_members_user_idx on public.business_members (user_id);

comment on table public.business_members is
  'Associação explícita usuário ↔ negócio. owner: tudo; editor: operação; viewer: somente leitura.';

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Funções de autorização (usadas pelas políticas RLS e pelas RPCs)
-- -----------------------------------------------------------------------------

create function private.is_member(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.business_members m
    where m.business_id = p_business_id
      and m.user_id = (select auth.uid())
  );
$$;

create function private.has_role(p_business_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.business_members m
    where m.business_id = p_business_id
      and m.user_id = (select auth.uid())
      and m.role = any (p_roles)
  );
$$;

create function private.can_write(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_role(p_business_id, array['owner', 'editor']);
$$;

create function private.assert_member(p_business_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Sessão inválida ou expirada.' using errcode = '42501';
  end if;
  if not private.is_member(p_business_id) then
    raise exception 'Acesso negado a este negócio.' using errcode = '42501';
  end if;
end;
$$;

create function private.assert_can_write(p_business_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_member(p_business_id);
  if not private.can_write(p_business_id) then
    raise exception 'Seu perfil não tem permissão para esta operação.' using errcode = '42501';
  end if;
end;
$$;

create function private.shares_business(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.business_members mine
    join public.business_members theirs on theirs.business_id = mine.business_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = p_user_id
  );
$$;

-- "Hoje" no fuso horário operacional do negócio.
create function private.business_today(p_business_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone b.timezone)::date
  from public.businesses b
  where b.id = p_business_id;
$$;

-- Próxima data com o dia do mês informado (ex.: 10), ajustando para o último dia
-- em meses mais curtos. inclusive = true aceita a própria data de referência.
create function private.next_day_of_month(p_from date, p_day integer, p_inclusive boolean)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', p_from)::date;
  v_candidate date;
  v_last_day integer;
begin
  for i in 0..1 loop
    v_last_day := extract(day from (v_month + interval '1 month' - interval '1 day'))::integer;
    v_candidate := v_month + (least(p_day, v_last_day) - 1);
    if v_candidate > p_from or (p_inclusive and v_candidate = p_from) then
      return v_candidate;
    end if;
    v_month := (v_month + interval '1 month')::date;
  end loop;
  return v_candidate;
end;
$$;

-- -----------------------------------------------------------------------------
-- Triggers utilitários
-- -----------------------------------------------------------------------------

create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Impede que o cliente falsifique autoria: created_by sempre = usuário da sessão.
create function private.stamp_created_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce((select auth.uid()), new.created_by);
  else
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

create function private.validate_business()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Fuso horário inválido: %', new.timezone using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger businesses_validate
  before insert or update of timezone on public.businesses
  for each row execute function private.validate_business();

create trigger businesses_touch
  before update on public.businesses
  for each row execute function private.touch_updated_at();

create trigger profiles_touch
  before update on public.profiles
  for each row execute function private.touch_updated_at();

-- Perfil criado automaticamente para cada usuário do Auth.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(new.email, ''), '@', 1)), 80)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- -----------------------------------------------------------------------------
-- Auditoria
-- -----------------------------------------------------------------------------

create table public.audit_logs (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  occurred_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb
);

create index audit_logs_business_time_idx on public.audit_logs (business_id, occurred_at desc);
create index audit_logs_entity_idx on public.audit_logs (business_id, entity, entity_id);

comment on table public.audit_logs is
  'Histórico imutável de operações financeiras. Usuários não têm privilégio de escrita; '
  'registros são criados apenas por triggers e RPCs SECURITY DEFINER.';

create function private.block_audit_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'O histórico de auditoria não pode ser alterado.' using errcode = '42501';
end;
$$;

create trigger audit_logs_immutable
  before update on public.audit_logs
  for each row execute function private.block_audit_update();

create function private.write_audit(
  p_business_id uuid,
  p_action text,
  p_entity text,
  p_entity_id uuid,
  p_details jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs (business_id, actor_id, action, entity, entity_id, details)
  values (p_business_id, (select auth.uid()), p_action, p_entity, p_entity_id, coalesce(p_details, '{}'::jsonb));
end;
$$;

-- Trigger genérico de auditoria. Registra criação, alteração (somente colunas
-- alteradas) e exclusão. Nomes de ação específicos para eventos financeiros.
-- Pode ser suspenso dentro de uma transação com set_config('magi.audit_skip','on',true)
-- (usado pela importação, que registra um evento de lote próprio).
create function private.audit_row()
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
    (v_row ->> 'business_id')::uuid,
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

create trigger businesses_audit
  after update on public.businesses
  for each row execute function private.audit_row('business');

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.profiles enable row level security;
alter table public.audit_logs enable row level security;

create policy businesses_select on public.businesses
  for select to authenticated
  using (private.is_member(id));

create policy businesses_update on public.businesses
  for update to authenticated
  using (private.has_role(id, array['owner']))
  with check (private.has_role(id, array['owner']));

create policy business_members_select on public.business_members
  for select to authenticated
  using (private.is_member(business_id));

create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or private.shares_business(id));

create policy profiles_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (private.has_role(business_id, array['owner', 'editor']));

-- -----------------------------------------------------------------------------
-- Provisionamento administrativo (executar no SQL Editor do Supabase).
-- Não há privilégio de execução para usuários da aplicação.
-- -----------------------------------------------------------------------------

create function private.provision_business(p_name text, p_owner_emails text[], p_timezone text default 'America/Sao_Paulo')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
  v_email text;
  v_user_id uuid;
begin
  insert into public.businesses (name, timezone)
  values (p_name, p_timezone)
  returning id into v_business_id;

  foreach v_email in array p_owner_emails loop
    select u.id into v_user_id from auth.users u where lower(u.email) = lower(btrim(v_email));
    if v_user_id is null then
      raise exception 'Usuário não encontrado no Auth: %. Convide-o antes de provisionar.', v_email;
    end if;
    insert into public.business_members (business_id, user_id, role)
    values (v_business_id, v_user_id, 'owner')
    on conflict do nothing;
  end loop;

  return v_business_id;
end;
$$;

create function private.add_member(p_business_id uuid, p_email text, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  select u.id into v_user_id from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_user_id is null then
    raise exception 'Usuário não encontrado no Auth: %', p_email;
  end if;
  insert into public.business_members (business_id, user_id, role)
  values (p_business_id, v_user_id, p_role)
  on conflict (business_id, user_id) do update set role = excluded.role;
end;
$$;

-- -----------------------------------------------------------------------------
-- Privilégios (o Supabase concede ALL por padrão; restringimos explicitamente)
-- -----------------------------------------------------------------------------

revoke all on public.businesses, public.business_members, public.profiles, public.audit_logs from anon, public;
revoke all on public.businesses, public.business_members, public.profiles, public.audit_logs from authenticated;

grant select on public.businesses, public.business_members, public.profiles, public.audit_logs to authenticated;
grant update (name, timezone, default_due_day, pix_key, charge_message_footer) on public.businesses to authenticated;
grant update (display_name) on public.profiles to authenticated;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_member(uuid),
  private.has_role(uuid, text[]),
  private.can_write(uuid),
  private.shares_business(uuid)
to authenticated;
