import type { ISODate } from '@/lib/dates';
import type { MeasureUnit } from '@/lib/units';

/** Tipos das linhas lidas das tabelas/views (espelham supabase/migrations). */

export type Role = 'owner' | 'editor' | 'viewer';
export type PaymentMethod = 'pix' | 'dinheiro' | 'cartao_credito' | 'cartao_debito' | 'transferencia' | 'boleto' | 'outro';
export type PaymentStatus = 'paid' | 'partial' | 'pending' | 'cancelled';
export type RecordStatus = 'active' | 'cancelled';

export const PAYMENT_METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'pix', label: 'PIX' },
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'cartao_credito', label: 'Cartão de crédito' },
  { value: 'cartao_debito', label: 'Cartão de débito' },
  { value: 'transferencia', label: 'Transferência' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'outro', label: 'Outro' },
];

export function paymentMethodLabel(method: string | null | undefined): string {
  return PAYMENT_METHODS.find((m) => m.value === method)?.label ?? '—';
}

export interface Business {
  id: string;
  name: string;
  timezone: string;
  default_due_day: number;
  pix_key: string | null;
  charge_message_footer: string | null;
}

export interface Membership {
  business_id: string;
  user_id: string;
  role: Role;
}

export interface MemberRow extends Membership {
  display_name: string | null;
  created_at: string;
}

export interface Profile {
  id: string;
  display_name: string;
}

export interface Customer {
  id: string;
  business_id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
}

export interface CustomerSummary extends Customer {
  sales_count: number;
  total_purchased_cents: number;
  total_paid_cents: number;
  open_balance_cents: number;
  overdue_balance_cents: number;
  open_sales_count: number;
  next_due_date: ISODate | null;
  last_sale_date: ISODate | null;
}

export interface Supplier {
  id: string;
  business_id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  active: boolean;
}

export interface ProductRow {
  id: string;
  business_id: string;
  name: string;
  description: string | null;
  category: string | null;
  unit: string;
  price_cents: number | null;
  cost_mode: 'manual' | 'recipe';
  manual_unit_cost_cents: number | null;
  photo_path: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  recipe_id: string | null;
  recipe_unit_cost_cents: number | null;
  effective_unit_cost_cents: number | null;
  cost_source: 'manual' | 'recipe' | null;
}

export interface PriceHistoryRow {
  id: number;
  product_id: string;
  price_cents: number | null;
  manual_unit_cost_cents: number | null;
  cost_mode: string;
  changed_at: string;
  changed_by: string | null;
}

export interface Ingredient {
  id: string;
  business_id: string;
  name: string;
  unit: MeasureUnit;
  purchase_quantity: number;
  purchase_price_cents: number;
  yield_percent: number;
  notes: string | null;
  active: boolean;
  updated_at: string;
}

export interface Recipe {
  id: string;
  business_id: string;
  product_id: string;
  yield_quantity: number;
  notes: string | null;
}

export interface RecipeItem {
  id: string;
  business_id: string;
  recipe_id: string;
  ingredient_id: string;
  quantity: number;
  unit: MeasureUnit;
}

export interface RecipeExtraCost {
  id: string;
  business_id: string;
  recipe_id: string;
  description: string;
  amount_cents: number;
}

export interface SaleRow {
  id: string;
  business_id: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  sale_date: ISODate;
  due_date: ISODate | null;
  payment_method: PaymentMethod | null;
  discount_cents: number;
  items_subtotal_cents: number;
  items_discount_cents: number;
  total_cents: number;
  cost_total_cents: number;
  items_without_cost: number;
  notes: string | null;
  status: RecordStatus;
  cancelled_at: string | null;
  cancel_reason: string | null;
  payment_confirmation_pending: boolean;
  source: 'manual' | 'import';
  import_batch_id: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  received_cents: number;
  refunded_cents: number;
  net_paid_cents: number;
  balance_cents: number;
  last_paid_on: ISODate | null;
  payment_status: PaymentStatus;
  is_overdue: boolean;
  item_count: number;
  items_summary: string | null;
}

export interface SaleItemRow {
  id: string;
  sale_id: string;
  product_id: string;
  position: number;
  product_name: string;
  unit: string;
  quantity: number;
  unit_price_cents: number;
  discount_cents: number;
  unit_cost_cents: number | null;
  cost_source: string | null;
  price_inferred: boolean;
  line_subtotal_cents: number;
  line_total_cents: number;
  line_cost_cents: number | null;
  sale_date: ISODate;
  sale_status: RecordStatus;
}

export interface PaymentRow {
  id: string;
  business_id: string;
  sale_id: string;
  kind: 'receipt' | 'refund';
  amount_cents: number;
  paid_on: ISODate;
  method: PaymentMethod;
  notes: string | null;
  received_by: string | null;
  received_by_name: string | null;
  created_at: string;
  voided_at: string | null;
  voided_by_name: string | null;
  void_reason: string | null;
  is_inferred: boolean;
  sale_date: ISODate;
  sale_due_date: ISODate | null;
  sale_total_cents: number;
  sale_status: RecordStatus;
  customer_id: string | null;
  customer_name: string | null;
}

