import { Plus, Users } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { DataTable, type Column } from '@/components/shared/data-table';
import { ExportMenu } from '@/components/shared/export-menu';
import { Freshness } from '@/components/shared/freshness';
import { Money } from '@/components/shared/money';
import { Page, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { useCustomers } from '@/data/catalog';
import type { CustomerSummary } from '@/data/types';
import { useBusiness } from '@/features/business/business-context';
import { formatDateBR } from '@/lib/dates';
import type { ExportColumn } from '@/lib/export';
import { formatPhoneBR } from '@/lib/whatsapp';
import { CustomerFormDialog } from './customer-form-dialog';

type Filter = 'active' | 'open' | 'overdue' | 'inactive' | 'all';

const columns: Column<CustomerSummary>[] = [
  { key: 'name', header: 'Cliente', cell: (c) => c.name, sortValue: (c) => c.name },
  { key: 'phone', header: 'Telefone', cell: (c) => <span className="text-muted">{formatPhoneBR(c.phone) || '—'}</span> },
  { key: 'sales', header: 'Compras', align: 'right', cell: (c) => <span className="num">{c.sales_count}</span>, sortValue: (c) => c.sales_count },
  { key: 'total', header: 'Total comprado', align: 'right', cell: (c) => <Money cents={c.total_purchased_cents} />, sortValue: (c) => c.total_purchased_cents },
  {
    key: 'open',
    header: 'Em aberto',
    align: 'right',
    cell: (c) => (c.open_balance_cents > 0 ? <Money cents={c.open_balance_cents} className={c.overdue_balance_cents > 0 ? 'font-semibold text-danger' : 'font-semibold'} /> : <span className="text-muted">—</span>),
    sortValue: (c) => c.open_balance_cents,
  },
  { key: 'last', header: 'Última compra', cell: (c) => formatDateBR(c.last_sale_date), sortValue: (c) => c.last_sale_date },
  { key: 'status', header: 'Situação', cell: (c) => (c.active ? <Badge tone="success">Ativo</Badge> : <Badge>Inativo</Badge>) },
];

const exportColumns: ExportColumn<CustomerSummary>[] = [
  { header: 'Cliente', value: (c) => c.name },
  { header: 'Telefone', value: (c) => c.phone },
  { header: 'Observações', value: (c) => c.notes },
  { header: 'Ativo', value: (c) => c.active, kind: 'boolean' },
  { header: 'Cadastro', value: (c) => c.created_at.slice(0, 10), kind: 'date' },
  { header: 'Compras', value: (c) => c.sales_count, kind: 'number' },
  { header: 'Total comprado', value: (c) => c.total_purchased_cents, kind: 'money' },
  { header: 'Total pago', value: (c) => c.total_paid_cents, kind: 'money' },
  { header: 'Em aberto', value: (c) => c.open_balance_cents, kind: 'money' },
  { header: 'Vencido', value: (c) => c.overdue_balance_cents, kind: 'money' },
  { header: 'Próximo vencimento', value: (c) => c.next_due_date, kind: 'date' },
];

export function CustomersPage() {
  const { can } = useBusiness();
  const navigate = useNavigate();
  const customers = useCustomers();
  const [filter, setFilter] = useState<Filter>('active');
  const [creating, setCreating] = useState(false);

  const rows = (customers.data ?? []).filter((c) => {
    switch (filter) {
      case 'active':
        return c.active;
      case 'inactive':
        return !c.active;
      case 'open':
        return c.open_balance_cents > 0;
      case 'overdue':
        return c.overdue_balance_cents > 0;
      default:
        return true;
    }
  });

  return (
    <Page>
      <PageHeader
        title="Clientes"
        description="Histórico de compras, pagamentos e saldo de cada cliente."
        actions={
          can('write') ? (
            <Button onClick={() => setCreating(true)}>
              <Plus /> Novo cliente
            </Button>
          ) : null
        }
      />
      {customers.isPending ? <LoadingBlock /> : null}
      {customers.isError && !customers.data ? <ErrorState error={customers.error} onRetry={() => void customers.refetch()} /> : null}
      {customers.data ? (
        <DataTable
          rows={rows}
          columns={columns}
          getRowId={(c) => c.id}
          rowHref={(c) => `/clientes/${c.id}`}
          searchText={(c) => `${c.name} ${c.phone ?? ''} ${c.notes ?? ''}`}
          searchPlaceholder="Pesquisar por nome ou telefone"
          initialSort={{ key: 'name', direction: 'asc' }}
          caption="Clientes"
          emptyTitle="Nenhum cliente neste filtro"
          emptyDescription="Cadastre clientes aqui ou diretamente ao registrar uma venda."
          emptyAction={can('write') ? <Button size="sm" onClick={() => setCreating(true)}><Users /> Cadastrar cliente</Button> : null}
          toolbar={
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <Select aria-label="Filtrar clientes" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="w-auto">
                <option value="active">Ativos</option>
                <option value="open">Com saldo em aberto</option>
                <option value="overdue">Com valores vencidos</option>
                <option value="inactive">Inativos</option>
                <option value="all">Todos</option>
              </Select>
              <ExportMenu rows={rows} columns={exportColumns} fileName="clientes" />
              <Freshness query={customers} className="sm:ml-auto" />
            </div>
          }
          mobileCard={(c) => (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{c.name}</p>
                <p className="text-xs text-muted">
                  {c.sales_count} {c.sales_count === 1 ? 'compra' : 'compras'}
                  {c.phone ? ` · ${formatPhoneBR(c.phone)}` : ''}
                </p>
              </div>
              <div className="text-right">
                {c.open_balance_cents > 0 ? (
                  <>
                    <Money cents={c.open_balance_cents} className={c.overdue_balance_cents > 0 ? 'font-semibold text-danger' : 'font-semibold'} />
                    <p className="text-xs text-muted">em aberto</p>
                  </>
                ) : (
                  <Badge tone={c.active ? 'success' : 'neutral'}>{c.active ? 'Em dia' : 'Inativo'}</Badge>
                )}
              </div>
            </div>
          )}
        />
      ) : null}
      <CustomerFormDialog open={creating} onOpenChange={setCreating} onSaved={(c) => navigate(`/clientes/${c.id}`)} />
    </Page>
  );
}
