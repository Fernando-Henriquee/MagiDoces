import { CalendarClock, CircleCheck, Plus, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Money } from '@/components/shared/money';
import { ReasonDialog } from '@/components/shared/reason-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog, Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { EmptyState } from '@/components/ui/states';
import { useAddBillPayment, useCancelBill, usePayInstallment, useVoidBillPayment } from '@/data/payables';
import { type BillKind, type BillPaymentRow, PAYMENT_METHODS, type PaymentMethod, paymentMethodLabel } from '@/data/types';
import { useBusiness } from '@/features/business/business-context';
import { cn } from '@/lib/cn';
import { formatDateBR, formatDateTimeBR } from '@/lib/dates';
import { formatBRL } from '@/lib/money';
import { useRequestId } from '@/lib/use-request-id';

export interface BillSummary {
  kind: BillKind;
  id: string;
  status: 'active' | 'cancelled';
  totalCents: number;
  paidCents: number;
  scheduledCents: number;
  unscheduledCents: number;
  paymentMethod: PaymentMethod | null;
}

function MethodSelect({ value, onChange, allowEmpty }: { value: PaymentMethod | ''; onChange: (v: PaymentMethod | '') => void; allowEmpty?: string }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value as PaymentMethod | '')}>
      {allowEmpty !== undefined ? <option value="">{allowEmpty}</option> : null}
      {PAYMENT_METHODS.map((m) => (
        <option key={m.value} value={m.value}>
          {m.label}
        </option>
      ))}
    </Select>
  );
}

