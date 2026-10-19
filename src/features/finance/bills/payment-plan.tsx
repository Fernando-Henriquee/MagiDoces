import { Money } from '@/components/shared/money';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { PAYMENT_METHODS, type PaymentMethod } from '@/data/types';
import type { PaymentPlan, PlanMode } from '@/data/payables';
import { cn } from '@/lib/cn';
import { formatDateBR } from '@/lib/dates';
import { previewInstallments } from './bill-calc';

export interface PlanValue {
  mode: PlanMode;
  paidOn: string;
  method: PaymentMethod | '';
  dueDate: string;
  count: number;
  firstDueDate: string;
}

const MODES: Array<{ value: PlanMode; label: string; description: string }> = [
  { value: 'paid', label: 'Paga agora', description: 'Registra o pagamento do total.' },
  { value: 'pending', label: 'A pagar', description: 'Fica em aberto até o vencimento.' },
  { value: 'installments', label: 'Parcelada', description: 'Gera parcelas previstas mensais.' },
];

/** Erros do plano (o banco revalida). */
export function planErrors(plan: PlanValue, totalCents: number, today: string): Partial<Record<keyof PlanValue, string>> {
  const errors: Partial<Record<keyof PlanValue, string>> = {};
  if (plan.mode === 'paid') {
    if (!plan.paidOn) errors.paidOn = 'Informe a data do pagamento.';
    else if (plan.paidOn > today) errors.paidOn = 'A data do pagamento não pode estar no futuro.';
    if (!plan.method) errors.method = 'Informe a forma de pagamento.';
  }
  if (plan.mode === 'installments') {
    if (!Number.isInteger(plan.count) || plan.count < 2 || plan.count > 60) errors.count = 'Escolha de 2 a 60 parcelas.';
    else if (totalCents > 0 && totalCents < plan.count) errors.count = 'Total pequeno demais para este número de parcelas.';
    if (!plan.firstDueDate) errors.firstDueDate = 'Informe o 1º vencimento.';
  }
  return errors;
}

/** Converte o plano do formulário no formato da RPC e no vencimento do documento. */
export function planToPayload(plan: PlanValue): { plan: PaymentPlan; dueDate: string | null } {
  switch (plan.mode) {
    case 'paid':
      return { plan: { mode: 'paid', paid_on: plan.paidOn, method: plan.method || null }, dueDate: null };
    case 'installments':
      return {
        plan: { mode: 'installments', count: plan.count, first_due_date: plan.firstDueDate, method: plan.method || null },
        dueDate: plan.firstDueDate || null,
      };
    default:
      return { plan: { mode: 'pending' }, dueDate: plan.dueDate || null };
  }
}

interface PaymentPlanFieldsProps {
  value: PlanValue;
  onChange: (value: PlanValue) => void;
  totalCents: number;
  errors: Partial<Record<keyof PlanValue, string>>;
  showErrors: boolean;
}

export function PaymentPlanFields({ value, onChange, totalCents, errors, showErrors }: PaymentPlanFieldsProps) {
  const set = (patch: Partial<PlanValue>) => onChange({ ...value, ...patch });
  const preview = value.mode === 'installments' && value.firstDueDate ? previewInstallments(totalCents, value.count, value.firstDueDate) : null;
  const err = (key: keyof PlanValue) => (showErrors ? errors[key] : undefined);
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium text-ink-soft">Pagamento</legend>
      <div role="radiogroup" aria-label="Como foi ou será pago" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {MODES.map((mode) => (
          <label
            key={mode.value}
            className={cn(
              'flex cursor-pointer flex-col rounded-lg border px-3 py-2 text-sm transition-colors',
              value.mode === mode.value ? 'border-brand bg-accent-soft/60' : 'border-line-strong bg-panel hover:bg-subtle',
            )}
          >
            <span className="flex items-center gap-2 font-medium text-ink">
              <input
                type="radio"
                name="plan-mode"
                value={mode.value}
                checked={value.mode === mode.value}
                onChange={() => set({ mode: mode.value })}
                className="accent-brand"
              />
              {mode.label}
            </span>
            <span className="pl-5 text-xs text-muted">{mode.description}</span>
          </label>
        ))}
      </div>

      {value.mode === 'paid' ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Data do pagamento" required error={err('paidOn')}>
            <Input type="date" value={value.paidOn} onChange={(e) => set({ paidOn: e.target.value })} />
          </Field>
          <Field label="Forma de pagamento" required error={err('method')}>
            <Select value={value.method} onChange={(e) => set({ method: e.target.value as PaymentMethod | '' })}>
              <option value="">Selecione…</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : null}

      {value.mode === 'pending' ? (
        <Field label="Vencimento" hint="Opcional. Sem vencimento, a conta aparece em aberto sem data prevista.">
          <Input type="date" value={value.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />
        </Field>
      ) : null}

      {value.mode === 'installments' ? (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Parcelas" required error={err('count')}>
              <Input
                type="number"
                inputMode="numeric"
                min={2}
                max={60}
                value={Number.isFinite(value.count) ? value.count : ''}
                onChange={(e) => set({ count: Number.parseInt(e.target.value, 10) })}
              />
            </Field>
            <Field label="1º vencimento" required error={err('firstDueDate')}>
              <Input type="date" value={value.firstDueDate} onChange={(e) => set({ firstDueDate: e.target.value })} />
            </Field>
            <Field label="Forma prevista">
              <Select value={value.method} onChange={(e) => set({ method: e.target.value as PaymentMethod | '' })}>
                <option value="">Definir ao pagar</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {preview ? (
            <div className="rounded-lg border border-line bg-subtle/60 p-3">
              <p className="mb-2 text-xs font-medium text-muted">Prévia das parcelas (diferença de centavos fica na 1ª)</p>
              <ol className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                {preview.map((p) => (
                  <li key={p.number} className="flex justify-between gap-3">
                    <span className="text-ink-soft">
                      {p.number}ª · {formatDateBR(p.dueDate)}
                    </span>
                    <Money cents={p.amountCents} />
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
}
