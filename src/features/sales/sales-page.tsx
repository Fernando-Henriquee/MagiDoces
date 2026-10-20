import { Plus, ShoppingBag } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { DataTable, type Column } from '@/components/shared/data-table';
import { ExportMenu } from '@/components/shared/export-menu';
import { Freshness } from '@/components/shared/freshness';
import { Money } from '@/components/shared/money';
import { PeriodPicker, usePeriod } from '@/components/shared/period-picker';
import { SaleStatusBadge, SelfServiceBadges } from '@/components/shared/sale-status';
import { Page, PageHeader } from '@/components/layout/page';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { type SaleFilters, useSales } from '@/data/sales';
import { paymentMethodLabel, type SaleRow } from '@/data/types';
import { useBusiness } from '@/features/business/business-context';
import { formatDateBR } from '@/lib/dates';
import type { ExportColumn } from '@/lib/export';

const columns: Column<SaleRow>[] = [
  { key: 'date', header: 'Data', cell: (s) => formatDateBR(s.sale_date), sortValue: (s) => `${s.sale_date}${s.created_at}` },
  { key: 'customer', header: 'Cliente', cell: (s) => s.customer_name ?? <span className="text-muted">Sem cliente</span>, sortValue: (s) => s.customer_name },
  { key: 'items', header: 'Itens', cell: (s) => <span className="line-clamp-1 max-w-64 text-muted">{s.items_summary}</span> },
  {
    key: 'total',
    header: 'Total',
    align: 'right',
    cell: (s) => <Money cents={s.total_cents} className={s.status === 'cancelled' ? 'text-muted line-through' : ''} />,
    sortValue: (s) => s.total_cents,
  },
  { key: 'paid', header: 'Recebido', align: 'right', cell: (s) => <Money cents={s.net_paid_cents} className="text-muted" />, sortValue: (s) => s.net_paid_cents },
  { key: 'balance', header: 'Saldo', align: 'right', cell: (s) => (s.balance_cents > 0 ? <Money cents={s.balance_cents} className="font-semibold" /> : '—'), sortValue: (s) => s.balance_cents },
  { key: 'due', header: 'Vencimento', cell: (s) => (s.balance_cents > 0 ? formatDateBR(s.due_date) : '—'), sortValue: (s) => s.due_date },
  {
    key: 'status',
    header: 'Situação',
    cell: (s) => (
      <span className="flex flex-wrap gap-1">
        <SaleStatusBadge sale={s} />
        <SelfServiceBadges sale={s} />
      </span>
    ),
  },
];

export const saleExportColumns: ExportColumn<SaleRow>[] = [
  { header: 'Data', value: (s) => s.sale_date, kind: 'date' },
  { header: 'Cliente', value: (s) => s.customer_name },
  { header: 'Itens', value: (s) => s.items_summary },
  { header: 'Subtotal', value: (s) => s.items_subtotal_cents, kind: 'money' },
  { header: 'Descontos', value: (s) => s.items_discount_cents + s.discount_cents, kind: 'money' },
  { header: 'Total', value: (s) => s.total_cents, kind: 'money' },
  { header: 'Recebido', value: (s) => s.net_paid_cents, kind: 'money' },
  { header: 'Saldo', value: (s) => s.balance_cents, kind: 'money' },
  { header: 'Vencimento', value: (s) => s.due_date, kind: 'date' },
  { header: 'Forma prevista', value: (s) => paymentMethodLabel(s.payment_method) },
  { header: 'Situação', value: (s) => ({ paid: 'Paga', partial: 'Parcial', pending: 'Pendente', cancelled: 'Cancelada' })[s.payment_status] },
  { header: 'Vencida', value: (s) => s.is_overdue, kind: 'boolean' },
  { header: 'Custo estimado', value: (s) => s.cost_total_cents, kind: 'money' },
  { header: 'Origem', value: (s) => ({ import: 'Importada', self_service: 'Link de compras', manual: 'Manual' })[s.source] },
  { header: 'Observações', value: (s) => s.notes },
];

type StatusFilter = 'all' | 'open' | 'paid' | 'overdue' | 'pending_confirmation' | 'review' | 'cancelled';

