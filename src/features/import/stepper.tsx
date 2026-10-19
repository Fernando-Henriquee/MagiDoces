import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface StepInfo {
  id: string;
  label: string;
}

/** Indicador de etapas do assistente (lista ordenada com aria-current). */
export function Stepper({ steps, current }: { steps: StepInfo[]; current: string }) {
  const currentIndex = steps.findIndex((step) => step.id === current);
  return (
    <nav aria-label="Etapas da importação" className="relative mb-5 overflow-x-auto">
      <ol className="flex min-w-max items-center gap-2">
        {steps.map((step, index) => {
          const done = index < currentIndex;
          const active = index === currentIndex;
          return (
            <li key={step.id} className="flex items-center gap-2" aria-current={active ? 'step' : undefined}>
              <span
                className={cn(
                  'grid size-7 place-items-center rounded-full border text-xs font-semibold',
                  done && 'border-success bg-success text-white',
                  active && 'border-brand bg-brand text-brand-fg',
                  !done && !active && 'border-line-strong bg-panel text-muted',
                )}
              >
                {done ? <Check className="size-3.5" aria-hidden /> : index + 1}
              </span>
              <span className={cn('text-sm', active ? 'font-semibold text-ink' : 'sr-only text-muted sm:not-sr-only')}>
                {step.label}
                {done ? <span className="sr-only"> (concluída)</span> : null}
              </span>
              {index < steps.length - 1 ? <span aria-hidden className="mx-1 h-px w-3 bg-line-strong sm:w-6" /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
