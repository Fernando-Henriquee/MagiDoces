-- =============================================================================
-- Magi Doces — 0700 Storage e configuração inicial do negócio
--
-- Arquivos ficam em buckets PRIVADOS, com caminho "<business_id>/<arquivo>".
-- Leitura: membros do negócio. Escrita/remoção: owner/editor.
-- O acesso no navegador usa URLs assinadas de curta duração.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('product-photos', 'product-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('receipts', 'receipts', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create function private.storage_business_id(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_first text := split_part(p_name, '/', 1);
begin
  if v_first ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return v_first::uuid;
  end if;
  return null;
end;
$$;

create policy magi_files_select on storage.objects
  for select to authenticated
  using (
    bucket_id in ('product-photos', 'receipts')
    and private.is_member(private.storage_business_id(name))
  );

create policy magi_files_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('product-photos', 'receipts')
    and private.can_write(private.storage_business_id(name))
  );

create policy magi_files_update on storage.objects
  for update to authenticated
  using (
    bucket_id in ('product-photos', 'receipts')
    and private.can_write(private.storage_business_id(name))
  )
  with check (
    bucket_id in ('product-photos', 'receipts')
    and private.can_write(private.storage_business_id(name))
  );

create policy magi_files_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('product-photos', 'receipts')
    and private.can_write(private.storage_business_id(name))
  );

-- -----------------------------------------------------------------------------
-- Configuração inicial: produtos cadastrados apenas como dados de configuração.
-- Preço fica em aberto (NULL) — não presumimos valores definitivos.
-- -----------------------------------------------------------------------------

create function private.seed_business_defaults(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.products (business_id, name, category, unit, price_cents)
  values
    (p_business_id, 'Bolo de pote', 'Doces', 'un', null),
    (p_business_id, 'Torta de limão', 'Doces', 'un', null),
    (p_business_id, 'Morango cravejado', 'Doces', 'un', null),
    (p_business_id, 'Surpresa de uva', 'Doces', 'un', null)
  on conflict do nothing;
end;
$$;

create or replace function private.provision_business(p_name text, p_owner_emails text[], p_timezone text default 'America/Sao_Paulo')
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

  perform private.seed_business_defaults(v_business_id);
  return v_business_id;
end;
$$;

-- Alterações de membros (quem tem acesso ao negócio) também ficam na auditoria.
create trigger business_members_audit
  after insert or update or delete on public.business_members
  for each row execute function private.audit_row('member');

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
