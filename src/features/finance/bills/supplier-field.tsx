import { Store, X } from 'lucide-react';
import { useState } from 'react';
import { EntityPicker } from '@/components/shared/entity-picker';
import { Button } from '@/components/ui/button';
import { useSuppliers } from '@/data/catalog';
import { formatPhoneBR } from '@/lib/whatsapp';

export interface SupplierValue {
  id: string | null;
  /** Cadastro rápido: o banco cria (ou reaproveita, se já existir) pelo nome. */
  newName: string | null;
  label: string;
}

interface SupplierFieldProps {
  id?: string;
  value: SupplierValue | null;
  onChange: (value: SupplierValue | null) => void;
  'aria-describedby'?: string;
}

/** Fornecedor opcional, com pesquisa e cadastro rápido pelo nome. */
export function SupplierField({ id, value, onChange, ...aria }: SupplierFieldProps) {
  const [open, setOpen] = useState(false);
  const suppliers = useSuppliers();
  const options = (suppliers.data ?? [])
    .filter((supplier) => supplier.active || supplier.id === value?.id)
    .map((supplier) => ({
      id: supplier.id,
      label: supplier.name,
      description: supplier.phone ? formatPhoneBR(supplier.phone) : undefined,
      searchText: supplier.phone ?? '',
    }));
  return (
    <div className="flex items-center gap-2">
      <Button
        id={id}
        type="button"
        variant="outline"
        className="h-10 min-w-0 flex-1 justify-start font-normal"
        onClick={() => setOpen(true)}
        aria-describedby={aria['aria-describedby']}
      >
        <Store className="text-muted" />
        <span className={value ? 'truncate text-ink' : 'truncate text-muted'}>
          {value ? (value.newName ? `${value.label} (novo)` : value.label) : 'Selecionar fornecedor (opcional)'}
        </span>
      </Button>
      {value ? (
        <Button type="button" variant="ghost" size="icon" aria-label="Remover fornecedor" onClick={() => onChange(null)}>
          <X />
        </Button>
      ) : null}
      <EntityPicker
        open={open}
        onOpenChange={setOpen}
        title="Fornecedor"
        options={options}
        loading={suppliers.isPending}
        selectedId={value?.id ?? null}
        onSelect={(option) => onChange({ id: option.id, newName: null, label: option.label })}
        onCreate={(text) => onChange({ id: null, newName: text, label: text })}
        createLabel={(text) => `Cadastrar fornecedor “${text}”`}
        emptyText="Nenhum fornecedor cadastrado. Digite o nome para cadastrar."
      />
    </div>
  );
}
