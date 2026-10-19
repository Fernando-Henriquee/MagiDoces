import { supabase } from '@/lib/supabase';
import { rpc, unwrap } from './api';
import { useBusinessQuery, useWrite } from './hooks';
import { removeFile, uploadFile } from './storage';
import type { BillKind, BillPaymentRow, BillRow, ExpenseRow, PaymentMethod, PurchaseItemRow, PurchaseRow } from './types';

/**
 * Contas a pagar: compras de insumos (purchases), despesas operacionais (expenses)
 * e seus pagamentos/parcelas (bill_payments). Leitura pelas views (security_invoker);
 * escrita somente pelas RPCs, que recalculam totais e validam limites no banco.
 */

export type BillStatusFilter = 'all' | 'open' | 'overdue' | 'paid' | 'cancelled';

export interface BillFilters {
  from?: string;
  to?: string;
  status?: BillStatusFilter;
}

/** Em aberto e vencidas valem para qualquer data; os demais filtros respeitam o período. */
export function statusIgnoresPeriod(status: BillStatusFilter | undefined): boolean {
  return status === 'open' || status === 'overdue';
}

interface Filterable<Q> {
  gte(column: string, value: unknown): Q;
  lte(column: string, value: unknown): Q;
  gt(column: string, value: unknown): Q;
  eq(column: string, value: unknown): Q;
}

function applyBillFilters<Q extends Filterable<Q>>(query: Q, dateColumn: string, filters: BillFilters): Q {
  let q = query;
  if (!statusIgnoresPeriod(filters.status)) {
    if (filters.from) q = q.gte(dateColumn, filters.from);
    if (filters.to) q = q.lte(dateColumn, filters.to);
  }
  switch (filters.status) {
    case 'open':
      q = q.eq('status', 'active').gt('balance_cents', 0);
      break;
    case 'overdue':
      q = q.eq('is_overdue', true);
      break;
    case 'paid':
      q = q.eq('payment_status', 'paid');
      break;
    case 'cancelled':
      q = q.eq('status', 'cancelled');
      break;
    default:
      break;
  }
  return q;
}

// ── Compras ─────────────────────────────────────────────────────────────────

export function usePurchases(filters: BillFilters) {
  return useBusinessQuery(['purchases', 'list', filters], (businessId) => {
    const base = supabase.from('v_purchases').select('*').eq('business_id', businessId);
    return unwrap<PurchaseRow[]>(
      applyBillFilters(base, 'purchase_date', filters).order('purchase_date', { ascending: false }).order('created_at', { ascending: false }),
    );
  });
}

export interface PurchaseDetail {
  purchase: PurchaseRow;
  items: PurchaseItemRow[];
  payments: BillPaymentRow[];
}

export function usePurchase(purchaseId: string | undefined) {
  return useBusinessQuery(
    ['purchases', 'detail', purchaseId],
    async (): Promise<PurchaseDetail> => {
      const [purchase, items, payments] = await Promise.all([
        unwrap<PurchaseRow>(supabase.from('v_purchases').select('*').eq('id', purchaseId!).single()),
        unwrap<PurchaseItemRow[]>(supabase.from('purchase_items').select('*').eq('purchase_id', purchaseId!).order('position')),
        fetchBillPayments('purchase', purchaseId!),
      ]);
      return { purchase, items, payments };
    },
    { enabled: Boolean(purchaseId) },
  );
}

// ── Despesas ────────────────────────────────────────────────────────────────

export function useExpenses(filters: BillFilters) {
  return useBusinessQuery(['expenses', 'list', filters], (businessId) => {
    const base = supabase.from('v_expenses').select('*').eq('business_id', businessId);
    return unwrap<ExpenseRow[]>(
      applyBillFilters(base, 'expense_date', filters).order('expense_date', { ascending: false }).order('created_at', { ascending: false }),
    );
  });
}

export interface ExpenseDetail {
  expense: ExpenseRow;
  payments: BillPaymentRow[];
}

