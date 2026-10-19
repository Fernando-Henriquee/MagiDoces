import { CakeSlice, Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { DataTable, type Column } from '@/components/shared/data-table';
import { ExportMenu } from '@/components/shared/export-menu';
import { Money } from '@/components/shared/money';
import { ProductThumb } from '@/components/shared/product-thumb';
import { Page, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Select } from '@/components/ui/input';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { useProducts, useSaveProduct } from '@/data/catalog';
import type { ProductRow } from '@/data/types';
import { useBusiness } from '@/features/business/business-context';
import type { ExportColumn } from '@/lib/export';
import { formatPercent, percent } from '@/lib/money';
import { ProductForm } from './product-form';

export function marginOf(product: Pick<ProductRow, 'price_cents' | 'effective_unit_cost_cents'>) {
  if (product.price_cents === null || product.effective_unit_cost_cents === null) return null;
  return { cents: product.price_cents - product.effective_unit_cost_cents, percent: percent(product.price_cents - product.effective_unit_cost_cents, product.price_cents) };
}

export function CostSourceBadge({ source }: { source: ProductRow['cost_source'] }) {
  if (source === 'recipe') return <Badge tone="info">receita</Badge>;
  if (source === 'manual') return <Badge>manual</Badge>;
  return <Badge tone="warning">sem custo</Badge>;
}

const columns: Column<ProductRow>[] = [
  {
    key: 'name',
    header: 'Produto',
    cell: (p) => (
      <span className="inline-flex items-center gap-2.5">
        <ProductThumb path={p.photo_path} className="size-8" />
        {p.name}
      </span>
    ),
    sortValue: (p) => p.name,
  },
  { key: 'category', header: 'Categoria', cell: (p) => <span className="text-muted">{p.category ?? '—'}</span>, sortValue: (p) => p.category },
  { key: 'price', header: 'Preço', align: 'right', cell: (p) => (p.price_cents === null ? <Badge tone="warning">a definir</Badge> : <Money cents={p.price_cents} />), sortValue: (p) => p.price_cents },
  {
    key: 'cost',
    header: 'Custo estimado',
    align: 'right',
    cell: (p) => (
      <span className="inline-flex items-center gap-2">
        <CostSourceBadge source={p.cost_source} />
        {p.effective_unit_cost_cents !== null ? <Money cents={p.effective_unit_cost_cents} /> : null}
      </span>
    ),
    sortValue: (p) => p.effective_unit_cost_cents,
  },
  {
    key: 'margin',
    header: 'Margem estimada',
    align: 'right',
    cell: (p) => {
      const m = marginOf(p);
      return m ? (
        <span className={m.cents < 0 ? 'text-danger' : ''}>
          <Money cents={m.cents} /> <span className="text-xs text-muted">({formatPercent(m.percent)})</span>
        </span>
      ) : (
        <span className="text-muted">—</span>
      );
    },
    sortValue: (p) => marginOf(p)?.percent ?? null,
  },
  { key: 'status', header: 'Situação', cell: (p) => (p.active ? <Badge tone="success">Ativo</Badge> : <Badge>Inativo</Badge>) },
];

const exportColumns: ExportColumn<ProductRow>[] = [
  { header: 'Produto', value: (p) => p.name },
  { header: 'Categoria', value: (p) => p.category },
  { header: 'Unidade', value: (p) => p.unit },
  { header: 'Preço', value: (p) => p.price_cents, kind: 'money' },
  { header: 'Custo estimado', value: (p) => p.effective_unit_cost_cents, kind: 'money' },
  { header: 'Origem do custo', value: (p) => p.cost_source ?? 'não informado' },
  { header: 'Margem', value: (p) => marginOf(p)?.cents ?? null, kind: 'money' },
  { header: 'Margem %', value: (p) => marginOf(p)?.percent ?? null, kind: 'number' },
  { header: 'Ativo', value: (p) => p.active, kind: 'boolean' },
];

export function ProductsPage() {
  const { can } = useBusiness();
  const navigate = useNavigate();
  const products = useProducts();
  const save = useSaveProduct();
  const [filter, setFilter] = useState<'active' | 'inactive' | 'all'>('active');
  const [category, setCategory] = useState('');
  const [creating, setCreating] = useState(false);
  const categories = [...new Set((products.data ?? []).map((p) => p.category).filter((c): c is string => Boolean(c)))].sort();
  const rows = (products.data ?? []).filter((p) => (filter === 'all' || (filter === 'active') === p.active) && (!category || p.category === category));

  return (
    <Page>
      <PageHeader
        title="Produtos"
        description="Preços, custos estimados e margens. Alterações não mudam vendas já registradas."
        actions={
          can('write') ? (
            <Button onClick={() => setCreating(true)}>
              <Plus /> Novo produto
            </Button>
          ) : null
        }
      />
      {products.isPending ? <LoadingBlock /> : null}
      {products.isError && !products.data ? <ErrorState error={products.error} onRetry={() => void products.refetch()} /> : null}
      {products.data ? (
        <DataTable
          rows={rows}
          columns={columns}
          getRowId={(p) => p.id}
          rowHref={(p) => `/produtos/${p.id}`}
          searchText={(p) => `${p.name} ${p.category ?? ''} ${p.description ?? ''}`}
          searchPlaceholder="Pesquisar produto"
          initialSort={{ key: 'name', direction: 'asc' }}
          caption="Produtos"
          emptyTitle="Nenhum produto neste filtro"
          emptyAction={can('write') ? <Button size="sm" onClick={() => setCreating(true)}><CakeSlice /> Cadastrar produto</Button> : null}
          toolbar={
            <div className="flex flex-wrap items-center gap-2">
              <Select aria-label="Situação" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="w-auto">
                <option value="active">Ativos</option>
                <option value="inactive">Inativos</option>
                <option value="all">Todos</option>
              </Select>
              {categories.length > 0 ? (
                <Select aria-label="Categoria" value={category} onChange={(e) => setCategory(e.target.value)} className="w-auto">
                  <option value="">Todas as categorias</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              ) : null}
              <ExportMenu rows={rows} columns={exportColumns} fileName="produtos" />
            </div>
          }
          mobileCard={(p) => {
            const m = marginOf(p);
            return (
              <div className="flex items-start justify-between gap-3">
                <ProductThumb path={p.photo_path} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{p.name}</p>
                  <p className="flex items-center gap-1.5 text-xs text-muted">
                    <CostSourceBadge source={p.cost_source} />
                    {p.effective_unit_cost_cents !== null ? <>custo <Money cents={p.effective_unit_cost_cents} /></> : null}
                  </p>
                </div>
                <div className="text-right">
                  {p.price_cents === null ? <Badge tone="warning">preço a definir</Badge> : <Money cents={p.price_cents} className="font-semibold" />}
                  {m ? <p className="text-xs text-muted">margem {formatPercent(m.percent)}</p> : null}
                </div>
              </div>
            );
          }}
        />
      ) : null}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent
          title="Novo produto"
          size="lg"
          footer={
            <>
              <Button variant="outline" onClick={() => setCreating(false)}>
                Cancelar
              </Button>
              <Button type="submit" form="new-product" loading={save.isPending}>
                Salvar
              </Button>
            </>
          }
        >
          <ProductForm
            formId="new-product"
            categories={categories}
            onSubmit={(values) => save.mutate({ values }, { onSuccess: (r) => { setCreating(false); navigate(`/produtos/${r.id}`); } })}
          />
        </DialogContent>
      </Dialog>
    </Page>
  );
}
