import { ArrowLeft, Pencil, Phone, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ChargeButton } from '@/components/shared/charge-dialog';
import { Money } from '@/components/shared/money';
import { SaleStatusBadge } from '@/components/shared/sale-status';
import { Stat } from '@/components/shared/stat';
import { Page, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { useCustomer, useDeleteCustomer } from '@/data/catalog';
import { usePaymentsOfCustomer } from '@/data/sales';
import { useSales } from '@/data/sales';
import { paymentMethodLabel } from '@/data/types';
import { useBusiness } from '@/features/business/business-context';
import { formatDateBR } from '@/lib/dates';
import { groupByCustomer } from '@/lib/receivables';
import { formatPhoneBR, whatsappLink } from '@/lib/whatsapp';
import { CustomerFormDialog } from './customer-form-dialog';

export function CustomerDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useBusiness();
  const customer = useCustomer(id);
  const sales = useSales({ customerId: id, status: 'all' });
  const payments = usePaymentsOfCustomer(id);
  const remove = useDeleteCustomer();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (customer.isPending) return <Page><LoadingBlock /></Page>;
  if (customer.isError || !customer.data) return <Page><ErrorState error={customer.error} onRetry={() => void customer.refetch()} /></Page>;
  const c = customer.data;
  const open = groupByCustomer(sales.data ?? [])[0];
  const hasHistory = c.sales_count > 0 || (sales.data?.length ?? 0) > 0;

  return (
    <Page>
      <PageHeader
        back={
          <Link to="/clientes" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ArrowLeft className="size-4" /> Clientes
          </Link>
        }
        title={c.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {c.active ? <Badge tone="success">Ativo</Badge> : <Badge>Inativo</Badge>}
            <span>Cliente desde {formatDateBR(c.created_at.slice(0, 10))}</span>
            {c.phone ? (
              <a href={whatsappLink(c.phone, '') ?? `tel:${c.phone}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent-ink hover:underline">
                <Phone className="size-3.5" /> {formatPhoneBR(c.phone)}
              </a>
            ) : null}
          </span>
        }
        actions={
          can('write') ? (
            <>
              {open ? <ChargeButton group={open} size="md" label="Cobrar no WhatsApp" /> : null}
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil /> Editar
              </Button>
              <Button asChild>
                <Link to={`/vendas/nova?cliente=${c.id}`}>
                  <Plus /> Venda
                </Link>
              </Button>
            </>
          ) : null
        }
      />

      {c.notes ? <p className="mb-4 whitespace-pre-line rounded-lg bg-subtle px-3 py-2 text-sm text-ink-soft">{c.notes}</p> : null}

      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <Stat label="Total comprado" cents={c.total_purchased_cents} hint={`${c.sales_count} ${c.sales_count === 1 ? 'compra' : 'compras'}`} />
        <Stat label="Total pago" cents={c.total_paid_cents} tone="positive" />
        <Stat label="Em aberto" cents={c.open_balance_cents} tone={c.open_balance_cents > 0 ? 'accent' : 'default'} hint={c.next_due_date ? `Próximo vencimento ${formatDateBR(c.next_due_date)}` : undefined} />
        <Stat label="Vencido" cents={c.overdue_balance_cents} tone={c.overdue_balance_cents > 0 ? 'negative' : 'default'} />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Histórico de compras" />
          <div className="p-2">
            {sales.isPending ? <LoadingBlock rows={3} /> : null}
            {sales.isError && !sales.data ? <ErrorState error={sales.error} /> : null}
            {sales.data?.length === 0 ? <EmptyState title="Nenhuma compra registrada" className="border-0" /> : null}
            <ul className="divide-y divide-line">
              {sales.data?.map((sale) => (
                <li key={sale.id}>
                  <Link to={`/vendas/${sale.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-subtle">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{formatDateBR(sale.sale_date)}</p>
                      <p className="truncate text-xs text-muted">{sale.items_summary}</p>
                      {sale.due_date && sale.balance_cents > 0 ? <p className="text-xs text-muted">Vencimento {formatDateBR(sale.due_date)}</p> : null}
                    </div>
                    <div className="flex flex-col items-end gap-1 text-right">
                      <Money cents={sale.total_cents} className={sale.status === 'cancelled' ? 'text-sm text-muted line-through' : 'text-sm font-semibold'} />
                      {sale.balance_cents > 0 && sale.net_paid_cents > 0 ? <span className="text-xs text-muted">saldo <Money cents={sale.balance_cents} /></span> : null}
                      <SaleStatusBadge sale={sale} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Pagamentos" />
          <div className="p-2">
            {payments.isPending ? <LoadingBlock rows={2} /> : null}
            {payments.data?.length === 0 ? <EmptyState title="Nenhum pagamento" className="border-0" /> : null}
            <ul className="divide-y divide-line">
              {payments.data?.map((p) => (
                <li key={p.id} className={p.voided_at ? 'px-2 py-2.5 opacity-60' : 'px-2 py-2.5'}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm">
                      {formatDateBR(p.paid_on)} · {paymentMethodLabel(p.method)}
                    </span>
                    <Money cents={p.kind === 'refund' ? -p.amount_cents : p.amount_cents} className={p.voided_at ? 'text-sm line-through' : 'text-sm font-medium'} />
                  </div>
                  <p className="text-xs text-muted">
                    {p.kind === 'refund' ? 'Reembolso' : 'Recebimento'} da venda de {formatDateBR(p.sale_date)}
                    {p.voided_at ? ` · estornado: ${p.void_reason}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      {can('write') ? (
        <div className="mt-6 border-t border-line pt-4">
          {hasHistory ? (
            <p className="text-xs text-muted">Clientes com histórico financeiro não podem ser excluídos. Para ocultá-lo das listas, edite e marque como inativo.</p>
          ) : (
            <Button variant="danger-outline" size="sm" onClick={() => setDeleting(true)}>
              <Trash2 /> Excluir cliente
            </Button>
          )}
        </div>
      ) : null}

      <CustomerFormDialog open={editing} onOpenChange={setEditing} customer={c} />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Excluir cliente?"
        description={`"${c.name}" será removido. Esta ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        onConfirm={() => remove.mutateAsync({ id: c.id }).then(() => navigate('/clientes'))}
      />
    </Page>
  );
}
