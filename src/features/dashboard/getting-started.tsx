import { CircleCheck, Circle, ArrowRight } from 'lucide-react';
import { Link } from 'react-router';
import { Card } from '@/components/ui/card';
import { useCustomers, useProducts } from '@/data/catalog';
import { useImportBatches } from '@/data/imports';
import { useBusiness } from '@/features/business/business-context';
import { cn } from '@/lib/cn';

interface Step {
  label: string;
  description: string;
  to: string;
  done: boolean;
  optional?: boolean;
}

/** Roteiro do primeiro uso: some quando a primeira venda é registrada. */
export function GettingStarted() {
  const { can } = useBusiness();
  const products = useProducts();
  const customers = useCustomers();
  const imports = useImportBatches();
  if (!can('write') || !products.data || !customers.data) return null;

  const active = products.data.filter((p) => p.active);
  const withoutPrice = active.filter((p) => p.price_cents === null).length;
  const steps: Step[] = [
    {
      label: 'Defina os preços dos produtos',
      description: withoutPrice > 0 ? `${withoutPrice} ${withoutPrice === 1 ? 'produto ainda está' : 'produtos ainda estão'} com preço a definir.` : 'Todos os produtos ativos têm preço.',
      to: '/produtos',
      done: active.length > 0 && withoutPrice === 0,
    },
    {
      label: 'Informe os custos',
      description: 'Custo manual ou por receita, para estimar o lucro. Pode ser feito depois.',
      to: '/produtos',
      done: active.some((p) => p.effective_unit_cost_cents !== null),
      optional: true,
    },
    {
      label: 'Traga a planilha antiga',
      description: 'Importe vendas e clientes com prévia e sem duplicar registros.',
      to: '/importar',
      done: (imports.data?.length ?? 0) > 0,
      optional: true,
    },
    {
      label: 'Cadastre os clientes',
      description: 'Ou cadastre cada cliente na hora da venda.',
      to: '/clientes',
      done: customers.data.length > 0,
      optional: true,
    },
    { label: 'Registre a primeira venda', description: 'Leva menos de um minuto.', to: '/vendas/nova', done: false },
  ];
  const completed = steps.filter((s) => s.done).length;

  return (
    <Card className="mb-5 overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line bg-accent-soft/50 px-4 py-3">
        <div>
          <h2 className="font-display text-lg font-semibold">Primeiros passos</h2>
          <p className="text-xs text-muted">Um roteiro rápido para começar a usar o sistema.</p>
        </div>
        <p className="num text-xs font-medium text-accent-ink">
          {completed} de {steps.length} concluídos
        </p>
      </div>
      <ol className="divide-y divide-line">
        {steps.map((step) => (
          <li key={step.label}>
            <Link to={step.to} className="flex items-center gap-3 px-4 py-3 hover:bg-subtle">
              {step.done ? <CircleCheck className="size-5 shrink-0 text-success" aria-label="Concluído" /> : <Circle className="size-5 shrink-0 text-line-strong" aria-label="Pendente" />}
              <span className="min-w-0 flex-1">
                <span className={cn('block text-sm font-medium', step.done && 'text-muted line-through decoration-line-strong')}>
                  {step.label}
                  {step.optional && !step.done ? <span className="ml-1.5 text-xs font-normal text-muted">(opcional)</span> : null}
                </span>
                <span className="block text-xs text-muted">{step.description}</span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-muted" aria-hidden />
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}
