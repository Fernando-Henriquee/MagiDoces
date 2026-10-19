import { type InputHTMLAttributes, useEffect, useState } from 'react';
import { formatDecimalBR, parseBRL, parseQuantity } from '@/lib/money';
import { cn } from '@/lib/cn';
import { Input } from './input';

interface MoneyInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  /** Valor em centavos (null = vazio). */
  value: number | null;
  onValueChange: (cents: number | null) => void;
}

/** Campo de valor em reais: aceita "12,5", "1.234,56"; guarda centavos inteiros. */
export function MoneyInput({ value, onValueChange, className, onBlur, ...props }: MoneyInputProps) {
  const [text, setText] = useState(value === null ? '' : formatDecimalBR(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(value === null ? '' : formatDecimalBR(value));
  }, [value, focused]);

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">R$</span>
      <Input
        inputMode="decimal"
        autoComplete="off"
        className={cn('num pl-9 text-right', className)}
        value={text}
        onFocus={() => setFocused(true)}
        onChange={(event) => {
          const next = event.target.value.replace(/[^\d.,-]/g, '');
          setText(next);
          onValueChange(next.trim() === '' ? null : parseBRL(next));
        }}
        onBlur={(event) => {
          setFocused(false);
          const parsed = parseBRL(text);
          setText(parsed === null ? text : formatDecimalBR(parsed));
          onBlur?.(event);
        }}
        {...props}
      />
    </div>
  );
}

interface QuantityInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: number | null;
  onValueChange: (value: number | null) => void;
}

/** Quantidade com até 3 casas decimais, vírgula decimal. */
export function QuantityInput({ value, onValueChange, className, ...props }: QuantityInputProps) {
  const [text, setText] = useState(value === null ? '' : String(value).replace('.', ','));
  useEffect(() => {
    const current = parseQuantity(text);
    if (current !== value) setText(value === null ? '' : String(value).replace('.', ','));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Input
      inputMode="decimal"
      autoComplete="off"
      className={cn('num text-right', className)}
      value={text}
      onChange={(event) => {
        const next = event.target.value.replace(/[^\d,.]/g, '');
        setText(next);
        onValueChange(parseQuantity(next));
      }}
      {...props}
    />
  );
}
