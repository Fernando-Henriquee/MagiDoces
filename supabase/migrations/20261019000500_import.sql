-- =============================================================================
-- Magi Doces — 0500 Importação de planilhas
--
-- * import_batches: um registro por processamento (arquivo, hash, aba, mapeamento,
--   regras de migração, usuário, contagens).
-- * import_rows: cada linha da planilha com conteúdo original, status e mensagens.
-- * Idempotência: cada linha válida tem uma impressão digital (fingerprint)
--   calculada a partir do conteúdo normalizado; sales.import_fingerprint é único
--   por negócio. Reprocessar o mesmo arquivo marca as linhas como duplicadas em vez
--   de criar vendas novas. Vendas manuais nunca são sobrescritas.
-- * A RPC é transacional: qualquer erro desfaz o lote inteiro.
-- =============================================================================

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  kind text not null default 'sales' check (kind in ('sales')),
  file_name text not null check (char_length(file_name) between 1 and 255),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  file_size_bytes integer check (file_size_bytes is null or file_size_bytes >= 0),
  sheet_name text check (sheet_name is null or char_length(sheet_name) <= 120),
  layout text not null check (layout in ('long', 'wide')),
  mapping jsonb not null default '{}'::jsonb,
  rules jsonb not null default '{}'::jsonb,
  status text not null default 'completed' check (status in ('completed')),
  total_rows integer not null default 0,
  imported_count integer not null default 0,
  duplicate_count integer not null default 0,
  ignored_count integer not null default 0,
  invalid_count integer not null default 0,
  created_customers_count integer not null default 0,
  inferred_count integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (business_id, id)
);

create index import_batches_business_idx on public.import_batches (business_id, created_at desc);
create index import_batches_hash_idx on public.import_batches (business_id, file_sha256);

create table public.import_rows (
  id bigint generated always as identity primary key,
  business_id uuid not null,
  batch_id uuid not null,
  row_number integer not null check (row_number > 0),
  raw jsonb not null,
  fingerprint text check (fingerprint is null or char_length(fingerprint) <= 128),
  status text not null check (status in ('imported', 'duplicate', 'ignored', 'invalid')),
  messages text[] not null default '{}',
  inferred_fields text[] not null default '{}',
  sale_id uuid,
  foreign key (business_id, batch_id) references public.import_batches (business_id, id) on delete cascade,
  foreign key (business_id, sale_id) references public.sales (business_id, id)
);

create index import_rows_batch_idx on public.import_rows (batch_id, row_number);
create index import_rows_fingerprint_idx on public.import_rows (business_id, fingerprint) where fingerprint is not null;

alter table public.sales
  add constraint sales_import_batch_fk foreign key (business_id, import_batch_id)
  references public.import_batches (business_id, id);

alter table public.payments
  add constraint payments_import_batch_fk foreign key (business_id, import_batch_id)
  references public.import_batches (business_id, id);

-- Normalização simples de nomes para casar clientes (sem depender de extensões).
create function private.normalize_name(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(btrim(translate(coalesce(p_value, ''),
    'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
    'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')), '\s+', ' ', 'g'));
$$;

