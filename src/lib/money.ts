/**
 * Dinheiro sempre em centavos inteiros. Nunca usamos ponto flutuante para valores
 * persistidos. Regra de arredondamento (igual ao PostgreSQL `round()`):
 * meio centavo para longe do zero.
 */

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const decimal2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const MAX_CENTS = 100_000_000;

export function formatBRL(cents: number | bigint | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return brl.format(Number(cents) / 100);
}

/** "1.234,56" sem o símbolo da moeda (usado em CSV e campos editáveis). */
export function formatDecimalBR(cents: number | bigint): string {
  return decimal2.format(Number(cents) / 100);
}

/** Converte "1.234,56", "R$ 12,5", "12.50" ou "12" em centavos. Retorna null se inválido. */
export function parseBRL(input: string | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  let text = input.replace(/R\$/gi, '').replace(/\s| /g, '').trim();
  if (text === '') return null;
  let negative = false;
  if (text.startsWith('-')) {
    negative = true;
    text = text.slice(1);
  }
  let integerPart: string;
  let fractionPart = '';
  if (text.includes(',')) {
    // Formato brasileiro: vírgula decimal, ponto como separador de milhar.
    const [int, frac, ...rest] = text.split(',');
    if (rest.length > 0 || int === undefined) return null;
    if (!/^\d{1,3}(\.\d{3})*$|^\d+$/.test(int)) return null;
    integerPart = int.replace(/\./g, '');
    fractionPart = frac ?? '';
  } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
    integerPart = text.replace(/\./g, '');
  } else if (/^\d+\.\d{1,2}$/.test(text)) {
    [integerPart = '', fractionPart = ''] = text.split('.');
  } else if (/^\d+$/.test(text)) {
    integerPart = text;
  } else {
    return null;
  }
  if (!/^\d*$/.test(fractionPart) || fractionPart.length > 2) return null;
  const cents = Number(integerPart || '0') * 100 + Number(fractionPart.padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

/** Divide inteiros arredondando meio para longe do zero. */
export function divRoundHalfAwayFromZero(numerator: number, denominator: number): number {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || denominator === 0) {
    throw new Error('Divisão inteira inválida');
  }
  const sign = Math.sign(numerator) * Math.sign(denominator);
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  const quotient = Math.floor(n / d);
  const remainder = n - quotient * d;
  return sign * (remainder * 2 >= d ? quotient + 1 : quotient);
}

/** Quantidade com até 3 casas → milésimos inteiros. */
export function quantityToMilli(quantity: number): number {
  const milli = Math.round(quantity * 1000);
  if (Math.abs(milli / 1000 - quantity) > 1e-9) throw new Error('Quantidade com mais de 3 casas decimais');
  return milli;
}

/** round(quantidade × preço unitário), igual ao banco. */
export function lineSubtotalCents(quantity: number, unitPriceCents: number): number {
  return divRoundHalfAwayFromZero(quantityToMilli(quantity) * unitPriceCents, 1000);
}

/**
 * Converte um número decimal (ex.: célula do Excel com 12.5) em centavos,
 * arredondando meio para longe do zero na 3ª casa. Evita erros como 0.1 + 0.2.
 */
export function decimalNumberToCents(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const text = Math.abs(value).toFixed(6);
  const [int = '0', frac = ''] = text.split('.');
  const scaled = Number(int) * 1_000_000 + Number(frac.padEnd(6, '0'));
  const cents = divRoundHalfAwayFromZero(scaled, 10_000);
  return value < 0 ? -cents : cents;
}

/** Interpreta quantidades no formato brasileiro ("1,5") com até 3 casas. */
export function parseQuantity(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return Math.round(input * 1000) / 1000 === input ? input : null;
  }
  const text = input.replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(text)) return null;
  return Number(text);
}

export function formatQuantity(quantity: number | string): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(Number(quantity));
}

export function percent(part: number, whole: number): number | null {
  if (whole === 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value)}%`;
}
