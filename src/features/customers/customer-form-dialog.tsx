import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Checkbox, Input, Textarea } from '@/components/ui/input';
import { useSaveCustomer } from '@/data/catalog';
import type { Customer } from '@/data/types';

const schema = z.object({
  name: z.string().trim().min(1, 'Informe o nome.').max(120, 'Máximo de 120 caracteres.'),
  phone: z
    .string()
    .trim()
    .max(30)
    .refine((value) => value === '' || value.replace(/\D/g, '').length >= 10, 'Informe DDD + número.'),
  notes: z.string().trim().max(2000),
  active: z.boolean(),
});

type Values = z.infer<typeof schema>;

export function CustomerFormDialog({
  open,
  onOpenChange,
  customer,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer?: Pick<Customer, 'id' | 'name' | 'phone' | 'notes' | 'active'> | null;
  onSaved?: (customer: Customer) => void;
}) {
  const save = useSaveCustomer();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: '', phone: '', notes: '', active: true } });

  useEffect(() => {
    if (open) form.reset({ name: customer?.name ?? '', phone: customer?.phone ?? '', notes: customer?.notes ?? '', active: customer?.active ?? true });
  }, [open, customer, form]);

  const onSubmit = form.handleSubmit((values) => {
    save.mutate(
      { id: customer?.id, values: { name: values.name, phone: values.phone || null, notes: values.notes || null, active: values.active } },
      {
        onSuccess: (saved) => {
          onOpenChange(false);
          onSaved?.(saved);
        },
      },
    );
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={customer ? 'Editar cliente' : 'Novo cliente'}
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="customer-form" loading={save.isPending}>
              Salvar
            </Button>
          </>
        }
      >
        <form id="customer-form" onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label="Nome" required error={form.formState.errors.name?.message}>
            <Input autoFocus autoComplete="off" {...form.register('name')} />
          </Field>
          <Field label="Telefone (opcional)" hint="Com DDD. Usado para o link do WhatsApp." error={form.formState.errors.phone?.message}>
            <Input type="tel" inputMode="tel" autoComplete="off" placeholder="(11) 98888-7777" {...form.register('phone')} />
          </Field>
          <Field label="Observações" error={form.formState.errors.notes?.message}>
            <Textarea rows={3} {...form.register('notes')} />
          </Field>
          {customer ? (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox {...form.register('active')} /> Cliente ativo
            </label>
          ) : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}
