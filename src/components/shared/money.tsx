import { cn } from '@/lib/cn';
import { formatBRL } from '@/lib/money';

export function Money({ cents, className, signed = false }: { cents: number | null | undefined; className?: string; signed?: boolean }) {
  const value = cents ?? null;
  const tone = signed && value !== null ? (value < 0 ? 'text-danger' : value > 0 ? 'text-success' : '') : '';
  return <span className={cn('num whitespace-nowrap', tone, className)}>{signed && value !== null && value > 0 ? '+' : ''}{formatBRL(value)}</span>;
}
