import type { ReactNode } from 'react';
import { useState } from 'react';
import { Link } from 'react-router';
import { ExportMenu } from '@/components/shared/export-menu';
import { Freshness } from '@/components/shared/freshness';
import { Money } from '@/components/shared/money';
import { PeriodPicker, usePeriod } from '@/components/shared/period-picker';
import { Page, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/menu';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { useCustomers, useProducts } from '@/data/catalog';
import { useDashboard } from '@/data/dashboard';
import {
  type Granularity,
  useIngredientConsumption,
  usePayablesReport,
  useReceiptsByPeriod,
  useSalesByPeriod,
  useTopProducts,
} from '@/data/reports';
import { useSales } from '@/data/sales';
import { paymentMethodLabel } from '@/data/types';
import { cn } from '@/lib/cn';
import { addDays, formatDateBR, monthLabel, capitalize } from '@/lib/dates';
import type { ExportColumn } from '@/lib/export';
import { formatBRL, formatPercent, formatQuantity, percent } from '@/lib/money';
import { marginOf } from '../products/products-page';

interface Col<T> {
  header: string;
  cell: (row: T) => ReactNode;
  align?: 'right';
  footer?: ReactNode;
}

function ReportTable<T>({ rows, columns, rowKey, caption, empty = 'Sem dados no período.' }: { rows: T[]; columns: Col<T>[]; rowKey: (row: T, index: number) => string; caption: string; empty?: string }) {
  if (rows.length === 0) return <EmptyState title={empty} />;
  const hasFooter = columns.some((c) => c.footer !== undefined);
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-line bg-subtle/70 text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            {columns.map((c) => (
              <th key={c.header} scope="col" className={cn('px-3 py-2 font-semibold', c.align === 'right' && 'text-right')}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row, index) => (
            <tr key={rowKey(row, index)}>
              {columns.map((c) => (
                <td key={c.header} className={cn('px-3 py-2', c.align === 'right' && 'num text-right')}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {hasFooter ? (
          <tfoot className="border-t-2 border-line bg-subtle/60 font-semibold">
            <tr>
              {columns.map((c) => (
                <td key={c.header} className={cn('px-3 py-2', c.align === 'right' && 'num text-right')}>
                  {c.footer ?? null}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </Card>
  );
}

function periodLabel(start: string, granularity: Granularity) {
  if (granularity === 'month') return capitalize(monthLabel(start));
  if (granularity === 'week') return `${formatDateBR(start)} a ${formatDateBR(addDays(start, 6))}`;
  return formatDateBR(start);
}

function sum<T>(rows: T[], pick: (row: T) => number) {
  return rows.reduce((total, row) => total + pick(row), 0);
}

function Loading({ query }: { query: { isPending: boolean; isError: boolean; error: unknown; data?: unknown; refetch: () => unknown } }) {
  if (query.isPending) return <LoadingBlock rows={4} />;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return null;
}

function Toolbar({ children, note }: { children?: ReactNode; note?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {note ? <p className="text-xs text-muted">{note}</p> : null}
    </div>
  );
}

function GranularitySelect({ value, onChange }: { value: Granularity; onChange: (g: Granularity) => void }) {
  return (
    <Select aria-label="Agrupar por" value={value} onChange={(e) => onChange(e.target.value as Granularity)} className="w-auto">
      <option value="day">Por dia</option>
      <option value="week">Por semana</option>
      <option value="month">Por mês</option>
    </Select>
  );
}

function SalesReport({ from, to }: { from: string; to: string }) {
  const [granularity, setGranularity] = useState<Granularity>('day');
  const query = useSalesByPeriod(from, to, granularity);
  const rows = query.data ?? [];
  const exportColumns: ExportColumn<(typeof rows)[number]>[] = [
    { header: 'Período', value: (r) => periodLabel(r.period_start, granularity) },
    { header: 'Vendas', value: (r) => r.sales_count, kind: 'number' },
    { header: 'Canceladas', value: (r) => r.cancelled_count, kind: 'number' },
    { header: 'Faturamento', value: (r) => r.revenue_cents, kind: 'money' },
    { header: 'Descontos', value: (r) => r.discounts_cents, kind: 'money' },
    { header: 'CMV estimado', value: (r) => r.cogs_cents, kind: 'money' },
    { header: 'Lucro bruto estimado', value: (r) => r.gross_profit_cents, kind: 'money' },
    { header: 'Itens sem custo', value: (r) => r.items_without_cost, kind: 'number' },
  ];
  return (
    <>
      <Toolbar note="Faturamento = vendas ativas (após descontos). CMV usa o custo gravado em cada venda.">
        <GranularitySelect value={granularity} onChange={setGranularity} />
        <ExportMenu rows={rows} columns={exportColumns} fileName={`vendas-por-periodo-${from}-a-${to}`} />
      </Toolbar>
      <Loading query={query} />
      {query.data ? (
        <ReportTable
          caption="Vendas por período"
          rows={rows}
          rowKey={(r) => r.period_start}
          columns={[
            { header: 'Período', cell: (r) => periodLabel(r.period_start, granularity), footer: 'Total' },
            { header: 'Vendas', align: 'right', cell: (r) => r.sales_count, footer: sum(rows, (r) => r.sales_count) },
            { header: 'Faturamento', align: 'right', cell: (r) => <Money cents={r.revenue_cents} />, footer: <Money cents={sum(rows, (r) => r.revenue_cents)} /> },
            { header: 'Descontos', align: 'right', cell: (r) => <Money cents={r.discounts_cents} />, footer: <Money cents={sum(rows, (r) => r.discounts_cents)} /> },
            { header: 'CMV estimado', align: 'right', cell: (r) => <Money cents={r.cogs_cents} />, footer: <Money cents={sum(rows, (r) => r.cogs_cents)} /> },
            {
              header: 'Lucro bruto',
              align: 'right',
              cell: (r) => (
                <span>
                  <Money cents={r.gross_profit_cents} />
                  {r.items_without_cost > 0 ? <Badge tone="warning" className="ml-1">{r.items_without_cost} s/ custo</Badge> : null}
                </span>
              ),
              footer: <Money cents={sum(rows, (r) => r.gross_profit_cents)} />,
            },
          ]}
        />
      ) : null}
    </>
  );
}

function ReceiptsReport({ from, to }: { from: string; to: string }) {
  const [granularity, setGranularity] = useState<Granularity>('month');
  const query = useReceiptsByPeriod(from, to, granularity);
  const rows = query.data ?? [];
  const exportColumns: ExportColumn<(typeof rows)[number]>[] = [
    { header: 'Período', value: (r) => periodLabel(r.period_start, granularity) },
    { header: 'Forma', value: (r) => paymentMethodLabel(r.method) },
    { header: 'Recebimentos', value: (r) => r.receipts_count, kind: 'number' },
    { header: 'Recebido', value: (r) => r.receipts_cents, kind: 'money' },
    { header: 'Reembolsos', value: (r) => r.refunds_cents, kind: 'money' },
    { header: 'Líquido', value: (r) => r.net_cents, kind: 'money' },
  ];
  return (
    <>
      <Toolbar note="Por data do recebimento. Lançamentos estornados não entram.">
        <GranularitySelect value={granularity} onChange={setGranularity} />
        <ExportMenu rows={rows} columns={exportColumns} fileName={`recebimentos-${from}-a-${to}`} />
      </Toolbar>
      <Loading query={query} />
      {query.data ? (
        <ReportTable
          caption="Recebimentos por período"
          rows={rows}
          rowKey={(r) => `${r.period_start}-${r.method}`}
          columns={[
            { header: 'Período', cell: (r) => periodLabel(r.period_start, granularity), footer: 'Total' },
            { header: 'Forma', cell: (r) => paymentMethodLabel(r.method) },
            { header: 'Qtd.', align: 'right', cell: (r) => r.receipts_count, footer: sum(rows, (r) => r.receipts_count) },
            { header: 'Recebido', align: 'right', cell: (r) => <Money cents={r.receipts_cents} />, footer: <Money cents={sum(rows, (r) => r.receipts_cents)} /> },
            { header: 'Reembolsos', align: 'right', cell: (r) => <Money cents={r.refunds_cents} />, footer: <Money cents={sum(rows, (r) => r.refunds_cents)} /> },
            { header: 'Líquido', align: 'right', cell: (r) => <Money cents={r.net_cents} />, footer: <Money cents={sum(rows, (r) => r.net_cents)} /> },
          ]}
        />
      ) : null}
    </>
  );
}

function ReceivablesReport() {
  const query = useCustomers();
  const rows = (query.data ?? []).filter((c) => c.open_balance_cents > 0).sort((a, b) => b.overdue_balance_cents - a.overdue_balance_cents || b.open_balance_cents - a.open_balance_cents);
  const exportColumns: ExportColumn<(typeof rows)[number]>[] = [
    { header: 'Cliente', value: (c) => c.name },
    { header: 'Telefone', value: (c) => c.phone },
    { header: 'Vendas em aberto', value: (c) => c.open_sales_count, kind: 'number' },
    { header: 'Em aberto', value: (c) => c.open_balance_cents, kind: 'money' },
    { header: 'Vencido', value: (c) => c.overdue_balance_cents, kind: 'money' },
    { header: 'Próximo vencimento', value: (c) => c.next_due_date, kind: 'date' },
  ];
  return (
    <>
      <Toolbar note={<>Posição de hoje. Detalhes por venda em <Link className="text-accent-ink underline" to="/receber">Contas a receber</Link>.</>}>
        <ExportMenu rows={rows} columns={exportColumns} fileName="contas-a-receber-por-cliente" />
      </Toolbar>
      <Loading query={query} />
      {query.data ? (
        <ReportTable
          caption="Contas a receber por cliente"
          rows={rows}
          rowKey={(c) => c.id}
          empty="Nenhum valor em aberto."
          columns={[
            { header: 'Cliente', cell: (c) => <Link className="hover:underline" to={`/clientes/${c.id}`}>{c.name}</Link>, footer: 'Total' },
            { header: 'Vendas', align: 'right', cell: (c) => c.open_sales_count, footer: sum(rows, (c) => c.open_sales_count) },
            { header: 'Em aberto', align: 'right', cell: (c) => <Money cents={c.open_balance_cents} />, footer: <Money cents={sum(rows, (c) => c.open_balance_cents)} /> },
            { header: 'Vencido', align: 'right', cell: (c) => <Money cents={c.overdue_balance_cents} className={c.overdue_balance_cents ? 'text-danger' : ''} />, footer: <Money cents={sum(rows, (c) => c.overdue_balance_cents)} /> },
            { header: 'Próximo venc.', cell: (c) => formatDateBR(c.next_due_date) },
          ]}
        />
      ) : null}
    </>
  );
}

function PayablesReport({ from, to }: { from: string; to: string }) {
  const query = usePayablesReport(from, to);
  const rows = query.data ?? [];
  const exportColumns: ExportColumn<(typeof rows)[number]>[] = [
    { header: 'Tipo', value: (r) => (r.kind === 'purchase' ? 'Compra' : 'Despesa') },
    { header: 'Categoria', value: (r) => r.category },
    { header: 'Registros', value: (r) => r.records_count, kind: 'number' },
    { header: 'Registrado no período', value: (r) => r.registered_cents, kind: 'money' },
    { header: 'Pago no período', value: (r) => r.paid_in_period_cents, kind: 'money' },
    { header: 'Em aberto (dos registrados)', value: (r) => r.open_cents, kind: 'money' },
  ];
  return (
    <>
      <Toolbar note="Registrado = pela data da compra/despesa. Pago = pela data do pagamento (inclui parcelas de compras anteriores).">
        <ExportMenu rows={rows} columns={exportColumns} fileName={`compras-despesas-${from}-a-${to}`} />
      </Toolbar>
      <Loading query={query} />
      {query.data ? (
        <ReportTable
          caption="Compras e despesas por categoria"
          rows={rows}
          rowKey={(r) => `${r.kind}-${r.category}`}
          columns={[
            { header: 'Tipo', cell: (r) => (r.kind === 'purchase' ? <Badge tone="info">Compra</Badge> : <Badge>Despesa</Badge>), footer: 'Total' },
            { header: 'Categoria', cell: (r) => r.category },
            { header: 'Registrado', align: 'right', cell: (r) => <Money cents={r.registered_cents} />, footer: <Money cents={sum(rows, (r) => r.registered_cents)} /> },
            { header: 'Pago no período', align: 'right', cell: (r) => <Money cents={r.paid_in_period_cents} />, footer: <Money cents={sum(rows, (r) => r.paid_in_period_cents)} /> },
            { header: 'Em aberto', align: 'right', cell: (r) => <Money cents={r.open_cents} />, footer: <Money cents={sum(rows, (r) => r.open_cents)} /> },
          ]}
        />
      ) : null}
    </>
  );
}

function ResultReport({ from, to }: { from: string; to: string }) {
  const query = useDashboard(from, to);
  const s = query.data;
  const line = (label: string, cents: number, options: { strong?: boolean; sign?: '−' | '=' ; note?: string } = {}) => (
    <div className={cn('flex items-baseline justify-between gap-3 px-4 py-2', options.strong && 'bg-subtle/60 font-semibold')}>
      <dt>
        {options.sign ? <span className="mr-1.5 text-muted">{options.sign}</span> : null}
        {label}
        {options.note ? <span className="block text-xs font-normal text-muted">{options.note}</span> : null}
      </dt>
      <dd><Money cents={cents} className={cents < 0 ? 'text-danger' : ''} /></dd>
    </div>
  );
  return (
    <>
      <Loading query={query} />
      {s ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <h3 className="border-b border-line px-4 py-3 font-sans text-sm font-semibold">Resultado econômico estimado</h3>
            <dl className="divide-y divide-line text-sm">
              {line('Faturamento (vendas após descontos)', s.revenue_cents)}
              {line('Custo dos produtos vendidos (CMV)', -s.cogs_cents, { sign: '−', note: 'Custo histórico gravado em cada venda' })}
              {line('Lucro bruto estimado', s.gross_profit_cents, { strong: true, sign: '=' })}
              {line('Despesas operacionais do período', -s.expenses_cents, { sign: '−', note: 'Por data de competência' })}
              {line('Resultado estimado', s.estimated_result_cents, { strong: true, sign: '=' })}
            </dl>
            <p className="border-t border-line px-4 py-3 text-xs text-muted">
              Margem bruta: {formatPercent(percent(s.gross_profit_cents, s.revenue_cents))} · margem do resultado: {formatPercent(percent(s.estimated_result_cents, s.revenue_cents))}.
              {s.items_without_cost > 0 ? <strong className="text-warning"> Há {s.items_without_cost} itens vendidos sem custo informado: o resultado está superestimado.</strong> : null}
              {' '}Compras de estoque não entram aqui; o custo aparece quando o produto é vendido.
            </p>
          </Card>
          <Card>
            <h3 className="border-b border-line px-4 py-3 font-sans text-sm font-semibold">Caixa no período</h3>
            <dl className="divide-y divide-line text-sm">
              {line('Recebido de clientes', s.receipts_cents)}
              {line('Reembolsos a clientes', -s.refunds_cents, { sign: '−' })}
              {line('Pagamentos de compras', -s.purchases_paid_cents, { sign: '−' })}
              {line('Pagamentos de despesas', -s.expenses_paid_cents, { sign: '−' })}
              {line('Fluxo de caixa', s.cash_flow_cents, { strong: true, sign: '=' })}
            </dl>
            <div className="border-t border-line px-4 py-3 text-xs text-muted">
              <p>Compras registradas no período: {formatBRL(s.purchases_cents)} (compromissos; o caixa considera só o que foi pago).</p>
              <p className="mt-1">Diferença entre compras de insumos e CMV estimado: {formatBRL(s.purchases_cents - s.cogs_cents)} (variação de estoque, perdas ou custos não informados).</p>
            </div>
          </Card>
        </div>
      ) : null}
    </>
  );
}

function ProductsReport({ from, to }: { from: string; to: string }) {
  const query = useTopProducts(from, to);
  const products = useProducts();
  const rows = query.data ?? [];
  const current = new Map((products.data ?? []).map((p) => [p.id, p]));
  const exportColumns: ExportColumn<(typeof rows)[number]>[] = [
    { header: 'Produto', value: (r) => r.product_name },
    { header: 'Quantidade', value: (r) => r.quantity, kind: 'number' },
    { header: 'Unidade', value: (r) => r.unit },
    { header: 'Vendas', value: (r) => r.sales_count, kind: 'number' },
    { header: 'Faturamento', value: (r) => r.revenue_cents, kind: 'money' },
    { header: 'CMV estimado', value: (r) => r.cogs_cents, kind: 'money' },
    { header: 'Lucro bruto', value: (r) => r.gross_profit_cents, kind: 'money' },
    { header: 'Margem estimada %', value: (r) => r.margin_percent, kind: 'number' },
    { header: 'Itens sem custo', value: (r) => r.items_without_cost, kind: 'number' },
  ];
  return (
    <>
      <Toolbar note="Faturamento por produto não rateia descontos dados no total da venda.">
        <ExportMenu rows={rows} columns={exportColumns} fileName={`produtos-${from}-a-${to}`} />
      </Toolbar>
      <Loading query={query} />
      {query.data ? (
        <ReportTable
          caption="Produtos mais vendidos e margem estimada"
          rows={rows}
          rowKey={(r) => r.product_id}
          columns={[
            { header: 'Produto', cell: (r) => <Link className="hover:underline" to={`/produtos/${r.product_id}`}>{r.product_name}</Link>, footer: 'Total' },
            { header: 'Qtd.', align: 'right', cell: (r) => `${formatQuantity(r.quantity)} ${r.unit}` },
            { header: 'Faturamento', align: 'right', cell: (r) => <Money cents={r.revenue_cents} />, footer: <Money cents={sum(rows, (r) => r.revenue_cents)} /> },
            { header: 'CMV', align: 'right', cell: (r) => <Money cents={r.cogs_cents} />, footer: <Money cents={sum(rows, (r) => r.cogs_cents)} /> },
            {
              header: 'Margem no período',
              align: 'right',
              cell: (r) => (
                <span>
                  {formatPercent(r.margin_percent)}
                  {r.items_without_cost > 0 ? <Badge tone="warning" className="ml-1">{r.items_without_cost} s/ custo</Badge> : null}
                </span>
              ),
            },
            {
              header: 'Margem atual',
              align: 'right',
              cell: (r) => {
                const product = current.get(r.product_id);
                const m = product ? marginOf(product) : null;
                return m ? formatPercent(m.percent) : '—';
              },
            },
          ]}
        />
      ) : null}
    </>
  );
}

function CustomersReport({ from, to }: { from: string; to: string }) {
  const sales = useSales({ from, to, status: 'active' });
  const grouped = new Map<string, { id: string | null; name: string; count: number; total: number; paid: number; balance: number }>();
  for (const sale of sales.data ?? []) {
    const key = sale.customer_id ?? 'none';
    const entry = grouped.get(key) ?? { id: sale.customer_id, name: sale.customer_name ?? 'Sem cliente identificado', count: 0, total: 0, paid: 0, balance: 0 };
    entry.count += 1;
    entry.total += sale.total_cents;
    entry.paid += sale.net_paid_cents;
    entry.balance += sale.balance_cents;
    grouped.set(key, entry);
  }
  const rows = [...grouped.values()].sort((a, b) => b.total - a.total);
  const exportColumns: ExportColumn<(typeof rows)[number]>[] = [
    { header: 'Cliente', value: (r) => r.name },
    { header: 'Vendas', value: (r) => r.count, kind: 'number' },
    { header: 'Faturamento', value: (r) => r.total, kind: 'money' },
    { header: 'Recebido (destas vendas)', value: (r) => r.paid, kind: 'money' },
    { header: 'Em aberto (destas vendas)', value: (r) => r.balance, kind: 'money' },
  ];
  return (
    <>
      <Toolbar note="Vendas do período agrupadas por cliente. Histórico completo na ficha do cliente.">
        <ExportMenu rows={rows} columns={exportColumns} fileName={`clientes-${from}-a-${to}`} />
      </Toolbar>
      <Loading query={sales} />
      {sales.data ? (
        <ReportTable
          caption="Histórico por cliente no período"
          rows={rows}
          rowKey={(r) => r.id ?? 'none'}
          columns={[
            { header: 'Cliente', cell: (r) => (r.id ? <Link className="hover:underline" to={`/clientes/${r.id}`}>{r.name}</Link> : r.name), footer: 'Total' },
            { header: 'Vendas', align: 'right', cell: (r) => r.count, footer: sum(rows, (r) => r.count) },
            { header: 'Faturamento', align: 'right', cell: (r) => <Money cents={r.total} />, footer: <Money cents={sum(rows, (r) => r.total)} /> },
            { header: 'Recebido', align: 'right', cell: (r) => <Money cents={r.paid} />, footer: <Money cents={sum(rows, (r) => r.paid)} /> },
            { header: 'Em aberto', align: 'right', cell: (r) => <Money cents={r.balance} />, footer: <Money cents={sum(rows, (r) => r.balance)} /> },
          ]}
        />
      ) : null}
    </>
  );
}

function IngredientsReport({ from, to }: { from: string; to: string }) {
  const query = useIngredientConsumption(from, to);
  const rows = query.data ?? [];
  const exportColumns: ExportColumn<(typeof rows)[number]>[] = [
    { header: 'Ingrediente', value: (r) => r.ingredient_name },
    { header: 'Quantidade estimada', value: (r) => r.quantity_base, kind: 'number' },
    { header: 'Unidade', value: (r) => r.base_unit },
    { header: 'Custo estimado', value: (r) => r.estimated_cost_cents, kind: 'money' },
  ];
  return (
    <>
      <Toolbar note="Estimativa: quantidades vendidas × receitas atuais. Não é controle de estoque.">
        <ExportMenu rows={rows} columns={exportColumns} fileName={`consumo-ingredientes-${from}-a-${to}`} />
      </Toolbar>
      <Loading query={query} />
      {query.data ? (
        <ReportTable
          caption="Consumo estimado de ingredientes"
          rows={rows}
          rowKey={(r) => r.ingredient_id}
          empty="Sem consumo estimado: nenhum produto vendido no período tem receita."
          columns={[
            { header: 'Ingrediente', cell: (r) => r.ingredient_name, footer: 'Total' },
            { header: 'Quantidade', align: 'right', cell: (r) => `${formatQuantity(r.quantity_base)} ${r.base_unit}` },
            { header: 'Custo estimado', align: 'right', cell: (r) => <Money cents={r.estimated_cost_cents} />, footer: <Money cents={sum(rows, (r) => r.estimated_cost_cents)} /> },
          ]}
        />
      ) : null}
    </>
  );
}

export function ReportsPage() {
  const [period, setPeriod] = usePeriod('month');
  const summary = useDashboard(period.from, period.to);
  return (
    <Page>
      <PageHeader title="Relatórios" description="Todos os números vêm do banco de dados; exporte em CSV ou Excel." />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <PeriodPicker period={period} onChange={setPeriod} />
        <Freshness query={summary} />
      </div>
      <Tabs defaultValue="vendas">
        <TabsList>
          <TabsTrigger value="vendas">Vendas</TabsTrigger>
          <TabsTrigger value="recebimentos">Recebimentos</TabsTrigger>
          <TabsTrigger value="receber">A receber</TabsTrigger>
          <TabsTrigger value="saidas">Compras e despesas</TabsTrigger>
          <TabsTrigger value="resultado">Resultado</TabsTrigger>
          <TabsTrigger value="produtos">Produtos</TabsTrigger>
          <TabsTrigger value="clientes">Clientes</TabsTrigger>
          <TabsTrigger value="ingredientes">Ingredientes</TabsTrigger>
        </TabsList>
        <TabsContent value="vendas"><SalesReport from={period.from} to={period.to} /></TabsContent>
        <TabsContent value="recebimentos"><ReceiptsReport from={period.from} to={period.to} /></TabsContent>
        <TabsContent value="receber"><ReceivablesReport /></TabsContent>
        <TabsContent value="saidas"><PayablesReport from={period.from} to={period.to} /></TabsContent>
        <TabsContent value="resultado"><ResultReport from={period.from} to={period.to} /></TabsContent>
        <TabsContent value="produtos"><ProductsReport from={period.from} to={period.to} /></TabsContent>
        <TabsContent value="clientes"><CustomersReport from={period.from} to={period.to} /></TabsContent>
        <TabsContent value="ingredientes"><IngredientsReport from={period.from} to={period.to} /></TabsContent>
      </Tabs>
    </Page>
  );
}
