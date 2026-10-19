import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { formatBRL } from '@/lib/money';

interface StatProps {
  label: string;
  cents: number | null | undefined;
  hint?: ReactNode;
  badge?: ReactNode;
  tone?: 'default' | 'positive' | 'negative' | 'warning' | 'accent';
  signed?: boolean;
  className?: string;
}

const toneClass = {
  default: 'text-ink',
  positive: 'text-success',
  negative: 'text-danger',
  warning: 'text-warning',
  accent: 'text-accent-ink',
};

/** Indicador financeiro compacto. */
export function Stat({ label, cents, hint, badge, tone = 'default', signed = false, className }: StatProps) {
  const value = cents ?? 0;
  const effectiveTone = signed ? (value < 0 ? 'negative' : value > 0 ? 'positive' : 'default') : tone;
  return (
    <div className={cn('flex min-w-0 flex-col gap-1 rounded-[var(--radius-card)] border border-line bg-panel px-3.5 py-3 shadow-[var(--shadow-card)]', className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <p className="text-xs font-medium leading-tight text-muted">{label}</p>
        {badge}
      </div>
      <p className={cn('num text-lg font-semibold leading-tight sm:text-xl', toneClass[effectiveTone])}>
        {signed && value > 0 ? '+' : ''}
        {formatBRL(cents ?? null)}
      </p>
      {hint ? <p className="text-xs leading-snug text-muted">{hint}</p> : null}
    </div>
  );
}