const STATUS_PARAMS: Record<string, StatusFilter> = { revisar: 'review', 'em-aberto': 'open', vencidas: 'overdue' };

export function SalesPage() {
  const { can } = useBusiness();
  const [period, setPeriod] = usePeriod('month');
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<StatusFilter>(() => STATUS_PARAMS[searchParams.get('situacao') ?? ''] ?? 'all');
  // "A revisar" mostra todas as datas: nenhuma compra anotada pela cliente fica esquecida.
  const allDates = status === 'review';
  const filters: SaleFilters = {
    from: allDates ? undefined : period.from,
    to: allDates ? undefined : period.to,
    status: status === 'cancelled' ? 'cancelled' : status === 'all' ? 'all' : 'active',
    paymentStatus: status === 'open' || status === 'paid' || status === 'overdue' || status === 'pending_confirmation' || status === 'review' ? status : 'all',
  };
  const sales = useSales(filters);
  const rows = sales.data ?? [];
  const active = rows.filter((s) => s.status === 'active');
  const total = active.reduce((sum, s) => sum + s.total_cents, 0);
  const open = active.reduce((sum, s) => sum + s.balance_cents, 0);

  return (
    <Page>
      <PageHeader
        title="Vendas"
        description="Vendas registradas, com recebimentos e saldo de cada uma."
        actions={
          can('write') ? (
            <Button asChild>
              <Link to="/vendas/nova">
                <Plus /> Nova venda
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        {allDates ? (
          <p className="text-sm text-muted">Compras anotadas pelas clientes no link, de todas as datas, aguardando revisão.</p>
        ) : (
          <PeriodPicker period={period} onChange={setPeriod} />
        )}
        <Freshness query={sales} />
      </div>
      {sales.isPending ? <LoadingBlock /> : null}
      {sales.isError && !sales.data ? <ErrorState error={sales.error} onRetry={() => void sales.refetch()} /> : null}
      {sales.data ? (
        <DataTable
          rows={rows}
          columns={columns}
          getRowId={(s) => s.id}
          rowHref={(s) => `/vendas/${s.id}`}
          searchText={(s) => `${s.customer_name ?? ''} ${s.items_summary ?? ''} ${s.notes ?? ''}`}
          searchPlaceholder="Pesquisar cliente ou produto"
          initialSort={{ key: 'date', direction: 'desc' }}
          caption="Vendas"
          rowClassName={(s) => (s.status === 'cancelled' ? 'opacity-70' : undefined)}
          emptyTitle={allDates ? 'Nenhuma compra anotada pelo link aguardando revisão' : 'Nenhuma venda neste período'}
          emptyAction={can('write') ? <Button asChild size="sm"><Link to="/vendas/nova"><ShoppingBag /> Registrar venda</Link></Button> : null}
          toolbar={
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <Select aria-label="Situação" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="w-auto">
                <option value="all">Todas</option>
                <option value="open">Em aberto</option>
                <option value="overdue">Vencidas</option>
                <option value="paid">Pagas</option>
                <option value="pending_confirmation">A confirmar (importadas)</option>
                <option value="review">A revisar (anotadas pela cliente)</option>
                <option value="cancelled">Canceladas</option>
              </Select>
              <ExportMenu rows={rows} columns={saleExportColumns} fileName={allDates ? 'vendas-a-revisar' : `vendas-${period.from}-a-${period.to}`} />
              <p className="text-xs text-muted sm:ml-auto">
                {active.length} {active.length === 1 ? 'venda' : 'vendas'} · total <Money cents={total} /> · em aberto <Money cents={open} />
              </p>
            </div>
          }
          mobileCard={(s) => (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{s.customer_name ?? 'Sem cliente'}</p>
                <p className="truncate text-xs text-muted">
                  {formatDateBR(s.sale_date)} · {s.items_summary}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Money cents={s.total_cents} className={s.status === 'cancelled' ? 'text-muted line-through' : 'font-semibold'} />
                <span className="flex flex-wrap justify-end gap-1">
                  <SaleStatusBadge sale={s} />
                  <SelfServiceBadges sale={s} />
                </span>
              </div>
            </div>
          )}
        />
      ) : null}
    </Page>
  );
}
