import { supabase } from '@/lib/supabase';
import { unwrap } from './api';
import { useBusinessQuery } from './hooks';
import type { AuditRow } from './types';

export const AUDIT_LIMIT = 1000;

export interface AuditFilters {
  /** Instantes (ISO) que delimitam o período no fuso do negócio: [from, to). */
  fromInstant: string;
  toInstant: string;
  entity?: string;
  action?: string;
}

export interface AuditLinks {
  /** id do pagamento → id da venda */
  payments: Record<string, string>;
  /** id do pagamento de conta → compra ou despesa */
  billPayments: Record<string, { kind: 'purchase' | 'expense'; billId: string }>;
}

async function inChunks<T>(ids: string[], fetchChunk: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const result: T[] = [];
  for (let start = 0; start < ids.length; start += 200) result.push(...(await fetchChunk(ids.slice(start, start + 200))));
  return result;
}

/** Histórico de auditoria (somente leitura; a RLS restringe a owner/editor). */
export function useAuditLogs(filters: AuditFilters) {
  return useBusinessQuery(['audit', filters], async (businessId) => {
    let query = supabase
      .from('audit_logs')
      .select('*')
      .eq('business_id', businessId)
      .gte('occurred_at', filters.fromInstant)
      .lt('occurred_at', filters.toInstant);
    if (filters.entity) query = query.eq('entity', filters.entity);
    if (filters.action) query = query.like('action', `%.${filters.action}`);
    const rows = await unwrap<AuditRow[]>(
      query.order('occurred_at', { ascending: false }).order('id', { ascending: false }).limit(AUDIT_LIMIT),
    );

    // Vínculos para navegar até a venda, compra ou despesa dos lançamentos de pagamento.
    const paymentIds = [...new Set(rows.filter((r) => r.entity === 'payment' && r.entity_id).map((r) => r.entity_id!))];
    const billPaymentIds = [...new Set(rows.filter((r) => r.entity === 'bill_payment' && r.entity_id).map((r) => r.entity_id!))];
    const [payments, billPayments] = await Promise.all([
      inChunks(paymentIds, (ids) => unwrap<Array<{ id: string; sale_id: string }>>(supabase.from('payments').select('id,sale_id').in('id', ids))),
      inChunks(billPaymentIds, (ids) =>
        unwrap<Array<{ id: string; purchase_id: string | null; expense_id: string | null }>>(
          supabase.from('bill_payments').select('id,purchase_id,expense_id').in('id', ids),
        ),
      ),
    ]);
    const links: AuditLinks = {
      payments: Object.fromEntries(payments.map((p) => [p.id, p.sale_id])),
      billPayments: Object.fromEntries(
        billPayments.map((b) => [
          b.id,
          b.purchase_id ? { kind: 'purchase' as const, billId: b.purchase_id } : { kind: 'expense' as const, billId: b.expense_id ?? '' },
        ]),
      ),
    };
    return { rows, links, truncated: rows.length >= AUDIT_LIMIT };
  });
}
