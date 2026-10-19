import { zodResolver } from '@hookform/resolvers/zod';
import { ImagePlus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import type { ProductInput } from '@/data/catalog';
import { BUCKET_RULES, uploadFile, useSignedUrl, validateFile } from '@/data/storage';
import type { ProductRow } from '@/data/types';
import { useBusiness } from '@/features/business/business-context';
import { describeError } from '@/lib/errors';

export const PRODUCT_UNITS = ['un', 'pote', 'fatia', 'caixa', 'dz', 'cento', 'kg', 'g'];

const schema = z.object({
  name: z.string().trim().min(1, 'Informe o nome.').max(120),
  description: z.string().trim().max(2000),
  category: z.string().trim().max(60),
  unit: z.string().trim().min(1, 'Informe a unidade.').max(20),
  price_cents: z.number().int().min(0, 'Preço inválido.').max(100_000_000).nullable(),
  cost_mode: z.enum(['manual', 'recipe']),
  manual_unit_cost_cents: z.number().int().min(0, 'Custo inválido.').max(100_000_000).nullable(),
  active: z.boolean(),
});

type Values = z.infer<typeof schema>;

interface ProductFormProps {
  product?: ProductRow | null;
  formId: string;
  onSubmit: (values: ProductInput) => void;
  categories: string[];
  disabled?: boolean;
}

export function ProductForm({ product, formId, onSubmit, categories, disabled }: ProductFormProps) {
  const { business } = useBusiness();
  const [photoPath, setPhotoPath] = useState<string | null>(product?.photo_path ?? null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const photo = useSignedUrl('product-photos', photoPath);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: product?.name ?? '',
      description: product?.description ?? '',
      category: product?.category ?? '',
      unit: product?.unit ?? 'un',
      price_cents: product?.price_cents ?? null,
      cost_mode: product?.cost_mode ?? 'manual',
      manual_unit_cost_cents: product?.manual_unit_cost_cents ?? null,
      active: product?.active ?? true,
    },
  });

  useEffect(() => setPhotoPath(product?.photo_path ?? null), [product?.photo_path]);

  const submit = form.handleSubmit((values) =>
    onSubmit({
      name: values.name,
      description: values.description || null,
      category: values.category || null,
      unit: values.unit,
      price_cents: values.price_cents,
      cost_mode: values.cost_mode,
      manual_unit_cost_cents: values.manual_unit_cost_cents,
      photo_path: photoPath,
      active: values.active,
    }),
  );

  const errors = form.formState.errors;
  const costMode = form.watch('cost_mode');

  return (
    <form id={formId} onSubmit={submit} className="space-y-4" noValidate>
      <fieldset disabled={disabled} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Nome" required error={errors.name?.message} className="sm:col-span-2">
            <Input autoComplete="off" {...form.register('name')} />
          </Field>
          <Field label="Categoria" error={errors.category?.message}>
            <Input list="product-categories" autoComplete="off" {...form.register('category')} />
          </Field>
          <datalist id="product-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <Field label="Unidade de venda" required error={errors.unit?.message}>
            <Select {...form.register('unit')}>
              {[...new Set([...PRODUCT_UNITS, form.getValues('unit')])].map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Preço de venda" hint="Deixe em branco se ainda não estiver definido; o preço poderá ser informado em cada venda." error={errors.price_cents?.message}>
            <Controller control={form.control} name="price_cents" render={({ field }) => <MoneyInput value={field.value} onValueChange={field.onChange} onBlur={field.onBlur} placeholder="a definir" />} />
          </Field>
          <Field label="Origem do custo">
            <Select {...form.register('cost_mode')}>
              <option value="manual">Custo unitário manual</option>
              <option value="recipe">Calculado pela receita</option>
            </Select>
          </Field>
          <Field
            label={costMode === 'recipe' ? 'Custo manual (usado se a receita estiver vazia)' : 'Custo unitário estimado'}
            hint="Usado para estimar CMV e lucro. Cada venda guarda o custo vigente no momento."
            error={errors.manual_unit_cost_cents?.message}
            className="sm:col-span-2"
          >
            <Controller
              control={form.control}
              name="manual_unit_cost_cents"
              render={({ field }) => <MoneyInput value={field.value} onValueChange={field.onChange} onBlur={field.onBlur} placeholder="não informado" />}
            />
          </Field>
          <Field label="Descrição" className="sm:col-span-2">
            <Textarea rows={2} {...form.register('description')} />
          </Field>
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium text-ink-soft">Foto (opcional)</p>
          <div className="flex items-center gap-3">
            <div className="grid size-20 place-items-center overflow-hidden rounded-xl border border-line bg-subtle">
              {photo.data ? <img src={photo.data} alt="Foto do produto" className="size-full object-cover" /> : <ImagePlus className="size-6 text-muted" aria-hidden />}
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" loading={uploading} onClick={() => fileInput.current?.click()}>
                  {photoPath ? 'Trocar foto' : 'Enviar foto'}
                </Button>
                {photoPath ? (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setPhotoPath(null)} aria-label="Remover foto">
                    <Trash2 />
                  </Button>
                ) : null}
              </div>
              <p className="text-xs text-muted">{BUCKET_RULES['product-photos'].label}. Salve o produto para gravar.</p>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept={BUCKET_RULES['product-photos'].types.join(',')}
              className="sr-only"
              aria-label="Arquivo da foto"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                const problem = validateFile('product-photos', file);
                if (problem) {
                  toast.error(problem);
                  return;
                }
                setUploading(true);
                try {
                  setPhotoPath(await uploadFile('product-photos', business.id, file));
                } catch (error) {
                  toast.error(describeError(error));
                } finally {
                  setUploading(false);
                }
              }}
            />
          </div>
        </div>

        {product ? (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox {...form.register('active')} /> Produto ativo (aparece nas novas vendas)
          </label>
        ) : null}
      </fieldset>
    </form>
  );
}
