import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { type CellValue, COLUMN_ROLE_LABELS, type ColumnMapping, type PreviewRow } from '@/lib/import/types';
import { editableCellText } from './import-helpers';

interface RowFixDialogProps {
  row: PreviewRow | null;
  cells: CellValue[];
  columns: ColumnMapping[];
  overrides: Record<number, string> | undefined;
  onOpenChange: (open: boolean) => void;
  onSave: (values: Record<number, string>) => void;
}

/** Corrige os valores de uma linha (somente na prévia; o arquivo original não é alterado). */
export function RowFixDialog({ row, cells, columns, overrides, onOpenChange, onSave }: RowFixDialogProps) {
  const mapped = columns.filter((column) => column.role !== 'ignore');
  // O diálogo é montado com key = número da linha, então o estado inicial basta.
  const [values, setValues] = useState<Record<number, string>>(() => {
    const initial: Record<number, string> = {};
    for (const column of mapped) {
      initial[column.index] = overrides?.[column.index] ?? editableCellText(cells[column.index] ?? null, column.role);
    }
    return initial;
  });

  if (!row) return null;

  const save = () => {
    const changed: Record<number, string> = {};
    for (const column of mapped) {
      const original = editableCellText(cells[column.index] ?? null, column.role);
      const value = values[column.index] ?? '';
      if (value !== original) changed[column.index] = value;
    }
    onSave(changed);
    onOpenChange(false);
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        title={`Corrigir linha ${row.rowNumber}`}
        description="A correção vale só para esta importação; a planilha original não é alterada."
        footer={
          <>
            {overrides && Object.keys(overrides).length > 0 ? (
              <Button
                variant="ghost"
                onClick={() => {
                  onSave({});
                  onOpenChange(false);
                }}
              >
                Desfazer correções
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={save}>Aplicar e revalidar</Button>
          </>
        }
      >
        {row.errors.length > 0 ? (
          <ul className="mb-4 space-y-1 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {row.errors.map((error) => (
              <li key={error}>• {error}</li>
            ))}
          </ul>
        ) : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {mapped.map((column) => (
            <Field
              key={column.index}
              label={column.header}
              hint={column.role === 'product_quantity' ? 'Quantidade deste produto' : COLUMN_ROLE_LABELS[column.role]}
            >
              <Input
                value={values[column.index] ?? ''}
                onChange={(event) => setValues((current) => ({ ...current, [column.index]: event.target.value }))}
                inputMode={column.role === 'quantity' || column.role === 'product_quantity' ? 'decimal' : undefined}
                placeholder={column.role === 'date' || column.role === 'due_date' || column.role === 'payment_date' ? 'DD/MM/AAAA' : undefined}
              />
            </Field>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
