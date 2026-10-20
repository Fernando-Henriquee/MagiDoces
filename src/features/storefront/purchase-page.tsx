import { useMutation } from '@tanstack/react-query';
import { CircleCheck, KeyRound, Minus, Plus, ReceiptText, Send } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Money } from '@/components/shared/money';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import {
  createAccessCode,
  type PaymentChoice,
  type PurchaseReceipt,
  registerPurchase,
  reportPaid,
  type Storefront,
  type StorefrontProduct,
  useStorefront,
} from '@/data/storefront';
import { accessCodeProblem } from '@/lib/access-code';
import { cn } from '@/lib/cn';
import { formatDateBR } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { formatQuantity } from '@/lib/money';
import { formatPhoneBR, normalizePhoneBR } from '@/lib/whatsapp';
import { PixPayment } from './pix-payment';
import { StorefrontLayout, StorefrontUnavailable } from './storefront-layout';

const MAX_QUANTITY = 50;

type FieldName = 'items' | 'name' | 'phone' | 'payment' | 'due_date';

export function PurchasePage() {
  const { token = '' } = useParams();
  const storefront = useStorefront(token);
  const [done, setDone] = useState<{ receipt: PurchaseReceipt; requestId: string } | null>(null);
  const [formKey, setFormKey] = useState(0);

  if (storefront.isPending) {
    return (
      <StorefrontLayout>
        <LoadingBlock rows={5} />
      </StorefrontLayout>
    );
  }
  if (storefront.isError) {
    return (
      <StorefrontLayout>
        <ErrorState error={storefront.error} onRetry={() => void storefront.refetch()} />
      </StorefrontLayout>
    );
  }
  if (!storefront.data) return <StorefrontUnavailable />;

  return (
    <StorefrontLayout businessName={storefront.data.business_name}>
      {done ? (
        <ReceiptView
          token={token}
          storefront={storefront.data}
          initial={done.receipt}
          requestId={done.requestId}
          onNewPurchase={() => {
            setDone(null);
            setFormKey((key) => key + 1);
            window.scrollTo({ top: 0 });
          }}
        />
      ) : (
        <PurchaseForm
          key={formKey}
          token={token}
          storefront={storefront.data}
          onDone={(receipt, requestId) => {
            setDone({ receipt, requestId });
            window.scrollTo({ top: 0 });
          }}
        />
      )}
    </StorefrontLayout>
  );
}

function groupByCategory(products: StorefrontProduct[]): Array<{ category: string | null; products: StorefrontProduct[] }> {
  const groups: Array<{ category: string | null; products: StorefrontProduct[] }> = [];
  for (const product of products) {
    const last = groups.at(-1);
    if (last && last.category === product.category) last.products.push(product);
    else groups.push({ category: product.category, products: [product] });
  }
  return groups;
}

