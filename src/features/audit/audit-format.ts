import type { AuditLinks } from '@/data/audit';
import { type AuditRow, paymentMethodLabel } from '@/data/types';
import { addDays, formatDateBR, formatDateTimeBR, type ISODate } from '@/lib/dates';
import { formatBRL } from '@/lib/money';

/** Deslocamento (ms) do fuso em relação ao UTC num instante. */
function timezoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUTC - Math.floor(instant / 1000) * 1000;
}

/** Início do dia (00:00) de uma data no fuso informado, como instante ISO (UTC). */
export function zonedDayStart(date: ISODate, timeZone: string): string {
  const guess = Date.parse(`${date}T00:00:00Z`);
  const offset = timezoneOffsetMs(guess, timeZone);
  let result = guess - offset;
  const corrected = timezoneOffsetMs(result, timeZone);
  if (corrected !== offset) result = guess - corrected;
  return new Date(result).toISOString();
}

/** Intervalo [início, fim) de instantes para um período de datas no fuso do negócio. */
export function zonedRange(from: ISODate, to: ISODate, timeZone: string): { fromInstant: string; toInstant: string } {
  return { fromInstant: zonedDayStart(from, timeZone), toInstant: zonedDayStart(addDays(to, 1), timeZone) };
}

export const ENTITY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'sale', label: 'Vendas' },
  { value: 'payment', label: 'Recebimentos' },
  { value: 'purchase', label: 'Compras' },
  { value: 'expense', label: 'Despesas' },
  { value: 'bill_payment', label: 'Pagamentos de contas' },
  { value: 'import_batch', label: 'Importações' },
  { value: 'member', label: 'Membros' },
  { value: 'business', label: 'Configurações do negócio' },
];

export const ACTION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'created', label: 'Criação' },
  { value: 'updated', label: 'Edição' },
  { value: 'cancelled', label: 'Cancelamento' },
  { value: 'voided', label: 'Estorno' },
  { value: 'refunded', label: 'Reembolso' },
  { value: 'paid', label: 'Pagamento de parcela' },
  { value: 'due_date_changed', label: 'Alteração de vencimento' },
  { value: 'completed', label: 'Importação' },
  { value: 'deleted', label: 'Exclusão' },
];

const ACTION_LABELS: Record<string, string> = {
  'sale.created': 'Venda registrada',
  'sale.updated': 'Venda editada',
  'sale.items_changed': 'Itens da venda alterados',
  'sale.cancelled': 'Venda cancelada',
  'sale.due_date_changed': 'Vencimento alterado',
  'payment.created': 'Recebimento registrado',
  'payment.refunded': 'Reembolso registrado',
  'payment.voided': 'Recebimento estornado',
  'payment.updated': 'Recebimento alterado',
  'purchase.created': 'Compra registrada',
  'purchase.updated': 'Compra editada',
  'purchase.cancelled': 'Compra cancelada',
  'purchase.due_date_changed': 'Vencimento da compra alterado',
  'expense.created': 'Despesa registrada',
  'expense.updated': 'Despesa editada',
  'expense.cancelled': 'Despesa cancelada',
  'expense.due_date_changed': 'Vencimento da despesa alterado',
  'bill_payment.created': 'Pagamento de conta registrado',
  'bill_payment.paid': 'Parcela paga',
  'bill_payment.voided': 'Pagamento de conta estornado',
  'bill_payment.updated': 'Pagamento de conta alterado',
  'import.completed': 'Importação concluída',
  'member.created': 'Membro adicionado',
  'member.updated': 'Papel de membro alterado',
  'member.deleted': 'Membro removido',
  'business.updated': 'Configurações alteradas',
};

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null;
}

/** Descrição da ação em português. */
export function describeAction(row: Pick<AuditRow, 'action' | 'details'>): string {
  if (row.action === 'bill_payment.created') {
    const record = asObject(row.details.registro);
    if (record && record.paid_on === null) return 'Parcela prevista lançada';
  }
  if (row.action === 'payment.voided') {
    const changes = asObject(row.details.alteracoes);
    if (changes && asObject(changes.voided_at) && String(asObject(changes.void_reason)?.para ?? '').startsWith('Cancelamento da venda')) {
      return 'Recebimento estornado (cancelamento da venda)';
    }
  }
  return ACTION_LABELS[row.action] ?? row.action;
}

export function actionTone(action: string): 'success' | 'danger' | 'warning' | 'info' | 'neutral' {
  if (/\.(cancelled|voided|deleted)$/.test(action)) return 'danger';
  if (/\.(refunded|due_date_changed)$/.test(action)) return 'warning';
  if (/\.(created|paid|completed)$/.test(action)) return 'success';
  if (/\.updated$/.test(action)) return 'info';
  return 'neutral';
}