export function useExpense(expenseId: string | undefined) {
  return useBusinessQuery(
    ['expenses', 'detail', expenseId],
    async (): Promise<ExpenseDetail> => {
      const [expense, payments] = await Promise.all([
        unwrap<ExpenseRow>(supabase.from('v_expenses').select('*').eq('id', expenseId!).single()),
        fetchBillPayments('expense', expenseId!),
      ]);
      return { expense, payments };
    },
    { enabled: Boolean(expenseId) },
  );
}

// ── Pagamentos e contas em aberto ───────────────────────────────────────────

/** Pagamentos e parcelas de um compromisso, incluindo os estornados (histórico). */
export function fetchBillPayments(kind: BillKind, billId: string): Promise<BillPaymentRow[]> {
  return unwrap<BillPaymentRow[]>(
    supabase
      .from('v_bill_payments')
      .select('*')
      .eq(kind === 'purchase' ? 'purchase_id' : 'expense_id', billId)
      .order('installment_number', { ascending: true, nullsFirst: false })
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true }),
  );
}

/** Compras e despesas com saldo a pagar (posição atual, todas as datas). */
export function useOpenBills() {
  return useBusinessQuery(['bills', 'open'], (businessId) =>
    unwrap<BillRow[]>(
      supabase
        .from('v_bills')
        .select('*')
        .eq('business_id', businessId)
        .eq('status', 'active')
        .gt('balance_cents', 0)
        .order('is_overdue', { ascending: false })
        .order('next_due_date', { ascending: true, nullsFirst: false })
        .order('due_date', { ascending: true, nullsFirst: false }),
    ),
  );
}

/** Pagamentos realizados (por data de pagamento) no período, incluindo estornados. */
export function useBillPaymentsPaid(from: string, to: string) {
  return useBusinessQuery(['bill-payments', 'paid', from, to], (businessId) =>
    unwrap<BillPaymentRow[]>(
      supabase
        .from('v_bill_payments')
        .select('*')
        .eq('business_id', businessId)
        .gte('paid_on', from)
        .lte('paid_on', to)
        .order('paid_on', { ascending: false })
        .order('created_at', { ascending: false }),
    ),
  );
}

// ── Escritas ────────────────────────────────────────────────────────────────

export type PlanMode = 'paid' | 'pending' | 'installments';

export interface PaymentPlan {
  mode: PlanMode;
  paid_on?: string;
  method?: PaymentMethod | null;
  count?: number;
  first_due_date?: string;
}

export interface PurchaseItemPayload {
  ingredient_id: string | null;
  description: string;
  quantity: number;
  unit: string;
  unit_price_cents: number;
  update_ingredient_cost: boolean;
}

export interface PurchasePayload {
  purchase_date: string;
  supplier_id: string | null;
  new_supplier_name: string | null;
  description: string;
  category: string;
  payment_method: PaymentMethod | null;
  due_date: string | null;
  receipt_path: string | null;
  notes: string | null;
  extra_cents: number;
  discount_cents: number;
  items: PurchaseItemPayload[];
  plan?: PaymentPlan;
}

export interface ExpensePayload {
  expense_date: string;
  supplier_id: string | null;
  new_supplier_name: string | null;
  description: string;
  category: string;
  amount_cents: number;
  payment_method: PaymentMethod | null;
  due_date: string | null;
  receipt_path: string | null;
  notes: string | null;
  plan?: PaymentPlan;
}

/**
 * Envia o comprovante (se houver um novo) antes da gravação; se a gravação falhar,
 * o arquivo recém-enviado é removido para não ficar órfão.
 */
async function withReceipt<T>(businessId: string, file: File | null | undefined, currentPath: string | null, save: (path: string | null) => Promise<T>) {
  if (!file) return save(currentPath);
  const uploaded = await uploadFile('receipts', businessId, file);
  try {
    return await save(uploaded);
  } catch (error) {
    await removeFile('receipts', uploaded).catch(() => undefined);
    throw error;
  }
}

