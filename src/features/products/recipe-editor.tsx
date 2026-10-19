import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { EntityPicker } from '@/components/shared/entity-picker';
import { Money } from '@/components/shared/money';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { MoneyInput, QuantityInput } from '@/components/ui/money-input';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { type RecipeBundle, useDeleteRecipe, useIngredients, useRecipe, useSaveProduct, useSaveRecipe } from '@/data/catalog';
import type { Ingredient, ProductRow } from '@/data/types';
import { useBusiness } from '@/features/business/business-context';
import { formatQuantity } from '@/lib/money';
import { computeRecipeCost } from '@/lib/recipe-cost';
import { areCompatible, MEASURE_UNITS, type MeasureUnit } from '@/lib/units';

interface ItemDraft {
  key: string;
  ingredientId: string;
  quantity: number | null;
  unit: MeasureUnit;
}

interface ExtraDraft {
  key: string;
  description: string;
  amountCents: number | null;
}

export function RecipeEditor({ product }: { product: ProductRow }) {
  const recipe = useRecipe(product.id);
  const ingredients = useIngredients();
  if (recipe.isPending || ingredients.isPending) return <LoadingBlock rows={3} />;
  if (recipe.isError) return <ErrorState error={recipe.error} onRetry={() => void recipe.refetch()} />;
  if (ingredients.isError) return <ErrorState error={ingredients.error} onRetry={() => void ingredients.refetch()} />;
  // Remonta o formulário quando a receita salva muda (estado inicial vem do servidor).
  return <RecipeForm key={recipe.dataUpdatedAt} product={product} bundle={recipe.data} ingredients={ingredients.data} />;
}