-- p_batch = {file_name, file_sha256, file_size_bytes?, sheet_name?, layout, mapping, rules}
-- p_rows  = [{
--   row_number, raw, fingerprint?, action: 'import'|'ignore'|'invalid', messages?, inferred_fields?,
--   sale?: {customer_id?, customer_name?, sale_date, due_date?, payment_method?, notes?,
--           items: [{product_id, quantity, unit_price_cents, price_inferred?}],
--           payment: {status: 'paid'|'partial'|'unpaid'|'unknown', amount_cents?, paid_on?,
--                     paid_on_inferred?, method?}}
-- }]
create function public.import_sales_batch(p_business_id uuid, p_batch jsonb, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch_id uuid;
  v_row jsonb;
  v_sale jsonb;
  v_item jsonb;
  v_payment jsonb;
  v_action text;
  v_status text;
  v_messages text[];
  v_inferred text[];
  v_fingerprint text;
  v_sale_id uuid;
  v_customer_id uuid;
  v_customer_name text;
  v_position integer;
  v_total bigint;
  v_amount bigint;
  v_paid_on date;
  v_pay_status text;
  v_today date;
  v_imported integer := 0;
  v_duplicates integer := 0;
  v_ignored integer := 0;
  v_invalid integer := 0;
  v_created_customers integer := 0;
  v_inferred_count integer := 0;
  v_row_number integer;
begin
  perform private.assert_can_write(p_business_id);
  if jsonb_typeof(p_batch) <> 'object' or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Dados de importação inválidos.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) = 0 then
    raise exception 'Nenhuma linha para importar.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'Limite de 5.000 linhas por importação. Divida o arquivo.' using errcode = '22023';
  end if;
  v_today := private.business_today(p_business_id);

  perform private.set_audit_skip(true);

  insert into public.import_batches (
    business_id, file_name, file_sha256, file_size_bytes, sheet_name, layout, mapping, rules, total_rows, created_by
  ) values (
    p_business_id, left(p_batch ->> 'file_name', 255), lower(p_batch ->> 'file_sha256'),
    (p_batch ->> 'file_size_bytes')::integer, left(p_batch ->> 'sheet_name', 120), p_batch ->> 'layout',
    coalesce(p_batch -> 'mapping', '{}'::jsonb), coalesce(p_batch -> 'rules', '{}'::jsonb),
    jsonb_array_length(p_rows), (select auth.uid())
  ) returning id into v_batch_id;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_row_number := (v_row ->> 'row_number')::integer;
    v_action := v_row ->> 'action';
    v_messages := coalesce(array(select jsonb_array_elements_text(coalesce(v_row -> 'messages', '[]'::jsonb))), '{}');
    v_inferred := coalesce(array(select jsonb_array_elements_text(coalesce(v_row -> 'inferred_fields', '[]'::jsonb))), '{}');
    v_fingerprint := nullif(v_row ->> 'fingerprint', '');
    v_sale_id := null;

    if v_action = 'ignore' then
      v_status := 'ignored';
      v_ignored := v_ignored + 1;
    elsif v_action = 'invalid' then
      v_status := 'invalid';
      v_invalid := v_invalid + 1;
    elsif v_action = 'import' then
      if v_fingerprint is null then
        raise exception 'Linha %: impressão digital ausente.', v_row_number using errcode = '22023';
      end if;

      select s.id into v_sale_id from public.sales s
      where s.business_id = p_business_id and s.import_fingerprint = v_fingerprint;

      if v_sale_id is not null then
        v_status := 'duplicate';
        v_duplicates := v_duplicates + 1;
        v_messages := array_append(v_messages, 'Já importada anteriormente; nada foi alterado.');
      else
        v_sale := v_row -> 'sale';
        if jsonb_typeof(v_sale) <> 'object' then
          raise exception 'Linha %: dados da venda ausentes.', v_row_number using errcode = '22023';
        end if;
        begin
          perform private.validate_sale_header(p_business_id, v_sale);
        exception when others then
          raise exception 'Linha %: %', v_row_number, sqlerrm using errcode = '22023';
        end;

        -- Cliente: id informado, ou nome igual (normalizado), ou novo cadastro.
        v_customer_id := nullif(v_sale ->> 'customer_id', '')::uuid;
        v_customer_name := nullif(btrim(v_sale ->> 'customer_name'), '');
        if v_customer_id is not null then
          if not exists (select 1 from public.customers c where c.id = v_customer_id and c.business_id = p_business_id) then
            raise exception 'Linha %: cliente não encontrado.', v_row_number using errcode = '22023';
          end if;
        elsif v_customer_name is not null then
          select c.id into v_customer_id from public.customers c
          where c.business_id = p_business_id and private.normalize_name(c.name) = private.normalize_name(v_customer_name)
          order by c.created_at limit 1;
          if v_customer_id is null then
            insert into public.customers (business_id, name, notes, created_by)
            values (p_business_id, left(v_customer_name, 120), 'Cadastrado pela importação de ' || left(p_batch ->> 'file_name', 200),
                    (select auth.uid()))
            returning id into v_customer_id;
            v_created_customers := v_created_customers + 1;
          end if;
        end if;

        v_payment := coalesce(v_sale -> 'payment', '{}'::jsonb);
        v_pay_status := coalesce(v_payment ->> 'status', 'unknown');
        if v_pay_status not in ('paid', 'partial', 'unpaid', 'unknown') then
          raise exception 'Linha %: situação de pagamento inválida.', v_row_number using errcode = '22023';
        end if;

        insert into public.sales (
          business_id, customer_id, sale_date, due_date, payment_method, notes, source,
          import_batch_id, import_fingerprint, payment_confirmation_pending, created_by, updated_by
        ) values (
          p_business_id, v_customer_id, (v_sale ->> 'sale_date')::date, nullif(v_sale ->> 'due_date', '')::date,
          nullif(v_sale ->> 'payment_method', '')::public.payment_method, nullif(btrim(v_sale ->> 'notes'), ''),
          'import', v_batch_id, v_fingerprint, v_pay_status = 'unknown', (select auth.uid()), (select auth.uid())
        ) returning id into v_sale_id;

        v_position := 0;
        for v_item in select value from jsonb_array_elements(v_sale -> 'items') loop
          begin
            perform private.insert_sale_item(p_business_id, v_sale_id, v_item, v_position, false);
          exception when others then
            raise exception 'Linha %: %', v_row_number, sqlerrm using errcode = '22023';
          end;
          v_position := v_position + 1;
        end loop;

        -- Custo de itens importados = custo vigente do produto (estimativa, sinalizada).
        update public.sale_items set cost_source = 'import_current'
        where sale_id = v_sale_id and unit_cost_cents is not null;

        select s.total_cents into v_total from public.sales s where s.id = v_sale_id;

        if v_pay_status in ('paid', 'partial') then
          v_amount := case when v_pay_status = 'paid' then v_total
                           else coalesce(private.jsonb_int(v_payment, 'amount_cents'), 0) end;
          if v_amount < 0 or v_amount > v_total then
            raise exception 'Linha %: valor pago (%) maior que o total da venda (%).',
              v_row_number, private.fmt_brl(v_amount), private.fmt_brl(v_total) using errcode = '22023';
          end if;
          if v_amount > 0 then
            v_paid_on := nullif(v_payment ->> 'paid_on', '')::date;
            if v_paid_on is null then
              raise exception 'Linha %: data de pagamento ausente.', v_row_number using errcode = '22023';
            end if;
            if v_paid_on > v_today then
              raise exception 'Linha %: data de pagamento no futuro.', v_row_number using errcode = '22023';
            end if;
            insert into public.payments (
              business_id, sale_id, kind, amount_cents, paid_on, method, notes, received_by, is_inferred, import_batch_id
            ) values (
              p_business_id, v_sale_id, 'receipt', v_amount, v_paid_on,
              coalesce(nullif(v_payment ->> 'method', ''), 'outro')::public.payment_method,
              'Importado de ' || left(p_batch ->> 'file_name', 200), (select auth.uid()),
              coalesce((v_payment ->> 'paid_on_inferred')::boolean, false), v_batch_id
            );
          end if;
        end if;

        v_status := 'imported';
        v_imported := v_imported + 1;
        if cardinality(v_inferred) > 0 then
          v_inferred_count := v_inferred_count + 1;
        end if;
      end if;
    else
      raise exception 'Linha %: ação inválida.', v_row_number using errcode = '22023';
    end if;

    insert into public.import_rows (business_id, batch_id, row_number, raw, fingerprint, status, messages, inferred_fields, sale_id)
    values (p_business_id, v_batch_id, v_row_number, coalesce(v_row -> 'raw', '{}'::jsonb), v_fingerprint, v_status,
            v_messages, v_inferred, v_sale_id);
  end loop;

  update public.import_batches
  set imported_count = v_imported, duplicate_count = v_duplicates, ignored_count = v_ignored,
      invalid_count = v_invalid, created_customers_count = v_created_customers, inferred_count = v_inferred_count
  where id = v_batch_id;

  perform private.set_audit_skip(false);
  perform private.write_audit(p_business_id, 'import.completed', 'import_batch', v_batch_id, jsonb_build_object(
    'arquivo', p_batch ->> 'file_name', 'aba', p_batch ->> 'sheet_name', 'linhas', jsonb_array_length(p_rows),
    'importadas', v_imported, 'duplicadas', v_duplicates, 'ignoradas', v_ignored, 'invalidas', v_invalid,
    'clientes_criados', v_created_customers, 'com_valores_inferidos', v_inferred_count));

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'total_rows', jsonb_array_length(p_rows),
    'imported', v_imported,
    'duplicates', v_duplicates,
    'ignored', v_ignored,
    'invalid', v_invalid,
    'created_customers', v_created_customers,
    'inferred', v_inferred_count
  );
