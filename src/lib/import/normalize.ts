import { excelSerialToISO, type ISODate, isValidISODate, parseDateBR } from '../dates';
import { decimalNumberToCents, parseBRL } from '../money';
import type { CellValue } from './types';

/** Minúsculas, sem acentos, espaços colapsados — para comparar nomes. */
export function normalizeName(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cellText(value: CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

export function isEmptyCell(value: CellValue): boolean {
  return cellText(value) === '';
}

/** Datas: serial do Excel, Date, "DD/MM/AAAA", "D/M/AA" ou "AAAA-MM-DD". */
export function parseCellDate(value: CellValue): ISODate | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return excelSerialToISO(value);
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (text === '') return null;
  const iso = text.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso) && isValidISODate(iso)) return iso;
  return parseDateBR(text);
}

/** Números no formato brasileiro ou do Excel. */
export function parseCellNumber(value: CellValue): number | null {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return null;
  const text = String(value).replace(/R\$/gi, '').replace(/\s|\u00a0/g, '');
  if (text === '') return null;
  let normalized: string;
  if (text.includes(',')) {
    normalized = text.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
    normalized = text.replace(/\./g, '');
  } else {
    normalized = text;
  }
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  return Number(normalized);
}

/** Valor monetário em centavos. */
export function parseCellMoney(value: CellValue): number | null {
  if (typeof value === 'number') return decimalNumberToCents(value);
  if (value === null || value === undefined || typeof value === 'boolean' || value instanceof Date) return null;
  return parseBRL(String(value));
}

const PAID_TRUE = new Set(['sim', 's', 'pago', 'paga', 'pg', 'ok', 'x', 'yes', 'y', 'true', '1', 'quitado', 'quitada', 'recebido', 'recebida', 'pagou']);
const PAID_FALSE = new Set(['nao', 'n', 'no', 'false', '0', 'pendente', 'aberto', 'em aberto', 'fiado', 'a pagar', 'devendo', 'deve', 'nao pago', 'nao pagou', 'a receber']);

export type PaidFlag = 'paid' | 'unpaid' | 'unknown';

/** Interpreta a coluna "pago". Vazio ou desconhecido = desconhecido (nunca presumido pago). */
export function parsePaidFlag(value: CellValue): PaidFlag {
  if (typeof value === 'boolean') return value ? 'paid' : 'unpaid';
  const raw = cellText(value);
  if (raw === '✓' || raw === '✔' || raw === '✅') return 'paid';
  const text = normalizeName(raw);
  if (text === '') return 'unknown';
  if (PAID_TRUE.has(text)) return 'paid';
  if (PAID_FALSE.has(text)) return 'unpaid';
  return 'unknown';
}

export type PaymentMethodValue = 'pix' | 'dinheiro' | 'cartao_credito' | 'cartao_debito' | 'transferencia' | 'boleto' | 'outro';

export function parsePaymentMethod(value: CellValue): PaymentMethodValue | null {
  const text = normalizeName(cellText(value));
  if (text === '') return null;
  if (text.includes('pix')) return 'pix';
  if (/(dinheiro|especie|cash|nota)/.test(text)) return 'dinheiro';
  if (/(credito|credit)/.test(text)) return 'cartao_credito';
  if (/(debito|debit)/.test(text)) return 'cartao_debito';
  if (/(cartao|card|maquininha)/.test(text)) return 'cartao_credito';
  if (/(transf|ted|doc)/.test(text)) return 'transferencia';
  if (text.includes('boleto')) return 'boleto';
  return 'outro';
}
