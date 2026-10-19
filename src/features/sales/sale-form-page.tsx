import { ArrowLeft, ChevronDown, Minus, Plus, Search, Trash2, UserRound, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { EntityPicker } from '@/components/shared/entity-picker';
import { Money } from '@/components/shared/money';
import { Page, PageHeader } from '@/components/layout/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { MoneyInput, QuantityInput } from '@/components/ui/money-input';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { useCustomers, useProducts } from '@/data/catalog';
import { type SalePayload, useCreateSale, useSale, useUpdateSale } from '@/data/sales';
import { PAYMENT_METHODS, type PaymentMethod, type ProductRow, type SaleItemRow, type SaleRow } from '@/data/types';
import { useBusiness } from '@/features/business/business-context';
import { cn } from '@/lib/cn';
import { useOnline } from '@/lib/connectivity';
import { formatDateBR, isValidISODate, nextDayOfMonth } from '@/lib/dates';
import { formatBRL } from '@/lib/money';
import { computeSaleTotals } from '@/lib/sale-calc';
import { useRequestId } from '@/lib/use-request-id';
import { formatPhoneBR } from '@/lib/whatsapp';

interface ItemDraft {
  key: string;
  id?: string;
  productId: string;
  name: string;
  unit: string;
  quantity: number | null;
  unitPriceCents: number | null;
  discountCents: number | null;
  showDiscount: boolean;
}

type PaymentMode = 'paid' | 'partial' | 'pending';
type DueMode = 'day' | 'date' | 'none';

function newItem(product: ProductRow): ItemDraft {
  return {
    key: crypto.randomUUID(),
    productId: product.id,
    name: product.name,
    unit: product.unit,
    quantity: 1,
    unitPriceCents: product.price_cents,
    discountCents: null,
    showDiscount: false,
  };
}

export function SaleFormPage() {
  const { id: saleId } = useParams();
  const { can } = useBusiness();
  const products = useProducts();
  const existing = useSale(saleId);

  if (!can('write')) {
    return (
      <Page>
        <PageHeader title="Nova venda" />
        <ErrorState error={new Error('Seu perfil é somente leitura.')} />
      </Page>
    );
  }
  if ((saleId && existing.isPending) || products.isPending) return <Page><LoadingBlock /></Page>;
  if (saleId && existing.isError) return <Page><ErrorState error={existing.error} onRetry={() => void existing.refetch()} /></Page>;
  if (products.isError) return <Page><ErrorState error={products.error} onRetry={() => void products.refetch()} /></Page>;
  if (saleId && existing.data?.sale.status === 'cancelled') {
    return (
      <Page>
        <ErrorState error={new Error('Venda cancelada não pode ser editada.')} />
      </Page>
    );
  }
  // O formulário é inicializado uma vez com a venda carregada (edição) ou vazio (nova).
  return <SaleForm key={saleId ?? 'nova'} saleId={saleId} initial={saleId ? existing.data! : null} products={products.data} />;
}

function itemFromRow(row: SaleItemRow): ItemDraft {
  return {
    key: row.id,
    id: row.id,
    productId: row.product_id,
    name: row.product_name,
    unit: row.unit,
    quantity: Number(row.quantity),
    unitPriceCents: row.unit_price_cents,
    discountCents: row.discount_cents || null,
    showDiscount: row.discount_cents > 0,
  };
}

interface SaleFormProps {
  saleId: string | undefined;
  initial: { sale: SaleRow; items: SaleItemRow[] } | null;
  products: ProductRow[];
}

function SaleForm({ saleId, initial, products }: SaleFormProps) {
  const editing = Boolean(saleId);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { business, today } = useBusiness();
  const online = useOnline();
  const customers = useCustomers();
  const create = useCreateSale();
  const update = useUpdateSale();
  const [requestId, renewRequestId] = useRequestId();
  const sale = initial?.sale;

  const [customerId, setCustomerId] = useState<string | null>(sale ? sale.customer_id : params.get('cliente'));
  const [newCustomer, setNewCustomer] = useState<{ name: string; phone: string } | null>(null);
  const [saleDate, setSaleDate] = useState(sale?.sale_date ?? today());
  const [items, setItems] = useState<ItemDraft[]>(() => initial?.items.map(itemFromRow) ?? []);
  const [saleDiscount, setSaleDiscount] = useState<number | null>(sale?.discount_cents || null);
  const [showSaleDiscount, setShowSaleDiscount] = useState(Boolean(sale && sale.discount_cents > 0));
  const [notes, setNotes] = useState(sale?.notes ?? '');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('paid');
  const [method, setMethod] = useState<PaymentMethod>(sale?.payment_method ?? 'pix');
  const [partialAmount, setPartialAmount] = useState<number | null>(null);
  const [dueMode, setDueMode] = useState<DueMode>(sale ? (sale.due_date ? 'date' : 'none') : 'day');
  const [dueDate, setDueDate] = useState(sale?.due_date ?? '');
  const [pickCustomer, setPickCustomer] = useState(false);
  const [pickProduct, setPickProduct] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const activeProducts = useMemo(() => products.filter((p) => p.active), [products]);
  const customer = (customers.data ?? []).find((c) => c.id === customerId) ?? null;
  const nextDue = nextDayOfMonth(isValidISODate(saleDate) ? saleDate : today(), business.default_due_day, false);

  const totals = computeSaleTotals(
    items.map((i) => ({ quantity: i.quantity ?? 0, unitPriceCents: i.unitPriceCents ?? 0, discountCents: i.discountCents ?? 0 })),
    saleDiscount ?? 0,
  );

  const effectiveDue = paymentMode === 'paid' && !editing ? null : dueMode === 'day' ? nextDue : dueMode === 'date' ? dueDate || null : null;

  const errors: string[] = [];
  if (!isValidISODate(saleDate)) errors.push('Informe a data da venda.');
  items.forEach((item) => {
    if (item.unitPriceCents === null) errors.push(`${item.name}: informe o preço unitário.`);
    if (!item.quantity) errors.push(`${item.name}: informe a quantidade.`);
  });
  errors.push(...totals.errors.filter((e) => !e.includes('quantidade')));
  if (!editing && paymentMode === 'partial') {
    if (!partialAmount || partialAmount <= 0) errors.push('Informe o valor recebido agora.');
    else if (partialAmount >= totals.totalCents) errors.push('O valor parcial deve ser menor que o total (use "Pago agora").');
  }
  if ((paymentMode !== 'paid' || editing) && dueMode === 'date' && dueDate && dueDate < saleDate) errors.push('O vencimento não pode ser anterior à data da venda.');
  if ((paymentMode !== 'paid' || editing) && dueMode === 'date' && !isValidISODate(dueDate)) errors.push('Informe a data de vencimento.');
  if (newCustomer && !newCustomer.name.trim()) errors.push('Informe o nome do novo cliente.');

  const addProduct = (product: ProductRow) => {
    setItems((list) => {
      const index = list.findIndex((i) => i.productId === product.id && !i.showDiscount);
      if (index >= 0) return list.map((item, i) => (i === index ? { ...item, quantity: (item.quantity ?? 0) + 1 } : item));
      return [...list, newItem(product)];
    });
  };

  const changeItem = (key: string, patch: Partial<ItemDraft>) => setItems((list) => list.map((item) => (item.key === key ? { ...item, ...patch } : item)));

  const submit = () => {
    setSubmitted(true);
    if (errors.length > 0 || items.length === 0) return;
    const payload: SalePayload = {
      customer_id: newCustomer ? null : customerId,
      new_customer: newCustomer ? { name: newCustomer.name.trim(), phone: newCustomer.phone.trim() || null } : null,
      sale_date: saleDate,
      due_date: effectiveDue,
      payment_method: method,
      discount_cents: saleDiscount ?? 0,
      notes: notes.trim() || null,
      items: items.map((i) => ({
        id: i.id,
        product_id: i.productId,
        quantity: i.quantity!,
        unit_price_cents: i.unitPriceCents!,
        discount_cents: i.discountCents ?? 0,
      })),
      payment: editing
        ? null
        : paymentMode === 'paid'
          ? { full: true, method, paid_on: saleDate > today() ? today() : saleDate }
          : paymentMode === 'partial'
            ? { amount_cents: partialAmount!, method, paid_on: saleDate > today() ? today() : saleDate }
            : null,
    };
    if (editing) {
      update.mutate({ saleId: saleId!, sale: payload }, { onSuccess: () => navigate(`/vendas/${saleId}`, { replace: true }) });
    } else {
      create.mutate(
        { requestId, sale: payload },
        {
          onSuccess: (id) => {
            renewRequestId();
            navigate(`/vendas/${id}`, { replace: true });
          },
        },
      );
    }
  };

  const pending = create.isPending || update.isPending;
  const remaining = paymentMode === 'partial' && partialAmount ? totals.totalCents - partialAmount : totals.totalCents;

  return (
    <Page className="max-w-4xl">
      <PageHeader
        back={
          <Link to={editing ? `/vendas/${saleId}` : '/vendas'} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ArrowLeft className="size-4" /> {editing ? 'Voltar à venda' : 'Vendas'}
          </Link>
        }
        title={editing ? 'Editar venda' : 'Nova venda'}
        description={editing ? 'Itens mantidos preservam o custo histórico. Recebimentos são lançados na tela da venda.' : undefined}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          {/* Cliente e data */}
          <Card className="p-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_11rem]">
              <div>
                <p className="mb-1.5 text-sm font-medium text-ink-soft">Cliente</p>
                {newCustomer ? (
                  <div className="space-y-2 rounded-lg border border-accent bg-accent-soft/40 p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">Novo cliente</p>
                      <Button variant="ghost" size="icon-sm" aria-label="Cancelar novo cliente" onClick={() => setNewCustomer(null)}>
                        <X />
                      </Button>
                    </div>
                    <Input aria-label="Nome do novo cliente" value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} placeholder="Nome" />
                    <Input aria-label="Telefone do novo cliente" type="tel" inputMode="tel" value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} placeholder="Telefone (opcional)" />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPickCustomer(true)}
                    className="flex h-10 w-full items-center gap-2 rounded-lg border border-line-strong bg-panel px-3 text-left text-sm hover:bg-subtle"
                    aria-label={customer ? `Cliente: ${customer.name}. Trocar` : 'Escolher cliente'}
                  >
                    <UserRound className="size-4 text-muted" aria-hidden />
                    <span className={cn('flex-1 truncate', !customer && 'text-muted')}>{customer ? customer.name : 'Escolher ou cadastrar cliente'}</span>
                    {customer && customer.open_balance_cents > 0 ? <span className="text-xs text-danger">deve {formatBRL(customer.open_balance_cents)}</span> : null}
                    <ChevronDown className="size-4 text-muted" aria-hidden />
                  </button>
                )}
              </div>
              <Field label="Data da venda" required>
                <Input type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />
              </Field>
            </div>
          </Card>

          {/* Produtos */}
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-sans text-sm font-semibold">Produtos</h2>
              <Button variant="ghost" size="sm" onClick={() => setPickProduct(true)}>
                <Search /> Buscar
              </Button>
            </div>
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Adicionar produto rapidamente">
              {activeProducts.slice(0, 8).map((product) => {
                const count = items.filter((i) => i.productId === product.id).reduce((sum, i) => sum + (i.quantity ?? 0), 0);
                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => addProduct(product)}
                    className={cn(
                      'relative flex min-h-16 flex-col justify-between rounded-xl border px-3 py-2 text-left transition-colors',
                      count > 0 ? 'border-accent bg-accent-soft/60' : 'border-line bg-panel hover:bg-subtle',
                    )}
                    aria-label={`Adicionar ${product.name}${count ? ` (${count} na venda)` : ''}`}
                  >
                    <span className="line-clamp-2 text-sm font-medium leading-tight">{product.name}</span>
                    <span className="text-xs text-muted">{product.price_cents === null ? 'preço a definir' : formatBRL(product.price_cents)}</span>
                    {count > 0 ? (
                      <span className="absolute right-1.5 top-1.5 grid min-w-5 place-items-center rounded-full bg-brand px-1 text-[0.7rem] font-semibold text-brand-fg">{count}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {items.length === 0 ? (
              <p className={cn('rounded-lg border border-dashed px-3 py-6 text-center text-sm', submitted ? 'border-danger text-danger' : 'border-line-strong text-muted')}>
                Toque em um produto para adicioná-lo à venda.
              </p>
            ) : (
              <ul className="space-y-3">
                {items.map((item, index) => {
                  const line = totals.lines[index];
                  return (
                    <li key={item.key} className="rounded-xl border border-line p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium">{item.name}</p>
                        <Button variant="ghost" size="icon-sm" aria-label={`Remover ${item.name}`} onClick={() => setItems((list) => list.filter((i) => i.key !== item.key))}>
                          <Trash2 />
                        </Button>
                      </div>
                      <div className="mt-2 grid grid-cols-[auto_1fr] items-end gap-3 sm:grid-cols-[auto_1fr_1fr]">
                        <div>
                          <p className="mb-1.5 text-xs font-medium text-ink-soft">Quantidade ({item.unit})</p>
                          <div className="flex items-center gap-1">
                            <Button variant="outline" size="icon" aria-label={`Diminuir ${item.name}`} disabled={(item.quantity ?? 0) <= 1} onClick={() => changeItem(item.key, { quantity: Math.max(1, (item.quantity ?? 1) - 1) })}>
                              <Minus />
                            </Button>
                            <QuantityInput aria-label={`Quantidade de ${item.name}`} value={item.quantity} onValueChange={(q) => changeItem(item.key, { quantity: q })} className="w-16 text-center" />
                            <Button variant="outline" size="icon" aria-label={`Aumentar ${item.name}`} onClick={() => changeItem(item.key, { quantity: (item.quantity ?? 0) + 1 })}>
                              <Plus />
                            </Button>
                          </div>
                        </div>
                        <Field label="Preço unitário" labelClassName="text-xs" error={submitted && item.unitPriceCents === null ? 'Informe o preço.' : null}>
                          <MoneyInput value={item.unitPriceCents} onValueChange={(v) => changeItem(item.key, { unitPriceCents: v })} />
                        </Field>
                        <div className="col-span-2 flex items-end justify-between gap-2 sm:col-span-1 sm:flex-col sm:items-end">
                          {item.showDiscount ? (
                            <Field label="Desconto do item" labelClassName="text-xs" className="w-36">
                              <MoneyInput value={item.discountCents} onValueChange={(v) => changeItem(item.key, { discountCents: v })} />
                            </Field>
                          ) : (
                            <Button variant="link" size="sm" onClick={() => changeItem(item.key, { showDiscount: true })}>
                              + desconto
                            </Button>
                          )}
                          <p className="text-right text-sm">
                            <span className="text-xs text-muted">Total </span>
                            <Money cents={line?.totalCents ?? 0} className="font-semibold" />
                          </p>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {/* Pagamento */}
          <Card className="p-4">
            <h2 className="mb-3 font-sans text-sm font-semibold">Pagamento</h2>
            {!editing ? (
              <div role="radiogroup" aria-label="Situação do pagamento" className="mb-4 grid grid-cols-3 gap-2">
                {(
                  [
                    ['paid', 'Pago agora'],
                    ['partial', 'Parcial'],
                    ['pending', 'A receber'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={paymentMode === value}
                    onClick={() => setPaymentMode(value)}
                    className={cn(
                      'h-11 rounded-lg border text-sm font-medium',
                      paymentMode === value ? 'border-brand bg-brand text-brand-fg' : 'border-line-strong bg-panel text-ink-soft hover:bg-subtle',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={paymentMode === 'pending' && !editing ? 'Forma de pagamento prevista' : 'Forma de pagamento'}>
                <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {paymentMode === 'partial' && !editing ? (
                <Field label="Valor recebido agora" required>
                  <MoneyInput value={partialAmount} onValueChange={setPartialAmount} />
                </Field>
              ) : null}
            </div>
            {paymentMode !== 'paid' || editing ? (
              <div className="mt-4">
                <p className="mb-1.5 text-sm font-medium text-ink-soft">{paymentMode === 'partial' ? 'Vencimento do restante' : 'Vencimento'}</p>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Vencimento">
                  {(
                    [
                      ['day', `Dia ${business.default_due_day} (${formatDateBR(nextDue).slice(0, 5)})`],
                      ['date', 'Outra data'],
                      ['none', 'Sem vencimento'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={dueMode === value}
                      onClick={() => setDueMode(value)}
                      className={cn(
                        'h-9 rounded-full border px-3 text-sm',
                        dueMode === value ? 'border-accent-ink bg-accent-soft font-medium text-accent-ink' : 'border-line-strong text-ink-soft hover:bg-subtle',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {dueMode === 'date' ? <Input type="date" aria-label="Data de vencimento" className="mt-2 w-44" min={saleDate} value={dueDate} onChange={(e) => setDueDate(e.target.value)} /> : null}
              </div>
            ) : null}
            <Field label="Observações" className="mt-4">
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: entregar no sábado" />
            </Field>
          </Card>
        </div>

        {/* Resumo */}
        <div className="lg:sticky lg:top-6 lg:h-fit">
          <Card className="p-4">
            <h2 className="mb-3 font-sans text-sm font-semibold">Resumo</h2>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Itens</dt>
                <dd><Money cents={totals.itemsSubtotalCents} /></dd>
              </div>
              {totals.itemsDiscountCents > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-muted">Descontos nos itens</dt>
                  <dd><Money cents={-totals.itemsDiscountCents} /></dd>
                </div>
              ) : null}
              {showSaleDiscount ? (
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted">Desconto na venda</dt>
                  <dd className="w-32">
                    <MoneyInput aria-label="Desconto na venda" value={saleDiscount} onValueChange={setSaleDiscount} />
                  </dd>
                </div>
              ) : (
                <div className="text-right">
                  <Button variant="link" size="sm" onClick={() => setShowSaleDiscount(true)}>
                    + desconto na venda
                  </Button>
                </div>
              )}
              <div className="flex justify-between border-t border-line pt-2 text-lg font-semibold">
                <dt>Total</dt>
                <dd><Money cents={totals.totalCents} /></dd>
              </div>
              {!editing && paymentMode !== 'paid' ? (
                <div className="flex justify-between text-sm">
                  <dt className="text-muted">A receber</dt>
                  <dd>
                    <Money cents={remaining} /> {effectiveDue ? <span className="text-xs text-muted">em {formatDateBR(effectiveDue)}</span> : null}
                  </dd>
                </div>
              ) : null}
            </dl>
            {customer?.phone && !newCustomer ? <p className="mt-2 text-xs text-muted">{customer.name} · {formatPhoneBR(customer.phone)}</p> : null}
            {submitted && (errors.length > 0 || items.length === 0) ? (
              <ul className="mt-3 space-y-1 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger" role="alert">
                {items.length === 0 ? <li>Adicione pelo menos um produto.</li> : null}
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            ) : null}
            {!online ? <p className="mt-3 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">Sem conexão: a venda só pode ser gravada com internet.</p> : null}
            <Button className="mt-4 w-full" size="lg" loading={pending} disabled={!online} onClick={submit}>
              {editing ? 'Salvar alterações' : paymentMode === 'paid' ? `Registrar venda paga · ${formatBRL(totals.totalCents)}` : 'Registrar venda'}
            </Button>
            <p className="mt-2 text-center text-xs text-muted">O total é recalculado e validado pelo servidor.</p>
          </Card>
        </div>
      </div>

      <EntityPicker
        open={pickCustomer}
        onOpenChange={setPickCustomer}
        title="Cliente"
        loading={customers.isPending}
        selectedId={customerId}
        options={[
          { id: '__none__', label: 'Sem cliente identificado', description: 'Venda de balcão' },
          ...(customers.data ?? [])
            .filter((c) => c.active || c.id === customerId)
            .map((c) => ({
              id: c.id,
              label: c.name,
              searchText: c.phone ?? '',
              description: [c.phone ? formatPhoneBR(c.phone) : null, c.open_balance_cents > 0 ? `em aberto ${formatBRL(c.open_balance_cents)}` : null].filter(Boolean).join(' · ') || undefined,
            })),
        ]}
        onSelect={(option) => {
          setNewCustomer(null);
          setCustomerId(option.id === '__none__' ? null : option.id);
        }}
        onCreate={(text) => {
          setCustomerId(null);
          setNewCustomer({ name: text, phone: '' });
        }}
        createLabel={(text) => `Cadastrar novo cliente “${text}”`}
      />
      <EntityPicker
        open={pickProduct}
        onOpenChange={setPickProduct}
        title="Produto"
        options={activeProducts.map((p) => ({ id: p.id, label: p.name, searchText: p.category ?? '', description: p.price_cents === null ? 'preço a definir' : formatBRL(p.price_cents) }))}
        emptyText="Nenhum produto ativo. Cadastre em Produtos."
        onSelect={(option) => {
          const product = activeProducts.find((p) => p.id === option.id);
          if (product) addProduct(product);
        }}
      />
    </Page>
  );
}
