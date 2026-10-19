import { ArrowLeft, ArrowRight, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { cn } from '@/lib/cn';
import { distinctProductTexts, productTextKey } from '@/lib/import/build';
import { matchProduct } from '@/lib/import/detect';
import { type CellValue, COLUMN_ROLE_LABELS, type ColumnMapping, type ColumnRole, type Layout, type MigrationRules, type ProductRef } from '@/lib/import/types';
import { mappingProblems, productsInMapping, sampleValues } from './import-helpers';

const ROLE_ORDER: ColumnRole[] = [
  'ignore',
  'date',
  'customer',
  'product',
  'quantity',
  'product_quantity',
  'unit_price',
  'line_total',
  'paid',
  'paid_amount',
  'payment_date',
  'payment_method',
  'due_date',
  'notes',
];

interface MappingStepProps {
  rows: Array<{ rowNumber: number; cells: CellValue[] }>;
  columns: ColumnMapping[];
  layout: Layout;
  rules: MigrationRules;
  aliases: Record<string, string | null>;
  overrides: Record<number, Record<number, string>>;
  products: ProductRef[];
  onColumnsChange: (columns: ColumnMapping[]) => void;
  onLayoutChange: (layout: Layout) => void;
  onRulesChange: (rules: MigrationRules) => void;
  onAliasesChange: (aliases: Record<string, string | null>) => void;
  onBack: () => void;
  onNext: () => void;
}

function Choice<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: T;
  options: Array<{ value: T; label: string; hint?: ReactNode }>;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="mb-1 text-sm font-medium text-ink-soft">{legend}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className={cn('flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm', value === option.value ? 'border-brand bg-accent-soft/60' : 'border-line')}
        >
          <input type="radio" name={name} className="mt-1 accent-brand" checked={value === option.value} onChange={() => onChange(option.value)} />
          <span>
            <span className="block text-ink">{option.label}</span>
            {option.hint ? <span className="block text-xs text-muted">{option.hint}</span> : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** Etapa 3: papel de cada coluna, relação de produtos e regras de migração. */
export function MappingStep(props: MappingStepProps) {
  const { rows, columns, layout, rules, aliases, overrides, products } = props;
  const productTexts = layout === 'long' ? distinctProductTexts({ rows, columns, overrides }) : [];
  const resolvedAlias = (text: string): string | null => {
    const key = productTextKey(text);
    if (key in aliases) return aliases[key] ?? null;
    return matchProduct(text, products)?.id ?? null;
  };
  const problems = mappingProblems(columns, layout);
  const priceProducts = productsInMapping(columns, productTexts.map(resolvedAlias))
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is ProductRef => Boolean(p));
  const hasPaymentInfo = columns.some((c) => c.role === 'paid' || c.role === 'paid_amount' || c.role === 'payment_date');
  const hasPrice = columns.some((c) => c.role === 'unit_price' || c.role === 'line_total');

  const setColumn = (index: number, patch: Partial<ColumnMapping>) => {
    props.onColumnsChange(columns.map((column) => (column.index === index ? { ...column, ...patch } : column)));
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Formato da planilha" />
        <div className="p-4">
          <Choice<Layout>
            legend="Como os produtos aparecem?"
            name="layout"
            value={layout}
            onChange={props.onLayoutChange}
            options={[
              { value: 'wide', label: 'Uma coluna por produto', hint: 'Ex.: colunas “Bolo de pote”, “Torta de limão” com a quantidade de cada um.' },
              { value: 'long', label: 'Uma linha por item', hint: 'Ex.: colunas “Produto” e “Quantidade”.' },
            ]}
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="Colunas" description="Sugestão automática — confira e ajuste o que cada coluna representa." />
        <ul className="divide-y divide-line">
          {columns.map((column) => (
            <li key={column.index} className="grid grid-cols-1 gap-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_16rem_16rem] md:items-center">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{column.header}</p>
                <p className="truncate text-xs text-muted">{sampleValues(rows, column.index, column.role).join(' · ') || 'sem valores'}</p>
              </div>
              <Select aria-label={`Conteúdo da coluna ${column.header}`} value={column.role} onChange={(event) => setColumn(column.index, { role: event.target.value as ColumnRole })}>
                {ROLE_ORDER.map((role) => (
                  <option key={role} value={role}>
                    {COLUMN_ROLE_LABELS[role]}
                  </option>
                ))}
              </Select>
              {column.role === 'product_quantity' ? (
                <Select
                  aria-label={`Produto da coluna ${column.header}`}
                  value={column.productId ?? ''}
                  onChange={(event) => setColumn(column.index, { productId: event.target.value || null })}
                  aria-invalid={!column.productId || undefined}
                >
                  <option value="">Escolha o produto…</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                      {product.active ? '' : ' (inativo)'}
                    </option>
                  ))}
                </Select>
              ) : (
                <span className="hidden md:block" />
              )}
            </li>
          ))}
        </ul>
      </Card>

      {layout === 'long' && productTexts.length > 0 ? (
        <Card>
          <CardHeader title="Produtos da planilha" description="Relacione cada nome encontrado a um produto do cadastro." />
          <ul className="divide-y divide-line">
            {productTexts.map((text) => {
              const key = productTextKey(text);
              const auto = matchProduct(text, products);
              const value = resolvedAlias(text);
              return (
                <li key={key} className="grid grid-cols-1 gap-2 px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_16rem] sm:items-center">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{text}</span>
                    {!(key in aliases) && auto ? <Badge tone="success">reconhecido</Badge> : null}
                    {!value ? <Badge tone="danger">desconhecido</Badge> : null}
                  </div>
                  <Select
                    aria-label={`Produto do cadastro para “${text}”`}
                    value={value ?? ''}
                    onChange={(event) => props.onAliasesChange({ ...aliases, [key]: event.target.value || null })}
                  >
                    <option value="">Desconhecido (linhas ficam inválidas)</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                      </option>
                    ))}
                  </Select>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Regras de migração" description="Nada ausente é inventado: o que for preenchido por uma regra fica marcado como inferido no relatório." />
        <div className="grid grid-cols-1 gap-5 p-4 lg:grid-cols-2">
          <div className="space-y-3">
            <Choice<MigrationRules['missingPrice']>
              legend={hasPrice ? 'Linhas sem preço (quando a célula estiver vazia)' : 'A planilha não tem coluna de preço. Como definir o preço?'}
              name="missing-price"
              value={rules.missingPrice}
              onChange={(missingPrice) => props.onRulesChange({ ...rules, missingPrice })}
              options={[
                { value: 'reject', label: 'Não importar a linha', hint: 'A linha fica inválida no relatório.' },
                { value: 'current_product_price', label: 'Usar o preço atual do produto', hint: 'Produtos sem preço cadastrado continuam inválidos.' },
                { value: 'manual_price', label: 'Informar um preço por produto', hint: 'Preço histórico de referência para a migração.' },
              ]}
            />
            {rules.missingPrice === 'manual_price' ? (
              <div className="space-y-2 rounded-lg border border-line p-3">
                {priceProducts.length === 0 ? <p className="text-xs text-muted">Relacione os produtos acima para informar os preços.</p> : null}
                {priceProducts.map((product) => (
                  <Field key={product.id} label={product.name}>
                    <MoneyInput
                      value={rules.manualPrices[product.id] ?? null}
                      onValueChange={(cents) => {
                        const manualPrices = { ...rules.manualPrices };
                        if (cents === null || cents < 0) delete manualPrices[product.id];
                        else manualPrices[product.id] = cents;
                        props.onRulesChange({ ...rules, manualPrices });
                      }}
                    />
                  </Field>
                ))}
              </div>
            ) : null}
          </div>
          <div className="space-y-4">
            <Choice<MigrationRules['paidWithoutDate']>
              legend="Linhas marcadas como pagas, sem data de pagamento"
              name="paid-without-date"
              value={rules.paidWithoutDate}
              onChange={(paidWithoutDate) => props.onRulesChange({ ...rules, paidWithoutDate })}
              options={[
                { value: 'reject', label: 'Não importar a linha' },
                { value: 'use_sale_date', label: 'Considerar pago na data da venda', hint: 'A data do recebimento fica marcada como inferida.' },
              ]}
            />
            {layout === 'long' ? (
              <Choice<MigrationRules['missingQuantity']>
                legend="Linhas sem quantidade"
                name="missing-quantity"
                value={rules.missingQuantity}
                onChange={(missingQuantity) => props.onRulesChange({ ...rules, missingQuantity })}
                options={[
                  { value: 'reject', label: 'Não importar a linha' },
                  { value: 'one', label: 'Considerar 1 unidade', hint: 'Fica marcada como inferida.' },
                ]}
              />
            ) : null}
          </div>
        </div>
        <p className="mx-4 mb-4 flex items-start gap-2 rounded-lg bg-subtle px-3 py-2 text-xs text-ink-soft">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {hasPaymentInfo
            ? 'Linhas sem informação de pagamento serão importadas como “pendente de confirmação” — nunca presumidas como pagas.'
            : 'Nenhuma coluna de pagamento foi mapeada: todas as vendas serão importadas como “pendente de confirmação” (nunca presumidas como pagas). Você poderá confirmar ou registrar os recebimentos depois.'}
        </p>
      </Card>

      {problems.length > 0 ? (
        <div role="alert" className="space-y-1 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
          {problems.map((problem) => (
            <p key={problem} className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {problem}
            </p>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="outline" onClick={props.onBack}>
          <ArrowLeft /> Voltar
        </Button>
        <Button onClick={props.onNext} disabled={problems.length > 0}>
          Ver prévia <ArrowRight />
        </Button>
      </div>
    </div>
  );
}
