import { cn } from '@/lib/cn';

export function BrandMark({ className }: { className?: string }) {
  return <img src="/icon.svg" alt="" width={36} height={36} className={cn('size-9 rounded-xl', className)} />;
}

export function BrandName({ className }: { className?: string }) {
  return <span className={cn('font-display text-xl font-semibold tracking-tight text-ink', className)}>Magi Doces</span>;
}
