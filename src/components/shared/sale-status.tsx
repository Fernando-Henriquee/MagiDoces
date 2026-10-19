import { Badge } from '@/components/ui/badge';
import { useBusiness } from '@/features/business/business-context';
import { describeStatus } from '@/lib/receivables';
import type { SaleRow } from '@/data/types';

export function SaleStatusBadge({ sale }: { sale: Pick<SaleRow, 'payment_status' | 'is_overdue' | 'due_date' | 'payment_confirmation_pending'> }) {
  const { today } = useBusiness();
  const status = describeStatus(sale, today());
  return <Badge tone={status.tone}>{status.label}</Badge>;
}

const BILL_LABELS = { paid: 'Paga', partial: 'Parcial', pending: 'A pagar', cancelled: 'Cancelada' } as const;

export function BillStatusBadge({ status, overdue }: { status: keyof typeof BILL_LABELS; overdue: boolean }) {
  if (status === 'cancelled') return <Badge tone="neutral">Cancelada</Badge>;
  if (status === 'paid') return <Badge tone="success">Paga</Badge>;
  if (overdue) return <Badge tone="danger">{status === 'partial' ? 'Parcial · vencida' : 'Vencida'}</Badge>;
  return <Badge tone={status === 'partial' ? 'warning' : 'info'}>{BILL_LABELS[status]}</Badge>;
}