function PurchaseForm({ token, storefront, onDone }: { token: string; storefront: Storefront; onDone: (receipt: PurchaseReceipt, requestId: string) => void }) {
  // Um identificador por compra: reenviar (toque duplo, internet instável) não duplica.
  const [requestId] = useState(() => crypto.randomUUID());
  const [cart, setCart] = useState<Record<string, number>>({});
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [payment, setPayment] = useState<PaymentChoice | null>(null);
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const submit = useMutation({
    mutationFn: () =>
      registerPurchase(token, requestId, {
        name: name.trim(),
        phone,
        notes: notes.trim() || null,
        items: storefront.products.filter((p) => (cart[p.id] ?? 0) > 0).map((p) => ({ product_id: p.id, quantity: cart[p.id]! })),
        payment: payment!,
        due_date: payment === 'date' ? dueDate : null,
      }),
    onSuccess: (receipt) => onDone(receipt, requestId),
  });

  const chosen = storefront.products.filter((p) => (cart[p.id] ?? 0) > 0);
  const total = chosen.reduce((sum, p) => sum + p.price_cents * cart[p.id]!, 0);
  const count = chosen.reduce((sum, p) => sum + cart[p.id]!, 0);

  function change(product: StorefrontProduct, delta: number) {
    setCart((current) => {
      const next = Math.min(MAX_QUANTITY, Math.max(0, (current[product.id] ?? 0) + delta));
      return { ...current, [product.id]: next };
    });
    setErrors((current) => ({ ...current, items: undefined }));
  }

  function validate(): Partial<Record<FieldName, string>> {
    const found: Partial<Record<FieldName, string>> = {};
    if (chosen.length === 0) found.items = 'Escolha pelo menos um produto.';
    if (name.trim().length < 2) found.name = 'Informe seu nome.';
    if (!normalizePhoneBR(phone)) found.phone = 'Informe seu celular com DDD, por exemplo (11) 98765-4321.';
    if (!payment) found.payment = 'Escolha quando vai pagar.';
    if (payment === 'date' && (!dueDate || dueDate < storefront.today || dueDate > storefront.max_due_date)) {
      found.due_date = `Escolha uma data entre hoje e ${formatDateBR(storefront.max_due_date)}.`;
    }
    return found;
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    const first = (['items', 'name', 'phone', 'payment', 'due_date'] as const).find((key) => found[key]);
    if (first) {
      document.getElementById(`sf-${first}`)?.focus();
      return;
    }
    submit.mutate();
  }

  if (storefront.products.length === 0) {
    return (
      <div className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-panel/60 px-6 py-10 text-center">
        <p className="font-display text-lg">Nenhum produto disponível no momento</p>
        <p className="mt-1 text-sm text-muted">Fale direto com a {storefront.business_name} para anotar sua compra.</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <section aria-labelledby="sf-items-title">
        <h1 id="sf-items-title" className="text-2xl font-semibold">
          O que você levou?
        </h1>
        <p className="mt-1 text-sm text-muted">Toque em + para escolher os produtos e as quantidades.</p>
        <div id="sf-items" tabIndex={-1} className="mt-3 space-y-4 outline-none">
          {groupByCategory(storefront.products).map((group) => (
            <div key={group.category ?? 'sem-categoria'}>
              {group.category ? <h2 className="mb-2 font-sans text-xs font-semibold uppercase tracking-wide text-muted">{group.category}</h2> : null}
              <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-panel shadow-[var(--shadow-card)]">
                {group.products.map((product) => {
                  const quantity = cart[product.id] ?? 0;
                  return (
                    <li key={product.id} className={cn('flex items-center gap-3 px-4 py-3', quantity > 0 && 'bg-accent-soft/50')}>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{product.name}</p>
                        {product.description ? <p className="line-clamp-2 text-xs text-muted">{product.description}</p> : null}
                        <p className="mt-0.5 text-sm">
                          <Money cents={product.price_cents} className="font-semibold" />
                          {product.unit !== 'un' ? <span className="text-muted"> / {product.unit}</span> : null}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className={cn('rounded-full', quantity === 0 && 'invisible')}
                          aria-label={`Remover um ${product.name}`}
                          onClick={() => change(product, -1)}
                        >
                          <Minus />
                        </Button>
                        <output aria-label={`Quantidade de ${product.name}`} className={cn('num w-7 text-center text-lg font-semibold', quantity === 0 && 'text-muted')}>
                          {quantity}
                        </output>
                        <Button
                          type="button"
                          variant={quantity > 0 ? 'primary' : 'outline'}
                          size="icon"
                          className="rounded-full"
                          aria-label={`Adicionar ${product.name}`}
                          disabled={quantity >= MAX_QUANTITY}
                          onClick={() => change(product, 1)}
                        >
                          <Plus />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
        {errors.items ? (
          <p role="alert" className="mt-2 text-sm font-medium text-danger">
            {errors.items}
          </p>
        ) : null}
      </section>

      <Card>
        <CardHeader title="Seus dados" description="Para a loja saber de quem é a compra e falar com você no WhatsApp." />
        <div className="space-y-4 p-4">
          <Field label="Seu nome" required error={errors.name}>
            <Input
              id="sf-name"
              autoComplete="name"
              maxLength={80}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setErrors((current) => ({ ...current, name: undefined }));
              }}
            />
          </Field>
          <Field label="Seu celular (WhatsApp)" required error={errors.phone} hint="Com DDD. É por ele que você consulta o que deve.">
            <Input
              id="sf-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              placeholder="(11) 98765-4321"
              maxLength={20}
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setErrors((current) => ({ ...current, phone: undefined }));
              }}
              onBlur={() => setPhone((value) => (normalizePhoneBR(value) ? formatPhoneBR(value) : value))}
            />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Quando vai pagar?" />
        <fieldset id="sf-payment" tabIndex={-1} className="space-y-2 p-4 outline-none" aria-describedby={errors.payment ? 'sf-payment-error' : undefined}>
          <legend className="sr-only">Quando vai pagar?</legend>
          <PaymentOption
            value="now"
            current={payment}
            onChange={setPayment}
            title={storefront.pix ? 'Agora, no PIX' : 'Agora'}
            description={storefront.pix ? 'Mostramos o código PIX com o valor certinho.' : 'Combine o pagamento com a loja.'}
          />
          <PaymentOption
            value="due_day"
            current={payment}
            onChange={setPayment}
            title={`No dia ${storefront.due_day}`}
            description={`Vence em ${formatDateBR(storefront.next_due_date)}.`}
          />
          <PaymentOption value="date" current={payment} onChange={setPayment} title="Outra data" description="Escolha o dia em que vai pagar." />
          {payment === 'date' ? (
            <Field label="Data do pagamento" required error={errors.due_date} className="pt-1">
              <Input
                id="sf-due_date"
                type="date"
                min={storefront.today}
                max={storefront.max_due_date}
                value={dueDate}
                onChange={(e) => {
                  setDueDate(e.target.value);
                  setErrors((current) => ({ ...current, due_date: undefined }));
                }}
              />
            </Field>
          ) : null}
          {errors.payment ? (
            <p id="sf-payment-error" role="alert" className="text-sm font-medium text-danger">
              {errors.payment}
            </p>
          ) : null}
        </fieldset>
      </Card>

      <Field label="Observação (opcional)" hint="Ex.: “sem lactose”, “retiro amanhã”.">
        <Textarea rows={2} maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>

      {submit.isError ? <ErrorState error={submit.error} /> : null}

      <div className="sticky bottom-0 -mx-4 border-t border-line bg-cream/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <div className="mb-2 flex items-baseline justify-between text-sm">
          <span className="text-muted">
            {count === 0 ? 'Nenhum produto escolhido' : `${count} ${count === 1 ? 'item' : 'itens'}`}
          </span>
          <span>
            Total <Money cents={total} className="text-xl font-semibold" />
          </span>
        </div>
        <Button type="submit" size="lg" className="w-full" loading={submit.isPending}>
          <Send /> Anotar compra
        </Button>
      </div>
    </form>
  );
}

function PaymentOption({
  value,
  current,
  onChange,
  title,
  description,
}: {
  value: PaymentChoice;
  current: PaymentChoice | null;
  onChange: (value: PaymentChoice) => void;
  title: string;
  description: string;
}) {
  const checked = current === value;
  return (
    <label className={cn('flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 transition-colors', checked ? 'border-brand bg-subtle' : 'border-line hover:bg-subtle/60')}>
      <input type="radio" name="sf-payment" value={value} checked={checked} onChange={() => onChange(value)} className="mt-1 size-4 accent-brand" />
      <span>
        <span className="block font-medium">{title}</span>
        <span className="block text-xs text-muted">{description}</span>
      </span>
    </label>
  );
}

function ReceiptView({
  token,
  storefront,
  initial,
  requestId,
  onNewPurchase,
}: {
  token: string;
  storefront: Storefront;
  initial: PurchaseReceipt;
  requestId: string;
  onNewPurchase: () => void;
}) {
  const [receipt, setReceipt] = useState(initial);
  const [showPix, setShowPix] = useState(initial.payment === 'now');
  const paid = useMutation({ mutationFn: () => reportPaid(token, receipt.sale_id, requestId), onSuccess: setReceipt });
  const pix = receipt.pix;
  const due = receipt.payment === 'now' ? 'Pagamento: agora' : `Vence em ${formatDateBR(receipt.due_date)}`;

  return (
    <div className="space-y-5">
      <div className="text-center">
        <CircleCheck className="mx-auto size-12 text-success" aria-hidden />
        <h1 className="mt-2 text-2xl font-semibold">Compra anotada!</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Obrigada, {receipt.customer_first_name}! A {storefront.business_name} já recebeu sua anotação.
        </p>
      </div>

      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><ReceiptText className="size-4 text-muted" aria-hidden /> Sua compra</span>} description={`${formatDateBR(receipt.sale_date)} · ${due}`} />
        <ul className="divide-y divide-line px-4">
          {receipt.items.map((item) => (
            <li key={item.name} className="flex items-baseline justify-between gap-3 py-2 text-sm">
              <span>
                {formatQuantity(item.quantity)}× {item.name}
              </span>
              <Money cents={item.total_cents} />
            </li>
          ))}
        </ul>
        <div className="flex items-baseline justify-between border-t border-line px-4 py-3">
          <span className="font-medium">Total</span>
          <Money cents={receipt.total_cents} className="text-xl font-semibold" />
        </div>
      </Card>

      {showPix && pix && receipt.balance_cents > 0 ? (
        <div className="space-y-3">
          <PixPayment pix={pix} amountCents={receipt.balance_cents} />
          {receipt.reported_paid ? (
            <p role="status" className="rounded-lg bg-success-soft px-3 py-2 text-sm text-success">
              Você avisou que já pagou. A loja vai conferir o PIX. Obrigada!
            </p>
          ) : (
            <Button variant="outline" className="w-full" loading={paid.isPending} onClick={() => paid.mutate()}>
              <CircleCheck /> Já paguei
            </Button>
          )}
          {paid.isError ? <p role="alert" className="text-sm text-danger">{describeError(paid.error)}</p> : null}
        </div>
      ) : null}
      {receipt.payment === 'now' && !pix ? (
        <p className="rounded-lg bg-subtle px-3 py-2 text-sm text-ink-soft">Combine o pagamento direto com a loja.</p>
      ) : null}
      {!showPix && pix && receipt.balance_cents > 0 ? (
        <Button variant="outline" className="w-full" onClick={() => setShowPix(true)}>
          Quero pagar agora pelo PIX
        </Button>
      ) : null}

      <CodeSection token={token} storefront={storefront} receipt={receipt} requestId={requestId} onChange={setReceipt} />

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button asChild variant="outline" className="sm:flex-1">
          <Link to={`/compra/${token}/consulta`}>Ver quanto eu devo</Link>
        </Button>
        <Button variant="ghost" className="sm:flex-1" onClick={onNewPurchase}>
          Anotar outra compra
        </Button>
      </div>
    </div>
  );
}

function CodeSection({
  token,
  storefront,
  receipt,
  requestId,
  onChange,
}: {
  token: string;
  storefront: Storefront;
  receipt: PurchaseReceipt;
  requestId: string;
  onChange: (receipt: PurchaseReceipt) => void;
}) {
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [created, setCreated] = useState(false);
  const save = useMutation({
    mutationFn: () => createAccessCode(token, receipt.sale_id, requestId, code),
    onSuccess: (updated) => {
      setCreated(true);
      onChange(updated);
    },
  });

  if (receipt.code_status === 'has_code') {
    return (
      <p className="flex items-start gap-2 rounded-lg bg-subtle px-3 py-2 text-sm text-ink-soft">
        <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden />
        {created
          ? 'Código criado! Para ver quanto deve, use seu celular e esse código em “Quanto eu devo”. Guarde-o: nem a loja consegue vê-lo.'
          : 'Para ver quanto deve, use seu celular e seu código de consulta em “Quanto eu devo”.'}
      </p>
    );
  }
  if (receipt.code_status === 'ask_business') {
    return (
      <p className="flex items-start gap-2 rounded-lg bg-subtle px-3 py-2 text-sm text-ink-soft">
        <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden />
        Para consultar o que deve por aqui, peça seu código de consulta à {storefront.business_name} pelo WhatsApp.
      </p>
    );
  }
  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><KeyRound className="size-4 text-muted" aria-hidden /> Crie seu código de consulta</span>}
        description="Com seu celular e esse código, você vê quanto deve sempre que quiser."
      />
      <form
        noValidate
        className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          const found = accessCodeProblem(code);
          setProblem(found);
          if (!found) save.mutate();
        }}
      >
        <Field label="Código de 4 números" error={problem ?? (save.isError ? describeError(save.error) : null)} className="flex-1">
          <Input
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            pattern="\d{4}"
            placeholder="••••"
            className="num text-center text-lg tracking-[0.5em]"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, '').slice(0, 4));
              setProblem(null);
            }}
          />
        </Field>
        <Button type="submit" loading={save.isPending}>
          Salvar código
        </Button>
      </form>
    </Card>
  );
}