end;
$$;

-- Impressões digitais já importadas (para a prévia sinalizar duplicidades).
create function public.import_existing_fingerprints(p_business_id uuid, p_fingerprints text[])
returns table (fingerprint text, sale_id uuid, imported_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select s.import_fingerprint, s.id, s.created_at
  from public.sales s
  where s.business_id = p_business_id
    and s.import_fingerprint = any (p_fingerprints);
$$;

alter table public.import_batches enable row level security;
alter table public.import_rows enable row level security;

create policy import_batches_select on public.import_batches for select to authenticated using (private.is_member(business_id));
create policy import_rows_select on public.import_rows for select to authenticated using (private.is_member(business_id));

revoke all on public.import_batches, public.import_rows from anon, authenticated, public;
grant select on public.import_batches, public.import_rows to authenticated;

revoke all on function public.import_sales_batch(uuid, jsonb, jsonb), public.import_existing_fingerprints(uuid, text[]) from public, anon;
grant execute on function public.import_sales_batch(uuid, jsonb, jsonb), public.import_existing_fingerprints(uuid, text[]) to authenticated;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_member(uuid),
  private.has_role(uuid, text[]),
  private.can_write(uuid),
  private.shares_business(uuid),
  private.unit_dimension(text),
  private.unit_factor(text)
to authenticated;
