import { ArrowLeft, Ban, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Freshness } from '@/components/shared/freshness';
import { Money } from '@/components/shared/money';
import { BillStatusBadge } from '@/components/shared/sale-status';
import { Page, PageHeader } from '@/components/layout/page';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { usePurchase } from '@/data/payables';
import { paymentMethodLabel } from '@/data/types';
import { useBusiness } from '@/features/business/business-context';
import { effectiveDueDate } from '@/features/finance/bills/bill-calc';
import { BillPaymentsPanel, type BillSummary, CancelBillDialog } from '@/features/finance/bills/bill-payments';
import { ReceiptLink } from '@/features/finance/bills/receipt';
import { TotalsRow } from '@/features/finance/bills/totals-row';
import { formatDateBR, formatDateTimeBR } from '@/lib/dates';
import { formatQuantity } from '@/lib/money';

export function PurchaseDetailPage() {
  const { id } = useParams();
  const { can, business } = useBusiness();
  const detail = usePurchase(id);
  const [cancelling, setCancelling] = useState(false);

  if (detail.isPending) {
    return (
      <Page>
        <LoadingBlock rows={6} />
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

  const { purchase, items, payments } = detail.data;
  const canWrite = can('write');
  const active = purchase.status === 'active';
  const summary: BillSummary = {
    kind: 'purchase',
    id: purchase.id,
    status: purchase.status,
    totalCents: purchase.total_cents,
    paidCents: purchase.paid_cents,
    scheduledCents: purchase.scheduled_cents,
    unscheduledCents: purchase.unscheduled_cents,
    paymentMethod: purchase.payment_method,
  };

  return (
    <Page className="max-w-4xl">
      <PageHeader
        title={purchase.description}
        description={`Compra de ${formatDateBR(purchase.purchase_date)} · ${purchase.supplier_name ?? 'sem fornecedor'} · ${purchase.category}`}
        back={
          <Button asChild variant="link" size="sm">
            <Link to="/compras">
              <ArrowLeft className="size-4" /> Compras
            </Link>
          </Button>
        }
        actions={
          canWrite && active ? (
            <>
              <Button asChild variant="outline">
                <Link to={`/compras/${purchase.id}/editar`}>
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
        <BillStatusBadge status={purchase.payment_status} overdue={purchase.is_overdue} />
        <Freshness query={detail} />
      </div>

      {purchase.status === 'cancelled' ? (
        <p role="status" className="mb-4 rounded-lg border border-line bg-subtle px-3 py-2 text-sm text-ink-soft">
          Cancelada em {formatDateTimeBR(purchase.cancelled_at, business.timezone)}. Motivo: {purchase.cancel_reason}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Itens" description={`${items.length} ${items.length === 1 ? 'item' : 'itens'}`} />
          <ul className="divide-y divide-line px-4">
            {items.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{item.description}</p>
                  <p className="text-xs text-muted">
                    {formatQuantity(item.quantity)} {item.unit} × <Money cents={item.unit_price_cents} />
                    {item.ingredient_id ? ' · ingrediente vinculado' : ''}
                  </p>
                </div>
                <Money cents={item.line_total_cents} className="text-sm font-semibold" />
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-4">
          <h2 className="mb-2 font-sans text-base font-semibold">Totais</h2>
          <TotalsRow label="Itens" cents={purchase.items_total_cents} />
          {purchase.extra_cents ? <TotalsRow label="Frete e taxas" cents={purchase.extra_cents} /> : null}
          {purchase.discount_cents ? <TotalsRow label="Desconto" cents={-purchase.discount_cents} /> : null}
          <TotalsRow label="Total" cents={purchase.total_cents} strong />
          <TotalsRow label="Pago" cents={purchase.paid_cents} muted />
          <TotalsRow label="Previsto em parcelas" cents={purchase.scheduled_cents} muted />
          <TotalsRow label="Saldo a pagar" cents={purchase.balance_cents} strong />
          {purchase.unscheduled_cents > 0 ? (
            <p className="mt-1 text-xs text-muted">
              Sem parcela definida: <Money cents={purchase.unscheduled_cents} />
              {purchase.due_date ? ` · vence ${formatDateBR(purchase.due_date)}` : ' · sem vencimento'}
            </p>
          ) : null}
          <dl className="mt-3 space-y-1 border-t border-line pt-3 text-xs text-muted">
            <div className="flex justify-between gap-2">
              <dt>Forma de pagamento</dt>
              <dd className="text-ink-soft">{paymentMethodLabel(purchase.payment_method)}</dd>
            </div>
            {effectiveDueDate(purchase) ? (
              <div className="flex justify-between gap-2">
                <dt>Próximo vencimento</dt>
                <dd className="text-ink-soft">{formatDateBR(effectiveDueDate(purchase))}</dd>
              </div>
            ) : null}
          </dl>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4">
        <BillPaymentsPanel bill={summary} payments={payments} canWrite={canWrite} />
        {purchase.receipt_path || purchase.notes ? (
          <Card className="space-y-3 p-4">
            {purchase.receipt_path ? (
              <div>
                <h2 className="mb-2 font-sans text-sm font-semibold">Comprovante</h2>
                <ReceiptLink path={purchase.receipt_path} />
              </div>
            ) : null}
            {purchase.notes ? (
              <div>
                <h2 className="mb-1 font-sans text-sm font-semibold">Observações</h2>
                <p className="whitespace-pre-wrap text-sm text-ink-soft">{purchase.notes}</p>
              </div>
            ) : null}
          </Card>
        ) : null}
      </div>

      <CancelBillDialog open={cancelling} onOpenChange={setCancelling} bill={summary} />
    </Page>
  );
}
