import { describe, expect, it } from 'vitest';
import { describeAction, describeChanges, describeRecord, entityLink, formatAuditValue, zonedDayStart, zonedRange, summarizeAudit } from './audit-format';

const nbsp = (text: string) => text.replace(/\u00a0/g, ' ');
const noLinks = { payments: {}, billPayments: {} };

describe('limites de dia no fuso do negócio', () => {
  it('converte 00:00 de São Paulo para UTC', () => {
    expect(zonedDayStart('2026-10-19', 'America/Sao_Paulo')).toBe('2026-10-19T03:00:00.000Z');
    expect(zonedDayStart('2026-10-19', 'UTC')).toBe('2026-10-19T00:00:00.000Z');
    expect(zonedDayStart('2026-10-19', 'Asia/Tokyo')).toBe('2026-10-18T15:00:00.000Z');
  });

  it('intervalo [início, fim) cobre o último dia inteiro', () => {
    expect(zonedRange('2026-10-01', '2026-10-31', 'America/Sao_Paulo')).toEqual({
      fromInstant: '2026-10-01T03:00:00.000Z',
      toInstant: '2026-11-01T03:00:00.000Z',
    });
  });
});

describe('descrição das ações', () => {
  it('traduz ações conhecidas e mantém as desconhecidas', () => {
    expect(describeAction({ action: 'sale.created', details: {} })).toBe('Venda registrada');
    expect(describeAction({ action: 'sale.due_date_changed', details: {} })).toBe('Vencimento alterado');
    expect(describeAction({ action: 'payment.refunded', details: {} })).toBe('Reembolso registrado');
    expect(describeAction({ action: 'import.completed', details: {} })).toBe('Importação concluída');
    expect(describeAction({ action: 'algo.novo', details: {} })).toBe('algo.novo');
  });

  it('distingue parcela prevista de pagamento realizado', () => {
    expect(describeAction({ action: 'bill_payment.created', details: { registro: { paid_on: null } } })).toBe('Parcela prevista lançada');
    expect(describeAction({ action: 'bill_payment.created', details: { registro: { paid_on: '2026-10-01' } } })).toBe(
      'Pagamento de conta registrado',
    );
  });
});

describe('links para a entidade', () => {
  it('aponta para a tela certa', () => {
    expect(entityLink({ entity: 'sale', entity_id: 's1', details: {} }, noLinks)).toBe('/vendas/s1');
    expect(entityLink({ entity: 'payment', entity_id: 'p1', details: {} }, { payments: { p1: 's9' }, billPayments: {} })).toBe('/vendas/s9');
    expect(entityLink({ entity: 'payment', entity_id: 'p2', details: { registro: { sale_id: 's2' } } }, noLinks)).toBe('/vendas/s2');
    expect(
      entityLink({ entity: 'bill_payment', entity_id: 'b1', details: {} }, { payments: {}, billPayments: { b1: { kind: 'expense', billId: 'e1' } } }),
    ).toBe('/despesas/e1');
    expect(entityLink({ entity: 'import_batch', entity_id: 'i1', details: {} }, noLinks)).toBe('/importar/lotes/i1');
    expect(entityLink({ entity: 'payment', entity_id: 'p3', details: {} }, noLinks)).toBeNull();
  });
});

describe('formatação de valores', () => {
  it('centavos, datas, booleanos, papéis e usuários', () => {
    expect(nbsp(formatAuditValue('discount_cents', 1250, 'America/Sao_Paulo'))).toBe('R$ 12,50');
    expect(formatAuditValue('due_date', '2026-11-10', 'America/Sao_Paulo')).toBe('10/11/2026');
    expect(formatAuditValue('cancelled_at', '2026-10-19T15:30:00+00:00', 'America/Sao_Paulo')).toBe('19/10/2026 12:30');
    expect(formatAuditValue('payment_confirmation_pending', false, 'UTC')).toBe('Não');
    expect(formatAuditValue('role', 'owner', 'UTC')).toBe('Sócia/administradora');
    expect(formatAuditValue('method', 'pix', 'UTC')).toBe('PIX');
    expect(formatAuditValue('voided_by', 'u1', 'UTC', { u1: 'Ana' })).toBe('Ana');
    expect(formatAuditValue('notes', null, 'UTC')).toBe('—');
  });

  it('descreve alterações "de → para" e omite campos técnicos', () => {
    const changes = describeChanges(
      {
        alteracoes: {
          due_date: { de: '2026-10-10', para: '2026-11-10' },
          discount_cents: { de: 0, para: 500 },
          updated_by: { de: 'a', para: 'b' },
        },
      },
      'America/Sao_Paulo',
    );
    expect(changes.map((c) => [c.label, nbsp(c.from), nbsp(c.to)])).toEqual([
      ['Vencimento', '10/10/2026', '10/11/2026'],
      ['Desconto', 'R$ 0,00', 'R$ 5,00'],
    ]);
  });

  it('descreve um registro simples', () => {
    const fields = describeRecord({ id: 'x', business_id: 'y', kind: 'receipt', amount_cents: 2400, paid_on: '2026-10-01', notes: null }, 'UTC');
    expect(fields.map((f) => [f.label, nbsp(f.value)])).toEqual([
      ['Tipo', 'Recebimento'],
      ['Valor', 'R$ 24,00'],
      ['Data do pagamento', '01/10/2026'],
    ]);
  });
});

describe('summarizeAudit', () => {
  const nbsp = (text: string | null) => text?.replace(/ /g, ' ') ?? null;
  it('resume venda, recebimento, vencimento e cancelamento', () => {
    expect(nbsp(summarizeAudit({ action: 'sale.created', details: { venda: { cliente: 'Maria', total_cents: 3900, itens: [{}, {}] } } }))).toBe('Maria · R$ 39,00 · 2 itens');
    expect(nbsp(summarizeAudit({ action: 'payment.created', details: { registro: { amount_cents: 1250, method: 'pix', paid_on: '2026-10-19' } } }))).toBe('R$ 12,50 · PIX · 19/10/2026');
    expect(summarizeAudit({ action: 'sale.due_date_changed', details: { alteracoes: { due_date: { de: '2026-10-10', para: null } } } })).toBe('Vencimento 10/10/2026 → sem vencimento');
    expect(summarizeAudit({ action: 'sale.cancelled', details: { alteracoes: { cancel_reason: { de: null, para: 'Desistiu' } } } })).toBe('Motivo: Desistiu');
    expect(nbsp(summarizeAudit({ action: 'sale.updated', details: { antes: { cliente: 'Ana', total_cents: 1000 }, depois: { cliente: 'Ana', total_cents: 1500 } } }))).toBe('Ana · total R$ 10,00 → R$ 15,00');
    expect(summarizeAudit({ action: 'desconhecida', details: {} })).toBeNull();
  });
});
