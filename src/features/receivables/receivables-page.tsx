import { CalendarDays, ChevronDown, HandCoins, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ChargeButton } from '@/components/shared/charge-dialog';
import { ExportMenu } from '@/components/shared/export-menu';
import { Freshness } from '@/components/shared/freshness';
import { Money } from '@/components/shared/money';
import { PeriodPicker, usePeriod } from '@/components/shared/period-picker';
import { SaleStatusBadge } from '@/components/shared/sale-status';
import { Stat } from '@/components/shared/stat';
import { Page, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/menu';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { usePaymentHistory, useReceivables } from '@/data/sales';
import { paymentMethodLabel, type PaymentRow, type SaleRow } from '@/data/types';
import { useBusiness } from '@/features/business/business-context';
import { cn } from '@/lib/cn';
import { formatDateBR, formatDateTimeBR, isValidISODate, nextDayOfMonth } from '@/lib/dates';
import type { ExportColumn } from '@/lib/export';
import { normalizeName } from '@/lib/import/normalize';
import { dueOn, dueOnDayOfMonth, groupByCustomer, groupByDueDate, sumBalance } from '@/lib/receivables';
import { PaymentDialog } from '../sales/payment-dialog';

type Quick = 'all' | 'overdue' | 'next-day' | 'every-day' | 'partial' | 'confirm' | 'range';

const exportColumns: ExportColumn<SaleRow>[] = [
  { header: 'Cliente', value: (s) => s.customer_name ?? 'Sem cliente' },
  { header: 'Telefone', value: (s) => s.customer_phone },
  { header: 'Data da venda', value: (s) => s.sale_date, kind: 'date' },
  { header: 'Itens', value: (s) => s.items_summary },
  { header: 'Valor original', value: (s) => s.total_cents, kind: 'money' },
  { header: 'Recebido', value: (s) => s.net_paid_cents, kind: 'money' },
  { header: 'Saldo', value: (s) => s.balance_cents, kind: 'money' },
  { header: 'Vencimento', value: (s) => s.due_date, kind: 'date' },
  { header: 'Vencida', value: (s) => s.is_overdue, kind: 'boolean' },
  { header: 'Parcial', value: (s) => s.payment_status === 'partial', kind: 'boolean' },
  { header: 'A confirmar', value: (s) => s.payment_confirmation_pending, kind: 'boolean' },
];

const movementColumns: ExportColumn<PaymentRow>[] = [
  { header: 'Data', value: (p) => p.paid_on, kind: 'date' },
  { header: 'Tipo', value: (p) => (p.kind === 'refund' ? 'Reembolso' : 'Recebimento') },
  { header: 'Cliente', value: (p) => p.customer_name },
  { header: 'Venda de', value: (p) => p.sale_date, kind: 'date' },
  { header: 'Valor', value: (p) => (p.kind === 'refund' ? -p.amount_cents : p.amount_cents), kind: 'money' },
  { header: 'Forma', value: (p) => paymentMethodLabel(p.method) },
  { header: 'Registrado por', value: (p) => p.received_by_name },
  { header: 'Estornado', value: (p) => Boolean(p.voided_at), kind: 'boolean' },
  { header: 'Motivo do estorno', value: (p) => p.void_reason },
];

function SaleLine({ sale, onReceive, showCustomer }: { sale: SaleRow; onReceive?: (sale: SaleRow) => void; showCustomer?: boolean }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
      <Link to={`/vendas/${sale.id}`} className="min-w-0 flex-1 hover:underline">
        <p className="truncate text-sm font-medium">
          {showCustomer ? `${sale.customer_name ?? 'Sem cliente'} · ` : ''}
          {formatDateBR(sale.sale_date)}
        </p>
        <p className="truncate text-xs text-muted">{sale.items_summary}</p>
        <p className="text-xs text-muted">
          original <Money cents={sale.total_cents} />
          {sale.net_paid_cents > 0 ? <> · recebido <Money cents={sale.net_paid_cents} /></> : null}
          {sale.due_date ? ` · vence ${formatDateBR(sale.due_date)}` : ' · sem vencimento'}
        </p>
      </Link>
      <div className="flex items-center gap-2">
        <div className="flex flex-col items-end gap-1">
          <Money cents={sale.balance_cents} className={cn('text-sm font-semibold', sale.is_overdue && 'text-danger')} />
          <SaleStatusBadge sale={sale} />
        </div>
        {onReceive ? (
          <Button size="sm" variant="outline" onClick={() => onReceive(sale)} aria-label={`Receber de ${sale.customer_name ?? 'venda'} de ${formatDateBR(sale.sale_date)}`}>
            <HandCoins />
            <span className="hidden sm:inline">Receber</span>
          </Button>
        ) : null}
      </div>
    </li>
  );
}

