import { Info, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { type Column, DataTable } from '@/components/shared/data-table';
import { ExportMenu } from '@/components/shared/export-menu';
import { Freshness } from '@/components/shared/freshness';
import { Money } from '@/components/shared/money';
import { PeriodPicker, usePeriod } from '@/components/shared/period-picker';
import { BillStatusBadge } from '@/components/shared/sale-status';
import { Stat } from '@/components/shared/stat';
import { Page, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/menu';
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '@/components/ui/states';
import { useCashFlow, useDashboard } from '@/data/dashboard';
import { useBillPaymentsPaid, useOpenBills } from '@/data/payables';
import { type BillPaymentRow, type BillRow, type CashFlowEntry, type DashboardSummary, paymentMethodLabel } from '@/data/types';
import { cn } from '@/lib/cn';
import { formatDateBR, type Period } from '@/lib/dates';
import type { ExportColumn } from '@/lib/export';
import { formatBRL } from '@/lib/money';
import { effectiveDueDate } from './bills/bill-calc';
import { type CashFlowView, entryHref, groupCashFlowByDay, summarizeCashFlow } from './cash-flow';

const TABS = ['fluxo', 'pagar', 'pagamentos'] as const;
type Tab = (typeof TABS)[number];

function useTab(): [Tab, (tab: Tab) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get('aba');
  const tab = (TABS as readonly string[]).includes(raw ?? '') ? (raw as Tab) : 'fluxo';
  return [
    tab,
    (next) => {
      const updated = new URLSearchParams(params);
      updated.set('aba', next);
      setParams(updated, { replace: true });
    },
  ];
}

// ── Fluxo de caixa ──────────────────────────────────────────────────────────

const cashFlowExport: ExportColumn<CashFlowEntry>[] = [
  { header: 'Data', value: (e) => e.entry_date, kind: 'date' },
  { header: 'Situação', value: (e) => (e.realized ? 'Realizado' : e.is_overdue ? 'Previsto (vencido)' : 'Previsto') },
  { header: 'Tipo', value: (e) => (e.direction === 'in' ? 'Entrada' : 'Saída') },
  { header: 'Categoria', value: (e) => e.category },
  { header: 'Descrição', value: (e) => e.description },
  { header: 'Valor (R$)', value: (e) => (e.direction === 'in' ? Number(e.amount_cents) : -Number(e.amount_cents)), kind: 'money' },
];

function ResultRow({ label, cents, formula, strong, sign }: { label: string; cents: number; formula?: string; strong?: boolean; sign?: '−' | '=' }) {
  return (
    <div className={cn('flex items-start justify-between gap-3 py-1.5 text-sm', strong && 'border-t border-line pt-2 font-semibold')}>
      <div className="min-w-0">
        <p>
          {sign ? <span className="mr-1 text-muted">{sign}</span> : null}
          {label}
        </p>
        {formula ? <p className="text-xs font-normal text-muted">{formula}</p> : null}
      </div>
      <Money cents={cents} className={cn(strong && cents < 0 && 'text-danger')} />
    </div>
  );
}

function EconomicSummary({ summary }: { summary: DashboardSummary }) {
  return (
    <Card className="p-4">
      <h2 className="font-sans text-base font-semibold">Resultado econômico estimado</h2>
      <p className="mb-2 text-xs text-muted">Competência: o que foi vendido e gasto no período, independentemente de quando foi pago.</p>
      <ResultRow label="Faturamento" cents={summary.revenue_cents} formula="Σ total das vendas ativas com data no período (após descontos)" />
      <ResultRow sign="−" label="CMV estimado" cents={summary.cogs_cents} formula="Σ quantidade × custo unitário histórico de cada item vendido" />
      <ResultRow label="Lucro bruto estimado" cents={summary.gross_profit_cents} strong />
      <ResultRow sign="−" label="Despesas operacionais" cents={summary.expenses_cents} formula="Despesas com data de competência no período" />
      <ResultRow sign="=" label="Resultado estimado" cents={summary.estimated_result_cents} strong />
      {summary.items_without_cost > 0 ? (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-warning-soft px-2.5 py-2 text-xs text-warning">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {summary.items_without_cost} {summary.items_without_cost === 1 ? 'item vendido está' : 'itens vendidos estão'} sem custo informado: o resultado
          pode estar superestimado. Cadastre custos ou receitas em Produtos.
        </p>
      ) : null}
      <div className="mt-3 space-y-1 border-t border-line pt-3 text-xs text-muted">
        <p>
          Compras de insumos registradas no período: <Money cents={summary.purchases_cents} className="text-ink-soft" />. Elas não entram no
          resultado: o custo aparece no CMV quando o produto é vendido (o restante fica em estoque).
        </p>
        <p>
          Recebido no período: <Money cents={summary.net_received_cents} className="text-ink-soft" /> · Fluxo de caixa:{' '}
          <Money cents={summary.cash_flow_cents} className="text-ink-soft" /> (recebido − pagamentos de compras e despesas).
        </p>
      </div>
    </Card>
  );
}

function CashFlowTab({ period }: { period: Period }) {
  const [view, setView] = useState<CashFlowView>('all');
  const flow = useCashFlow(period.from, period.to);
  const dashboard = useDashboard(period.from, period.to);
  const entries = flow.data ?? [];
  const summary = summarizeCashFlow(entries);
  const days = groupCashFlowByDay(entries, view);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Freshness query={flow} />
        <ExportMenu rows={entries} columns={cashFlowExport} fileName={`fluxo-de-caixa-${period.from}-a-${period.to}`} />
      </div>
      {flow.isError && !flow.data ? <ErrorState error={flow.error} onRetry={() => void flow.refetch()} /> : null}
      {flow.isPending ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : null}

      {flow.data ? (
        <>
          <section className="space-y-2">
            <h2 className="font-sans text-xs font-semibold uppercase tracking-wider text-muted">Realizado no período</h2>
            <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3">
              <Stat label="Entradas" cents={summary.realizedIn} tone="positive" hint="Recebimentos de vendas" />
              <Stat label="Saídas" cents={summary.realizedOut} tone="negative" hint="Pagamentos de compras, despesas e reembolsos" />
              <Stat label="Saldo do período" cents={summary.realizedNet} signed hint="Entradas − saídas realizadas" className="col-span-2 lg:col-span-1" />
            </div>
          </section>
          <section className="space-y-2">
            <h2 className="font-sans text-xs font-semibold uppercase tracking-wider text-muted">Previsto no período</h2>
            <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3">
              <Stat
                label="A receber"
                cents={summary.forecastIn}
                tone="accent"
                hint={summary.overdueIn > 0 ? `Inclui ${formatBRL(summary.overdueIn)} já vencidos` : 'Saldos de vendas por vencimento'}
              />
              <Stat
                label="A pagar"
                cents={summary.forecastOut}
                tone={summary.overdueOut > 0 ? 'warning' : 'default'}
                hint={summary.overdueOut > 0 ? `Inclui ${formatBRL(summary.overdueOut)} já vencidos` : 'Parcelas e contas por vencimento'}
              />
              <Stat label="Saldo previsto" cents={summary.forecastNet} signed hint="A receber − a pagar" className="col-span-2 lg:col-span-1" />
            </div>
          </section>
        </>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="space-y-3 lg:col-span-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-sans text-base font-semibold">Movimentações por dia</h2>
            <div role="radiogroup" aria-label="Mostrar" className="inline-flex rounded-xl border border-line bg-subtle p-1">
              {(
                [
                  ['all', 'Tudo'],
                  ['realized', 'Realizado'],
                  ['forecast', 'Previsto'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={view === value}
                  onClick={() => setView(value)}
                  className={cn('h-8 rounded-lg px-3 text-sm font-medium text-muted hover:text-ink', view === value && 'bg-panel text-ink shadow-sm')}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {flow.isPending ? <LoadingBlock /> : null}
          {flow.data && days.length === 0 ? (
            <EmptyState title="Nenhuma movimentação" description="Não há entradas ou saídas, realizadas ou previstas, neste período." />
          ) : null}
          <ol className="space-y-3">
            {days.map((day) => (
              <li key={day.date}>
                <Card>
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-2.5">
                    <h3 className="font-sans text-sm font-semibold">{formatDateBR(day.date)}</h3>
                    <p className="text-xs text-muted">
                      {day.realizedIn || day.realizedOut ? (
                        <>
                          Realizado <Money cents={day.realizedIn - day.realizedOut} signed /> ·{' '}
                        </>
                      ) : null}
                      Saldo acumulado <Money cents={day.runningRealized} className="font-medium text-ink-soft" />
                    </p>
                  </div>
                  <ul className="divide-y divide-line">
                    {day.entries.map((entry, index) => (
                      <li key={`${entry.ref_kind}-${entry.ref_id}-${entry.category}-${index}`}>
                        <Link to={entryHref(entry)} className="flex items-center gap-3 px-4 py-2.5 hover:bg-subtle">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{entry.description}</p>
                            <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                              {entry.category}
                              {!entry.realized ? <Badge tone={entry.is_overdue ? 'danger' : 'info'}>{entry.is_overdue ? 'vencido' : 'previsto'}</Badge> : null}
                            </p>
                          </div>
                          <Money
                            cents={entry.direction === 'in' ? Number(entry.amount_cents) : -Number(entry.amount_cents)}
                            signed
                            className={cn('text-sm font-semibold', !entry.realized && 'opacity-75')}
                          />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              </li>
            ))}
          </ol>
        </div>
        <div className="space-y-3 lg:col-span-2">
          {dashboard.data ? <EconomicSummary summary={dashboard.data} /> : dashboard.isPending ? <Skeleton className="h-72" /> : null}
          {dashboard.isError && !dashboard.data ? <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} /> : null}
          <p className="flex items-start gap-2 rounded-lg bg-subtle px-3 py-2 text-xs text-ink-soft">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              Cada movimentação aparece uma única vez: um pagamento realizado não volta a aparecer como previsto, e uma compra parcelada aparece
              como parcelas (pagas ou previstas), nunca com o total repetido. O saldo acumulado considera somente o realizado no período e não é o
              saldo da conta bancária. Valores a receber ou a pagar sem vencimento não entram na previsão.
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Contas a pagar ──────────────────────────────────────────────────────────

const billHref = (bill: Pick<BillRow, 'kind' | 'id'>) => (bill.kind === 'purchase' ? `/compras/${bill.id}` : `/despesas/${bill.id}`);

const billColumns: Column<BillRow>[] = [
  { key: 'description', header: 'Descrição', cell: (b) => <span className="line-clamp-2">{b.description}</span>, sortValue: (b) => b.description },
  { key: 'due', header: 'Vencimento', cell: (b) => formatDateBR(effectiveDueDate(b)), sortValue: (b) => effectiveDueDate(b) },
  { key: 'kind', header: 'Tipo', cell: (b) => (b.kind === 'purchase' ? 'Compra' : 'Despesa'), sortValue: (b) => b.kind },
  { key: 'supplier', header: 'Fornecedor', cell: (b) => b.supplier_name ?? '—', sortValue: (b) => b.supplier_name },
  { key: 'category', header: 'Categoria', cell: (b) => b.category, sortValue: (b) => b.category },
  { key: 'total', header: 'Total', align: 'right', cell: (b) => <Money cents={b.total_cents} />, sortValue: (b) => b.total_cents },
  { key: 'balance', header: 'Saldo', align: 'right', cell: (b) => <Money cents={b.balance_cents} className="font-semibold" />, sortValue: (b) => b.balance_cents },
  { key: 'status', header: 'Situação', cell: (b) => <BillStatusBadge status={b.payment_status} overdue={b.is_overdue} />, sortValue: (b) => (b.is_overdue ? 0 : 1) },
];

const billExport: ExportColumn<BillRow>[] = [
  { header: 'Tipo', value: (b) => (b.kind === 'purchase' ? 'Compra' : 'Despesa') },
  { header: 'Data', value: (b) => b.bill_date, kind: 'date' },
  { header: 'Descrição', value: (b) => b.description },
  { header: 'Fornecedor', value: (b) => b.supplier_name },
  { header: 'Categoria', value: (b) => b.category },
  { header: 'Total (R$)', value: (b) => b.total_cents, kind: 'money' },
  { header: 'Pago (R$)', value: (b) => b.paid_cents, kind: 'money' },
  { header: 'Previsto (R$)', value: (b) => b.scheduled_cents, kind: 'money' },
  { header: 'Saldo (R$)', value: (b) => b.balance_cents, kind: 'money' },
  { header: 'Próximo vencimento', value: (b) => effectiveDueDate(b), kind: 'date' },
  { header: 'Vencida', value: (b) => b.is_overdue, kind: 'boolean' },
];

function PayablesTab() {
  const bills = useOpenBills();
  const rows = bills.data ?? [];
  const open = rows.reduce((sum, b) => sum + b.balance_cents, 0);
  const overdue = rows.filter((b) => b.is_overdue).reduce((sum, b) => sum + b.balance_cents, 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:max-w-xl sm:gap-3">
        <Stat label="Em aberto" cents={open} hint={`${rows.length} ${rows.length === 1 ? 'conta' : 'contas'} (todas as datas)`} />
        <Stat label="Vencido" cents={overdue} tone={overdue > 0 ? 'negative' : 'default'} hint="Parcelas ou contas com vencimento passado" />
      </div>
      {bills.isError && !bills.data ? <ErrorState error={bills.error} onRetry={() => void bills.refetch()} /> : null}
      {bills.isPending ? <LoadingBlock /> : null}
      {bills.data ? (
        <DataTable
          rows={rows}
          columns={billColumns}
          getRowId={(b) => `${b.kind}-${b.id}`}
          rowHref={billHref}
          caption="Contas a pagar"
          searchText={(b) => `${b.description} ${b.supplier_name ?? ''} ${b.category}`}
          searchPlaceholder="Pesquisar contas"
          initialSort={{ key: 'status', direction: 'asc' }}
          toolbar={
            <div className="flex flex-1 items-center justify-between gap-2">
              <Freshness query={bills} />
              <ExportMenu rows={rows} columns={billExport} fileName="contas-a-pagar" />
            </div>
          }
          emptyTitle="Nenhuma conta a pagar"
          emptyDescription="Todas as compras e despesas estão pagas."
          mobileCard={(b) => (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{b.description}</p>
                <p className="truncate text-xs text-muted">
                  {b.kind === 'purchase' ? 'Compra' : 'Despesa'} · {effectiveDueDate(b) ? `vence ${formatDateBR(effectiveDueDate(b))}` : 'sem vencimento'}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Money cents={b.balance_cents} className="text-sm font-semibold" />
                <BillStatusBadge status={b.payment_status} overdue={b.is_overdue} />
              </div>
            </div>
          )}
        />
      ) : null}
    </div>
  );
}

// ── Pagamentos realizados ───────────────────────────────────────────────────

const paymentHref = (p: Pick<BillPaymentRow, 'kind' | 'bill_id'>) => (p.kind === 'purchase' ? `/compras/${p.bill_id}` : `/despesas/${p.bill_id}`);

const paymentColumns: Column<BillPaymentRow>[] = [
  { key: 'description', header: 'Referente a', cell: (p) => <span className="line-clamp-2">{p.bill_description}</span>, sortValue: (p) => p.bill_description },
  { key: 'paid_on', header: 'Pago em', cell: (p) => formatDateBR(p.paid_on), sortValue: (p) => p.paid_on },
  { key: 'kind', header: 'Tipo', cell: (p) => (p.kind === 'purchase' ? 'Compra' : 'Despesa'), sortValue: (p) => p.kind },
  { key: 'category', header: 'Categoria', cell: (p) => p.bill_category, sortValue: (p) => p.bill_category },
  { key: 'installment', header: 'Parcela', cell: (p) => (p.installment_number ? `${p.installment_number}ª` : '—'), sortValue: (p) => p.installment_number },
  { key: 'method', header: 'Forma', cell: (p) => paymentMethodLabel(p.method), sortValue: (p) => p.method },
  {
    key: 'amount',
    header: 'Valor',
    align: 'right',
    cell: (p) => <Money cents={p.amount_cents} className={p.voided_at ? 'text-muted line-through' : undefined} />,
    sortValue: (p) => p.amount_cents,
  },
  { key: 'state', header: 'Situação', cell: (p) => (p.voided_at ? <Badge tone="neutral">Estornado</Badge> : <Badge tone="success">Pago</Badge>) },
];

const paymentExport: ExportColumn<BillPaymentRow>[] = [
  { header: 'Pago em', value: (p) => p.paid_on, kind: 'date' },
  { header: 'Tipo', value: (p) => (p.kind === 'purchase' ? 'Compra' : 'Despesa') },
  { header: 'Referente a', value: (p) => p.bill_description },
  { header: 'Categoria', value: (p) => p.bill_category },
  { header: 'Fornecedor', value: (p) => p.supplier_name },
  { header: 'Parcela', value: (p) => p.installment_number, kind: 'number' },
  { header: 'Forma', value: (p) => paymentMethodLabel(p.method) },
  { header: 'Valor (R$)', value: (p) => p.amount_cents, kind: 'money' },
  { header: 'Estornado', value: (p) => Boolean(p.voided_at), kind: 'boolean' },
  { header: 'Motivo do estorno', value: (p) => p.void_reason },
];

function PaymentsTab({ period }: { period: Period }) {
  const payments = useBillPaymentsPaid(period.from, period.to);
  const rows = payments.data ?? [];
  const valid = rows.filter((p) => !p.voided_at);
  const total = valid.reduce((sum, p) => sum + p.amount_cents, 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:max-w-xl sm:gap-3">
        <Stat label="Pago no período" cents={total} hint={`${valid.length} ${valid.length === 1 ? 'pagamento' : 'pagamentos'}`} />
        <Stat
          label="Compras / despesas"
          cents={valid.filter((p) => p.kind === 'purchase').reduce((s, p) => s + p.amount_cents, 0)}
          hint={`Compras · despesas ${formatBRL(valid.filter((p) => p.kind === 'expense').reduce((s, p) => s + p.amount_cents, 0))}`}
        />
      </div>
      {payments.isError && !payments.data ? <ErrorState error={payments.error} onRetry={() => void payments.refetch()} /> : null}
      {payments.isPending ? <LoadingBlock /> : null}
      {payments.data ? (
        <DataTable
          rows={rows}
          columns={paymentColumns}
          getRowId={(p) => p.id}
          rowHref={paymentHref}
          caption="Pagamentos realizados"
          searchText={(p) => `${p.bill_description} ${p.bill_category} ${p.supplier_name ?? ''}`}
          searchPlaceholder="Pesquisar pagamentos"
          initialSort={{ key: 'paid_on', direction: 'desc' }}
          rowClassName={(p) => (p.voided_at ? 'opacity-60' : undefined)}
          toolbar={
            <div className="flex flex-1 items-center justify-between gap-2">
              <Freshness query={payments} />
              <ExportMenu rows={rows} columns={paymentExport} fileName={`pagamentos-${period.from}-a-${period.to}`} />
            </div>
          }
          emptyTitle="Nenhum pagamento no período"
          emptyDescription="Pagamentos de compras e despesas aparecem aqui pela data em que foram pagos."
          mobileCard={(p) => (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className={cn('truncate text-sm font-medium text-ink', p.voided_at && 'line-through')}>{p.bill_description}</p>
                <p className="truncate text-xs text-muted">
                  {formatDateBR(p.paid_on)} · {p.kind === 'purchase' ? 'Compra' : 'Despesa'} · {paymentMethodLabel(p.method)}
                  {p.installment_number ? ` · ${p.installment_number}ª parcela` : ''}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Money cents={p.amount_cents} className={cn('text-sm font-semibold', p.voided_at && 'text-muted line-through')} />
                {p.voided_at ? <Badge tone="neutral">Estornado</Badge> : null}
              </div>
            </div>
          )}
        />
      ) : null}
    </div>
  );
}

export function FinancePage() {
  const [period, setPeriod] = usePeriod('month');
  const [tab, setTab] = useTab();
  return (
    <Page>
      <PageHeader title="Financeiro" description="Entradas e saídas realizadas e previstas, contas a pagar e resultado estimado." />
      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <TabsList aria-label="Seções do financeiro">
            <TabsTrigger value="fluxo">Fluxo de caixa</TabsTrigger>
            <TabsTrigger value="pagar">Contas a pagar</TabsTrigger>
            <TabsTrigger value="pagamentos">Pagamentos</TabsTrigger>
          </TabsList>
          {tab === 'pagar' ? <p className="text-sm text-muted">Posição atual, todas as datas.</p> : <PeriodPicker period={period} onChange={setPeriod} />}
        </div>
        <TabsContent value="fluxo">
          <CashFlowTab period={period} />
        </TabsContent>
        <TabsContent value="pagar">
          <PayablesTab />
        </TabsContent>
        <TabsContent value="pagamentos">
          <PaymentsTab period={period} />
        </TabsContent>
      </Tabs>
    </Page>
  );
}
