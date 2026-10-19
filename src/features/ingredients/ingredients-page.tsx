import { zodResolver } from '@hookform/resolvers/zod';
import { Pencil, Plus, Trash2, Wheat } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { DataTable, type Column } from '@/components/shared/data-table';
import { ExportMenu } from '@/components/shared/export-menu';
import { Money } from '@/components/shared/money';
import { Page, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input';
import { MoneyInput, QuantityInput } from '@/components/ui/money-input';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { useDeleteIngredient, useIngredients, useSaveIngredient } from '@/data/catalog';
import type { Ingredient } from '@/data/types';
import { useBusiness } from '@/features/business/business-context';
import type { ExportColumn } from '@/lib/export';
import { formatQuantity } from '@/lib/money';
import { BASE_UNIT, convert, dimensionOf, MEASURE_UNITS, type MeasureUnit } from '@/lib/units';

/** Custo de uma unidade "amigável" (1 kg, 1 l, 1 un) já com aproveitamento, em centavos (fracionário). */
export function costPerFriendlyUnit(ingredient: Pick<Ingredient, 'unit' | 'purchase_quantity' | 'purchase_price_cents' | 'yield_percent'>) {
  const dimension = dimensionOf(ingredient.unit);
  const friendly: MeasureUnit = dimension === 'mass' ? 'kg' : dimension === 'volume' ? 'l' : 'un';
  const usable = convert(Number(ingredient.purchase_quantity), ingredient.unit, friendly) * (Number(ingredient.yield_percent) / 100);
  return { unit: friendly, cents: usable > 0 ? ingredient.purchase_price_cents / usable : 0 };
}

const schema = z.object({
  name: z.string().trim().min(1, 'Informe o nome.').max(120),
  unit: z.enum(['mg', 'g', 'kg', 'ml', 'l', 'un', 'dz']),
  purchase_quantity: z.number({ message: 'Informe a quantidade.' }).positive('Deve ser maior que zero.'),
  purchase_price_cents: z.number({ message: 'Informe o custo.' }).int().min(0),
  yield_percent: z.number({ message: 'Informe o aproveitamento.' }).gt(0, 'Maior que 0%.').max(100, 'Até 100%.'),
  notes: z.string().trim().max(2000),
  active: z.boolean(),
});

type Values = z.infer<typeof schema>;

function IngredientDialog({ open, onOpenChange, ingredient }: { open: boolean; onOpenChange: (open: boolean) => void; ingredient: Ingredient | null }) {
  const save = useSaveIngredient();
  const form = useForm<Values>({ resolver: zodResolver(schema) });
  useEffect(() => {
    if (open)
      form.reset({
        name: ingredient?.name ?? '',
        unit: ingredient?.unit ?? 'kg',
        purchase_quantity: ingredient ? Number(ingredient.purchase_quantity) : (undefined as unknown as number),
        purchase_price_cents: ingredient?.purchase_price_cents ?? (undefined as unknown as number),
        yield_percent: ingredient ? Number(ingredient.yield_percent) : 100,
        notes: ingredient?.notes ?? '',
        active: ingredient?.active ?? true,
      });
  }, [open, ingredient, form]);
  const values = form.watch();
  const preview =
    values.purchase_quantity > 0 && values.purchase_price_cents >= 0 && values.yield_percent > 0
      ? costPerFriendlyUnit({ unit: values.unit, purchase_quantity: values.purchase_quantity, purchase_price_cents: values.purchase_price_cents, yield_percent: values.yield_percent })
      : null;
  const errors = form.formState.errors;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={ingredient ? 'Editar ingrediente' : 'Novo ingrediente'}
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="ingredient-form" loading={save.isPending}>
              Salvar
            </Button>
          </>
        }
      >
        <form
          id="ingredient-form"
          noValidate
          className="grid grid-cols-2 gap-4"
          onSubmit={form.handleSubmit((v) => save.mutate({ id: ingredient?.id, values: { ...v, notes: v.notes || null } }, { onSuccess: () => onOpenChange(false) }))}
        >
          <Field label="Nome" required error={errors.name?.message} className="col-span-2">
            <Input autoFocus autoComplete="off" {...form.register('name')} />
          </Field>
          <Field label="Quantidade comprada" required error={errors.purchase_quantity?.message}>
            <Controller control={form.control} name="purchase_quantity" render={({ field }) => <QuantityInput value={field.value ?? null} onValueChange={(v) => field.onChange(v ?? undefined)} />} />
          </Field>
          <Field label="Unidade" required>
            <Select {...form.register('unit')}>
              {MEASURE_UNITS.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Custo dessa quantidade" required error={errors.purchase_price_cents?.message}>
            <Controller control={form.control} name="purchase_price_cents" render={({ field }) => <MoneyInput value={field.value ?? null} onValueChange={(v) => field.onChange(v ?? undefined)} />} />
          </Field>
          <Field label="Aproveitamento (%)" hint="Parte utilizável após limpeza/perdas." error={errors.yield_percent?.message}>
            <Controller control={form.control} name="yield_percent" render={({ field }) => <QuantityInput value={field.value ?? null} onValueChange={(v) => field.onChange(v ?? undefined)} />} />
          </Field>
          <Field label="Observações" className="col-span-2">
            <Textarea rows={2} {...form.register('notes')} />
          </Field>
          {ingredient ? (
            <label className="col-span-2 flex items-center gap-2 text-sm">
              <Checkbox {...form.register('active')} /> Ingrediente ativo
            </label>
          ) : null}
          {preview ? (
            <p className="col-span-2 rounded-lg bg-subtle px-3 py-2 text-sm">
              Custo efetivo: <Money cents={Math.round(preview.cents)} /> por {preview.unit}
              {values.yield_percent < 100 ? ' (já considerando o aproveitamento)' : ''}.
            </p>
          ) : null}
          {ingredient ? <p className="col-span-2 text-xs text-muted">Alterar o custo atualiza o custo das receitas a partir de agora; vendas passadas mantêm o custo que tinham.</p> : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}

const exportColumns: ExportColumn<Ingredient>[] = [
  { header: 'Ingrediente', value: (i) => i.name },
  { header: 'Quantidade comprada', value: (i) => i.purchase_quantity, kind: 'number' },
  { header: 'Unidade', value: (i) => i.unit },
  { header: 'Custo', value: (i) => i.purchase_price_cents, kind: 'money' },
  { header: 'Aproveitamento %', value: (i) => i.yield_percent, kind: 'number' },
  { header: 'Custo efetivo por kg/l/un', value: (i) => Math.round(costPerFriendlyUnit(i).cents), kind: 'money' },
  { header: 'Ativo', value: (i) => i.active, kind: 'boolean' },
];

export function IngredientsPage() {
  const { can } = useBusiness();
  const ingredients = useIngredients();
  const remove = useDeleteIngredient();
  const [editing, setEditing] = useState<Ingredient | null>(null);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<Ingredient | null>(null);

  const columns: Column<Ingredient>[] = [
    { key: 'name', header: 'Ingrediente', cell: (i) => i.name, sortValue: (i) => i.name },
    { key: 'purchase', header: 'Compra', cell: (i) => <span className="num">{formatQuantity(i.purchase_quantity)} {i.unit} por <Money cents={i.purchase_price_cents} /></span> },
    { key: 'yield', header: 'Aproveitamento', align: 'right', cell: (i) => <span className="num">{formatQuantity(i.yield_percent)}%</span>, sortValue: (i) => Number(i.yield_percent) },
    {
      key: 'unitcost',
      header: 'Custo efetivo',
      align: 'right',
      cell: (i) => {
        const c = costPerFriendlyUnit(i);
        return <span><Money cents={Math.round(c.cents)} /> <span className="text-xs text-muted">/{c.unit}</span></span>;
      },
      sortValue: (i) => costPerFriendlyUnit(i).cents,
    },
    { key: 'status', header: 'Situação', cell: (i) => (i.active ? <Badge tone="success">Ativo</Badge> : <Badge>Inativo</Badge>) },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (i) =>
        can('write') ? (
          <span className="inline-flex gap-1">
            <Button size="icon-sm" variant="ghost" aria-label={`Editar ${i.name}`} onClick={() => { setEditing(i); setOpen(true); }}>
              <Pencil />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label={`Excluir ${i.name}`} onClick={() => setDeleting(i)}>
              <Trash2 />
            </Button>
          </span>
        ) : null,
    },
  ];

  return (
    <Page>
      <PageHeader
        title="Ingredientes"
        description={`Custos de aquisição usados nas receitas. Unidade-base: ${BASE_UNIT.mass} (massa), ${BASE_UNIT.volume} (volume), ${BASE_UNIT.count} (contagem).`}
        actions={
          can('write') ? (
            <Button onClick={() => { setEditing(null); setOpen(true); }}>
              <Plus /> Novo ingrediente
            </Button>
          ) : null
        }
      />
      {ingredients.isPending ? <LoadingBlock /> : null}
      {ingredients.isError && !ingredients.data ? <ErrorState error={ingredients.error} onRetry={() => void ingredients.refetch()} /> : null}
      {ingredients.data ? (
        <DataTable
          rows={ingredients.data}
          columns={columns}
          getRowId={(i) => i.id}
          searchText={(i) => `${i.name} ${i.notes ?? ''}`}
          searchPlaceholder="Pesquisar ingrediente"
          initialSort={{ key: 'name', direction: 'asc' }}
          caption="Ingredientes"
          emptyTitle="Nenhum ingrediente cadastrado"
          emptyDescription="Receitas são opcionais: sem elas, use o custo manual de cada produto."
          emptyAction={can('write') ? <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}><Wheat /> Cadastrar ingrediente</Button> : null}
          toolbar={<ExportMenu rows={ingredients.data} columns={exportColumns} fileName="ingredientes" />}
          mobileCard={(i) => {
            const c = costPerFriendlyUnit(i);
            return (
              <button type="button" className="flex w-full items-start justify-between gap-3 text-left" disabled={!can('write')} onClick={() => { setEditing(i); setOpen(true); }}>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{i.name}</span>
                  <span className="block text-xs text-muted">
                    {formatQuantity(i.purchase_quantity)} {i.unit} por R$ {(i.purchase_price_cents / 100).toFixed(2).replace('.', ',')}
                    {Number(i.yield_percent) < 100 ? ` · ${formatQuantity(i.yield_percent)}% aproveitado` : ''}
                  </span>
                </span>
                <span className="text-right text-sm">
                  <Money cents={Math.round(c.cents)} /> <span className="text-xs text-muted">/{c.unit}</span>
                </span>
              </button>
            );
          }}
        />
      ) : null}
      <IngredientDialog open={open} onOpenChange={setOpen} ingredient={editing} />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Excluir ingrediente?"
        description={`"${deleting?.name}" será removido. Ingredientes usados em receitas ou compras não podem ser excluídos — desative-os.`}
        confirmLabel="Excluir"
        onConfirm={() => remove.mutateAsync({ id: deleting!.id })}
      />
    </Page>
  );
}
