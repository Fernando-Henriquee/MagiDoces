import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/auth-context';
import type { ISODate } from '@/lib/dates';
import { env } from '@/lib/env';
import { supabase } from '@/lib/supabase';
import { rpc } from './api';
import { useBusinessQuery, useWrite } from './hooks';

/**
 * Link de compras (/compra/<token>): a própria cliente anota a compra, sem login.
 * As chamadas públicas usam só a chave pública e NUNCA a sessão de quem estiver
 * logado no aparelho — a página age sempre como visitante (papel anon), que só
 * executa as funções storefront_* do banco.
 */

export interface StorefrontPix {
  key: string;
  name: string;
  city: string | null;
}

export interface StorefrontProduct {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  unit: string;
  price_cents: number;
}

export interface Storefront {
  business_name: string;
  today: ISODate;
  due_day: number;
  next_due_date: ISODate;
  max_due_date: ISODate;
  pix: StorefrontPix | null;
  products: StorefrontProduct[];
}

export type PaymentChoice = 'now' | 'due_day' | 'date';

export interface PurchaseInput {
  name: string;
  phone: string;
  notes?: string | null;
  items: Array<{ product_id: string; quantity: number }>;
  payment: PaymentChoice;
  due_date?: ISODate | null;
}

export interface PurchaseReceipt {
  sale_id: string;
  sale_date: ISODate;
  due_date: ISODate;
  payment: PaymentChoice;
  customer_first_name: string;
  total_cents: number;
  balance_cents: number;
  status: 'active' | 'cancelled';
  reported_paid: boolean;
  items: Array<{ name: string; quantity: number; unit: string; unit_price_cents: number; total_cents: number }>;
  code_status: 'can_create' | 'has_code' | 'ask_business';
  pix: StorefrontPix | null;
}

export interface StatementSale {
  sale_date: ISODate;
  due_date: ISODate | null;
  items_summary: string | null;
  total_cents: number;
  paid_cents: number;
  balance_cents: number;
  is_overdue: boolean;
  reported_paid: boolean;
}

export type StatementResult =
  | { status: 'ok'; customer_first_name: string | null; balance_cents: number; overdue_cents: number; sales: StatementSale[]; pix: StorefrontPix | null }
  | { status: 'invalid'; attempts_left: number }
  | { status: 'locked'; retry_minutes: number }
  | { status: 'invalid_input' }
  | { status: 'unavailable' };

/** RPC como visitante: só a chave pública, sem o token de sessão do aparelho. */
async function publicRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${env.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: env.supabaseAnonKey,
      Authorization: `Bearer ${env.supabaseAnonKey}`,
      'content-type': 'application/json',
      'x-client-info': 'magi-doces-link-de-compras',
    },
    body: JSON.stringify(args),
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const error = (body ?? {}) as { code?: string; message?: string; details?: string | null };
    throw Object.assign(new Error(error.message ?? `Erro ${response.status}`), { code: error.code, status: response.status, details: error.details ?? null });
  }
  return body as T;
}

export function fetchStorefront(token: string): Promise<Storefront | null> {
  return publicRpc<Storefront | null>('storefront', { p_token: token });
}

export function registerPurchase(token: string, requestId: string, purchase: PurchaseInput): Promise<PurchaseReceipt> {
  return publicRpc<PurchaseReceipt>('storefront_register_purchase', { p_token: token, p_request_id: requestId, p_purchase: purchase });
}

export function reportPaid(token: string, saleId: string, requestId: string): Promise<PurchaseReceipt> {
  return publicRpc<PurchaseReceipt>('storefront_report_paid', { p_token: token, p_sale_id: saleId, p_request_id: requestId });
}

export function createAccessCode(token: string, saleId: string, requestId: string, code: string): Promise<PurchaseReceipt> {
  return publicRpc<PurchaseReceipt>('storefront_create_code', { p_token: token, p_sale_id: saleId, p_request_id: requestId, p_code: code });
}

export function fetchStatement(token: string, phone: string, code: string): Promise<StatementResult> {
  return publicRpc<StatementResult>('storefront_statement', { p_token: token, p_phone: phone, p_code: code });
}

/** Vitrine do link (pública; fora do cache por usuária do sistema). */
export function useStorefront(token: string) {
  return useQuery({ queryKey: ['storefront', token], queryFn: () => fetchStorefront(token), staleTime: 60_000 });
}

export function storefrontUrl(token: string): string {
  return `${window.location.origin}/compra/${token}`;
}

// -----------------------------------------------------------------------------
// Lado das sócias (logadas)
// -----------------------------------------------------------------------------

export function useConfigureStorefront() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useWrite<{ enabled: boolean; regenerate?: boolean }, string>({
    mutationFn: ({ enabled, regenerate }, businessId) =>
      rpc<string>('configure_storefront', { p_business_id: businessId, p_enabled: enabled, p_regenerate: regenerate ?? false }),
    success: (_token, { enabled, regenerate }) =>
      regenerate ? 'Link trocado. O endereço e o QR code antigos não funcionam mais.' : enabled ? 'Link de compras ativado.' : 'Link de compras desativado.',
    // O link (token e situação) vem junto com os dados do negócio.
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['memberships', user?.id] }),
  });
}

export interface AccessCodeInfo {
  phone_valid: boolean;
  has_code: boolean;
  set_by?: 'customer' | 'business' | null;
  updated_at?: string | null;
  locked?: boolean;
}

export function useAccessCodeInfo(customerId: string | undefined) {
  return useBusinessQuery(['customers', 'access-code', customerId], () => rpc<AccessCodeInfo>('customer_access_code_info', { p_customer_id: customerId }), {
    enabled: Boolean(customerId),
  });
}

export function useSetAccessCode() {
  return useWrite<{ customerId: string }, string>({
    mutationFn: ({ customerId }) => rpc<string>('set_customer_access_code', { p_customer_id: customerId }),
  });
}

export function useRemoveAccessCode() {
  return useWrite<{ customerId: string }, void>({
    mutationFn: ({ customerId }) => rpc('remove_customer_access_code', { p_customer_id: customerId }),
    success: 'Código de consulta removido.',
  });
}

export function useReviewSale() {
  return useWrite<{ saleId: string }, void>({
    mutationFn: ({ saleId }) => rpc('review_self_service_sale', { p_sale_id: saleId }),
    success: 'Venda marcada como revisada.',
  });
}

/** Quantas compras anotadas pelas clientes aguardam revisão (todas as datas). */
export function usePendingReviewCount() {
  return useBusinessQuery(['sales', 'review-count'], async (businessId) => {
    const { count, error } = await supabase
      .from('v_sales')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .eq('status', 'active')
      .eq('self_service_review_pending', true);
    if (error) throw error;
    return count ?? 0;
  });
}

