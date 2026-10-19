import { Plus, Receipt } from 'lucide-react';
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
import { statusIgnoresPeriod, useExpenses } from '@/data/payables';
import { type ExpenseRow, paymentMethodLabel } from '@/data/types';
import { useBusiness } from '@/features/business/business-context';
import { effectiveDueDate } from '@/features/finance/bills/bill-calc';
import { BillListToolbar, useBillStatus } from '@/features/finance/bills/bill-list-toolbar';
import { formatDateBR } from '@/lib/dates';
import type { ExportColumn } from '@/lib/export';

const columns: Column<ExpenseRow>[] = [
  { key: 'date', header: 'Competência', cell: (e) => formatDateBR(e.expense_date), sortValue: (e) => e.expense_date },
  { key: 'description', header: 'Descrição', cell: (e) => <span className="line-clamp-2">{e.description}</span>, sortValue: (e) => e.description },
  { key: 'category', header: 'Categoria', cell: (e) => e.category, sortValue: (e) => e.category },
  { key: 'supplier', header: 'Fornecedor', cell: (e) => e.supplier_name ?? '—', sortValue: (e) => e.supplier_name },
  { key: 'total', header: 'Valor', align: 'right', cell: (e) => <Money cents={e.total_cents} />, sortValue: (e) => e.total_cents },
  {
    key: 'balance',
    header: 'A pagar',
    align: 'right',
    cell: (e) => <Money cents={e.balance_cents} className={e.balance_cents > 0 ? 'font-semibold' : 'text-muted'} />,
    sortValue: (e) => e.balance_cents,
  },
  {
    key: 'due',
    header: 'Vencimento',
    cell: (e) => formatDateBR(effectiveDueDate(e)),
    sortValue: (e) => effectiveDueDate(e),
  },
  { key: 'status', header: 'Situação', cell: (e) => <BillStatusBadge status={e.payment_status} overdue={e.is_overdue} />, sortValue: (e) => e.payment_status },
];

const exportColumns: ExportColumn<ExpenseRow>[] = [
  { header: 'Competência', value: (e) => e.expense_date, kind: 'date' },
  { header: 'Descrição', value: (e) => e.description },
  { header: 'Categoria', value: (e) => e.category },
  { header: 'Fornecedor', value: (e) => e.supplier_name },
  { header: 'Valor (R$)', value: (e) => e.total_cents, kind: 'money' },
  { header: 'Pago (R$)', value: (e) => e.paid_cents, kind: 'money' },
  { header: 'Previsto (R$)', value: (e) => e.scheduled_cents, kind: 'money' },
  { header: 'A pagar (R$)', value: (e) => e.balance_cents, kind: 'money' },
  { header: 'Próximo vencimento', value: (e) => effectiveDueDate(e), kind: 'date' },
  { header: 'Forma de pagamento', value: (e) => (e.payment_method ? paymentMethodLabel(e.payment_method) : '') },
  { header: 'Situação', value: (e) => (e.status === 'cancelled' ? 'Cancelada' : e.is_overdue ? 'Vencida' : { paid: 'Paga', partial: 'Parcial', pending: 'A pagar', cancelled: 'Cancelada' }[e.payment_status]) },
];

export function ExpensesPage() {
  const { can } = useBusiness();
  const [period, setPeriod] = usePeriod('month');
  const [status, setStatus] = useBillStatus();
  const expenses = useExpenses({ from: period.from, to: period.to, status });
  const rows = expenses.data ?? [];

  return (
    <Page>
      <PageHeader
        title="Despesas"
        description="Despesas operacionais (aluguel, gás, energia, transporte…). Entram no resultado pela data de competência."
        actions={
          can('write') ? (
            <Button asChild>
              <Link to="/despesas/nova">
                <Plus /> Nova despesa
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="mb-3 flex justify-end">
        <Freshness query={expenses} />
      </div>
      {expenses.isError && !expenses.data ? <ErrorState error={expenses.error} onRetry={() => void expenses.refetch()} /> : null}
      {expenses.isPending ? <LoadingBlock /> : null}
      {expenses.data ? (
        <DataTable
          rows={rows}
          columns={columns}
          getRowId={(e) => e.id}
          rowHref={(e) => `/despesas/${e.id}`}
          caption="Despesas"
          searchText={(e) => `${e.description} ${e.category} ${e.supplier_name ?? ''}`}
          searchPlaceholder="Pesquisar despesas"
          initialSort={{ key: 'date', direction: 'desc' }}
          rowClassName={(e) => (e.status === 'cancelled' ? 'opacity-60' : undefined)}
          toolbar={
            <>
              <BillListToolbar status={status} onStatusChange={setStatus} period={period} onPeriodChange={setPeriod} />
              <div className="sm:ml-auto">
                <ExportMenu rows={rows} columns={exportColumns} fileName={`despesas-${statusIgnoresPeriod(status) ? 'em-aberto' : `${period.from}-a-${period.to}`}`} />
              </div>
            </>
          }
          emptyTitle="Nenhuma despesa neste filtro"
          emptyDescription="Registre as despesas do mês para que o lucro estimado as considere."
          emptyAction={
            can('write') ? (
              <Button asChild size="sm">
                <Link to="/despesas/nova">
                  <Receipt /> Registrar despesa
                </Link>
              </Button>
            ) : null
          }
          mobileCard={(e) => (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{e.description}</p>
                <p className="truncate text-xs text-muted">
                  {formatDateBR(e.expense_date)} · {e.category}
                  {e.supplier_name ? ` · ${e.supplier_name}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Money cents={e.total_cents} className="text-sm font-semibold" />
                <BillStatusBadge status={e.payment_status} overdue={e.is_overdue} />
              </div>
            </div>
          )}
        />
      ) : null}
    </Page>
  );
}
