import { cloneElement, isValidElement, type ReactElement, type ReactNode, useId } from 'react';
import { cn } from '@/lib/cn';

interface FieldProps {
  label: ReactNode;
  /** Controle (Input, Select, MoneyInput…). Recebe id, aria-describedby e aria-invalid. */
  children: ReactElement<Record<string, unknown>>;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
  labelClassName?: string;
}

/** Rótulo + controle + ajuda + erro, com associação acessível (label/for, aria-describedby). */
export function Field({ label, children, hint, error, required, className, labelClassName }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  const control = isValidElement(children)
    ? cloneElement(children, {
        id: (children.props.id as string | undefined) ?? id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        'aria-required': required || undefined,
      })
    : children;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={(isValidElement(children) && (children.props.id as string | undefined)) || id} className={cn('text-sm font-medium text-ink-soft', labelClassName)}>
        {label}
        {required ? <span className="ml-0.5 text-danger" aria-hidden>*</span> : null}
      </label>
      {control}
      {hint && !error ? (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
