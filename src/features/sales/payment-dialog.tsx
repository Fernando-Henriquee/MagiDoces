import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { useRegisterPayment, useRegisterRefund } from '@/data/sales';
import { PAYMENT_METHODS, type PaymentMethod, type SaleRow } from '@/data/types';
import { useBusiness } from '@/features/business/business-context';
import { useOnline } from '@/lib/connectivity';
import { formatDateBR } from '@/lib/dates';
import { formatBRL } from '@/lib/money';
import { useRequestId } from '@/lib/use-request-id';

interface PaymentDialogProps {
  sale: Pick<SaleRow, 'id' | 'customer_name' | 'sale_date' | 'total_cents' | 'net_paid_cents' | 'balance_cents' | 'payment_method'>;
  kind: 'receipt' | 'refund';
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Recebimento (total ou parcial) ou reembolso de uma venda. Idempotente.
 * Monte o componente só quando for abrir: o estado inicial vem da venda atual.
 */
export function PaymentDialog({ sale, kind, open, onOpenChange }: PaymentDialogProps) {
  const { today } = useBusiness();
  const online = useOnline();
  const receipt = useRegisterPayment();
  const refund = useRegisterRefund();
  const mutation = kind === 'receipt' ? receipt : refund;
  const [requestId, renew] = useRequestId();
  const limit = kind === 'receipt' ? sale.balance_cents : sale.net_paid_cents;
  const [amount, setAmount] = useState<number | null>(limit);
  const [paidOn, setPaidOn] = useState(today());
  const [method, setMethod] = useState<PaymentMethod>(sale.payment_method ?? 'pix');
  const [notes, setNotes] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const errors: string[] = [];
  if (!amount || amount <= 0) errors.push('Informe um valor maior que zero.');
  else if (amount > limit) errors.push(kind === 'receipt' ? `O valor não pode passar do saldo (${formatBRL(limit)}).` : `O reembolso não pode passar do recebido (${formatBRL(limit)}).`);
  if (!paidOn) errors.push('Informe a data.');
  else if (paidOn > today()) errors.push('A data não pode estar no futuro.');
  if (kind === 'refund' && notes.trim().length < 3) errors.push('Informe o motivo do reembolso.');

  const submit = () => {
    setSubmitted(true);
    if (errors.length > 0) return;
    mutation.mutate(
      { saleId: sale.id, requestId, amountCents: amount!, paidOn, method, notes: notes.trim() || null },
      {
        onSuccess: () => {
          renew();
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={kind === 'receipt' ? 'Registrar recebimento' : 'Registrar reembolso'}
        description={`${sale.customer_name ?? 'Sem cliente'} · venda de ${formatDateBR(sale.sale_date)} · total ${formatBRL(sale.total_cents)}`}
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button loading={mutation.isPending} disabled={!online} onClick={submit}>
              {kind === 'receipt' ? 'Confirmar recebimento' : 'Confirmar reembolso'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="rounded-lg bg-subtle px-3 py-2 text-sm">
            {kind === 'receipt' ? (
              <>
                Saldo devedor: <strong>{formatBRL(sale.balance_cents)}</strong> · já recebido {formatBRL(sale.net_paid_cents)}
              </>
            ) : (
              <>
                Recebido até agora: <strong>{formatBRL(sale.net_paid_cents)}</strong>. O reembolso é uma saída de caixa na data informada.
              </>
            )}
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Valor" required hint={kind === 'receipt' && amount !== null && amount < limit ? `Restará ${formatBRL(limit - amount)} em aberto.` : undefined}>
              <MoneyInput value={amount} onValueChange={setAmount} autoFocus />
            </Field>
            <Field label={kind === 'receipt' ? 'Data do recebimento' : 'Data da devolução'} required>
              <Input type="date" value={paidOn} max={today()} onChange={(e) => setPaidOn(e.target.value)} />
            </Field>
            <Field label="Forma" required>
              <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label={kind === 'refund' ? 'Motivo' : 'Observação (opcional)'} required={kind === 'refund'}>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </Field>
          {submitted && errors.length > 0 ? (
            <ul role="alert" className="space-y-1 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
          {!online ? <p className="text-xs text-warning">Sem conexão: não é possível gravar agora.</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
