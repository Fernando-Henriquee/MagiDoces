import { describe, expect, it } from 'vitest';
import {
  decimalNumberToCents,
  divRoundHalfAwayFromZero,
  formatBRL,
  formatDecimalBR,
  lineSubtotalCents,
  parseBRL,
  parseQuantity,
} from './money';

const nbsp = (text: string) => text.replace(/\u00a0/g, ' ');

describe('formatBRL', () => {
  it('formata centavos em reais no padrão brasileiro', () => {
    expect(nbsp(formatBRL(123456))).toBe('R$ 1.234,56');
    expect(nbsp(formatBRL(5))).toBe('R$ 0,05');
    expect(nbsp(formatBRL(-1500))).toBe('-R$ 15,00');
    expect(formatBRL(null)).toBe('—');
  });

  it('formata decimal sem símbolo', () => {
    expect(formatDecimalBR(1234567)).toBe('12.345,67');
  });
});

describe('parseBRL', () => {
  it.each([
    ['12', 1200],
    ['12,5', 1250],
    ['12,50', 1250],
    ['1.234,56', 123456],
    ['R$ 1.234,56', 123456],
    ['R$\u00a015,00', 1500],
    ['0,99', 99],
    ['12.50', 1250],
    ['1.234', 123400],
    ['-3,10', -310],
  ])('"%s" → %i centavos', (input, expected) => {
    expect(parseBRL(input)).toBe(expected);
  });

  it.each(['', 'abc', '12,345', '1,2,3', '12.345,6.7', '12.3456', '1.23.4'])('rejeita "%s"', (input) => {
    expect(parseBRL(input)).toBeNull();
  });
});

describe('arredondamento', () => {
  it('meio para longe do zero', () => {
    expect(divRoundHalfAwayFromZero(5, 2)).toBe(3);
    expect(divRoundHalfAwayFromZero(-5, 2)).toBe(-3);
    expect(divRoundHalfAwayFromZero(4, 3)).toBe(1);
    expect(divRoundHalfAwayFromZero(1499, 1000)).toBe(1);
    expect(divRoundHalfAwayFromZero(1500, 1000)).toBe(2);
  });

  it('linha = round(quantidade × preço), igual ao banco', () => {
    expect(lineSubtotalCents(3, 1200)).toBe(3600);
    expect(lineSubtotalCents(1.5, 25)).toBe(38); // 37,5 → 38
    expect(lineSubtotalCents(0.333, 1000)).toBe(333);
    expect(lineSubtotalCents(2.125, 1)).toBe(2); // 2,125 → 2
    expect(lineSubtotalCents(0.1, 3)).toBe(0); // 0,3 → 0
  });

  it('rejeita quantidade com mais de 3 casas', () => {
    expect(() => lineSubtotalCents(1.0001, 100)).toThrow();
  });
});

describe('decimalNumberToCents', () => {
  it('converte números de planilha sem erro de ponto flutuante', () => {
    expect(decimalNumberToCents(12.5)).toBe(1250);
    expect(decimalNumberToCents(0.1 + 0.2)).toBe(30);
    expect(decimalNumberToCents(1.005)).toBe(101);
    expect(decimalNumberToCents(19.99)).toBe(1999);
    expect(decimalNumberToCents(-2.5)).toBe(-250);
    expect(decimalNumberToCents(Number.NaN)).toBeNull();
  });
});

describe('parseQuantity', () => {
  it('aceita vírgula decimal até 3 casas', () => {
    expect(parseQuantity('1,5')).toBe(1.5);
    expect(parseQuantity('2')).toBe(2);
    expect(parseQuantity('0,125')).toBe(0.125);
    expect(parseQuantity(3)).toBe(3);
    expect(parseQuantity('1,2345')).toBeNull();
    expect(parseQuantity('-1')).toBeNull();
    expect(parseQuantity('abc')).toBeNull();
  });
});
