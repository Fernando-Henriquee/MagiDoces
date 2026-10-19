import { Package, Plus } from 'lucide-react';
import { Link } from 'react-router';
import { type Column, DataTable } from '@/components/shared/data-table';
import { ExportMenu } from '@/components/shared/export-menu';
import { Freshness } from '@/components/shared/freshness';
import { Money } from '@/components/shared/money';
import { usePeriod } from '@/components/shared/period-picker';
import { BillStatusBadge } from '@/components/shared/sale-status';
import { Page, PageHeader } from '@/components/layout/page';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { statusIgnoresPeriod, usePurchases } from '@/data/payables';
import type { PurchaseRow } from '@/data/types';
import { paymentMethodLabel } from '@/data/types';
import { useBusiness } from '@/features/business/business-context';
import { effectiveDueDate } from '@/features/finance/bills/bill-calc';
import { BillListToolbar, useBillStatus } from '@/features/finance/bills/bill-list-toolbar';
import { formatDateBR } from '@/lib/dates';
import type { ExportColumn } from '@/lib/export';

const columns: Column<PurchaseRow>[] = [
  { key: 'date', header: 'Data', cell: (p) => formatDateBR(p.purchase_date), sortValue: (p) => p.purchase_date },
  { key: 'description', header: 'Descrição', cell: (p) => <span className="line-clamp-2">{p.description}</span>, sortValue: (p) => p.description },
  { key: 'supplier', header: 'Fornecedor', cell: (p) => p.supplier_name ?? '—', sortValue: (p) => p.supplier_name },
  { key: 'category', header: 'Categoria', cell: (p) => p.category, sortValue: (p) => p.category },
  { key: 'total', header: 'Total', align: 'right', cell: (p) => <Money cents={p.total_cents} />, sortValue: (p) => p.total_cents },
  { key: 'paid', header: 'Pago', align: 'right', cell: (p) => <Money cents={p.paid_cents} />, sortValue: (p) => p.paid_cents },
  {
    key: 'balance',
    header: 'Saldo',
    align: 'right',
    cell: (p) => <Money cents={p.balance_cents} className={p.balance_cents > 0 ? 'font-semibold' : 'text-muted'} />,
    sortValue: (p) => p.balance_cents,
  },
  { key: 'status', header: 'Situação', cell: (p) => <BillStatusBadge status={p.payment_status} overdue={p.is_overdue} />, sortValue: (p) => p.payment_status },
];

const exportColumns: ExportColumn<PurchaseRow>[] = [
  { header: 'Data', value: (p) => p.purchase_date, kind: 'date' },
  { header: 'Descrição', value: (p) => p.description },
  { header: 'Fornecedor', value: (p) => p.supplier_name },
  { header: 'Categoria', value: (p) => p.category },
  { header: 'Itens (R$)', value: (p) => p.items_total_cents, kind: 'money' },
  { header: 'Frete/taxas (R$)', value: (p) => p.extra_cents, kind: 'money' },
  { header: 'Desconto (R$)', value: (p) => p.discount_cents, kind: 'money' },
  { header: 'Total (R$)', value: (p) => p.total_cents, kind: 'money' },
  { header: 'Pago (R$)', value: (p) => p.paid_cents, kind: 'money' },
  { header: 'Previsto (R$)', value: (p) => p.scheduled_cents, kind: 'money' },
  { header: 'Saldo (R$)', value: (p) => p.balance_cents, kind: 'money' },
  { header: 'Próximo vencimento', value: (p) => effectiveDueDate(p), kind: 'date' },
  { header: 'Forma de pagamento', value: (p) => (p.payment_method ? paymentMethodLabel(p.payment_method) : '') },
  { header: 'Situação', value: (p) => (p.status === 'cancelled' ? 'Cancelada' : p.is_overdue ? 'Vencida' : { paid: 'Paga', partial: 'Parcial', pending: 'A pagar', cancelled: 'Cancelada' }[p.payment_status]) },
];

export function PurchasesPage() {
  const { can } = useBusiness();
  const [period, setPeriod] = usePeriod('month');
  const [status, setStatus] = useBillStatus();
  const filters = { from: period.from, to: period.to, status };
  const purchases = usePurchases(filters);
  const rows = purchases.data ?? [];

  return (
    <Page>
      <PageHeader
        title="Compras"
        description="Insumos, embalagens e materiais. O custo entra no resultado quando o produto é vendido."
        actions={
          can('write') ? (
            <Button asChild>
              <Link to="/compras/nova">
                <Plus /> Nova compra
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="mb-3 flex justify-end">
        <Freshness query={purchases} />
      </div>
      {purchases.isError && !purchases.data ? <ErrorState error={purchases.error} onRetry={() => void purchases.refetch()} /> : null}
      {purchases.isPending ? <LoadingBlock /> : null}
      {purchases.data ? (
        <DataTable
          rows={rows}
          columns={columns}
          getRowId={(p) => p.id}
          rowHref={(p) => `/compras/${p.id}`}
          caption="Compras"
          searchText={(p) => `${p.description} ${p.supplier_name ?? ''} ${p.category}`}
          searchPlaceholder="Pesquisar compras"
          initialSort={{ key: 'date', direction: 'desc' }}
          rowClassName={(p) => (p.status === 'cancelled' ? 'opacity-60' : undefined)}
          toolbar={
            <>
              <BillListToolbar status={status} onStatusChange={setStatus} period={period} onPeriodChange={setPeriod} />
              <div className="sm:ml-auto">
                <ExportMenu rows={rows} columns={exportColumns} fileName={`compras-${statusIgnoresPeriod(status) ? 'em-aberto' : `${period.from}-a-${period.to}`}`} />
              </div>
            </>
          }
          emptyTitle="Nenhuma compra neste filtro"
          emptyDescription="Registre as compras de ingredientes e embalagens para acompanhar o que há a pagar."
          emptyAction={
            can('write') ? (
              <Button asChild size="sm">
                <Link to="/compras/nova">
                  <Package /> Registrar compra
                </Link>
              </Button>
            ) : null
          }
          mobileCard={(p) => (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{p.description}</p>
                <p className="truncate text-xs text-muted">
                  {formatDateBR(p.purchase_date)} · {p.supplier_name ?? 'Sem fornecedor'} · {p.category}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Money cents={p.total_cents} className="text-sm font-semibold" />
                {p.balance_cents > 0 && p.status === 'active' ? (
                  <span className="text-xs text-muted">
                    saldo <Money cents={p.balance_cents} />
                  </span>
                ) : null}
                <BillStatusBadge status={p.payment_status} overdue={p.is_overdue} />
              </div>
            </div>
          )}
        />
      ) : null}
    </Page>
  );
}
