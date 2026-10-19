import { formatDateBR } from './dates';
import { formatBRL } from './money';
import type { CustomerGroup } from './receivables';

/**
 * Resumo de cobrança para copiar/enviar pelo WhatsApp. Lista cada venda em aberto
 * (sem perder o detalhamento) e o total consolidado do cliente.
 */

export interface ChargeOptions {
  businessName: string;
  pixKey?: string | null;
  footer?: string | null;
}

export function buildChargeMessage(group: CustomerGroup, options: ChargeOptions): string {
  const firstName = group.customerName.trim().split(/\s+/)[0] ?? group.customerName;
  const lines: string[] = [];
  lines.push(`Olá, ${firstName}! Tudo bem?`);
  lines.push(`Segue o resumo dos seus pedidos em aberto na ${options.businessName}:`);
  lines.push('');
  for (const sale of group.sales) {
    const what = sale.items_summary ? ` — ${sale.items_summary}` : '';
    lines.push(`• ${formatDateBR(sale.sale_date)}${what}`);
    const parts = [`total ${formatBRL(sale.total_cents)}`];
    if (sale.net_paid_cents > 0) parts.push(`pago ${formatBRL(sale.net_paid_cents)}`);
    parts.push(`em aberto ${formatBRL(sale.balance_cents)}`);
    if (sale.due_date) parts.push(`${sale.is_overdue ? 'venceu em' : 'vence em'} ${formatDateBR(sale.due_date)}`);
    lines.push(`  ${parts.join(' · ')}`);
  }
  lines.push('');
  lines.push(`*Total em aberto: ${formatBRL(group.balanceCents)}*`);
  if (group.overdueCents > 0 && group.overdueCents !== group.balanceCents) {
    lines.push(`Dos quais vencidos: ${formatBRL(group.overdueCents)}`);
  }
  if (options.pixKey) {
    lines.push('');
    lines.push(`Chave PIX: ${options.pixKey}`);
  }
  lines.push('');
  lines.push(options.footer?.trim() || 'Qualquer dúvida, é só chamar. Agradecemos a preferência!');
  // Intl usa espaço não separável em "R$ 10,00"; troca por espaço comum para colar em qualquer app.
  return lines.join('\n').replace(/\u00a0/g, ' ');
}

/** Normaliza telefone brasileiro para o formato internacional usado pelo wa.me. */
export function normalizePhoneBR(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return digits;
  return null;
}

export function whatsappLink(phone: string | null | undefined, text: string): string | null {
  const normalized = normalizePhoneBR(phone);
  if (!normalized) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(text)}`;
}

export function formatPhoneBR(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return phone;
}
