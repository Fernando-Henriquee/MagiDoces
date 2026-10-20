import { Badge } from '@/components/ui/badge';
import { useBusiness } from '@/features/business/business-context';
import { describeStatus } from '@/lib/receivables';
import type { SaleRow } from '@/data/types';

export function SaleStatusBadge({ sale }: { sale: Pick<SaleRow, 'payment_status' | 'is_overdue' | 'due_date' | 'payment_confirmation_pending'> }) {
  const { today } = useBusiness();
  const status = describeStatus(sale, today());
  return <Badge tone={status.tone}>{status.label}</Badge>;
}

/** Selos das compras anotadas pela própria cliente no link de compras. */
export function SelfServiceBadges({ sale }: { sale: Pick<SaleRow, 'status' | 'balance_cents' | 'self_service_review_pending' | 'customer_reported_paid_at'> }) {
  if (sale.status !== 'active') return null;
  return (
    <>
      {sale.self_service_review_pending ? <Badge tone="accent">a revisar</Badge> : null}
      {sale.customer_reported_paid_at && sale.balance_cents > 0 ? <Badge tone="info">avisou que pagou</Badge> : null}
    </>
  );
}

const BILL_LABELS = { paid: 'Paga', partial: 'Parcial', pending: 'A pagar', cancelled: 'Cancelada' } as const;

export function BillStatusBadge({ status, overdue }: { status: keyof typeof BILL_LABELS; overdue: boolean }) {
  if (status === 'cancelled') return <Badge tone="neutral">Cancelada</Badge>;
  if (status === 'paid') return <Badge tone="success">Paga</Badge>;
  if (overdue) return <Badge tone="danger">{status === 'partial' ? 'Parcial · vencida' : 'Vencida'}</Badge>;
  return <Badge tone={status === 'partial' ? 'warning' : 'info'}>{BILL_LABELS[status]}</Badge>;
}
