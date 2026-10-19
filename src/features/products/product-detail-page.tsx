import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { Money } from '@/components/shared/money';
import { Page, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/menu';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { usePriceHistory, useProduct, useProducts, useSaveProduct } from '@/data/catalog';
import { useBusiness } from '@/features/business/business-context';
import { formatDateTimeBR } from '@/lib/dates';
import { formatPercent } from '@/lib/money';
import { ProductForm } from './product-form';
import { CostSourceBadge, marginOf } from './products-page';
import { RecipeEditor } from './recipe-editor';

export function ProductDetailPage() {
  const { id } = useParams();
  const { can, business } = useBusiness();
  const product = useProduct(id);
  const all = useProducts();
  const history = usePriceHistory(id);
  const save = useSaveProduct();

  if (product.isPending) return <Page><LoadingBlock /></Page>;
  if (product.isError || !product.data) return <Page><ErrorState error={product.error} onRetry={() => void product.refetch()} /></Page>;
  const p = product.data;
  const margin = marginOf(p);
  const categories = [...new Set((all.data ?? []).map((x) => x.category).filter((c): c is string => Boolean(c)))];

  return (
    <Page>
      <PageHeader
        back={
          <Link to="/produtos" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ArrowLeft className="size-4" /> Produtos
          </Link>
        }
        title={p.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {p.active ? <Badge tone="success">Ativo</Badge> : <Badge>Inativo</Badge>}
            {p.price_cents === null ? <Badge tone="warning">preço a definir</Badge> : <span>Preço <Money cents={p.price_cents} /></span>}
            <span className="inline-flex items-center gap-1">
              Custo <CostSourceBadge source={p.cost_source} /> {p.effective_unit_cost_cents !== null ? <Money cents={p.effective_unit_cost_cents} /> : null}
            </span>
            {margin ? <span>Margem {formatPercent(margin.percent)}</span> : null}
          </span>
        }
      />
      <Tabs defaultValue="dados">
        <TabsList>
          <TabsTrigger value="dados">Dados</TabsTrigger>
          <TabsTrigger value="receita">Receita e custo</TabsTrigger>
          <TabsTrigger value="historico">Histórico de preços</TabsTrigger>
        </TabsList>
        <TabsContent value="dados">
          <Card className="max-w-3xl p-4">
            <ProductForm
              key={p.updated_at}
              formId="edit-product"
              product={p}
              categories={categories}
              disabled={!can('write')}
              onSubmit={(values) => save.mutate({ id: p.id, values })}
            />
            {can('write') ? (
              <div className="mt-4 flex justify-end border-t border-line pt-4">
                <Button type="submit" form="edit-product" loading={save.isPending}>
                  Salvar alterações
                </Button>
              </div>
            ) : null}
          </Card>
        </TabsContent>
        <TabsContent value="receita">
          <RecipeEditor product={p} />
        </TabsContent>
        <TabsContent value="historico">
          {history.isPending ? <LoadingBlock rows={3} /> : null}
          {history.data?.length === 0 ? <EmptyState title="Sem histórico" /> : null}
          {history.data && history.data.length > 0 ? (
            <Card className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Histórico de preço e custo</caption>
                <thead className="border-b border-line bg-subtle/70 text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th scope="col" className="px-3 py-2">Quando</th>
                    <th scope="col" className="px-3 py-2 text-right">Preço</th>
                    <th scope="col" className="px-3 py-2 text-right">Custo manual</th>
                    <th scope="col" className="px-3 py-2">Origem do custo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {history.data.map((h) => (
                    <tr key={h.id}>
                      <td className="px-3 py-2">{formatDateTimeBR(h.changed_at, business.timezone)}</td>
                      <td className="px-3 py-2 text-right">{h.price_cents === null ? <span className="text-muted">a definir</span> : <Money cents={h.price_cents} />}</td>
                      <td className="px-3 py-2 text-right">{h.manual_unit_cost_cents === null ? <span className="text-muted">—</span> : <Money cents={h.manual_unit_cost_cents} />}</td>
                      <td className="px-3 py-2">{h.cost_mode === 'recipe' ? 'Receita' : 'Manual'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="border-t border-line px-3 py-2 text-xs text-muted">Cada venda guarda o preço e o custo do momento; mudanças aqui não alteram resultados passados.</p>
            </Card>
          ) : null}
        </TabsContent>
      </Tabs>
    </Page>
  );
}
