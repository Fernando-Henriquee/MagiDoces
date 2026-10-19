import { normalizeName, parseCellDate, parseCellNumber, parsePaidFlag } from './normalize';
import type { CellValue, ColumnMapping, ColumnRole, Layout, ProductRef } from './types';

/**
 * Sugere o papel de cada coluna a partir do cabeçalho e de uma amostra de valores.
 * A sugestão é sempre editável pelo usuário na tela de mapeamento.
 */

const HEADER_PATTERNS: Array<{ role: ColumnRole; patterns: RegExp[] }> = [
  { role: 'payment_date', patterns: [/^(data|dt) (do |de )?(pagamento|pgto|pagto|recebimento)/, /^(pago|recebido) em/, /^data pago$/] },
  { role: 'due_date', patterns: [/venc/, /^prazo/, /^(pagar|receber) (em|ate)/, /^previs/, /^data prevista/] },
  { role: 'date', patterns: [/^(data|dt|dia)( (da )?(venda|pedido|compra|entrega))?$/, /^data/] },
  { role: 'customer', patterns: [/^(cliente|clientes|nome|comprador|compradora|freguesa?)\b/] },
  { role: 'paid_amount', patterns: [/^(valor|vl) (pago|recebido)/, /^recebido$/, /^pago r/] },
  { role: 'payment_method', patterns: [/^forma/, /^meio/, /^metodo/, /^tipo de pagamento/] },
  { role: 'paid', patterns: [/^pago\??$/, /^pagou\??$/, /^status/, /^situacao/, /^pagamento$/, /^quitado/] },
  { role: 'quantity', patterns: [/^(qtd|qtde|qte|qt|quant|quantidade|unidades|un)\b/] },
  { role: 'unit_price', patterns: [/(preco|valor|vl) (unit|unitario|un)\b/, /^preco$/, /^unitario/] },
  { role: 'line_total', patterns: [/^(valor|vl)? ?total/, /^valor$/, /^subtotal/, /^vl$/] },
  { role: 'product', patterns: [/^(produto|produtos|item|itens|doce|doces|sabor|descricao)\b/] },
  { role: 'notes', patterns: [/^(obs|observacao|observacoes|nota|notas|anotacao|anotacoes|comentario)/] },
];

export function roleFromHeader(header: string): ColumnRole | null {
  const text = normalizeName(header);
  if (!text) return null;
  for (const { role, patterns } of HEADER_PATTERNS) {
    if (patterns.some((pattern) => pattern.test(text))) return role;
  }
  return null;
}

/** Produto cujo nome corresponde ao cabeçalho (igual, ou um contém o outro). */
export function matchProduct(name: string, products: ProductRef[]): ProductRef | null {
  const target = normalizeName(name);
  if (!target) return null;
  const exact = products.find((product) => normalizeName(product.name) === target);
  if (exact) return exact;
  const singular = target.replace(/s\b/g, '');
  const loose = products.filter((product) => {
    const candidate = normalizeName(product.name);
    const candidateSingular = candidate.replace(/s\b/g, '');
    return (
      candidateSingular === singular ||
      (target.length >= 4 && candidate.includes(target)) ||
      (candidate.length >= 4 && target.includes(candidate))
    );
  });
  return loose.length === 1 ? (loose[0] ?? null) : null;
}

function sampleColumn(rows: CellValue[][], index: number): CellValue[] {
  return rows
    .map((row) => row[index] ?? null)
    .filter((cell) => cell !== null && String(cell).trim() !== '')
    .slice(0, 30);
}

export interface MappingSuggestion {
  layout: Layout;
  columns: ColumnMapping[];
}

export function suggestMapping(headers: string[], dataRows: CellValue[][], products: ProductRef[]): MappingSuggestion {
  const used = new Set<ColumnRole>();
  const columns = headers.map((header, index): ColumnMapping => {
    const product = matchProduct(header, products);
    const byHeader = roleFromHeader(header);
    const sample = sampleColumn(dataRows, index);

    // Coluna com nome de produto e valores majoritariamente numéricos: quantidade daquele
    // produto (layout largo). Células inválidas viram erro na própria linha, na prévia.
    const numeric = sample.filter((cell) => parseCellNumber(cell) !== null).length;
    if (product && byHeader !== 'product' && numeric >= Math.max(1, sample.length * 0.7)) {
      return { index, header, role: 'product_quantity', productId: product.id };
    }

    let role: ColumnRole = byHeader ?? 'ignore';
    if (role === 'paid' && sample.length > 0 && sample.every((cell) => parsePaidFlag(cell) === 'unknown')) {
      role = sample.every((cell) => parseCellNumber(cell) !== null) ? 'paid_amount' : 'ignore';
    }
    if ((role === 'date' || role === 'due_date' || role === 'payment_date') && sample.length > 0) {
      const dates = sample.filter((cell) => parseCellDate(cell) !== null).length;
      if (dates < sample.length * 0.5) role = 'ignore';
    }
    // Cada papel simples é usado uma vez; repetições ficam para o usuário decidir.
    if (role !== 'ignore' && used.has(role)) role = 'ignore';
    if (role !== 'ignore') used.add(role);
    return { index, header, role, productId: null };
  });

  const layout: Layout = columns.some((column) => column.role === 'product_quantity') ? 'wide' : 'long';
  return { layout, columns };
}
