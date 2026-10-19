import type { CashFlowEntry } from '@/data/types';

/**
 * Organização das movimentações devolvidas por cash_flow_entries. O banco já
 * garante que cada movimentação aparece uma única vez (realizada OU prevista);
 * aqui apenas somamos e agrupamos para exibição.
 */

export type CashFlowView = 'all' | 'realized' | 'forecast';

export interface CashFlowSummary {
  realizedIn: number;
  realizedOut: number;
  realizedNet: number;
  forecastIn: number;
  forecastOut: number;
  forecastNet: number;
  overdueIn: number;
  overdueOut: number;
}

export interface CashFlowDay {
  date: string;
  entries: CashFlowEntry[];
  realizedIn: number;
  realizedOut: number;
  forecastIn: number;
  forecastOut: number;
  /** Saldo acumulado das movimentações REALIZADAS desde o início do período. */
  runningRealized: number;
}

const amount = (entry: CashFlowEntry) => Number(entry.amount_cents);

export function summarizeCashFlow(entries: CashFlowEntry[]): CashFlowSummary {
  const summary: CashFlowSummary = {
    realizedIn: 0,
    realizedOut: 0,
    realizedNet: 0,
    forecastIn: 0,
    forecastOut: 0,
    forecastNet: 0,
    overdueIn: 0,
    overdueOut: 0,
  };
  for (const entry of entries) {
    const value = amount(entry);
    if (entry.realized) {
      if (entry.direction === 'in') summary.realizedIn += value;
      else summary.realizedOut += value;
    } else {
      if (entry.direction === 'in') summary.forecastIn += value;
      else summary.forecastOut += value;
      if (entry.is_overdue) {
        if (entry.direction === 'in') summary.overdueIn += value;
        else summary.overdueOut += value;
      }
    }
  }
  summary.realizedNet = summary.realizedIn - summary.realizedOut;
  summary.forecastNet = summary.forecastIn - summary.forecastOut;
  return summary;
}

function entryOrder(a: CashFlowEntry, b: CashFlowEntry): number {
  if (a.realized !== b.realized) return a.realized ? -1 : 1;
  if (a.direction !== b.direction) return a.direction === 'in' ? -1 : 1;
  return a.description.localeCompare(b.description, 'pt-BR');
}

export function groupCashFlowByDay(entries: CashFlowEntry[], view: CashFlowView = 'all'): CashFlowDay[] {
  const byDate = new Map<string, CashFlowEntry[]>();
  for (const entry of entries) {
    const list = byDate.get(entry.entry_date) ?? [];
    list.push(entry);
    byDate.set(entry.entry_date, list);
  }
  let running = 0;
  const days: CashFlowDay[] = [];
  for (const date of [...byDate.keys()].sort()) {
    const all = byDate.get(date)!;
    const totals = summarizeCashFlow(all);
    running += totals.realizedNet;
    const visible = all.filter((entry) => view === 'all' || (view === 'realized' ? entry.realized : !entry.realized)).sort(entryOrder);
    if (visible.length === 0) continue;
    days.push({
      date,
      entries: visible,
      realizedIn: totals.realizedIn,
      realizedOut: totals.realizedOut,
      forecastIn: totals.forecastIn,
      forecastOut: totals.forecastOut,
      runningRealized: running,
    });
  }
  return days;
}

/** Link para o registro de origem da movimentação. */
export function entryHref(entry: Pick<CashFlowEntry, 'ref_kind' | 'ref_id'>): string {
  switch (entry.ref_kind) {
    case 'sale':
      return `/vendas/${entry.ref_id}`;
    case 'purchase':
      return `/compras/${entry.ref_id}`;
    default:
      return `/despesas/${entry.ref_id}`;
  }
}
