import { describe, expect, it } from 'vitest';
import { chunk } from '@/data/imports';
import type { ColumnMapping, PreviewRow } from '@/lib/import/types';
import { canIgnore, editableCellText, importableCount, mappingProblems, productsInMapping, rowDisplayStatus, sampleValues } from './import-helpers';

const serial = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000 + 25569;

function row(rowNumber: number, status: PreviewRow['status']): PreviewRow {
  return {
    rowNumber,
    raw: {},
    status,
    errors: [],
    warnings: [],
    inferredFields: [],
    sale: null,
    contentKey: null,
    fingerprint: null,
    sameAsRow: null,
    alreadyImported: status === 'duplicate',
  };
}

describe('texto editável das células', () => {
  it('converte serial do Excel em data e números em dinheiro/quantidade no padrão brasileiro', () => {
    expect(editableCellText(serial('2025-03-05'), 'date')).toBe('05/03/2025');
    expect(editableCellText(24.5, 'line_total')).toBe('24,50');
    expect(editableCellText(1.5, 'quantity')).toBe('1,5');
    expect(editableCellText('sim', 'paid')).toBe('sim');
    expect(editableCellText(null, 'customer')).toBe('');
  });

  it('amostra os primeiros valores não vazios', () => {
    const rows = [{ cells: [null] }, { cells: [serial('2025-03-05')] }, { cells: [serial('2025-03-06')] }];
    expect(sampleValues(rows, 0, 'date')).toEqual(['05/03/2025', '06/03/2025']);
  });
});

describe('validação do mapeamento', () => {
  const base: ColumnMapping[] = [{ index: 0, header: 'Data', role: 'date' }];

  it('exige data e produto conforme o formato', () => {
    expect(mappingProblems([], 'long')).toContain('Escolha a coluna com a data da venda.');
    expect(mappingProblems(base, 'long')[0]).toMatch(/nome do produto/);
    expect(mappingProblems(base, 'wide')[0]).toMatch(/Quantidade de um produto/);
    expect(mappingProblems([...base, { index: 1, header: 'Bolo', role: 'product_quantity', productId: null }], 'wide')).toContain(
      'Relacione cada coluna de produto a um produto do cadastro.',
    );
    expect(mappingProblems([...base, { index: 1, header: 'Bolo', role: 'product_quantity', productId: 'p1' }], 'wide')).toEqual([]);
  });

  it('não permite o mesmo papel em duas colunas', () => {
    const columns: ColumnMapping[] = [...base, { index: 1, header: 'Dia', role: 'date' }, { index: 2, header: 'Produto', role: 'product' }];
    expect(mappingProblems(columns, 'long').some((p) => p.includes('Mais de uma coluna'))).toBe(true);
  });

  it('lista os produtos envolvidos sem repetir', () => {
    expect(
      productsInMapping(
        [
          { index: 1, header: 'A', role: 'product_quantity', productId: 'p1' },
          { index: 2, header: 'B', role: 'product_quantity', productId: 'p2' },
        ],
        ['p2', null, 'p3'],
      ),
    ).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('linhas a importar', () => {
  const rows = [row(2, 'ok'), row(3, 'warning'), row(4, 'error'), row(5, 'empty'), row(6, 'duplicate'), row(7, 'ok')];

  it('conta só prontas/com aviso não ignoradas', () => {
    expect(importableCount(rows, new Set())).toBe(3);
    expect(importableCount(rows, new Set([7]))).toBe(2);
  });

  it('linhas com erro ou vazias não podem ser “incluídas”', () => {
    expect(rows.map(canIgnore)).toEqual([true, true, false, false, true, true]);
    expect(rowDisplayStatus(rows[0]!, new Set([2]))).toBe('ignored');
    expect(rowDisplayStatus(rows[2]!, new Set([4]))).toBe('error');
  });

  it('divide consultas em lotes', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
