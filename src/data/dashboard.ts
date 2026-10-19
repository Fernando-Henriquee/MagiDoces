import { keepPreviousData } from '@tanstack/react-query';
import { rpc } from './api';
import { useBusinessQuery } from './hooks';
import type { CashFlowEntry, DashboardSummary } from './types';

export function useDashboard(from: string, to: string) {
  // Ao trocar de período, mantém os números anteriores na tela até os novos chegarem.
  return useBusinessQuery(
    ['dashboard', from, to],
    (businessId) => rpc<DashboardSummary>('dashboard_summary', { p_business_id: businessId, p_from: from, p_to: to }),
    { placeholderData: keepPreviousData },
  );
}

export function useCashFlow(from: string, to: string) {
  return useBusinessQuery(['cash-flow', from, to], (businessId) =>
    rpc<CashFlowEntry[]>('cash_flow_entries', { p_business_id: businessId, p_from: from, p_to: to }),
  );
}