/** Endereço da entidade relacionada, quando houver tela para ela. */
export function entityLink(row: Pick<AuditRow, 'entity' | 'entity_id' | 'details'>, links: AuditLinks): string | null {
  const id = row.entity_id;
  const record = asObject(row.details.registro);
  switch (row.entity) {
    case 'sale':
      return id ? `/vendas/${id}` : null;
    case 'payment': {
      const saleId = (id && links.payments[id]) || (record?.sale_id as string | undefined);
      return saleId ? `/vendas/${saleId}` : null;
    }
    case 'purchase':
      return id ? `/compras/${id}` : null;
    case 'expense':
      return id ? `/despesas/${id}` : null;
    case 'bill_payment': {
      const link = id ? links.billPayments[id] : undefined;
      if (link?.billId) return `/${link.kind === 'purchase' ? 'compras' : 'despesas'}/${link.billId}`;
      if (record?.purchase_id) return `/compras/${String(record.purchase_id)}`;
      if (record?.expense_id) return `/despesas/${String(record.expense_id)}`;
      return null;
    }
    case 'import_batch':
      return id ? `/importar/lotes/${id}` : null;
    case 'business':
    case 'member':
      return '/configuracoes';
    default:
      return null;
  }
}

export const FIELD_LABELS: Record<string, string> = {
  status: 'Situação',
  sale_date: 'Data da venda',
  due_date: 'Vencimento',
  customer_id: 'Cliente',
  payment_method: 'Forma de pagamento',
  discount_cents: 'Desconto',
  notes: 'Observações',
  cancelled_at: 'Cancelada em',
  cancelled_by: 'Cancelada por',
  cancel_reason: 'Motivo do cancelamento',
  payment_confirmation_pending: 'Pendente de confirmação',
  amount_cents: 'Valor',
  paid_on: 'Data do pagamento',
  method: 'Forma de pagamento',
  kind: 'Tipo',
  voided_at: 'Estornado em',
  voided_by: 'Estornado por',
  void_reason: 'Motivo do estorno',
  is_inferred: 'Data inferida',
  received_by: 'Registrado por',
  name: 'Nome',
  timezone: 'Fuso horário',
  default_due_day: 'Dia padrão de vencimento',
  pix_key: 'Chave PIX',
  charge_message_footer: 'Rodapé da cobrança',
  role: 'Papel',
  user_id: 'Usuário',
  description: 'Descrição',
  category: 'Categoria',
  purchase_date: 'Data da compra',
  expense_date: 'Data da despesa',
  supplier_id: 'Fornecedor',
  extra_cents: 'Frete/taxas',
  receipt_path: 'Comprovante',
  installment_number: 'Parcela',
  paid_by: 'Pago por',
  paid_recorded_at: 'Pagamento lançado em',
  total_cents: 'Total',
  items_total_cents: 'Total dos itens',
  // Snapshots (chaves em português gravadas pelas RPCs)
  cliente: 'Cliente',
  data_venda: 'Data da venda',
  vencimento: 'Vencimento',
  forma_pagamento: 'Forma de pagamento',
  desconto_venda_cents: 'Desconto da venda',
  observacoes: 'Observações',
  arquivo: 'Arquivo',
  aba: 'Aba',
  linhas: 'Linhas',
  importadas: 'Importadas',
  duplicadas: 'Duplicadas',
  ignoradas: 'Ignoradas',
  invalidas: 'Inválidas',
  clientes_criados: 'Clientes criados',
  com_valores_inferidos: 'Com valores inferidos',
};

/** Campos técnicos omitidos ao exibir um registro. */
export const HIDDEN_FIELDS = new Set([
  'id',
  'business_id',
  'sale_id',
  'purchase_id',
  'expense_id',
  'created_at',
  'created_by',
  'updated_at',
  'updated_by',
  'client_request_id',
  'import_batch_id',
  'import_fingerprint',
  'items_subtotal_cents',
  'items_discount_cents',
  'cost_total_cents',
  'items_without_cost',
  'source',
]);

const ROLE_NAMES: Record<string, string> = { owner: 'Sócia/administradora', editor: 'Operação', viewer: 'Somente leitura' };
const STATUS_NAMES: Record<string, string> = { active: 'Ativa', cancelled: 'Cancelada' };
const KIND_NAMES: Record<string, string> = { receipt: 'Recebimento', refund: 'Reembolso' };

export function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key.replace(/_/g, ' ');
}

/** Valor legível para um campo do histórico. */
export function formatAuditValue(key: string, value: unknown, timeZone: string, profiles: Record<string, string> = {}): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (key.endsWith('_cents') && (typeof value === 'number' || /^-?\d+$/.test(String(value)))) return formatBRL(Number(value));
  const text = String(value);
  if (key === 'role') return ROLE_NAMES[text] ?? text;
  if (key === 'status') return STATUS_NAMES[text] ?? text;
  if (key === 'kind') return KIND_NAMES[text] ?? text;
  if (key === 'method' || key === 'payment_method' || key === 'forma_pagamento') return paymentMethodLabel(text);
  if (/_by$|^user_id$|^received_by$/.test(key)) return profiles[text] ?? 'Outro usuário';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return formatDateBR(text);
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return formatDateTimeBR(text, timeZone);
  if (typeof value === 'object') return JSON.stringify(value);
  return text;
}

export interface FieldChange {
  key: string;
  label: string;
  from: string;
  to: string;
}

