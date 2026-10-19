import { Money } from '@/components/shared/money';
import { cn } from '@/lib/cn';

export function TotalsRow({ label, cents, strong, muted }: { label: string; cents: number; strong?: boolean; muted?: boolean }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 py-1 text-sm', strong && 'border-t border-line pt-2 font-semibold', muted && 'text-muted')}>
      <span>{label}</span>
      <Money cents={cents} />
    </div>
  );
}
