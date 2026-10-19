import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Plus, Trash2, Wheat, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import { EntityPicker } from '@/components/shared/entity-picker';
import { Money } from '@/components/shared/money';
import { Page, PageHeader } from '@/components/layout/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input';
import { MoneyInput, QuantityInput } from '@/components/ui/money-input';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { useIngredients } from '@/data/catalog';
import { type PurchaseDetail, type PurchasePayload, useCreatePurchase, usePurchase, useUpdatePurchase } from '@/data/payables';
import { type Ingredient, PAYMENT_METHODS, type PaymentMethod } from '@/data/types';
import { useBusiness } from '@/features/business/business-context';
import { computePurchaseTotals, ingredientCostUpdateProblem, suggestedFirstDue } from '@/features/finance/bills/bill-calc';
import { PURCHASE_CATEGORIES, PURCHASE_UNITS } from '@/features/finance/bills/constants';
import { PaymentPlanFields, planErrors, planToPayload, type PlanValue } from '@/features/finance/bills/payment-plan';
import { ReceiptField } from '@/features/finance/bills/receipt';
import { SupplierField } from '@/features/finance/bills/supplier-field';
import { formatBRL, formatQuantity } from '@/lib/money';
import { useRequestId } from '@/lib/use-request-id';

const itemSchema = z.object({
  key: z.string(),
  ingredientId: z.string().nullable(),
  ingredientName: z.string().nullable(),
  ingredientUnit: z.string().nullable(),
  description: z.string(),
  quantity: z.number().nullable(),
  unit: z.string(),
  unitPriceCents: z.number().nullable(),
  updateIngredientCost: z.boolean(),
});

const schema = z
  .object({
    purchaseDate: z.string().min(1, 'Informe a data da compra.'),
    supplier: z.object({ id: z.string().nullable(), newName: z.string().nullable(), label: z.string() }).nullable(),
    description: z.string().trim().min(1, 'Informe uma descrição.').max(200, 'Use até 200 caracteres.'),
    category: z.string().trim().min(1, 'Informe a categoria.').max(60, 'Use até 60 caracteres.'),
    paymentMethod: z.string(),
    dueDate: z.string(),
    notes: z.string().max(2000, 'Use até 2.000 caracteres.'),
    extraCents: z.number().nullable(),
    discountCents: z.number().nullable(),
    items: z.array(itemSchema).min(1, 'Adicione pelo menos um item.'),
  })
  .superRefine((values, ctx) => {
    values.items.forEach((item, index) => {
      const path = (field: string) => ['items', index, field];
      if (!item.description.trim() && !item.ingredientId) ctx.addIssue({ code: 'custom', path: path('description'), message: 'Descreva o item ou escolha um ingrediente.' });
      if (item.quantity === null || item.quantity <= 0) ctx.addIssue({ code: 'custom', path: path('quantity'), message: 'Quantidade maior que zero (até 3 casas).' });
      if (!item.unit.trim()) ctx.addIssue({ code: 'custom', path: path('unit'), message: 'Informe a unidade.' });
      if (item.unitPriceCents === null || item.unitPriceCents < 0) ctx.addIssue({ code: 'custom', path: path('unitPriceCents'), message: 'Informe o valor unitário.' });
      if (item.ingredientId && item.updateIngredientCost) {
        const problem = ingredientCostUpdateProblem(item.unit, item.ingredientUnit);
        if (problem) ctx.addIssue({ code: 'custom', path: path('updateIngredientCost'), message: problem });
      }
    });
    if ((values.extraCents ?? 0) < 0) ctx.addIssue({ code: 'custom', path: ['extraCents'], message: 'Valor inválido.' });
    if ((values.discountCents ?? 0) < 0) ctx.addIssue({ code: 'custom', path: ['discountCents'], message: 'Valor inválido.' });
    const totals = computePurchaseTotals(values.items, values.extraCents, values.discountCents);
    if (totals.totalCents < 0) ctx.addIssue({ code: 'custom', path: ['discountCents'], message: 'O desconto não pode ser maior que itens + frete.' });
  });

type Values = z.infer<typeof schema>;
type ItemValues = Values['items'][number];