function PayInstallmentDialog({ payment, defaultMethod, onClose }: { payment: BillPaymentRow; defaultMethod: PaymentMethod; onClose: () => void }) {
  const { today } = useBusiness();
  const [paidOn, setPaidOn] = useState(today());
  const [method, setMethod] = useState<PaymentMethod | ''>(payment.method ?? defaultMethod);
  const pay = usePayInstallment();
  const error = !paidOn ? 'Informe a data.' : paidOn > today() ? 'A data não pode estar no futuro.' : null;
  return (
    <Dialog open onOpenChange={(open) => !open && !pay.isPending && onClose()}>
      <DialogContent
        title={`Pagar ${payment.installment_number ? `${payment.installment_number}ª parcela` : 'parcela prevista'}`}
        description={`${formatBRL(payment.amount_cents)}${payment.due_date ? ` · vencimento ${formatDateBR(payment.due_date)}` : ''}`}
        footer={
          <>
            <Button variant="outline" onClick={onClose} disabled={pay.isPending}>
              Voltar
            </Button>
            <Button
              loading={pay.isPending}
              disabled={Boolean(error) || !method}
              onClick={() => {
                if (pay.isPending || error || !method) return;
                pay.mutate({ billPaymentId: payment.id, paidOn, method }, { onSuccess: onClose });
              }}
            >
              <CircleCheck /> Confirmar pagamento
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Data do pagamento" required error={error}>
            <Input type="date" value={paidOn} max={today()} onChange={(e) => setPaidOn(e.target.value)} />
          </Field>
          <Field label="Forma de pagamento" required>
            <MethodSelect value={method} onChange={setMethod} />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddPaymentDialog({ bill, onClose }: { bill: BillSummary; onClose: () => void }) {
  const { today } = useBusiness();
  const [requestId] = useRequestId();
  const [type, setType] = useState<'paid' | 'scheduled'>('paid');
  const [amount, setAmount] = useState<number | null>(bill.unscheduledCents);
  const [date, setDate] = useState(today());
  const [method, setMethod] = useState<PaymentMethod | ''>(bill.paymentMethod ?? 'pix');
  const [notes, setNotes] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const add = useAddBillPayment();

  const amountError =
    amount === null || amount <= 0
      ? 'Informe um valor maior que zero.'
      : amount > bill.unscheduledCents
        ? `O valor máximo sem parcela definida é ${formatBRL(bill.unscheduledCents)}.`
        : null;
  const dateError = !date ? 'Informe a data.' : type === 'paid' && date > today() ? 'A data do pagamento não pode estar no futuro.' : null;
  const methodError = type === 'paid' && !method ? 'Informe a forma de pagamento.' : null;
  const invalid = Boolean(amountError || dateError || methodError);

  return (
    <Dialog open onOpenChange={(open) => !open && !add.isPending && onClose()}>
      <DialogContent
        title="Lançar pagamento"
        description={`Saldo sem parcela definida: ${formatBRL(bill.unscheduledCents)}`}
        footer={
          <>
            <Button variant="outline" onClick={onClose} disabled={add.isPending}>
              Voltar
            </Button>
            <Button
              loading={add.isPending}
              onClick={() => {
                setSubmitted(true);
                if (invalid || add.isPending || amount === null) return;
                add.mutate(
                  {
                    kind: bill.kind,
                    billId: bill.id,
                    requestId,
                    amountCents: amount,
                    paidOn: type === 'paid' ? date : null,
                    dueDate: type === 'scheduled' ? date : null,
                    method: method || null,
                    notes: notes.trim() || null,
                  },
                  { onSuccess: onClose },
                );
              }}
            >
              Salvar
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div role="radiogroup" aria-label="Tipo de lançamento" className="grid grid-cols-2 gap-2">
            {(
              [
                ['paid', 'Pagamento realizado'],
                ['scheduled', 'Parcela prevista'],
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium',
                  type === value ? 'border-brand bg-accent-soft/60' : 'border-line-strong hover:bg-subtle',
                )}
              >
                <input type="radio" name="payment-type" checked={type === value} onChange={() => setType(value)} className="accent-brand" />
                {label}
              </label>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Valor" required error={submitted ? amountError : null}>
              <MoneyInput value={amount} onValueChange={setAmount} />
            </Field>
            <Field label={type === 'paid' ? 'Data do pagamento' : 'Vencimento'} required error={submitted ? dateError : null}>
              <Input type="date" value={date} max={type === 'paid' ? today() : undefined} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Forma de pagamento" required={type === 'paid'} error={submitted ? methodError : null}>
              <MethodSelect value={method} onChange={setMethod} allowEmpty={type === 'scheduled' ? 'Definir ao pagar' : undefined} />
            </Field>
          </div>
          <Field label="Observação">
            <Textarea value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function paymentState(payment: BillPaymentRow): { label: string; tone: 'success' | 'info' | 'danger' | 'neutral' } {
  if (payment.voided_at) return { label: 'Estornado', tone: 'neutral' };
  if (payment.paid_on) return { label: 'Pago', tone: 'success' };
  if (payment.is_overdue) return { label: 'Vencida', tone: 'danger' };
  return { label: 'Prevista', tone: 'info' };
}

/** Histórico de pagamentos e parcelas, com as ações de pagar, lançar e estornar. */
export function BillPaymentsPanel({ bill, payments, canWrite }: { bill: BillSummary; payments: BillPaymentRow[]; canWrite: boolean }) {
  const { business } = useBusiness();
  const [paying, setPaying] = useState<BillPaymentRow | null>(null);
  const [voiding, setVoiding] = useState<BillPaymentRow | null>(null);
  const [adding, setAdding] = useState(false);
  const voidPayment = useVoidBillPayment();
  const active = bill.status === 'active';

  return (
    <Card>
      <CardHeader
        title="Pagamentos e parcelas"
        description={`Pago ${formatBRL(bill.paidCents)} · previsto ${formatBRL(bill.scheduledCents)} · sem parcela ${formatBRL(bill.unscheduledCents)}`}
        actions={
          canWrite && active && bill.unscheduledCents > 0 ? (
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus /> Lançar pagamento
            </Button>
          ) : null
        }
      />
      <div className="p-2">
        {payments.length === 0 ? (
          <EmptyState
            className="border-0"
            title="Nenhum pagamento lançado"
            description={active ? 'Lance um pagamento realizado ou uma parcela prevista.' : undefined}
          />
        ) : (
          <ul className="divide-y divide-line">
            {payments.map((payment) => {
              const state = paymentState(payment);
              const voided = Boolean(payment.voided_at);
              return (
                <li key={payment.id} className="flex flex-wrap items-center gap-3 px-2 py-3">
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-sm font-medium', voided && 'text-muted line-through')}>
                      {payment.installment_number ? `${payment.installment_number}ª parcela` : payment.paid_on ? 'Pagamento' : 'Parcela prevista'}
                      {payment.paid_on
                        ? ` · pago em ${formatDateBR(payment.paid_on)} (${paymentMethodLabel(payment.method)})`
                        : payment.due_date
                          ? ` · vence ${formatDateBR(payment.due_date)}`
                          : ''}
                    </p>
                    <p className="text-xs text-muted">
                      {payment.paid_by_name ? `Registrado por ${payment.paid_by_name}` : null}
                      {payment.notes ? `${payment.paid_by_name ? ' · ' : ''}${payment.notes}` : null}
                    </p>
                    {voided ? (
                      <p className="text-xs text-muted">
                        Estornado em {formatDateTimeBR(payment.voided_at, business.timezone)} — {payment.void_reason}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={state.tone}>{state.label}</Badge>
                    <Money cents={payment.amount_cents} className={cn('text-sm font-semibold', voided && 'text-muted line-through')} />
                  </div>
                  {canWrite && active && !voided ? (
                    <div className="flex w-full justify-end gap-1 sm:w-auto">
                      {!payment.paid_on ? (
                        <Button size="sm" onClick={() => setPaying(payment)}>
                          <CalendarClock /> Pagar
                        </Button>
                      ) : null}
                      <Button size="sm" variant="ghost" onClick={() => setVoiding(payment)}>
                        <Undo2 /> Estornar
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {paying ? <PayInstallmentDialog payment={paying} defaultMethod={bill.paymentMethod ?? 'pix'} onClose={() => setPaying(null)} /> : null}
      {adding ? <AddPaymentDialog bill={bill} onClose={() => setAdding(false)} /> : null}
      <ReasonDialog
        open={voiding !== null}
        onOpenChange={(open) => !open && setVoiding(null)}
        title="Estornar lançamento"
        description={
          voiding
            ? `${voiding.paid_on ? 'O pagamento' : 'A parcela prevista'} de ${formatBRL(voiding.amount_cents)} deixa de contar nos totais, mas continua visível no histórico.`
            : ''
        }
        confirmLabel="Estornar"
        reasonLabel="Motivo do estorno"
        onConfirm={async (reason) => {
          if (voiding) await voidPayment.mutateAsync({ billPaymentId: voiding.id, reason });
        }}
      />
    </Card>
  );
}

/** Cancelamento rastreável; pagamentos realizados exigem estorno explícito. */
export function CancelBillDialog({
  open,
  onOpenChange,
  bill,
  onCancelled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bill: BillSummary;
  onCancelled?: () => void;
}) {
  const [reason, setReason] = useState('');
  const [voidPayments, setVoidPayments] = useState(false);
  const cancel = useCancelBill();
  const label = bill.kind === 'purchase' ? 'compra' : 'despesa';
  const needsVoid = bill.paidCents > 0;
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setReason('');
          setVoidPayments(false);
        }
        onOpenChange(next);
      }}
      title={`Cancelar ${label}`}
      description={`A ${label} deixa de contar nos totais e nas contas a pagar. O registro e o histórico continuam disponíveis.${
        bill.scheduledCents > 0 ? ` As parcelas previstas (${formatBRL(bill.scheduledCents)}) serão anuladas.` : ''
      }`}
      confirmLabel={`Cancelar ${label}`}
      confirmDisabled={reason.trim().length < 3 || (needsVoid && !voidPayments)}
      onConfirm={async () => {
        await cancel.mutateAsync({ kind: bill.kind, id: bill.id, reason: reason.trim(), voidPayments });
        onCancelled?.();
      }}
    >
      <div className="space-y-3">
        {needsVoid ? (
          <label className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
            <Checkbox checked={voidPayments} onChange={(e) => setVoidPayments(e.target.checked)} className="mt-0.5" />
            <span>
              Há <strong>{formatBRL(bill.paidCents)}</strong> em pagamentos realizados. Confirmo o estorno desses pagamentos (por exemplo,
              valor devolvido pelo fornecedor ou lançamento por engano).
            </span>
          </label>
        ) : null}
        <Field label="Motivo do cancelamento" required hint="Fica registrado no histórico.">
          <Textarea value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </ConfirmDialog>
  );
}
