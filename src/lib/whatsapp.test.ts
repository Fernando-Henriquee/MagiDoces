import { describe, expect, it } from 'vitest';
import { toCSV, toSheetRows } from './export';
import { groupByCustomer, type ReceivableSale } from './receivables';
import { buildChargeMessage, formatPhoneBR, normalizePhoneBR, whatsappLink } from './whatsapp';

const sales: ReceivableSale[] = [
  {
    id: '1', customer_id: 'c1', customer_name: 'Maria Souza', customer_phone: '(11) 98888-7777',
    sale_date: '2026-10-01', due_date: '2026-10-10', total_cents: 3900, net_paid_cents: 1000, balance_cents: 2900,
    payment_status: 'partial', is_overdue: true, payment_confirmation_pending: false,
    items_summary: '2× Bolo de pote, 1× Torta de limão', status: 'active',
  },
  {
    id: '2', customer_id: 'c1', customer_name: 'Maria Souza', customer_phone: '(11) 98888-7777',
    sale_date: '2026-10-15', due_date: '2026-11-10', total_cents: 1200, net_paid_cents: 0, balance_cents: 1200,
    payment_status: 'pending', is_overdue: false, payment_confirmation_pending: false,
    items_summary: '1× Morango cravejado', status: 'active',
  },
];

describe('mensagem de cobrança', () => {
  it('detalha cada venda e consolida o total do cliente', () => {
    const [group] = groupByCustomer(sales);
    const text = buildChargeMessage(group!, { businessName: 'Magi Doces', pixKey: 'magi@exemplo.com' });
    expect(text).toBe(
      [
        'Olá, Maria! Tudo bem?',
        'Segue o resumo dos seus pedidos em aberto na Magi Doces:',
        '',
        '• 01/10/2026 — 2× Bolo de pote, 1× Torta de limão',
        '  total R$ 39,00 · pago R$ 10,00 · em aberto R$ 29,00 · venceu em 10/10/2026',
        '• 15/10/2026 — 1× Morango cravejado',
        '  total R$ 12,00 · em aberto R$ 12,00 · vence em 10/11/2026',
        '',
        '*Total em aberto: R$ 41,00*',
        'Dos quais vencidos: R$ 29,00',
        '',
        'Chave PIX: magi@exemplo.com',
        '',
        'Qualquer dúvida, é só chamar. Agradecemos a preferência!',
      ].join('\n'),
    );
  });
});

describe('telefone', () => {
  it('normaliza para o wa.me', () => {
    expect(normalizePhoneBR('(11) 98888-7777')).toBe('5511988887777');
    expect(normalizePhoneBR('+55 11 98888-7777')).toBe('5511988887777');
    expect(normalizePhoneBR('1133334444')).toBe('551133334444');
    expect(normalizePhoneBR('12345')).toBeNull();
    expect(whatsappLink('11988887777', 'Olá & até')).toBe('https://wa.me/5511988887777?text=Ol%C3%A1%20%26%20at%C3%A9');
    expect(whatsappLink(null, 'x')).toBeNull();
  });

  it('formata para exibição', () => {
    expect(formatPhoneBR('11988887777')).toBe('(11) 98888-7777');
    expect(formatPhoneBR('5511333344444'.slice(0, 12))).toBe('(11) 3333-4444');
  });
});

describe('exportação', () => {
  const columns = [
    { header: 'Cliente', value: (s: ReceivableSale) => s.customer_name },
    { header: 'Data', value: (s: ReceivableSale) => s.sale_date, kind: 'date' as const },
    { header: 'Saldo', value: (s: ReceivableSale) => s.balance_cents, kind: 'money' as const },
    { header: 'Itens', value: (s: ReceivableSale) => s.items_summary },
  ];

  it('gera CSV no padrão brasileiro com BOM e escapes', () => {
    const csv = toCSV(sales, columns);
    expect(csv.startsWith('\ufeff')).toBe(true);
    expect(csv.slice(1).split('\r\n')).toEqual([
      'Cliente;Data;Saldo;Itens',
      'Maria Souza;01/10/2026;29,00;2× Bolo de pote, 1× Torta de limão',
      'Maria Souza;15/10/2026;12,00;1× Morango cravejado',
    ]);
  });

  it('neutraliza fórmulas e escapa separadores', () => {
    const csv = toCSV([{ a: '=HYPERLINK("x")' }, { a: 'a;b' }, { a: '-12,50' }], [{ header: 'A', value: (r: { a: string }) => r.a }]);
    expect(csv.slice(1).split('\r\n')).toEqual(['A', `"'=HYPERLINK(""x"")"`, '"a;b"', '-12,50']);
  });

  it('planilha recebe números em reais', () => {
    expect(toSheetRows(sales.slice(0, 1), columns)).toEqual([
      { Cliente: 'Maria Souza', Data: '01/10/2026', Saldo: 29, Itens: '2× Bolo de pote, 1× Torta de limão' },
    ]);
  });
});
