import type { ISODate } from '../dates';
import type { PaymentMethodValue } from './normalize';

export type CellValue = string | number | boolean | Date | null;

export interface SheetData {
  name: string;
  /** Índice (0-based) da linha de cabeçalho dentro de `allRows`. */
  headerRowIndex: number;
  /** Todas as linhas da aba, como lidas. */
  allRows: CellValue[][];
}

export interface WorkbookData {
  fileName: string;
  sizeBytes: number;
  sha256: string;
  sheets: SheetData[];
}

export type ColumnRole =
  | 'ignore'
  | 'date'
  | 'customer'
  | 'product'
  | 'quantity'
  | 'unit_price'
  | 'line_total'
  | 'paid'
  | 'paid_amount'
  | 'payment_date'
  | 'payment_method'
  | 'due_date'
  | 'notes'
  | 'product_quantity';

export const COLUMN_ROLE_LABELS: Record<ColumnRole, string> = {
  ignore: 'Ignorar',
  date: 'Data da venda',
  customer: 'Cliente',
  product: 'Produto (nome)',
  quantity: 'Quantidade',
  unit_price: 'Preço unitário',
  line_total: 'Valor total',
  paid: 'Pago? (sim/não)',
  paid_amount: 'Valor pago',
  payment_date: 'Data do pagamento',
  payment_method: 'Forma de pagamento',
  due_date: 'Vencimento',
  notes: 'Observações',
  product_quantity: 'Quantidade de um produto',
};

export interface ColumnMapping {
  index: number;
  header: string;
  role: ColumnRole;
  /** Para role = product_quantity (layout largo): produto da coluna. */
  productId?: string | null;
}

export type Layout = 'long' | 'wide';

export interface MigrationRules {
  /** Sem coluna de preço: usar preço atual do produto, preço informado por produto, ou rejeitar. */
  missingPrice: 'current_product_price' | 'manual_price' | 'reject';
  manualPrices: Record<string, number>;
  /** Linha marcada como paga sem data de pagamento. */
  paidWithoutDate: 'use_sale_date' | 'reject';
  /** Layout longo sem coluna de quantidade. */
  missingQuantity: 'one' | 'reject';
}

export const DEFAULT_RULES: MigrationRules = {
  missingPrice: 'reject',
  manualPrices: {},
  paidWithoutDate: 'reject',
  missingQuantity: 'reject',
};

export interface ProductRef {
  id: string;
  name: string;
  price_cents: number | null;
  active: boolean;
}

export interface CustomerRef {
  id: string;
  name: string;
}

export type RowStatus = 'ok' | 'warning' | 'error' | 'empty' | 'duplicate';

export interface PreviewItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  priceInferred: boolean;
}

export interface PreviewSale {
  customerId: string | null;
  customerName: string | null;
  isNewCustomer: boolean;
  saleDate: ISODate;
  dueDate: ISODate | null;
  notes: string | null;
  paymentMethod: PaymentMethodValue | null;
  items: PreviewItem[];
  totalCents: number;
  payment: {
    status: 'paid' | 'partial' | 'unpaid' | 'unknown';
    amountCents: number | null;
    paidOn: ISODate | null;
    paidOnInferred: boolean;
    method: PaymentMethodValue | null;
  };
}

export interface PreviewRow {
  rowNumber: number;
  raw: Record<string, string>;
  status: RowStatus;
  errors: string[];
  warnings: string[];
  inferredFields: string[];
  sale: PreviewSale | null;
  /** Chave canônica (antes de considerar repetições no arquivo). */
  contentKey: string | null;
  fingerprint: string | null;
  /** Linha do arquivo com o mesmo conteúdo (possível duplicidade interna). */
  sameAsRow: number | null;
  alreadyImported: boolean;
}
