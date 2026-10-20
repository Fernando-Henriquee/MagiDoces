import { ArrowLeft, Ban, CalendarClock, CheckCheck, HandCoins, Link2, Pencil, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ChargeButton } from '@/components/shared/charge-dialog';
import { Money } from '@/components/shared/money';
import { ReasonDialog } from '@/components/shared/reason-dialog';
import { SaleStatusBadge, SelfServiceBadges } from '@/components/shared/sale-status';
import { Page, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog, Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { useCancelSale, useChangeDueDate, useConfirmPending, useReceivables, useSale, useSaleAudit, useVoidPayment } from '@/data/sales';
import { useReviewSale } from '@/data/storefront';
import { paymentMethodLabel, type PaymentRow } from '@/data/types';
import { useBusiness } from '@/features/business/business-context';
import { formatDateBR, formatDateTimeBR } from '@/lib/dates';
import { formatBRL, formatQuantity } from '@/lib/money';
import { groupByCustomer } from '@/lib/receivables';
import { formatPhoneBR } from '@/lib/whatsapp';
import { PaymentDialog } from './payment-dialog';

const AUDIT_LABELS: Record<string, string> = {
  'sale.created': 'Venda registrada',
  'sale.updated': 'Venda editada',
  'sale.cancelled': 'Venda cancelada',
  'sale.due_date_changed': 'Vencimento alterado',
  'payment.created': 'Recebimento registrado',
  'payment.refunded': 'Reembolso registrado',
  'payment.voided': 'Lançamento estornado',
  'sale.reviewed': 'Revisada',
  'sale.customer_reported_paid': 'Cliente avisou pelo link que pagou',
};

const PAYMENT_CHOICE_LABELS = { now: 'agora (PIX)', due_day: 'no dia padrão de vencimento', date: 'em data escolhida' } as const;

function costSourceLabel(source: string | null) {
  if (source === 'recipe') return 'receita';
  if (source === 'manual') return 'manual';
  if (source === 'import_current') return 'estimado na importação';
  return 'sem custo';
}

export function SaleDetailPage() {
  const { id } = useParams();
  const { can, business, today } = useBusiness();
  const query = useSale(id);
  const receivables = useReceivables();
  const audit = useSaleAudit(id, can('audit'));
  const cancel = useCancelSale();
  const voidPayment = useVoidPayment();
  const changeDue = useChangeDueDate();
  const confirmPending = useConfirmPending();
  const review = useReviewSale();
  const [paying, setPaying] = useState<'receipt' | 'refund' | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [paymentAction, setPaymentAction] = useState<'void' | 'refund'>('refund');
  const [voiding, setVoiding] = useState<PaymentRow | null>(null);
  const [editingDue, setEditingDue] = useState(false);
  const [newDue, setNewDue] = useState('');
  const [confirming, setConfirming] = useState(false);

  if (query.isPending) return <Page><LoadingBlock /></Page>;
  if (query.isError || !query.data) return <Page><ErrorState error={query.error} onRetry={() => void query.refetch()} /></Page>;
  const { sale, items, payments } = query.data;
  const active = sale.status === 'active';
  const writable = can('write') && active;
  const customerGroup = sale.customer_id ? groupByCustomer((receivables.data ?? []).filter((s) => s.customer_id === sale.customer_id))[0] : undefined;
  const knownCost = items.every((i) => i.unit_cost_cents !== null);

  return (
    <Page className="max-w-5xl">
      <PageHeader
        back={
          <Link to="/vendas" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ArrowLeft className="size-4" /> Vendas
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            Venda de {formatDateBR(sale.sale_date)}
            <SaleStatusBadge sale={sale} />
            <SelfServiceBadges sale={sale} />
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {sale.customer_id ? (
              <Link to={`/clientes/${sale.customer_id}`} className="font-medium text-accent-ink hover:underline">
                {sale.customer_name}
              </Link>
            ) : (
              <span>Sem cliente identificado</span>
            )}
            {sale.due_date ? <span>Vencimento {formatDateBR(sale.due_date)}</span> : <span>Sem vencimento</span>}
            {sale.source === 'import' ? <Badge tone="info">importada</Badge> : null}
            {sale.source === 'self_service' ? <Badge tone="accent">anotada pela cliente</Badge> : null}
          </span>
        }
        actions={
          writable ? (
            <>
              {sale.balance_cents > 0 ? (
                <Button onClick={() => setPaying('receipt')}>
                  <HandCoins /> Receber
                </Button>
              ) : null}
              {customerGroup ? <ChargeButton group={customerGroup} size="md" /> : null}
              <Button asChild variant="outline">
                <Link to={`/vendas/${sale.id}/editar`}>
                  <Pencil /> Editar
                </Link>
              </Button>
            </>
          ) : null
        }
      />

      {sale.status === 'cancelled' ? (
        <div role="status" className="mb-4 rounded-lg border border-line-strong bg-subtle px-4 py-3 text-sm">
          <p className="font-medium">Venda cancelada em {formatDateTimeBR(sale.cancelled_at, business.timezone)}.</p>
          <p className="text-muted">Motivo: {sale.cancel_reason}</p>
        </div>
      ) : null}

      {sale.source === 'self_service' && sale.self_service_contact ? (
        <div role="status" className="mb-4 space-y-2 rounded-lg border border-accent/60 bg-accent-soft px-4 py-3 text-sm text-ink">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="flex items-start gap-2">
              <Link2 className="mt-0.5 size-4 shrink-0 text-accent-ink" aria-hidden />
              <span>
                <strong>Anotada pela própria cliente no link de compras.</strong> Ela se identificou como “{sale.self_service_contact.name}”,{' '}
                {formatPhoneBR(sale.self_service_contact.phone)}, e escolheu pagar {PAYMENT_CHOICE_LABELS[sale.self_service_contact.payment]}.
                {sale.self_service_review_pending ? ' Confira produtos e quantidades: edite ou cancele se algo não bater.' : ''}
              </span>
            </p>
            {writable && sale.self_service_review_pending ? (
              <Button size="sm" variant="outline" loading={review.isPending} onClick={() => review.mutate({ saleId: sale.id })}>
                <CheckCheck /> Marcar como revisada
              </Button>
            ) : null}
          </div>
          {sale.customer_reported_paid_at && sale.balance_cents > 0 && active ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-accent/40 pt-2">
              <p>
                A cliente avisou em {formatDateTimeBR(sale.customer_reported_paid_at, business.timezone)} que já pagou. Confira no banco e registre o recebimento.
              </p>
              {writable ? (
                <Button size="sm" onClick={() => setPaying('receipt')}>
                  <HandCoins /> Registrar recebimento
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {sale.payment_confirmation_pending && active ? (
        <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-info/30 bg-info-soft px-4 py-3 text-sm text-info">
          <p>
            <strong>Pagamento a confirmar.</strong> Esta venda foi importada sem informação de pagamento. Registre o recebimento se já foi pago, ou confirme que está em aberto.
          </p>
          {writable ? (
            <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
              <CheckCheck /> Está em aberto
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Itens" description="Preço e custo gravados no momento da venda." />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Itens da venda</caption>
              <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2">Produto</th>
                  <th scope="col" className="px-2 py-2 text-right">Qtd.</th>
                  <th scope="col" className="px-2 py-2 text-right">Preço</th>
                  <th scope="col" className="hidden px-2 py-2 text-right sm:table-cell">Desconto</th>
                  <th scope="col" className="px-4 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium">{item.product_name}</p>
                      <p className="text-xs text-muted">
                        custo {item.unit_cost_cents === null ? 'não informado' : `${formatBRL(item.unit_cost_cents)}/${item.unit}`} · {costSourceLabel(item.cost_source)}
                        {item.price_inferred ? ' · preço inferido na importação' : ''}
                      </p>
                    </td>
                    <td className="num px-2 py-2.5 text-right">
                      {formatQuantity(item.quantity)} {item.unit}
                    </td>
                    <td className="px-2 py-2.5 text-right"><Money cents={item.unit_price_cents} /></td>
                    <td className="hidden px-2 py-2.5 text-right sm:table-cell">{item.discount_cents ? <Money cents={-item.discount_cents} /> : '—'}</td>
                    <td className="px-4 py-2.5 text-right font-medium"><Money cents={item.line_total_cents} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sale.notes ? <p className="border-t border-line px-4 py-3 text-sm text-ink-soft">{sale.notes}</p> : null}
        </Card>

        <Card className="h-fit">
          <CardHeader title="Valores" />
          <dl className="space-y-1.5 p-4 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Itens</dt><dd><Money cents={sale.items_subtotal_cents} /></dd></div>
            {sale.items_discount_cents > 0 ? <div className="flex justify-between"><dt className="text-muted">Descontos nos itens</dt><dd><Money cents={-sale.items_discount_cents} /></dd></div> : null}
            {sale.discount_cents > 0 ? <div className="flex justify-between"><dt className="text-muted">Desconto na venda</dt><dd><Money cents={-sale.discount_cents} /></dd></div> : null}
            <div className="flex justify-between border-t border-line pt-2 text-base font-semibold"><dt>Total</dt><dd><Money cents={sale.total_cents} /></dd></div>
            <div className="flex justify-between"><dt className="text-muted">Recebido</dt><dd><Money cents={sale.received_cents} className="text-success" /></dd></div>
            {sale.refunded_cents > 0 ? <div className="flex justify-between"><dt className="text-muted">Reembolsado</dt><dd><Money cents={-sale.refunded_cents} /></dd></div> : null}
            <div className="flex justify-between text-base font-semibold"><dt>Saldo</dt><dd><Money cents={sale.balance_cents} className={sale.is_overdue ? 'text-danger' : ''} /></dd></div>
            <div className="flex justify-between border-t border-line pt-2 text-xs text-muted">
              <dt>Custo estimado</dt>
              <dd>{knownCost ? formatBRL(sale.cost_total_cents) : `${formatBRL(sale.cost_total_cents)} (${sale.items_without_cost} sem custo)`}</dd>
            </div>
          </dl>
          {writable ? (
            <div className="flex flex-col gap-2 border-t border-line p-4">
              <Button variant="outline" size="sm" onClick={() => { setNewDue(sale.due_date ?? ''); setEditingDue(true); }}>
                <CalendarClock /> Alterar vencimento
              </Button>
              {sale.net_paid_cents > 0 ? (
                <Button variant="outline" size="sm" onClick={() => setPaying('refund')}>
                  <Undo2 /> Registrar reembolso
                </Button>
              ) : null}
              <Button variant="danger-outline" size="sm" onClick={() => setCancelling(true)}>
                <Ban /> Cancelar venda
              </Button>
            </div>
          ) : null}
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Recebimentos" description="Cada movimentação tem seu próprio registro; estornos ficam no histórico." />
        <div className="p-2">
          {payments.length === 0 ? <EmptyState title="Nenhum recebimento" description="Use “Receber” para registrar pagamentos totais ou parciais." className="border-0" /> : null}
          <ul className="divide-y divide-line">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-2 py-2.5">
                <div className={p.voided_at ? 'min-w-0 flex-1 opacity-60' : 'min-w-0 flex-1'}>
                  <p className="text-sm font-medium">
                    {p.kind === 'refund' ? 'Reembolso' : 'Recebimento'} · {formatDateBR(p.paid_on)} · {paymentMethodLabel(p.method)}
                    {p.is_inferred ? <Badge tone="info" className="ml-2">data inferida</Badge> : null}
                  </p>
                  <p className="text-xs text-muted">
                    {p.received_by_name ? `por ${p.received_by_name}` : ''} {p.notes ? `· ${p.notes}` : ''}
                  </p>
                  {p.voided_at ? (
                    <p className="text-xs text-danger">
                      Estornado em {formatDateTimeBR(p.voided_at, business.timezone)}
                      {p.voided_by_name ? ` por ${p.voided_by_name}` : ''}: {p.void_reason}
                    </p>
                  ) : null}
                </div>
                <Money cents={p.kind === 'refund' ? -p.amount_cents : p.amount_cents} className={p.voided_at ? 'text-sm line-through opacity-60' : 'text-sm font-semibold'} />
                {can('write') && !p.voided_at ? (
                  <Button variant="ghost" size="sm" onClick={() => setVoiding(p)}>
                    Estornar
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </Card>

      {audit.data && audit.data.length > 0 ? (
        <Card className="mt-4">
          <CardHeader title="Histórico" description="Registro de auditoria desta venda (somente leitura)." />
          <ol className="divide-y divide-line px-4">
            {audit.data.map((entry) => (
              <li key={entry.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                <span>
                  {entry.action === 'sale.created' && sale.source === 'self_service'
                    ? 'Anotada pela cliente no link de compras'
                    : (AUDIT_LABELS[entry.action] ?? entry.action)}
                </span>
                <span className="text-xs text-muted">
                  {formatDateTimeBR(entry.occurred_at, business.timezone)}
                  {entry.actor_name ? ` · ${entry.actor_name}` : entry.actor_id === null && sale.source === 'self_service' ? ' · pela cliente' : ''}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      {paying ? <PaymentDialog sale={sale} kind={paying} open onOpenChange={(open) => !open && setPaying(null)} /> : null}

      <ReasonDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title="Cancelar venda?"
        description="A venda deixa de contar no faturamento e nas contas a receber. Ela continua visível, com motivo e autor."
        confirmLabel="Cancelar venda"
        reasonLabel="Motivo do cancelamento"
        onConfirm={(reason) => cancel.mutateAsync({ saleId: sale.id, reason, paymentAction: sale.net_paid_cents > 0 ? paymentAction : 'none' })}
      >
        {sale.net_paid_cents > 0 ? (
          <fieldset className="space-y-2 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm">
            <legend className="px-1 font-medium text-warning">Esta venda tem {formatBRL(sale.net_paid_cents)} recebidos</legend>
            <label className="flex items-start gap-2">
              <input type="radio" name="payment-action" checked={paymentAction === 'refund'} onChange={() => setPaymentAction('refund')} className="mt-1 accent-brand" />
              <span>
                <strong>O dinheiro foi devolvido ao cliente</strong>
                <br />
                <span className="text-xs text-muted">Registra um reembolso hoje (saída de caixa).</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="payment-action" checked={paymentAction === 'void'} onChange={() => setPaymentAction('void')} className="mt-1 accent-brand" />
              <span>
                <strong>Os recebimentos foram lançados por engano</strong>
                <br />
                <span className="text-xs text-muted">Estorna os lançamentos (como se não tivessem acontecido).</span>
              </span>
            </label>
          </fieldset>
        ) : null}
      </ReasonDialog>

      <ReasonDialog
        open={Boolean(voiding)}
        onOpenChange={(open) => !open && setVoiding(null)}
        title="Estornar lançamento?"
        description={voiding ? `${voiding.kind === 'refund' ? 'Reembolso' : 'Recebimento'} de ${formatBRL(voiding.amount_cents)} em ${formatDateBR(voiding.paid_on)}. Use para lançamentos feitos por engano; ele continuará no histórico.` : ''}
        confirmLabel="Estornar"
        onConfirm={(reason) => voidPayment.mutateAsync({ paymentId: voiding!.id, reason })}
      />

      <Dialog open={editingDue} onOpenChange={setEditingDue}>
        <DialogContent
          title="Alterar vencimento"
          size="sm"
          footer={
            <>
              <Button variant="outline" onClick={() => setEditingDue(false)}>Cancelar</Button>
              <Button
                loading={changeDue.isPending}
                disabled={Boolean(newDue) && newDue < sale.sale_date}
                onClick={() => changeDue.mutate({ saleId: sale.id, dueDate: newDue || null }, { onSuccess: () => setEditingDue(false) })}
              >
                Salvar
              </Button>
            </>
          }
        >
          <Field label="Novo vencimento" hint="Deixe em branco para “sem vencimento”. A alteração fica registrada na auditoria.">
            <Input type="date" value={newDue} min={sale.sale_date} onChange={(e) => setNewDue(e.target.value)} />
          </Field>
          {newDue && newDue < today() ? <p className="mt-2 text-xs text-warning">A data escolhida já passou: a venda ficará como vencida.</p> : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Confirmar que está em aberto?"
        description="Use se a cliente ainda não pagou esta venda importada. Se já pagou, registre o recebimento."
        confirmLabel="Confirmar"
        tone="primary"
        onConfirm={() => confirmPending.mutateAsync({ saleId: sale.id })}
      />
    </Page>
  );
}
