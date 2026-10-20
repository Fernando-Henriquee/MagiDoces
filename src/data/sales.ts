import { supabase } from '@/lib/supabase';
import { rpc, unwrap } from './api';
import { useBusinessQuery, useWrite } from './hooks';
import type { PaymentMethod, PaymentRow, SaleItemRow, SaleRow } from './types';

export interface SaleFilters {
  from?: string;
  to?: string;
  customerId?: string;
  status?: 'active' | 'cancelled' | 'all';
  paymentStatus?: 'open' | 'paid' | 'overdue' | 'pending_confirmation' | 'review' | 'all';
  limit?: number;
}

export async function fetchSales(businessId: string, filters: SaleFilters = {}): Promise<SaleRow[]> {
  let query = supabase.from('v_sales').select('*').eq('business_id', businessId);
  if (filters.from) query = query.gte('sale_date', filters.from);
  if (filters.to) query = query.lte('sale_date', filters.to);
  if (filters.customerId) query = query.eq('customer_id', filters.customerId);
  if (filters.status && filters.status !== 'all') query = query.eq('status', filters.status);
  if (filters.paymentStatus === 'open') query = query.eq('status', 'active').gt('balance_cents', 0);
  if (filters.paymentStatus === 'paid') query = query.eq('payment_status', 'paid');
  if (filters.paymentStatus === 'overdue') query = query.eq('is_overdue', true);
  if (filters.paymentStatus === 'pending_confirmation') query = query.eq('payment_confirmation_pending', true).eq('status', 'active');
  if (filters.paymentStatus === 'review') query = query.eq('self_service_review_pending', true).eq('status', 'active');
  query = query.order('sale_date', { ascending: false }).order('created_at', { ascending: false });
  if (filters.limit) query = query.limit(filters.limit);
  return unwrap<SaleRow[]>(query);
}

export function useSales(filters: SaleFilters = {}) {
  return useBusinessQuery(['sales', 'list', filters], (businessId) => fetchSales(businessId, filters));
}

/** Contas a receber: vendas ativas com saldo, ordenadas por vencimento. */
export function useReceivables() {
  return useBusinessQuery(['sales', 'receivables'], (businessId) =>
    unwrap<SaleRow[]>(
      supabase
        .from('v_sales')
        .select('*')
        .eq('business_id', businessId)
        .eq('status', 'active')
        .gt('balance_cents', 0)
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('sale_date', { ascending: true }),
    ),
  );
}

export function useSale(saleId: string | undefined) {
  return useBusinessQuery(
    ['sales', 'detail', saleId],
    async () => {
      const [sale, items, payments] = await Promise.all([
        unwrap<SaleRow>(supabase.from('v_sales').select('*').eq('id', saleId!).single()),
        unwrap<SaleItemRow[]>(supabase.from('v_sale_items').select('*').eq('sale_id', saleId!).order('position')),
        unwrap<PaymentRow[]>(supabase.from('v_payments').select('*').eq('sale_id', saleId!).order('paid_on').order('created_at')),
      ]);
      return { sale, items, payments };
    },
    { enabled: Boolean(saleId) },
  );
}

export function usePaymentHistory(filters: { from?: string; to?: string; limit?: number } = {}) {
  return useBusinessQuery(['payments', 'list', filters], (businessId) => {
    let query = supabase.from('v_payments').select('*').eq('business_id', businessId);
    if (filters.from) query = query.gte('paid_on', filters.from);
    if (filters.to) query = query.lte('paid_on', filters.to);
    query = query.order('paid_on', { ascending: false }).order('created_at', { ascending: false });
    if (filters.limit) query = query.limit(filters.limit);
    return unwrap<PaymentRow[]>(query);
  });
}

export interface SaleItemPayload {
  id?: string;
  product_id: string;
  quantity: number;
  unit_price_cents: number;
  discount_cents: number;
}

export interface SalePayload {
  customer_id?: string | null;
  new_customer?: { name: string; phone?: string | null } | null;
  sale_date: string;
  due_date?: string | null;
  payment_method?: PaymentMethod | null;
  discount_cents: number;
  notes?: string | null;
  items: SaleItemPayload[];
  payment?: { full?: boolean; amount_cents?: number; paid_on?: string; method?: PaymentMethod } | null;
}

export function useCreateSale() {
  return useWrite<{ requestId: string; sale: SalePayload }, string>({
    mutationFn: ({ requestId, sale }, businessId) => rpc<string>('create_sale', { p_business_id: businessId, p_request_id: requestId, p_sale: sale }),
    success: 'Venda registrada.',
  });
}

