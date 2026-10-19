import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import { Money } from '@/components/shared/money';
import { Page, PageHeader } from '@/components/layout/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { type ExpensePayload, useCreateExpense, useExpense, useUpdateExpense } from '@/data/payables';
import { type ExpenseRow, PAYMENT_METHODS, type PaymentMethod } from '@/data/types';
import { useBusiness } from '@/features/business/business-context';
import { suggestedFirstDue } from '@/features/finance/bills/bill-calc';
import { EXPENSE_CATEGORIES } from '@/features/finance/bills/constants';
import { PaymentPlanFields, planErrors, planToPayload, type PlanValue } from '@/features/finance/bills/payment-plan';
import { ReceiptField } from '@/features/finance/bills/receipt';
import { SupplierField } from '@/features/finance/bills/supplier-field';
import { useRequestId } from '@/lib/use-request-id';

const schema = z.object({
  expenseDate: z.string().min(1, 'Informe a data de competência.'),
  supplier: z.object({ id: z.string().nullable(), newName: z.string().nullable(), label: z.string() }).nullable(),
  description: z.string().trim().min(1, 'Informe uma descrição.').max(200, 'Use até 200 caracteres.'),
  category: z.string().trim().min(1, 'Informe a categoria.').max(60, 'Use até 60 caracteres.'),
  amountCents: z.number({ message: 'Informe o valor.' }).nullable().refine((v) => v !== null && v > 0, 'Informe um valor maior que zero.'),
  paymentMethod: z.string(),
  dueDate: z.string(),
  notes: z.string().max(2000, 'Use até 2.000 caracteres.'),
});

type Values = z.infer<typeof schema>;

function editValues(expense: ExpenseRow): Values {
  return {
    expenseDate: expense.expense_date,
    supplier: expense.supplier_id ? { id: expense.supplier_id, newName: null, label: expense.supplier_name ?? '' } : null,
    description: expense.description,
    category: expense.category,
    amountCents: expense.total_cents,
    paymentMethod: expense.payment_method ?? '',
    dueDate: expense.due_date ?? '',
    notes: expense.notes ?? '',
  };
}

/** Carrega a despesa (na edição) e só então monta o formulário com os valores iniciais. */
export function ExpenseFormPage() {
  const { id } = useParams();
  const { can } = useBusiness();
  const existing = useExpense(id);

  if (!can('write')) {
    return (
      <Page>
        <EmptyState title="Seu perfil é somente leitura" description="Peça a uma sócia para registrar ou editar despesas." />
      </Page>
    );
  }
  if (!id) return <ExpenseForm key="new" expenseId={null} initial={null} initialReceiptPath={null} />;
  if (existing.isPending) {
    return (
      <Page>
        <LoadingBlock />
      </Page>
    );
  }
  if (!existing.data) {
    return (
      <Page>
        <ErrorState error={existing.error} onRetry={() => void existing.refetch()} />
      </Page>
    );
  }
  if (existing.data.expense.status === 'cancelled') {
    return (
      <Page>
        <EmptyState title="Despesa cancelada" description="Despesas canceladas não podem ser editadas." action={<Button asChild variant="outline"><Link to={`/despesas/${id}`}>Voltar</Link></Button>} />
      </Page>
    );
  }
  return <ExpenseForm key={id} expenseId={id} initial={editValues(existing.data.expense)} initialReceiptPath={existing.data.expense.receipt_path} />;
}

