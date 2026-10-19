import { diffInDays, formatDateBR, type ISODate } from './dates';

/**
 * Contas a receber: agrupamentos e filtros sobre as linhas de v_sales.
 * Saldo, situação e "vencida" vêm calculados do banco; aqui apenas organizamos.
 */

export type PaymentStatus = 'paid' | 'partial' | 'pending' | 'cancelled';

export interface ReceivableSale {
  id: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  sale_date: ISODate;
  due_date: ISODate | null;
  total_cents: number;
  net_paid_cents: number;
  balance_cents: number;
  payment_status: PaymentStatus;
  is_overdue: boolean;
  payment_confirmation_pending: boolean;
  items_summary: string | null;
  status: 'active' | 'cancelled';
}

export const NO_CUSTOMER_KEY = 'sem-cliente';

export interface CustomerGroup {
  key: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string | null;
  originalCents: number;
  receivedCents: number;
  balanceCents: number;
  overdueCents: number;
  nextDueDate: ISODate | null;
  sales: ReceivableSale[];
}

export function isOpen(sale: ReceivableSale): boolean {
  return sale.status === 'active' && sale.balance_cents > 0;
}

/** Consolida por cliente sem perder o detalhamento de cada venda. */
export function groupByCustomer(sales: ReceivableSale[]): CustomerGroup[] {
  const groups = new Map<string, CustomerGroup>();
  for (const sale of sales.filter(isOpen)) {
    const key = sale.customer_id ?? NO_CUSTOMER_KEY;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        customerId: sale.customer_id,
        customerName: sale.customer_name ?? 'Sem cliente identificado',
        customerPhone: sale.customer_phone,
        originalCents: 0,
        receivedCents: 0,
        balanceCents: 0,
        overdueCents: 0,
        nextDueDate: null,
        sales: [],
      };
      groups.set(key, group);
    }
    group.originalCents += sale.total_cents;
    group.receivedCents += sale.net_paid_cents;
    group.balanceCents += sale.balance_cents;
    if (sale.is_overdue) group.overdueCents += sale.balance_cents;
    if (sale.due_date && (group.nextDueDate === null || sale.due_date < group.nextDueDate)) {
      group.nextDueDate = sale.due_date;
    }
    group.sales.push(sale);
  }
  for (const group of groups.values()) {
    group.sales.sort(compareByDueThenDate);
  }
  return [...groups.values()].sort(
    (a, b) => b.overdueCents - a.overdueCents || b.balanceCents - a.balanceCents || a.customerName.localeCompare(b.customerName, 'pt-BR'),
  );
}

function compareByDueThenDate(a: ReceivableSale, b: ReceivableSale): number {
  const dueA = a.due_date ?? '9999-12-31';
  const dueB = b.due_date ?? '9999-12-31';
  return dueA.localeCompare(dueB) || a.sale_date.localeCompare(b.sale_date);
}

export interface DueGroup {
  key: string;
  label: string;
  dueDate: ISODate | null;
  kind: 'overdue' | 'today' | 'future' | 'none';
  balanceCents: number;
  sales: ReceivableSale[];
}

/** Agrupa por vencimento: vencidos, hoje, cada data futura, sem vencimento. */
export function groupByDueDate(sales: ReceivableSale[], today: ISODate): DueGroup[] {
  const groups = new Map<string, DueGroup>();
  const ensure = (key: string, init: () => DueGroup) => {
    let group = groups.get(key);
    if (!group) {
      group = init();
      groups.set(key, group);
    }
    return group;
  };
  for (const sale of sales.filter(isOpen)) {
    let group: DueGroup;
    if (!sale.due_date) {
      group = ensure('none', () => ({ key: 'none', label: 'Sem vencimento', dueDate: null, kind: 'none', balanceCents: 0, sales: [] }));
    } else if (sale.due_date < today) {
      group = ensure('overdue', () => ({ key: 'overdue', label: 'Vencidos', dueDate: null, kind: 'overdue', balanceCents: 0, sales: [] }));
    } else if (sale.due_date === today) {
      group = ensure('today', () => ({ key: 'today', label: 'Vencem hoje', dueDate: today, kind: 'today', balanceCents: 0, sales: [] }));
    } else {
      const due = sale.due_date;
      group = ensure(due, () => ({ key: due, label: formatDateBR(due), dueDate: due, kind: 'future', balanceCents: 0, sales: [] }));
    }
    group.balanceCents += sale.balance_cents;
    group.sales.push(sale);
  }
  const order = { overdue: 0, today: 1, future: 2, none: 3 } as const;
  for (const group of groups.values()) group.sales.sort(compareByDueThenDate);
  return [...groups.values()].sort(
    (a, b) => order[a.kind] - order[b.kind] || (a.dueDate ?? '').localeCompare(b.dueDate ?? ''),
  );
}

/** Contas em aberto que vencem exatamente na data (ex.: o próximo dia 10). */
export function dueOn(sales: ReceivableSale[], date: ISODate): ReceivableSale[] {
  return sales.filter((sale) => isOpen(sale) && sale.due_date === date);
}

/** Contas em aberto com vencimento em qualquer dia N do mês (ex.: todo dia 10). */
export function dueOnDayOfMonth(sales: ReceivableSale[], day: number): ReceivableSale[] {
  return sales.filter((sale) => isOpen(sale) && sale.due_date !== null && Number(sale.due_date.slice(8, 10)) === day);
}

export function sumBalance(sales: ReceivableSale[]): number {
  return sales.reduce((sum, sale) => sum + (isOpen(sale) ? sale.balance_cents : 0), 0);
}

export interface StatusInfo {
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info';
}

/** Rótulo de situação para exibição, combinando situação, vencimento e confirmação. */
export function describeStatus(sale: Pick<ReceivableSale, 'payment_status' | 'is_overdue' | 'due_date' | 'payment_confirmation_pending'>, today: ISODate): StatusInfo {
  if (sale.payment_status === 'cancelled') return { label: 'Cancelada', tone: 'neutral' };
  if (sale.payment_status === 'paid') return { label: 'Paga', tone: 'success' };
  if (sale.payment_confirmation_pending) return { label: 'A confirmar', tone: 'info' };
  if (sale.is_overdue) {
    const days = sale.due_date ? diffInDays(today, sale.due_date) : 0;
    const prefix = sale.payment_status === 'partial' ? 'Parcial · ' : '';
    return { label: `${prefix}Vencida há ${days} ${days === 1 ? 'dia' : 'dias'}`, tone: 'danger' };
  }
  if (sale.payment_status === 'partial') return { label: 'Parcial', tone: 'warning' };
  if (sale.due_date && sale.due_date > today) return { label: `Prevista ${formatDateBR(sale.due_date)}`, tone: 'info' };
  if (sale.due_date === today) return { label: 'Vence hoje', tone: 'warning' };
  return { label: 'Pendente', tone: 'warning' };
}