function emptyItem(): ItemValues {
  return {
    key: crypto.randomUUID(),
    ingredientId: null,
    ingredientName: null,
    ingredientUnit: null,
    description: '',
    quantity: null,
    unit: '',
    unitPriceCents: null,
    updateIngredientCost: false,
  };
}

function editValues(detail: PurchaseDetail, ingredients: Ingredient[]): Values {
  const { purchase, items: rows } = detail;
  const byId = new Map(ingredients.map((i) => [i.id, i]));
  return {
    purchaseDate: purchase.purchase_date,
    supplier: purchase.supplier_id ? { id: purchase.supplier_id, newName: null, label: purchase.supplier_name ?? '' } : null,
    description: purchase.description,
    category: purchase.category,
    paymentMethod: purchase.payment_method ?? '',
    dueDate: purchase.due_date ?? '',
    notes: purchase.notes ?? '',
    extraCents: purchase.extra_cents || null,
    discountCents: purchase.discount_cents || null,
    items: rows.map((row) => ({
      key: row.id,
      ingredientId: row.ingredient_id,
      ingredientName: row.ingredient_id ? (byId.get(row.ingredient_id)?.name ?? null) : null,
      ingredientUnit: row.ingredient_id ? (byId.get(row.ingredient_id)?.unit ?? null) : null,
      description: row.description,
      quantity: Number(row.quantity),
      unit: row.unit,
      unitPriceCents: row.unit_price_cents,
      updateIngredientCost: false,
    })),
  };
}

/** Carrega a compra (na edição) e só então monta o formulário com os valores iniciais. */
export function PurchaseFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const { can } = useBusiness();
  const existing = usePurchase(id);
  const ingredients = useIngredients();

  if (!can('write')) {
    return (
      <Page>
        <EmptyState title="Seu perfil é somente leitura" description="Peça a uma sócia para registrar ou editar compras." />
      </Page>
    );
  }
  if (!isEdit) return <PurchaseForm key="new" purchaseId={null} initial={null} initialReceiptPath={null} />;
  if (existing.isPending || ingredients.isPending) {
    return (
      <Page>
        <LoadingBlock />
      </Page>
    );
  }
  if (!existing.data || !ingredients.data) {
    return (
      <Page>
        <ErrorState error={existing.error ?? ingredients.error} onRetry={() => void existing.refetch()} />
      </Page>
    );
  }
  if (existing.data.purchase.status === 'cancelled') {
    return (
      <Page>
        <EmptyState title="Compra cancelada" description="Compras canceladas não podem ser editadas." action={<Button asChild variant="outline"><Link to={`/compras/${id}`}>Voltar</Link></Button>} />
      </Page>
    );
  }
  return (
    <PurchaseForm
      key={id}
      purchaseId={id!}
      initial={editValues(existing.data, ingredients.data)}
      initialReceiptPath={existing.data.purchase.receipt_path}
    />
  );
}