export function ReceivablesPage() {
  const { business, today, can } = useBusiness();
  const receivables = useReceivables();
  const [quick, setQuick] = useState<Quick>('all');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [receiving, setReceiving] = useState<SaleRow | null>(null);
  const [movementPeriod, setMovementPeriod] = useState(() => ({ kind: 'month' as const, from: `${today().slice(0, 7)}-01`, to: today() }));
  const movements = usePaymentHistory({ from: movementPeriod.from, to: movementPeriod.to });
  const [period, setPeriodState] = usePeriod('month');

  const day = business.default_due_day;
  const nextDay = nextDayOfMonth(today(), day, true);
  const all = useMemo(() => receivables.data ?? [], [receivables.data]);

  const filtered = useMemo(() => {
    let rows: SaleRow[] = all;
    switch (quick) {
      case 'overdue':
        rows = rows.filter((s) => s.is_overdue);
        break;
      case 'next-day':
        rows = dueOn(rows, nextDay) as SaleRow[];
        break;
      case 'every-day':
        rows = dueOnDayOfMonth(rows, day) as SaleRow[];
        break;
      case 'partial':
        rows = rows.filter((s) => s.payment_status === 'partial');
        break;
      case 'confirm':
        rows = rows.filter((s) => s.payment_confirmation_pending);
        break;
      case 'range':
        rows = rows.filter((s) => s.due_date && (!isValidISODate(from) || s.due_date >= from) && (!isValidISODate(to) || s.due_date <= to));
        break;
    }
    const needle = normalizeName(query);
    if (needle) rows = rows.filter((s) => normalizeName(`${s.customer_name ?? ''} ${s.items_summary ?? ''}`).includes(needle));
    return rows;
  }, [all, quick, nextDay, day, from, to, query]);

  const byCustomer = groupByCustomer(filtered);
  const byDue = groupByDueDate(filtered, today());
  const overdue = all.filter((s) => s.is_overdue);
  const partial = all.filter((s) => s.payment_status === 'partial');
  const toConfirm = all.filter((s) => s.payment_confirmation_pending);
  const nextDayRows = dueOn(all, nextDay);

  const chips: Array<{ value: Quick; label: string; count?: number }> = [
    { value: 'all', label: 'Todas', count: all.length },
    { value: 'overdue', label: 'Vencidas', count: overdue.length },
    { value: 'next-day', label: `Dia ${day} (${formatDateBR(nextDay).slice(0, 5)})`, count: nextDayRows.length },
    { value: 'every-day', label: `Todo dia ${day}` },
    { value: 'partial', label: 'Parciais', count: partial.length },
    { value: 'confirm', label: 'A confirmar', count: toConfirm.length },
    { value: 'range', label: 'Por período' },
  ];

  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <Page>
      <PageHeader title="Contas a receber" description="Vendas com saldo em aberto. Vencimento passado não quita a venda: só recebimentos registrados." actions={<Freshness query={receivables} />} />

      {receivables.isPending ? <LoadingBlock /> : null}
      {receivables.isError && !receivables.data ? <ErrorState error={receivables.error} onRetry={() => void receivables.refetch()} /> : null}

      {receivables.data ? (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
            <Stat label="Total em aberto" cents={sumBalance(all)} tone="accent" hint={`${all.length} ${all.length === 1 ? 'venda' : 'vendas'}`} />
            <Stat label="Vencido" cents={sumBalance(overdue)} tone={overdue.length ? 'negative' : 'default'} hint={`${overdue.length} ${overdue.length === 1 ? 'venda' : 'vendas'}`} />
            <Stat label={`Dia ${day} · ${formatDateBR(nextDay)}`} cents={sumBalance(nextDayRows)} hint={`${nextDayRows.length} previstos`} />
            <Stat label="Pagamentos parciais" cents={sumBalance(partial)} hint={`${partial.length} com saldo restante`} />
          </div>

          <Tabs defaultValue="customers">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <TabsList>
                <TabsTrigger value="customers">Por cliente</TabsTrigger>
                <TabsTrigger value="due">Por vencimento</TabsTrigger>
                <TabsTrigger value="movements">Movimentações</TabsTrigger>
              </TabsList>
            </div>

            <div className="mt-3 space-y-2" aria-label="Filtros">
              <div className="flex gap-1.5 overflow-x-auto pb-1" role="radiogroup" aria-label="Filtro rápido">
                {chips.map((chip) => (
                  <button
                    key={chip.value}
                    type="button"
                    role="radio"
                    aria-checked={quick === chip.value}
                    onClick={() => setQuick(chip.value)}
                    className={cn(
                      'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm',
                      quick === chip.value ? 'border-accent-ink bg-accent-soft font-medium text-accent-ink' : 'border-line-strong bg-panel text-ink-soft hover:bg-subtle',
                    )}
                  >
                    {chip.value === 'next-day' || chip.value === 'every-day' ? <CalendarDays className="size-3.5" aria-hidden /> : null}
                    {chip.label}
                    {chip.count !== undefined ? <span className="num text-xs opacity-70">{chip.count}</span> : null}
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative sm:w-72">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
                  <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Pesquisar cliente" aria-label="Pesquisar cliente" className="pl-9" />
                </div>
                {quick === 'range' ? (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted">Vencimento de</span>
                    <Input type="date" aria-label="Vencimento a partir de" className="h-9 w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
                    <span className="text-muted">a</span>
                    <Input type="date" aria-label="Vencimento até" className="h-9 w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
                  </div>
                ) : null}
                <div className="flex items-center gap-2 sm:ml-auto">
                  <p className="text-sm text-muted">
                    Filtrado: <Money cents={sumBalance(filtered)} className="font-semibold text-ink" />
                  </p>
                  <ExportMenu rows={filtered} columns={exportColumns} fileName={`contas-a-receber-${today()}`} />
                </div>
              </div>
            </div>

            <TabsContent value="customers">
              {byCustomer.length === 0 ? <EmptyState icon={<HandCoins />} title="Nada a receber neste filtro" /> : null}
              <ul className="space-y-2">
                {byCustomer.map((group) => {
                  const open = expanded.has(group.key);
                  return (
                    <li key={group.key}>
                      <Card>
                        <div className="px-4 py-3">
                          <div className="flex items-start gap-3">
                            <button type="button" onClick={() => toggle(group.key)} aria-expanded={open} className="flex min-w-0 flex-1 items-start gap-2 text-left">
                              <ChevronDown className={cn('mt-0.5 size-4 shrink-0 text-muted transition-transform', open && 'rotate-180')} aria-hidden />
                              <span className="font-medium leading-snug">{group.customerName}</span>
                            </button>
                            <div className="text-right">
                              <Money cents={group.balanceCents} className="font-semibold" />
                              {group.overdueCents > 0 ? <p className="text-xs text-danger">vencido <Money cents={group.overdueCents} /></p> : null}
                            </div>
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 pl-6">
                            <p className="text-xs text-muted">
                              {group.sales.length} {group.sales.length === 1 ? 'venda' : 'vendas'} · original <Money cents={group.originalCents} /> · recebido <Money cents={group.receivedCents} />
                              {group.nextDueDate ? ` · próximo venc. ${formatDateBR(group.nextDueDate)}` : ''}
                            </p>
                            {can('write') ? <ChargeButton group={group} /> : null}
                          </div>
                        </div>
                        {open ? (
                          <ul className="divide-y divide-line border-t border-line">
                            {group.sales.map((sale) => (
                              <SaleLine key={sale.id} sale={sale as SaleRow} onReceive={can('write') ? setReceiving : undefined} />
                            ))}
                          </ul>
                        ) : null}
                      </Card>
                    </li>
                  );
                })}
              </ul>
            </TabsContent>

            <TabsContent value="due">
              {byDue.length === 0 ? <EmptyState icon={<HandCoins />} title="Nada a receber neste filtro" /> : null}
              <div className="space-y-3">
                {byDue.map((group) => (
                  <Card key={group.key}>
                    <div className={cn('flex items-center justify-between gap-2 border-b border-line px-4 py-2.5', group.kind === 'overdue' && 'bg-danger-soft/60')}>
                      <p className="flex items-center gap-2 text-sm font-semibold">
                        {group.label}
                        {group.dueDate && Number(group.dueDate.slice(8, 10)) === day ? <Badge tone="accent">dia {day}</Badge> : null}
                      </p>
                      <Money cents={group.balanceCents} className={cn('text-sm font-semibold', group.kind === 'overdue' && 'text-danger')} />
                    </div>
                    <ul className="divide-y divide-line">
                      {group.sales.map((sale) => (
                        <SaleLine key={sale.id} sale={sale as SaleRow} showCustomer onReceive={can('write') ? setReceiving : undefined} />
                      ))}
                    </ul>
                  </Card>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="movements">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <PeriodPicker
                  period={period}
                  onChange={(p) => {
                    setPeriodState(p);
                    setMovementPeriod({ kind: 'month', from: p.from, to: p.to });
                  }}
                />
                <ExportMenu rows={movements.data ?? []} columns={movementColumns} fileName={`recebimentos-${period.from}-a-${period.to}`} />
              </div>
              {movements.isPending ? <LoadingBlock rows={3} /> : null}
              {movements.data?.length === 0 ? <EmptyState title="Nenhuma movimentação no período" /> : null}
              {movements.data && movements.data.length > 0 ? (
                <Card>
                  <ul className="divide-y divide-line">
                    {movements.data.map((p) => (
                      <li key={p.id} className={cn('flex flex-wrap items-center gap-3 px-4 py-2.5', p.voided_at && 'opacity-60')}>
                        <Link to={`/vendas/${p.sale_id}`} className="min-w-0 flex-1 hover:underline">
                          <p className="truncate text-sm font-medium">
                            {p.kind === 'refund' ? 'Reembolso' : 'Recebimento'} · {p.customer_name ?? 'Sem cliente'}
                          </p>
                          <p className="text-xs text-muted">
                            {formatDateBR(p.paid_on)} · {paymentMethodLabel(p.method)} · venda de {formatDateBR(p.sale_date)}
                            {p.received_by_name ? ` · por ${p.received_by_name}` : ''}
                          </p>
                          {p.voided_at ? <p className="text-xs text-danger">Estornado em {formatDateTimeBR(p.voided_at, business.timezone)}: {p.void_reason}</p> : null}
                        </Link>
                        <Money cents={p.kind === 'refund' ? -p.amount_cents : p.amount_cents} signed className={cn('text-sm font-semibold', p.voided_at && 'line-through')} />
                      </li>
                    ))}
                  </ul>
                  <p className="border-t border-line px-4 py-2 text-xs text-muted">
                    Total líquido no período:{' '}
                    <Money
                      cents={(movements.data ?? []).filter((p) => !p.voided_at).reduce((sum, p) => sum + (p.kind === 'refund' ? -p.amount_cents : p.amount_cents), 0)}
                      className="font-semibold text-ink"
                    />{' '}
                    (lançamentos estornados não contam)
                  </p>
                </Card>
              ) : null}
            </TabsContent>
          </Tabs>
        </>
      ) : null}

      {receiving ? <PaymentDialog sale={receiving} kind="receipt" open onOpenChange={(open) => !open && setReceiving(null)} /> : null}
    </Page>
  );
}