export function useCreatePurchase() {
  return useWrite<{ requestId: string; purchase: PurchasePayload; receipt?: File | null }, string>({
    mutationFn: ({ requestId, purchase, receipt }, businessId) =>
      withReceipt(businessId, receipt, purchase.receipt_path, (path) =>
        rpc<string>('create_purchase', { p_business_id: businessId, p_request_id: requestId, p_purchase: { ...purchase, receipt_path: path } }),
      ),
    success: 'Compra registrada.',
  });
}

export function useUpdatePurchase() {
  return useWrite<{ purchaseId: string; purchase: PurchasePayload; receipt?: File | null }, string>({
    mutationFn: ({ purchaseId, purchase, receipt }, businessId) =>
      withReceipt(businessId, receipt, purchase.receipt_path, (path) =>
        rpc<string>('update_purchase', { p_purchase_id: purchaseId, p_purchase: { ...purchase, receipt_path: path } }),
      ),
    success: 'Compra atualizada.',
  });
}

export function useCreateExpense() {
  return useWrite<{ requestId: string; expense: ExpensePayload; receipt?: File | null }, string>({
    mutationFn: ({ requestId, expense, receipt }, businessId) =>
      withReceipt(businessId, receipt, expense.receipt_path, (path) =>
        rpc<string>('create_expense', { p_business_id: businessId, p_request_id: requestId, p_expense: { ...expense, receipt_path: path } }),
      ),
    success: 'Despesa registrada.',
  });
}

export function useUpdateExpense() {
  return useWrite<{ expenseId: string; expense: ExpensePayload; receipt?: File | null }, string>({
    mutationFn: ({ expenseId, expense, receipt }, businessId) =>
      withReceipt(businessId, receipt, expense.receipt_path, (path) =>
        rpc<string>('update_expense', { p_expense_id: expenseId, p_expense: { ...expense, receipt_path: path } }),
      ),
    success: 'Despesa atualizada.',
  });
}

export function useCancelBill() {
  return useWrite<{ kind: BillKind; id: string; reason: string; voidPayments: boolean }, void>({
    mutationFn: ({ kind, id, reason, voidPayments }) =>
      rpc('cancel_bill', { p_kind: kind, p_id: id, p_reason: reason, p_void_payments: voidPayments }),
    success: (_r, vars) => (vars.kind === 'purchase' ? 'Compra cancelada. O histórico foi mantido.' : 'Despesa cancelada. O histórico foi mantido.'),
  });
}

export interface AddBillPaymentInput {
  kind: BillKind;
  billId: string;
  requestId: string;
  amountCents: number;
  /** Pagamento realizado: data do pagamento. */
  paidOn: string | null;
  /** Parcela prevista: vencimento. */
  dueDate: string | null;
  method: PaymentMethod | null;
  notes: string | null;
}

export function useAddBillPayment() {
  return useWrite<AddBillPaymentInput, string>({
    mutationFn: (input) =>
      rpc<string>('add_bill_payment', {
        p_kind: input.kind,
        p_bill_id: input.billId,
        p_request_id: input.requestId,
        p_amount_cents: input.amountCents,
        p_paid_on: input.paidOn,
        p_due_date: input.dueDate,
        p_method: input.method,
        p_notes: input.notes,
      }),
    success: (_r, vars) => (vars.paidOn ? 'Pagamento lançado.' : 'Parcela prevista lançada.'),
  });
}

export function usePayInstallment() {
  return useWrite<{ billPaymentId: string; paidOn: string; method: PaymentMethod }, void>({
    mutationFn: ({ billPaymentId, paidOn, method }) =>
      rpc('pay_bill_installment', { p_bill_payment_id: billPaymentId, p_paid_on: paidOn, p_method: method }),
    success: 'Parcela marcada como paga.',
  });
}

export function useVoidBillPayment() {
  return useWrite<{ billPaymentId: string; reason: string }, void>({
    mutationFn: ({ billPaymentId, reason }) => rpc('void_bill_payment', { p_bill_payment_id: billPaymentId, p_reason: reason }),
    success: 'Lançamento estornado. Ele continua visível no histórico.',
  });
}
