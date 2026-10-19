import { num, rpc } from './api';
import { useBusinessQuery } from './hooks';

export type Granularity = 'day' | 'week' | 'month';

export interface SalesByPeriodRow {
  period_start: string;
  sales_count: number;
  cancelled_count: number;
  revenue_cents: number;
  discounts_cents: number;
  cogs_cents: number;
  gross_profit_cents: number;
  items_without_cost: number;
}

export interface ReceiptsByPeriodRow {
  period_start: string;
  method: string;
  receipts_count: number;
  receipts_cents: number;
  refunds_cents: number;
  net_cents: number;
}

export interface TopProductRow {
  product_id: string;
  product_name: string;
  unit: string;
  quantity: number;
  sales_count: number;
  revenue_cents: number;
  cogs_cents: number;
  gross_profit_cents: number;
  items_without_cost: number;
  margin_percent: number | null;
}

export interface PayablesReportRow {
  kind: 'purchase' | 'expense';
  category: string;
  records_count: number;
  registered_cents: number;
  paid_in_period_cents: number;
  open_cents: number;
}

export interface IngredientConsumptionRow {
  ingredient_id: string;
  ingredient_name: string;
  base_unit: string;
  quantity_base: number;
  estimated_cost_cents: number;
}

export function useSalesByPeriod(from: string, to: string, granularity: Granularity) {
  return useBusinessQuery(['reports', 'sales', from, to, granularity], (businessId) =>
    rpc<SalesByPeriodRow[]>('report_sales_by_period', { p_business_id: businessId, p_from: from, p_to: to, p_granularity: granularity }),
  );
}

export function useReceiptsByPeriod(from: string, to: string, granularity: Granularity) {
  return useBusinessQuery(['reports', 'receipts', from, to, granularity], (businessId) =>
    rpc<ReceiptsByPeriodRow[]>('report_receipts_by_period', { p_business_id: businessId, p_from: from, p_to: to, p_granularity: granularity }),
  );
}

export function useTopProducts(from: string, to: string) {
  return useBusinessQuery(['reports', 'products', from, to], async (businessId) =>
    (await rpc<TopProductRow[]>('report_top_products', { p_business_id: businessId, p_from: from, p_to: to })).map((row) => ({
      ...row,
      quantity: num(row.quantity),
      margin_percent: row.margin_percent === null ? null : num(row.margin_percent),
    })),
  );
}

export function usePayablesReport(from: string, to: string) {
  return useBusinessQuery(['reports', 'payables', from, to], (businessId) =>
    rpc<PayablesReportRow[]>('report_payables', { p_business_id: businessId, p_from: from, p_to: to }),
  );
}

export function useIngredientConsumption(from: string, to: string) {
  return useBusinessQuery(['reports', 'ingredients', from, to], async (businessId) =>
    (await rpc<IngredientConsumptionRow[]>('report_ingredient_consumption', { p_business_id: businessId, p_from: from, p_to: to })).map((row) => ({
      ...row,
      quantity_base: num(row.quantity_base),
    })),
  );
}