function RecipeForm({ product, bundle, ingredients }: { product: ProductRow; bundle: RecipeBundle; ingredients: Ingredient[] }) {
  const { can } = useBusiness();
  const editable = can('write');
  const save = useSaveRecipe();
  const remove = useDeleteRecipe();
  const saveProduct = useSaveProduct();
  const [yieldQuantity, setYieldQuantity] = useState<number | null>(bundle.recipe?.yield_quantity ? Number(bundle.recipe.yield_quantity) : null);
  const [notes, setNotes] = useState(bundle.recipe?.notes ?? '');
  const [items, setItems] = useState<ItemDraft[]>(() =>
    bundle.items.map((i) => ({ key: i.id, ingredientId: i.ingredient_id, quantity: Number(i.quantity), unit: i.unit })),
  );
  const [extras, setExtras] = useState<ExtraDraft[]>(() => bundle.extras.map((e) => ({ key: e.id, description: e.description, amountCents: e.amount_cents })));
  const [picking, setPicking] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const byId = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);

  const cost = useMemo(
    () =>
      computeRecipeCost({
        yieldQuantity: yieldQuantity ?? 0,
        items: items
          .filter((i) => byId.has(i.ingredientId) && i.quantity)
          .map((i) => {
            const ing = byId.get(i.ingredientId)!;
            return {
              ingredient: { name: ing.name, unit: ing.unit, purchaseQuantity: Number(ing.purchase_quantity), purchasePriceCents: ing.purchase_price_cents, yieldPercent: Number(ing.yield_percent) },
              quantity: i.quantity!,
              unit: i.unit,
            };
          }),
        extraCosts: extras.filter((e) => e.amountCents !== null).map((e) => ({ description: e.description, amountCents: e.amountCents! })),
      }),
    [items, extras, yieldQuantity, byId],
  );

  const problems: string[] = [];
  if (!yieldQuantity || yieldQuantity <= 0) problems.push('Informe o rendimento da receita.');
  if (items.some((i) => !i.quantity)) problems.push('Informe a quantidade de todos os ingredientes.');
  if (extras.some((e) => !e.description.trim() || e.amountCents === null)) problems.push('Preencha descrição e valor dos custos adicionais.');
  problems.push(...cost.errors.filter((e) => !e.includes('rendimento')));

  const onSave = () =>
    save.mutate(
      {
        productId: product.id,
        recipeId: bundle.recipe?.id ?? null,
        values: {
          yield_quantity: yieldQuantity!,
          notes: notes.trim() || null,
          items: items.map((i) => ({ ingredient_id: i.ingredientId, quantity: i.quantity!, unit: i.unit })),
          extras: extras.map((e) => ({ description: e.description.trim(), amount_cents: e.amountCents! })),
        },
      },
      {
        onSuccess: () => {
          if (product.cost_mode !== 'recipe') {
            saveProduct.mutate({
              id: product.id,
              values: {
                name: product.name,
                description: product.description,
                category: product.category,
                unit: product.unit,
                price_cents: product.price_cents,
                cost_mode: 'recipe',
                manual_unit_cost_cents: product.manual_unit_cost_cents,
                photo_path: product.photo_path,
                active: product.active,
              },
            });
          }
        },
      },
    );

  const ingredientOptions = ingredients
    .filter((i) => i.active && !items.some((item) => item.ingredientId === i.id))
    .map((i) => ({ id: i.id, label: i.name, description: `R$ ${(i.purchase_price_cents / 100).toFixed(2).replace('.', ',')} por ${formatQuantity(i.purchase_quantity)} ${i.unit}` }));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="Receita" description="Ingredientes de um lote e quanto ele rende." />
        <fieldset disabled={!editable} className="space-y-4 p-4">
          <Field label={`Rendimento (${product.unit})`} required hint={`Quantas unidades de "${product.name}" um lote produz.`}>
            <QuantityInput value={yieldQuantity} onValueChange={setYieldQuantity} className="w-40" />
          </Field>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium text-ink-soft">Ingredientes</p>
              {editable ? (
                <Button type="button" size="sm" variant="outline" onClick={() => setPicking(true)}>
                  <Plus /> Ingrediente
                </Button>
              ) : null}
            </div>
            {ingredients.length === 0 ? (
              <EmptyState title="Nenhum ingrediente cadastrado" description={<>Cadastre ingredientes em <Link className="text-accent-ink underline" to="/ingredientes">Ingredientes</Link>.</>} />
            ) : null}
            {items.length === 0 && ingredients.length > 0 ? <p className="rounded-lg bg-subtle px-3 py-2 text-sm text-muted">Nenhum ingrediente na receita.</p> : null}
            <ul className="space-y-2">
              {items.map((item, index) => {
                const ing = byId.get(item.ingredientId) as Ingredient | undefined;
                const line = cost.items.find((c) => c.name === ing?.name);
                return (
                  <li key={item.key} className="grid grid-cols-[1fr_auto] items-end gap-2 rounded-lg border border-line p-2 sm:grid-cols-[1fr_7rem_6rem_6rem_auto]">
                    <div className="col-span-2 min-w-0 sm:col-span-1">
                      <p className="truncate text-sm font-medium">{ing?.name ?? 'Ingrediente removido'}</p>
                      <p className="text-xs text-muted">comprado em {ing?.unit}</p>
                    </div>
                    <Field label="Qtd." labelClassName="text-xs">
                      <QuantityInput value={item.quantity} onValueChange={(q) => setItems((list) => list.map((x, i) => (i === index ? { ...x, quantity: q } : x)))} />
                    </Field>
                    <Field label="Unidade" labelClassName="text-xs">
                      <Select value={item.unit} onChange={(e) => setItems((list) => list.map((x, i) => (i === index ? { ...x, unit: e.target.value as MeasureUnit } : x)))}>
                        {MEASURE_UNITS.filter((u) => !ing || areCompatible(u.value, ing.unit)).map((u) => (
                          <option key={u.value} value={u.value}>
                            {u.value}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <div className="text-right text-sm">
                      <p className="text-xs text-muted">custo</p>
                      <Money cents={line?.costCents ?? 0} />
                    </div>
                    {editable ? (
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remover ${ing?.name ?? 'ingrediente'}`} onClick={() => setItems((list) => list.filter((_, i) => i !== index))}>
                        <Trash2 />
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium text-ink-soft">Custos adicionais do lote</p>
              {editable ? (
                <Button type="button" size="sm" variant="outline" onClick={() => setExtras((list) => [...list, { key: crypto.randomUUID(), description: '', amountCents: null }])}>
                  <Plus /> Custo adicional
                </Button>
              ) : null}
            </div>
            <p className="mb-2 text-xs text-muted">Ex.: potes e tampas, gás, energia do forno — só o que você quiser incluir no custo do produto.</p>
            <ul className="space-y-2">
              {extras.map((extra, index) => (
                <li key={extra.key} className="flex items-end gap-2">
                  <Field label="Descrição" labelClassName="text-xs" className="flex-1">
                    <Input value={extra.description} onChange={(e) => setExtras((list) => list.map((x, i) => (i === index ? { ...x, description: e.target.value } : x)))} />
                  </Field>
                  <Field label="Valor por lote" labelClassName="text-xs" className="w-36">
                    <MoneyInput value={extra.amountCents} onValueChange={(v) => setExtras((list) => list.map((x, i) => (i === index ? { ...x, amountCents: v } : x)))} />
                  </Field>
                  {editable ? (
                    <Button type="button" variant="ghost" size="icon-sm" aria-label="Remover custo adicional" onClick={() => setExtras((list) => list.filter((_, i) => i !== index))}>
                      <Trash2 />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>

          <Field label="Modo de preparo / observações">
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </fieldset>
      </Card>

      <Card className="h-fit">
        <CardHeader title="Custo estimado" />
        <dl className="space-y-2 p-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Ingredientes (com aproveitamento)</dt>
            <dd><Money cents={cost.ingredientsCostCents} /></dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Custos adicionais</dt>
            <dd><Money cents={cost.extraCostsCents} /></dd>
          </div>
          <div className="flex justify-between border-t border-line pt-2 font-medium">
            <dt>Custo do lote</dt>
            <dd><Money cents={cost.batchCostCents} /></dd>
          </div>
          <div className="flex justify-between text-base font-semibold">
            <dt>Por {product.unit}</dt>
            <dd><Money cents={yieldQuantity ? cost.unitCostCents : null} /></dd>
          </div>
          {product.price_cents !== null && yieldQuantity ? (
            <div className="flex justify-between text-muted">
              <dt>Margem sobre o preço atual</dt>
              <dd><Money cents={product.price_cents - cost.unitCostCents} /></dd>
            </div>
          ) : null}
        </dl>
        <p className="border-t border-line px-4 py-3 text-xs text-muted">
          Inclui apenas os ingredientes e custos adicionais listados. Mão de obra e despesas fixas não entram aqui (registre-as em Despesas). Unidades só são
          convertidas dentro da mesma grandeza (kg↔g, l↔ml, dúzia↔unidade).
        </p>
        {editable ? (
          <div className="space-y-2 border-t border-line p-4">
            {problems.length > 0 ? (
              <ul className="space-y-1 text-xs text-danger" role="alert">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : null}
            <Button className="w-full" disabled={problems.length > 0} loading={save.isPending} onClick={onSave}>
              Salvar receita
            </Button>
            {product.cost_mode !== 'recipe' ? <p className="text-xs text-muted">Ao salvar, o produto passa a usar o custo da receita.</p> : null}
            {bundle.recipe ? (
              <Button variant="ghost" size="sm" className="w-full" onClick={() => setConfirmRemove(true)}>
                <Trash2 /> Remover receita
              </Button>
            ) : null}
          </div>
        ) : null}
      </Card>

      <EntityPicker
        open={picking}
        onOpenChange={setPicking}
        title="Adicionar ingrediente"
        options={ingredientOptions}
        emptyText="Nenhum ingrediente disponível. Cadastre em Ingredientes."
        onSelect={(option) => {
          const ing = byId.get(option.id)!;
          const unit: MeasureUnit = ing.unit === 'kg' ? 'g' : ing.unit === 'l' ? 'ml' : ing.unit;
          setItems((list) => [...list, { key: crypto.randomUUID(), ingredientId: ing.id, quantity: null, unit }]);
        }}
      />
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remover receita?"
        description="O produto passará a usar o custo manual. Vendas já registradas mantêm o custo que tinham."
        confirmLabel="Remover"
        onConfirm={() => remove.mutateAsync({ recipeId: bundle.recipe!.id })}
      />
    </div>
  );
}