function PurchaseForm({ purchaseId, initial, initialReceiptPath }: { purchaseId: string | null; initial: Values | null; initialReceiptPath: string | null }) {
  const id = purchaseId ?? undefined;
  const isEdit = purchaseId !== null;
  const navigate = useNavigate();
  const { today } = useBusiness();
  const ingredients = useIngredients();
  const create = useCreatePurchase();
  const update = useUpdatePurchase();
  const [requestId, renewRequestId] = useRequestId();
  const [receipt, setReceipt] = useState<File | null>(null);
  const [receiptPath, setReceiptPath] = useState<string | null>(initialReceiptPath);
  const [submitted, setSubmitted] = useState(false);
  const [pickingIndex, setPickingIndex] = useState<number | null>(null);
  const [plan, setPlan] = useState<PlanValue>(() => ({
    mode: 'pending',
    paidOn: today(),
    method: '',
    dueDate: '',
    count: 2,
    firstDueDate: suggestedFirstDue(today(), null),
  }));

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: initial ?? {
      purchaseDate: today(),
      supplier: null,
      description: '',
      category: 'Ingredientes',
      paymentMethod: '',
      dueDate: '',
      notes: '',
      extraCents: null,
      discountCents: null,
      items: [emptyItem()],
    },
  });
  const items = useFieldArray({ control: form.control, name: 'items', keyName: 'fieldKey' });

  const watchedItems = useWatch({ control: form.control, name: 'items' });
  const extraCents = useWatch({ control: form.control, name: 'extraCents' });
  const discountCents = useWatch({ control: form.control, name: 'discountCents' });
  const totals = useMemo(() => computePurchaseTotals(watchedItems ?? [], extraCents, discountCents), [watchedItems, extraCents, discountCents]);
  const planProblems = planErrors(plan, totals.totalCents, today());
  const pending = create.isPending || update.isPending;

  const ingredientOptions = (ingredients.data ?? [])
    .filter((ingredient) => ingredient.active)
    .map((ingredient) => ({
      id: ingredient.id,
      label: ingredient.name,
      description: `Último custo: ${formatBRL(ingredient.purchase_price_cents)} por ${formatQuantity(ingredient.purchase_quantity)} ${ingredient.unit}`,
    }));

  const onSubmit = form.handleSubmit((values) => {
    setSubmitted(true);
    if (pending) return;
    if (!isEdit && Object.keys(planProblems).length > 0) return;
    const base: PurchasePayload = {
      purchase_date: values.purchaseDate,
      supplier_id: values.supplier?.id ?? null,
      new_supplier_name: values.supplier?.id ? null : (values.supplier?.newName ?? null),
      description: values.description.trim(),
      category: values.category.trim(),
      payment_method: (values.paymentMethod || null) as PaymentMethod | null,
      due_date: values.dueDate || null,
      receipt_path: receiptPath,
      notes: values.notes.trim() || null,
      extra_cents: values.extraCents ?? 0,
      discount_cents: values.discountCents ?? 0,
      items: values.items.map((item) => ({
        ingredient_id: item.ingredientId,
        description: item.description.trim() || item.ingredientName || '',
        quantity: item.quantity!,
        unit: item.unit.trim(),
        unit_price_cents: item.unitPriceCents!,
        update_ingredient_cost: Boolean(item.ingredientId && item.updateIngredientCost),
      })),
    };
    if (isEdit && id) {
      update.mutate({ purchaseId: id, purchase: base, receipt }, { onSuccess: () => navigate(`/compras/${id}`) });
      return;
    }
    const { plan: planPayload, dueDate } = planToPayload(plan);
    const payment_method = base.payment_method ?? (plan.method || null);
    create.mutate(
      { requestId, purchase: { ...base, due_date: dueDate, payment_method, plan: planPayload }, receipt },
      {
        onSuccess: (newId) => {
          renewRequestId();
          navigate(`/compras/${newId}`);
        },
      },
    );
  });

  const errors = form.formState.errors;

  return (
    <Page className="max-w-3xl">
      <PageHeader
        title={isEdit ? 'Editar compra' : 'Nova compra'}
        description="Compras de insumos e materiais. O custo dos produtos entra no resultado quando eles são vendidos."
        back={
          <Button asChild variant="link" size="sm">
            <Link to={isEdit ? `/compras/${id}` : '/compras'}>
              <ArrowLeft className="size-4" /> Voltar
            </Link>
          </Button>
        }
      />
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Card className="space-y-4 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Data da compra" required error={errors.purchaseDate?.message}>
              <Input type="date" {...form.register('purchaseDate')} />
            </Field>
            <Controller
              control={form.control}
              name="supplier"
              render={({ field }) => (
                <Field label="Fornecedor">
                  <SupplierField value={field.value} onChange={field.onChange} />
                </Field>
              )}
            />
            <Field label="Descrição" required error={errors.description?.message} className="sm:col-span-2">
              <Input placeholder="Ex.: Compra do mês no atacado" maxLength={200} {...form.register('description')} />
            </Field>
            <Field label="Categoria" required error={errors.category?.message}>
              <Input list="purchase-categories" maxLength={60} {...form.register('category')} />
            </Field>
            <datalist id="purchase-categories">
              {PURCHASE_CATEGORIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            {isEdit ? (
              <>
                <Field label="Forma de pagamento">
                  <Select {...form.register('paymentMethod')}>
                    <option value="">Não informada</option>
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Vencimento" hint="Vale para o saldo sem parcela definida.">
                  <Input type="date" {...form.register('dueDate')} />
                </Field>
              </>
            ) : null}
          </div>
        </Card>

        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-sans text-base font-semibold">Itens</h2>
            <Button type="button" variant="outline" size="sm" onClick={() => items.append(emptyItem())}>
              <Plus /> Item
            </Button>
          </div>
          {errors.items?.root?.message || errors.items?.message ? (
            <p role="alert" className="mb-2 text-xs font-medium text-danger">
              {errors.items?.root?.message ?? errors.items?.message}
            </p>
          ) : null}
          <ol className="space-y-3">
            {items.fields.map((fieldItem, index) => {
              const itemErrors = errors.items?.[index];
              const current = watchedItems?.[index];
              const costProblem = current?.ingredientId ? ingredientCostUpdateProblem(current.unit, current.ingredientUnit) : null;
              return (
                <li key={fieldItem.fieldKey} className="rounded-lg border border-line bg-subtle/40 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted">Item {index + 1}</span>
                    {items.fields.length > 1 ? (
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remover item ${index + 1}`} onClick={() => items.remove(index)}>
                        <Trash2 />
                      </Button>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-6 gap-x-2 gap-y-3 sm:gap-x-3">
                    <Field label="Descrição" error={itemErrors?.description?.message} className="col-span-6 sm:col-span-4">
                      <Input placeholder={current?.ingredientName ?? 'Ex.: Leite condensado 395 g'} maxLength={200} {...form.register(`items.${index}.description`)} />
                    </Field>
                    <div className="col-span-6 flex flex-col gap-1.5 sm:col-span-2">
                      <span className="text-sm font-medium text-ink-soft">Ingrediente</span>
                      <div className="flex items-center gap-1">
                        <Button type="button" variant="outline" className="h-10 min-w-0 flex-1 justify-start font-normal" onClick={() => setPickingIndex(index)}>
                          <Wheat className="text-muted" />
                          <span className={current?.ingredientId ? 'truncate text-ink' : 'truncate text-muted'}>{current?.ingredientName ?? 'Opcional'}</span>
                        </Button>
                        {current?.ingredientId ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Desvincular ingrediente"
                            onClick={() => {
                              form.setValue(`items.${index}.ingredientId`, null);
                              form.setValue(`items.${index}.ingredientName`, null);
                              form.setValue(`items.${index}.ingredientUnit`, null);
                              form.setValue(`items.${index}.updateIngredientCost`, false);
                            }}
                          >
                            <X />
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    <Controller
                      control={form.control}
                      name={`items.${index}.quantity`}
                      render={({ field }) => (
                        <Field label="Quantidade" error={itemErrors?.quantity?.message} className="col-span-2">
                          <QuantityInput value={field.value} onValueChange={field.onChange} onBlur={field.onBlur} />
                        </Field>
                      )}
                    />
                    <Field label="Unidade" error={itemErrors?.unit?.message} className="col-span-2 sm:col-span-1">
                      <Input list="purchase-units" maxLength={20} autoCapitalize="none" {...form.register(`items.${index}.unit`)} />
                    </Field>
                    <Controller
                      control={form.control}
                      name={`items.${index}.unitPriceCents`}
                      render={({ field }) => (
                        <Field label="Valor unit." error={itemErrors?.unitPriceCents?.message} className="col-span-2">
                          <MoneyInput value={field.value} onValueChange={field.onChange} onBlur={field.onBlur} />
                        </Field>
                      )}
                    />
                    <div className="col-span-6 flex items-center justify-between gap-2 sm:col-span-1 sm:flex-col sm:items-start sm:justify-end">
                      <span className="text-xs text-muted">Total do item</span>
                      <Money cents={totals.lines[index] ?? 0} className="text-sm font-semibold sm:flex sm:h-10 sm:items-center" />
                    </div>
                  </div>
                  {current?.ingredientId ? (
                    <div className="mt-2 space-y-1">
                      <label className="flex items-start gap-2 text-sm text-ink-soft">
                        <Checkbox className="mt-0.5" {...form.register(`items.${index}.updateIngredientCost`)} />
                        <span>
                          Atualizar o custo de aquisição de <strong>{current.ingredientName}</strong> com esta compra (afeta o custo das próximas
                          vendas, não das passadas).
                        </span>
                      </label>
                      {current.updateIngredientCost && costProblem ? (
                        <p role="alert" className="text-xs font-medium text-danger">
                          {itemErrors?.updateIngredientCost?.message ?? costProblem}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
          <datalist id="purchase-units">
            {PURCHASE_UNITS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>

          <div className="mt-4 grid grid-cols-1 gap-3 border-t border-line pt-4 sm:grid-cols-3">
            <Controller
              control={form.control}
              name="extraCents"
              render={({ field }) => (
                <Field label="Frete e taxas" error={errors.extraCents?.message}>
                  <MoneyInput value={field.value} onValueChange={field.onChange} onBlur={field.onBlur} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="discountCents"
              render={({ field }) => (
                <Field label="Desconto" error={errors.discountCents?.message}>
                  <MoneyInput value={field.value} onValueChange={field.onChange} onBlur={field.onBlur} />
                </Field>
              )}
            />
            <div className="flex flex-col justify-end rounded-lg bg-accent-soft/60 px-3 py-2">
              <span className="text-xs text-muted">Total (prévia)</span>
              <Money cents={totals.totalCents} className="text-xl font-semibold" />
              <span className="text-[0.7rem] text-muted">Itens {formatBRL(totals.itemsTotalCents)} · o banco recalcula ao salvar</span>
            </div>
          </div>
        </Card>

        {!isEdit ? (
          <Card className="p-4">
            <PaymentPlanFields value={plan} onChange={setPlan} totalCents={totals.totalCents} errors={planProblems} showErrors={submitted} />
          </Card>
        ) : null}

        <Card className="space-y-4 p-4">
          <ReceiptField currentPath={receiptPath} onRemoveCurrent={() => setReceiptPath(null)} file={receipt} onFileChange={setReceipt} />
          <Field label="Observações" error={errors.notes?.message}>
            <Textarea maxLength={2000} {...form.register('notes')} />
          </Field>
        </Card>

        <div className="sticky bottom-20 z-10 flex flex-wrap items-center justify-end gap-2 rounded-xl border border-line bg-panel/95 p-3 shadow-[var(--shadow-pop)] backdrop-blur lg:bottom-4">
          <span className="mr-auto text-sm text-muted">
            Total <Money cents={totals.totalCents} className="font-semibold text-ink" />
          </span>
          <Button asChild variant="outline">
            <Link to={isEdit ? `/compras/${id}` : '/compras'}>Cancelar</Link>
          </Button>
          <Button type="submit" loading={pending}>
            {isEdit ? 'Salvar alterações' : 'Registrar compra'}
          </Button>
        </div>
      </form>

      <EntityPicker
        open={pickingIndex !== null}
        onOpenChange={(open) => !open && setPickingIndex(null)}
        title="Ingrediente"
        options={ingredientOptions}
        loading={ingredients.isPending}
        selectedId={pickingIndex !== null ? (watchedItems?.[pickingIndex]?.ingredientId ?? null) : null}
        emptyText="Nenhum ingrediente ativo. Cadastre em Ingredientes."
        onSelect={(option) => {
          if (pickingIndex === null) return;
          const ingredient = ingredients.data?.find((i) => i.id === option.id);
          if (!ingredient) return;
          const index = pickingIndex;
          form.setValue(`items.${index}.ingredientId`, ingredient.id);
          form.setValue(`items.${index}.ingredientName`, ingredient.name);
          form.setValue(`items.${index}.ingredientUnit`, ingredient.unit);
          if (!form.getValues(`items.${index}.description`).trim()) form.setValue(`items.${index}.description`, ingredient.name);
          if (!form.getValues(`items.${index}.unit`).trim()) form.setValue(`items.${index}.unit`, ingredient.unit);
        }}
      />
    </Page>
  );
}
