import { ArrowLeft, Ban, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Freshness } from '@/components/shared/freshness';
import { BillStatusBadge } from '@/components/shared/sale-status';
import { Page, PageHeader } from '@/components/layout/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { useExpense } from '@/data/payables';
import { paymentMethodLabel } from '@/data/types';
import { useBusiness } from '@/features/business/business-context';
import { effectiveDueDate } from '@/features/finance/bills/bill-calc';
import { BillPaymentsPanel, type BillSummary, CancelBillDialog } from '@/features/finance/bills/bill-payments';
import { ReceiptLink } from '@/features/finance/bills/receipt';
import { TotalsRow } from '@/features/finance/bills/totals-row';
import { formatDateBR, formatDateTimeBR } from '@/lib/dates';

export function ExpenseDetailPage() {
  const { id } = useParams();
  const { can, business } = useBusiness();
  const detail = useExpense(id);
  const [cancelling, setCancelling] = useState(false);

  if (detail.isPending) {
    return (
      <Page>
        <LoadingBlock rows={5} />
      </Page>
    );
  }
  if (!detail.data) {
    return (
      <Page>
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
      </Page>
    );
  }

  const { expense, payments } = detail.data;
  const canWrite = can('write');
  const active = expense.status === 'active';
  const summary: BillSummary = {
    kind: 'expense',
    id: expense.id,
    status: expense.status,
    totalCents: expense.total_cents,
    paidCents: expense.paid_cents,
    scheduledCents: expense.scheduled_cents,
    unscheduledCents: expense.unscheduled_cents,
    paymentMethod: expense.payment_method,
  };

  return (
    <Page className="max-w-4xl">
      <PageHeader
        title={expense.description}
        description={`Despesa de ${formatDateBR(expense.expense_date)} (competência) · ${expense.category}${expense.supplier_name ? ` · ${expense.supplier_name}` : ''}`}
        back={
          <Button asChild variant="link" size="sm">
            <Link to="/despesas">
              <ArrowLeft className="size-4" /> Despesas
            </Link>
          </Button>
        }
        actions={
          canWrite && active ? (
            <>
              <Button asChild variant="outline">
                <Link to={`/despesas/${expense.id}/editar`}>
                  <Pencil /> Editar
                </Link>
              </Button>
              <Button variant="danger-outline" onClick={() => setCancelling(true)}>
                <Ban /> Cancelar
              </Button>
            </>
          ) : null
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <BillStatusBadge status={expense.payment_status} overdue={expense.is_overdue} />
        <Freshness query={detail} />
      </div>

      {expense.status === 'cancelled' ? (
        <p role="status" className="mb-4 rounded-lg border border-line bg-subtle px-3 py-2 text-sm text-ink-soft">
          Cancelada em {formatDateTimeBR(expense.cancelled_at, business.timezone)}. Motivo: {expense.cancel_reason}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <BillPaymentsPanel bill={summary} payments={payments} canWrite={canWrite} />
        </div>
        <Card className="p-4">
          <h2 className="mb-2 font-sans text-base font-semibold">Valores</h2>
          <TotalsRow label="Valor da despesa" cents={expense.total_cents} strong />
          <TotalsRow label="Pago" cents={expense.paid_cents} muted />
          <TotalsRow label="Previsto em parcelas" cents={expense.scheduled_cents} muted />
          <TotalsRow label="Saldo a pagar" cents={expense.balance_cents} strong />
          <dl className="mt-3 space-y-1 border-t border-line pt-3 text-xs text-muted">
            <div className="flex justify-between gap-2">
              <dt>Forma de pagamento</dt>
              <dd className="text-ink-soft">{paymentMethodLabel(expense.payment_method)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Próximo vencimento</dt>
              <dd className="text-ink-soft">{formatDateBR(effectiveDueDate(expense))}</dd>
            </div>
          </dl>
        </Card>
      </div>

      {expense.receipt_path || expense.notes ? (
        <Card className="mt-4 space-y-3 p-4">
          {expense.receipt_path ? (
            <div>
              <h2 className="mb-2 font-sans text-sm font-semibold">Comprovante</h2>
              <ReceiptLink path={expense.receipt_path} />
            </div>
          ) : null}
          {expense.notes ? (
            <div>
              <h2 className="mb-1 font-sans text-sm font-semibold">Observações</h2>
              <p className="whitespace-pre-wrap text-sm text-ink-soft">{expense.notes}</p>
            </div>
          ) : null}
        </Card>
      ) : null}

      <CancelBillDialog open={cancelling} onOpenChange={setCancelling} bill={summary} />
    </Page>
  );
}