export function useUpdateSale() {
  return useWrite<{ saleId: string; sale: SalePayload }, string>({
    mutationFn: ({ saleId, sale }) => rpc<string>('update_sale', { p_sale_id: saleId, p_sale: sale }),
    success: 'Venda atualizada.',
  });
}

export function useCancelSale() {
  return useWrite<{ saleId: string; reason: string; paymentAction: 'none' | 'void' | 'refund' }, void>({
    mutationFn: ({ saleId, reason, paymentAction }) => rpc('cancel_sale', { p_sale_id: saleId, p_reason: reason, p_payment_action: paymentAction }),
    success: 'Venda cancelada. O histórico foi mantido.',
  });
}

export interface PaymentPayload {
  saleId: string;
  requestId: string;
  amountCents: number;
  paidOn: string;
  method: PaymentMethod;
  notes?: string | null;
}

export function useRegisterPayment() {
  return useWrite<PaymentPayload, string>({
    mutationFn: (p) =>
      rpc<string>('register_payment', {
        p_sale_id: p.saleId,
        p_request_id: p.requestId,
        p_amount_cents: p.amountCents,
        p_paid_on: p.paidOn,
        p_method: p.method,
        p_notes: p.notes ?? null,
      }),
    success: 'Recebimento registrado.',
  });
}

export function useRegisterRefund() {
  return useWrite<PaymentPayload, string>({
    mutationFn: (p) =>
      rpc<string>('register_refund', {
        p_sale_id: p.saleId,
        p_request_id: p.requestId,
        p_amount_cents: p.amountCents,
        p_paid_on: p.paidOn,
        p_method: p.method,
        p_notes: p.notes ?? null,
      }),
    success: 'Reembolso registrado.',
  });
}

export function useVoidPayment() {
  return useWrite<{ paymentId: string; reason: string }, void>({
    mutationFn: ({ paymentId, reason }) => rpc('void_payment', { p_payment_id: paymentId, p_reason: reason }),
    success: 'Lançamento estornado. Ele continua visível no histórico.',
  });
}

export function useChangeDueDate() {
  return useWrite<{ saleId: string; dueDate: string | null }, void>({
    mutationFn: ({ saleId, dueDate }) => rpc('change_sale_due_date', { p_sale_id: saleId, p_due_date: dueDate }),
    success: 'Vencimento alterado.',
  });
}

export function useConfirmPending() {
  return useWrite<{ saleId: string }, void>({
    mutationFn: ({ saleId }) => rpc('confirm_sale_pending', { p_sale_id: saleId }),
    success: 'Venda confirmada como em aberto.',
  });
}

export function usePaymentsOfCustomer(customerId: string | undefined) {
  return useBusinessQuery(
    ['payments', 'customer', customerId],
    (businessId) =>
      unwrap<PaymentRow[]>(
        supabase
          .from('v_payments')
          .select('*')
          .eq('business_id', businessId)
          .eq('customer_id', customerId!)
          .order('paid_on', { ascending: false })
          .order('created_at', { ascending: false }),
      ),
    { enabled: Boolean(customerId) },
  );
}

export interface SaleAuditEntry {
  id: number;
  action: string;
  actor_id: string | null;
  actor_name: string | null;
  occurred_at: string;
}

/** Linha do tempo de auditoria da venda e de seus recebimentos (owner/editor). */
export function useSaleAudit(saleId: string | undefined, enabled: boolean) {
  return useBusinessQuery(
    ['sales', 'audit', saleId],
    async (businessId) => {
      const payments = await unwrap<Array<{ id: string }>>(supabase.from('payments').select('id').eq('sale_id', saleId!));
      const ids = [saleId!, ...payments.map((p) => p.id)];
      const entries = await unwrap<Array<Omit<SaleAuditEntry, 'actor_name'>>>(
        supabase.from('audit_logs').select('id,action,actor_id,occurred_at').eq('business_id', businessId).in('entity_id', ids).order('id'),
      );
      const actorIds = [...new Set(entries.map((e) => e.actor_id).filter((a): a is string => Boolean(a)))];
      const profiles = actorIds.length
        ? await unwrap<Array<{ id: string; display_name: string }>>(supabase.from('profiles').select('id,display_name').in('id', actorIds))
        : [];
      return entries.map((e) => ({ ...e, actor_name: profiles.find((p) => p.id === e.actor_id)?.display_name ?? null }));
    },
    { enabled: Boolean(saleId) && enabled },
  );
}
