import { ArrowRight, CalendarDays, Info, Plus } from 'lucide-react';
import { Link } from 'react-router';
import { Freshness } from '@/components/shared/freshness';
import { Money } from '@/components/shared/money';
import { PeriodPicker, usePeriod } from '@/components/shared/period-picker';
import { SaleStatusBadge } from '@/components/shared/sale-status';
import { Stat } from '@/components/shared/stat';
import { Page, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '@/components/ui/states';
import { useDashboard } from '@/data/dashboard';
import { useReceivables, useSales } from '@/data/sales';
import { useBusiness } from '@/features/business/business-context';
import { formatDateBR } from '@/lib/dates';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="font-sans text-xs font-semibold uppercase tracking-wider text-muted">{title}</h2>
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">{children}</div>
    </section>
  );
}

export function DashboardPage() {
  const [period, setPeriod] = usePeriod('month');
  const { can, business } = useBusiness();
  const summary = useDashboard(period.from, period.to);
  const recent = useSales({ limit: 6, status: 'all' });
  const receivables = useReceivables();
  const s = summary.data;

  return (
    <Page>
      <PageHeader
        title="Início"
        description={business.name}
        actions={
          can('write') ? (
            <Button asChild className="hidden sm:inline-flex">
              <Link to="/vendas/nova">
                <Plus /> Nova venda
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <PeriodPicker period={period} onChange={setPeriod} />
        <Freshness query={summary} />
      </div>

      {summary.isError && !s ? <ErrorState error={summary.error} onRetry={() => void summary.refetch()} /> : null}

      {!s && summary.isPending ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : null}

      {s ? (
        <div className="space-y-5">
          <Section title="Vendas no período">
            <Stat label="Faturamento" cents={s.revenue_cents} hint={`${s.sales_count} ${s.sales_count === 1 ? 'venda' : 'vendas'}${s.discounts_cents ? ` · descontos ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(s.discounts_cents / 100)}` : ''}`} />
            <Stat label="Recebido" cents={s.net_received_cents} tone="positive" hint={s.refunds_cents ? 'Já descontados os reembolsos' : 'Dinheiro que entrou no período'} />
            <Stat
              label="CMV estimado"
              cents={s.cogs_cents}
              hint={s.items_without_cost > 0 ? `${s.items_without_cost} ${s.items_without_cost === 1 ? 'item vendido sem custo informado' : 'itens vendidos sem custo informado'}` : 'Custo histórico dos produtos vendidos'}
              badge={s.items_without_cost > 0 ? <Badge tone="warning">incompleto</Badge> : null}
            />
            <Stat
              label="Lucro estimado"
              cents={s.estimated_result_cents}
              signed
              hint={s.items_without_cost > 0 ? 'Pode estar superestimado: há itens sem custo' : 'Faturamento − CMV − despesas do período'}
              badge={s.items_without_cost > 0 ? <Badge tone="warning">parcial</Badge> : null}
            />
          </Section>

          <Section title="Posição hoje">
            <Stat label="Contas a receber" cents={s.open_receivables_cents} tone="accent" hint={`${s.open_receivables_count} em aberto${s.pending_confirmation_count ? ` · ${s.pending_confirmation_count} a confirmar` : ''}`} />
            <Stat label="Vencidos" cents={s.overdue_cents} tone={s.overdue_cents > 0 ? 'negative' : 'default'} hint={`${s.overdue_count} ${s.overdue_count === 1 ? 'venda vencida' : 'vendas vencidas'}`} />
            <Stat label={`Previsto para ${formatDateBR(s.next_due_day).slice(0, 5)}`} cents={s.next_due_day_cents} hint={`${s.next_due_day_count} ${s.next_due_day_count === 1 ? 'recebimento' : 'recebimentos'} no dia ${business.default_due_day}`} />
            <Stat label="Contas a pagar" cents={s.open_payables_cents} tone={s.overdue_payables_cents > 0 ? 'warning' : 'default'} hint={s.overdue_payables_cents > 0 ? `Vencidas: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(s.overdue_payables_cents / 100)}` : 'Compras e despesas em aberto'} />
          </Section>

          <Section title="Saídas e caixa no período">
            <Stat label="Compras registradas" cents={s.purchases_cents} hint="Insumos e estoque (não entram no lucro)" />
            <Stat label="Despesas do período" cents={s.expenses_cents} hint="Despesas operacionais por competência" />
            <Stat label="Pagamentos feitos" cents={s.purchases_paid_cents + s.expenses_paid_cents} hint="Compras e despesas pagas no período" />
            <Stat label="Fluxo de caixa" cents={s.cash_flow_cents} signed hint="Recebido − pagamentos" />
          </Section>

          <p className="flex items-start gap-2 rounded-lg bg-subtle px-3 py-2 text-xs text-ink-soft">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              <strong>Faturamento</strong> é o que foi vendido; <strong>recebido</strong> é o dinheiro que entrou; <strong>fluxo de caixa</strong> é
              entrada menos saída; <strong>lucro estimado</strong> considera o custo dos produtos vendidos e as despesas. Compras de estoque não
              entram no lucro: o custo aparece quando o produto é vendido.{' '}
              <Link to="/financeiro" className="font-medium text-accent-ink underline-offset-2 hover:underline">
                Ver fluxo de caixa
              </Link>
            </span>
          </p>
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Próximos recebimentos"
            description={s ? `Destaque para o dia ${business.default_due_day}` : undefined}
            actions={
              <Button asChild variant="ghost" size="sm">
                <Link to="/receber">
                  Ver tudo <ArrowRight />
                </Link>
              </Button>
            }
          />
          <div className="p-2">
            {receivables.isPending ? <LoadingBlock rows={3} /> : null}
            {receivables.isError && !receivables.data ? <ErrorState error={receivables.error} onRetry={() => void receivables.refetch()} /> : null}
            {receivables.data && receivables.data.length === 0 ? <EmptyState title="Nada a receber" description="Todas as vendas estão pagas." className="border-0" /> : null}
            <ul className="divide-y divide-line">
              {receivables.data?.slice(0, 6).map((sale) => (
                <li key={sale.id}>
                  <Link to={`/vendas/${sale.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-subtle">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{sale.customer_name ?? 'Sem cliente'}</p>
                      <p className="flex items-center gap-1 truncate text-xs text-muted">
                        <CalendarDays className="size-3" aria-hidden />
                        {sale.due_date ? `vence ${formatDateBR(sale.due_date)}` : 'sem vencimento'}
                        {s && sale.due_date === s.next_due_day ? <Badge tone="accent" className="ml-1">dia {business.default_due_day}</Badge> : null}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Money cents={sale.balance_cents} className="text-sm font-semibold" />
                      <SaleStatusBadge sale={sale} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Vendas recentes"
            actions={
              <Button asChild variant="ghost" size="sm">
                <Link to="/vendas">
                  Ver todas <ArrowRight />
                </Link>
              </Button>
            }
          />
          <div className="p-2">
            {recent.isPending ? <LoadingBlock rows={3} /> : null}
            {recent.isError && !recent.data ? <ErrorState error={recent.error} onRetry={() => void recent.refetch()} /> : null}
            {recent.data && recent.data.length === 0 ? (
              <EmptyState
                title="Nenhuma venda ainda"
                description="Registre a primeira venda ou importe a planilha antiga."
                className="border-0"
                action={
                  can('write') ? (
                    <Button asChild size="sm">
                      <Link to="/vendas/nova">
                        <Plus /> Nova venda
                      </Link>
                    </Button>
                  ) : null
                }
              />
            ) : null}
            <ul className="divide-y divide-line">
              {recent.data?.map((sale) => (
                <li key={sale.id}>
                  <Link to={`/vendas/${sale.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-subtle">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{sale.customer_name ?? 'Sem cliente'}</p>
                      <p className="truncate text-xs text-muted">
                        {formatDateBR(sale.sale_date)} · {sale.items_summary}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Money cents={sale.total_cents} className={sale.status === 'cancelled' ? 'text-sm text-muted line-through' : 'text-sm font-semibold'} />
                      <SaleStatusBadge sale={sale} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>
    </Page>
  );
}