export interface PurchaseRow {
  id: string;
  business_id: string;
  purchase_date: ISODate;
  supplier_id: string | null;
  supplier_name: string | null;
  description: string;
  category: string;
  payment_method: PaymentMethod | null;
  due_date: ISODate | null;
  receipt_path: string | null;
  notes: string | null;
  items_total_cents: number;
  extra_cents: number;
  discount_cents: number;
  total_cents: number;
  status: RecordStatus;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  paid_cents: number;
  scheduled_cents: number;
  balance_cents: number;
  unscheduled_cents: number;
  next_due_date: ISODate | null;
  last_paid_on: ISODate | null;
  installment_count: number;
  payment_status: PaymentStatus;
  is_overdue: boolean;
  item_count: number;
}

export interface PurchaseItemRow {
  id: string;
  purchase_id: string;
  ingredient_id: string | null;
  position: number;
  description: string;
  quantity: number;
  unit: string;
  unit_price_cents: number;
  line_total_cents: number;
}

export interface ExpenseRow {
  id: string;
  business_id: string;
  expense_date: ISODate;
  supplier_id: string | null;
  supplier_name: string | null;
  description: string;
  category: string;
  total_cents: number;
  payment_method: PaymentMethod | null;
  due_date: ISODate | null;
  receipt_path: string | null;
  notes: string | null;
  status: RecordStatus;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  paid_cents: number;
  scheduled_cents: number;
  balance_cents: number;
  unscheduled_cents: number;
  next_due_date: ISODate | null;
  last_paid_on: ISODate | null;
  installment_count: number;
  payment_status: PaymentStatus;
  is_overdue: boolean;
}

export type BillKind = 'purchase' | 'expense';

export interface BillRow {
  kind: BillKind;
  id: string;
  business_id: string;
  bill_date: ISODate;
  supplier_name: string | null;
  description: string;
  category: string;
  total_cents: number;
  paid_cents: number;
  scheduled_cents: number;
  balance_cents: number;
  unscheduled_cents: number;
  due_date: ISODate | null;
  next_due_date: ISODate | null;
  payment_status: PaymentStatus;
  is_overdue: boolean;
  status: RecordStatus;
}

export interface BillPaymentRow {
  id: string;
  business_id: string;
  kind: BillKind;
  bill_id: string;
  installment_number: number | null;
  amount_cents: number;
  due_date: ISODate | null;
  paid_on: ISODate | null;
  method: PaymentMethod | null;
  notes: string | null;
  created_at: string;
  paid_by_name: string | null;
  voided_at: string | null;
  void_reason: string | null;
  bill_description: string;
  bill_category: string;
  bill_status: RecordStatus;
  supplier_name: string | null;
  is_overdue: boolean;
}

export interface DashboardSummary {
  from: ISODate;
  to: ISODate;
  today: ISODate;
  sales_count: number;
  cancelled_count: number;
  revenue_cents: number;
  discounts_cents: number;
  cogs_cents: number;
  items_without_cost: number;
  period_receivable_cents: number;
  receipts_cents: number;
  refunds_cents: number;
  net_received_cents: number;
  open_receivables_cents: number;
  open_receivables_count: number;
  overdue_cents: number;
  overdue_count: number;
  receivables_without_due_cents: number;
  pending_confirmation_count: number;
  next_due_day: ISODate;
  next_due_day_cents: number;
  next_due_day_count: number;
  purchases_cents: number;
  purchases_paid_cents: number;
  expenses_cents: number;
  expenses_paid_cents: number;
  open_payables_cents: number;
  overdue_payables_cents: number;
  gross_profit_cents: number;
  estimated_result_cents: number;
  cash_flow_cents: number;
}

export interface CashFlowEntry {
  entry_date: ISODate;
  direction: 'in' | 'out';
  realized: boolean;
  category: string;
  description: string;
  amount_cents: number;
  ref_kind: 'sale' | 'purchase' | 'expense';
  ref_id: string;
  is_overdue: boolean;
}

export interface AuditRow {
  id: number;
  business_id: string;
  actor_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  occurred_at: string;
  details: Record<string, unknown>;
}

export interface ImportBatchRow {
  id: string;
  file_name: string;
  file_sha256: string;
  sheet_name: string | null;
  layout: 'long' | 'wide';
  total_rows: number;
  imported_count: number;
  duplicate_count: number;
  ignored_count: number;
  invalid_count: number;
  created_customers_count: number;
  inferred_count: number;
  created_by: string | null;
  created_at: string;
}

export interface ImportRowRecord {
  id: number;
  batch_id: string;
  row_number: number;
  raw: Record<string, string>;
  status: 'imported' | 'duplicate' | 'ignored' | 'invalid';
  messages: string[];
  inferred_fields: string[];
  sale_id: string | null;
}