function ExpenseForm({ expenseId, initial, initialReceiptPath }: { expenseId: string | null; initial: Values | null; initialReceiptPath: string | null }) {
  const id = expenseId ?? undefined;
  const isEdit = expenseId !== null;
  const navigate = useNavigate();
  const { today } = useBusiness();
  const create = useCreateExpense();
  const update = useUpdateExpense();
  const [requestId, renewRequestId] = useRequestId();
  const [receipt, setReceipt] = useState<File | null>(null);
  const [receiptPath, setReceiptPath] = useState<string | null>(initialReceiptPath);
  const [submitted, setSubmitted] = useState(false);
  const [plan, setPlan] = useState<PlanValue>(() => ({
    mode: 'paid',
    paidOn: today(),
    method: '',
    dueDate: '',
    count: 2,
    firstDueDate: suggestedFirstDue(today(), null),
  }));

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: initial ?? {
      expenseDate: today(),
      supplier: null,
      description: '',
      category: '',
      amountCents: null,
      paymentMethod: '',
      dueDate: '',
      notes: '',
    },
  });

  const amount = useWatch({ control: form.control, name: 'amountCents' }) ?? 0;
  const planProblems = planErrors(plan, amount, today());
  const pending = create.isPending || update.isPending;

  const onSubmit = form.handleSubmit((values) => {
    setSubmitted(true);
    if (pending) return;
    if (!isEdit && Object.keys(planProblems).length > 0) return;
    const base: ExpensePayload = {
      expense_date: values.expenseDate,
      supplier_id: values.supplier?.id ?? null,
      new_supplier_name: values.supplier?.id ? null : (values.supplier?.newName ?? null),
      description: values.description.trim(),
      category: values.category.trim(),
      amount_cents: values.amountCents!,
      payment_method: (values.paymentMethod || null) as PaymentMethod | null,
      due_date: values.dueDate || null,
      receipt_path: receiptPath,
      notes: values.notes.trim() || null,
    };
    if (isEdit && id) {
      update.mutate({ expenseId: id, expense: base, receipt }, { onSuccess: () => navigate(`/despesas/${id}`) });
      return;
    }
    const { plan: planPayload, dueDate } = planToPayload(plan);
    create.mutate(
      { requestId, expense: { ...base, due_date: dueDate, payment_method: base.payment_method ?? (plan.method || null), plan: planPayload }, receipt },
      {
        onSuccess: (newId) => {
          renewRequestId();
          navigate(`/despesas/${newId}`);
        },
      },
    );
  });

  const errors = form.formState.errors;

  return (
    <Page className="max-w-3xl">
      <PageHeader
        title={isEdit ? 'Editar despesa' : 'Nova despesa'}
        description="Despesas operacionais do negócio. Compras de ingredientes e embalagens ficam em Compras."
        back={
          <Button asChild variant="link" size="sm">
            <Link to={isEdit ? `/despesas/${id}` : '/despesas'}>
              <ArrowLeft className="size-4" /> Voltar
            </Link>
          </Button>
        }
      />
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Card className="space-y-4 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label="Data de competência"
              required
              error={errors.expenseDate?.message}
              hint="Quando a despesa aconteceu (ex.: mês da conta de luz), não a data do pagamento."
            >
              <Input type="date" {...form.register('expenseDate')} />
            </Field>
            <Controller
              control={form.control}
              name="amountCents"
              render={({ field }) => (
                <Field label="Valor" required error={errors.amountCents?.message}>
                  <MoneyInput value={field.value} onValueChange={field.onChange} onBlur={field.onBlur} />
                </Field>
              )}
            />
            <Field label="Descrição" required error={errors.description?.message} className="sm:col-span-2">
              <Input placeholder="Ex.: Conta de luz de outubro" maxLength={200} {...form.register('description')} />
            </Field>
            <Field label="Categoria" required error={errors.category?.message}>
              <Input list="expense-categories" maxLength={60} {...form.register('category')} />
            </Field>
            <datalist id="expense-categories">
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <Controller
              control={form.control}
              name="supplier"
              render={({ field }) => (
                <Field label="Fornecedor">
                  <SupplierField value={field.value} onChange={field.onChange} />
                </Field>
              )}
            />
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

        {!isEdit ? (
          <Card className="p-4">
            <PaymentPlanFields value={plan} onChange={setPlan} totalCents={amount} errors={planProblems} showErrors={submitted} />
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
            Valor <Money cents={amount} className="font-semibold text-ink" />
          </span>
          <Button asChild variant="outline">
            <Link to={isEdit ? `/despesas/${id}` : '/despesas'}>Cancelar</Link>
          </Button>
          <Button type="submit" loading={pending}>
            {isEdit ? 'Salvar alterações' : 'Registrar despesa'}
          </Button>
        </div>
      </form>
    </Page>
  );
}