/** Converte details.alteracoes ({campo: {de, para}}) em linhas legíveis. */
export function describeChanges(details: Json, timeZone: string, profiles: Record<string, string> = {}): FieldChange[] {
  const changes = asObject(details.alteracoes);
  if (!changes) return [];
  return Object.entries(changes)
    .filter(([key]) => !HIDDEN_FIELDS.has(key))
    .map(([key, change]) => {
      const pair = asObject(change) ?? {};
      return {
        key,
        label: fieldLabel(key),
        from: formatAuditValue(key, pair.de, timeZone, profiles),
        to: formatAuditValue(key, pair.para, timeZone, profiles),
      };
    });
}

/** Campos visíveis de um registro simples (chave → valor legível). */
export function describeRecord(record: Json, timeZone: string, profiles: Record<string, string> = {}): Array<{ key: string; label: string; value: string }> {
  return Object.entries(record)
    .filter(([key, value]) => !HIDDEN_FIELDS.has(key) && value !== null && value !== '' && !Array.isArray(value) && typeof value !== 'object')
    .map(([key, value]) => ({ key, label: fieldLabel(key), value: formatAuditValue(key, value, timeZone, profiles) }));
}

function money(value: unknown): string | null {
  return typeof value === 'number' ? formatBRL(value) : null;
}

function change(details: Json, key: string): { de: unknown; para: unknown } | null {
  const changes = asObject(details.alteracoes);
  const entry = changes ? asObject(changes[key]) : null;
  return entry ? { de: entry.de, para: entry.para } : null;
}

/** Resumo de uma linha: sobre o quê foi a operação (cliente, valor, motivo…). */
export function summarizeAudit(row: Pick<AuditRow, 'action' | 'details'>): string | null {
  const details = row.details as Json;
  const record = asObject(details.registro);
  const parts = (...values: Array<string | null | undefined | false>) => values.filter(Boolean).join(' · ') || null;
  switch (row.action) {
    case 'sale.created': {
      const sale = asObject(details.venda);
      const items = Array.isArray(sale?.itens) ? sale.itens.length : 0;
      return sale ? parts(String(sale.cliente ?? 'Sem cliente'), money(sale.total_cents), `${items} ${items === 1 ? 'item' : 'itens'}`) : null;
    }
    case 'sale.updated': {
      const before = asObject(details.antes);
      const after = asObject(details.depois);
      if (!after) return null;
      const total = before && before.total_cents !== after.total_cents ? `total ${money(before.total_cents)} → ${money(after.total_cents)}` : money(after.total_cents);
      return parts(String(after.cliente ?? 'Sem cliente'), total);
    }
    case 'sale.cancelled':
    case 'purchase.cancelled':
    case 'expense.cancelled': {
      const reason = change(details, 'cancel_reason')?.para;
      return reason ? `Motivo: ${String(reason)}` : null;
    }
    case 'sale.due_date_changed': {
      const due = change(details, 'due_date');
      if (!due) return null;
      const show = (value: unknown) => (value ? formatDateBR(String(value)) : 'sem vencimento');
      return `Vencimento ${show(due.de)} → ${show(due.para)}`;
    }
    case 'payment.created':
    case 'payment.refunded':
    case 'bill_payment.created':
      return record
        ? parts(money(record.amount_cents), record.method ? paymentMethodLabel(String(record.method)) : null, record.paid_on ? formatDateBR(String(record.paid_on)) : record.due_date ? `vence ${formatDateBR(String(record.due_date))}` : null)
        : null;
    case 'bill_payment.paid': {
      const paidOn = change(details, 'paid_on')?.para;
      return paidOn ? `Pago em ${formatDateBR(String(paidOn))}` : null;
    }
    case 'payment.voided':
    case 'bill_payment.voided': {
      const reason = change(details, 'void_reason')?.para;
      return reason ? `Motivo: ${String(reason)}` : null;
    }
    case 'purchase.created': {
      const purchase = asObject(details.compra);
      return purchase ? parts(String(purchase.description ?? ''), money(purchase.total_cents)) : null;
    }
    case 'expense.created':
      return record ? parts(String(record.description ?? ''), money(record.amount_cents)) : null;
    case 'import.completed':
      return parts(String(details.arquivo ?? ''), typeof details.importadas === 'number' ? `${details.importadas} importadas` : null, typeof details.duplicadas === 'number' && details.duplicadas > 0 ? `${details.duplicadas} duplicadas` : null);
    case 'member.created':
    case 'member.deleted': {
      const roles: Record<string, string> = { owner: 'Sócia/administradora', editor: 'Operação', viewer: 'Somente leitura' };
      return record?.role ? `Papel: ${roles[String(record.role)] ?? String(record.role)}` : null;
    }
    case 'member.updated': {
      const role = change(details, 'role');
      return role ? `Papel alterado: ${String(role.de)} → ${String(role.para)}` : null;
    }
    case 'business.updated': {
      const changes = asObject(details.alteracoes);
      return changes ? `Alterado: ${Object.keys(changes).map(fieldLabel).join(', ')}` : null;
    }
    default:
      return null;
  }
}
