import { supabase } from '@/lib/supabase';
import { unwrap } from './api';
import { useBusinessQuery, useWrite } from './hooks';
import type {
  Customer,
  CustomerSummary,
  Ingredient,
  PriceHistoryRow,
  ProductRow,
  Recipe,
  RecipeExtraCost,
  RecipeItem,
  Supplier,
} from './types';

/**
 * Cadastros: CRUD direto nas tabelas, protegido pela RLS (owner/editor gravam,
 * todos os membros leem). Colunas de autoria e business_id não são graváveis
 * após a criação (privilégios por coluna no banco).
 */

// ── Clientes ────────────────────────────────────────────────────────────────

export function useCustomers() {
  return useBusinessQuery(['customers', 'summary'], (businessId) =>
    unwrap<CustomerSummary[]>(supabase.from('v_customer_summary').select('*').eq('business_id', businessId).order('name')),
  );
}

export function useCustomer(customerId: string | undefined) {
  return useBusinessQuery(
    ['customers', 'detail', customerId],
    () => unwrap<CustomerSummary>(supabase.from('v_customer_summary').select('*').eq('id', customerId!).single()),
    { enabled: Boolean(customerId) },
  );
}

export interface CustomerInput {
  name: string;
  phone: string | null;
  notes: string | null;
  active: boolean;
}

export function useSaveCustomer() {
  return useWrite<{ id?: string; values: CustomerInput }, Customer>({
    mutationFn: ({ id, values }, businessId) =>
      id
        ? unwrap<Customer>(supabase.from('customers').update(values).eq('id', id).select('*').single())
        : unwrap<Customer>(supabase.from('customers').insert({ ...values, business_id: businessId }).select('*').single()),
    success: (_r, vars) => (vars.id ? 'Cliente atualizado.' : 'Cliente cadastrado.'),
  });
}

export function useDeleteCustomer() {
  return useWrite<{ id: string }, void>({
    mutationFn: async ({ id }) => {
      await unwrap(supabase.from('customers').delete().eq('id', id));
    },
    success: 'Cliente excluído.',
  });
}

// ── Fornecedores ────────────────────────────────────────────────────────────

export function useSuppliers() {
  return useBusinessQuery(['suppliers', 'list'], (businessId) =>
    unwrap<Supplier[]>(supabase.from('suppliers').select('*').eq('business_id', businessId).order('name')),
  );
}

export function useSaveSupplier() {
  return useWrite<{ id?: string; values: Omit<Supplier, 'id' | 'business_id'> }, Supplier>({
    mutationFn: ({ id, values }, businessId) =>
      id
        ? unwrap<Supplier>(supabase.from('suppliers').update(values).eq('id', id).select('*').single())
        : unwrap<Supplier>(supabase.from('suppliers').insert({ ...values, business_id: businessId }).select('*').single()),
    success: (_r, vars) => (vars.id ? 'Fornecedor atualizado.' : 'Fornecedor cadastrado.'),
  });
}

// ── Produtos ────────────────────────────────────────────────────────────────

export function useProducts() {
  return useBusinessQuery(['products', 'list'], (businessId) =>
    unwrap<ProductRow[]>(supabase.from('v_products').select('*').eq('business_id', businessId).order('name')),
  );
}

export function useProduct(productId: string | undefined) {
  return useBusinessQuery(
    ['products', 'detail', productId],
    () => unwrap<ProductRow>(supabase.from('v_products').select('*').eq('id', productId!).single()),
    { enabled: Boolean(productId) },
  );
}

export function usePriceHistory(productId: string | undefined) {
  return useBusinessQuery(
    ['products', 'price-history', productId],
    () =>
      unwrap<PriceHistoryRow[]>(
        supabase.from('product_price_history').select('*').eq('product_id', productId!).order('changed_at', { ascending: false }),
      ),
    { enabled: Boolean(productId) },
  );
}

export interface ProductInput {
  name: string;
  description: string | null;
  category: string | null;
  unit: string;
  price_cents: number | null;
  cost_mode: 'manual' | 'recipe';
  manual_unit_cost_cents: number | null;
  photo_path: string | null;
  active: boolean;
}

export function useSaveProduct() {
  return useWrite<{ id?: string; values: ProductInput }, { id: string }>({
    mutationFn: ({ id, values }, businessId) =>
      id
        ? unwrap<{ id: string }>(supabase.from('products').update(values).eq('id', id).select('id').single())
        : unwrap<{ id: string }>(supabase.from('products').insert({ ...values, business_id: businessId }).select('id').single()),
    success: (_r, vars) => (vars.id ? 'Produto atualizado.' : 'Produto cadastrado.'),
  });
}

// ── Ingredientes ────────────────────────────────────────────────────────────

export function useIngredients() {
  return useBusinessQuery(['ingredients', 'list'], (businessId) =>
    unwrap<Ingredient[]>(supabase.from('ingredients').select('*').eq('business_id', businessId).order('name')),
  );
}

export type IngredientInput = Omit<Ingredient, 'id' | 'business_id' | 'updated_at'>;

export function useSaveIngredient() {
  return useWrite<{ id?: string; values: IngredientInput }, Ingredient>({
    mutationFn: ({ id, values }, businessId) =>
      id
        ? unwrap<Ingredient>(supabase.from('ingredients').update(values).eq('id', id).select('*').single())
        : unwrap<Ingredient>(supabase.from('ingredients').insert({ ...values, business_id: businessId }).select('*').single()),
    success: (_r, vars) => (vars.id ? 'Ingrediente atualizado.' : 'Ingrediente cadastrado.'),
  });
}

export function useDeleteIngredient() {
  return useWrite<{ id: string }, void>({
    mutationFn: async ({ id }) => {
      await unwrap(supabase.from('ingredients').delete().eq('id', id));
    },
    success: 'Ingrediente excluído.',
  });
}

// ── Receitas ────────────────────────────────────────────────────────────────

export interface RecipeBundle {
  recipe: Recipe | null;
  items: RecipeItem[];
  extras: RecipeExtraCost[];
}

export function useRecipe(productId: string | undefined) {
  return useBusinessQuery(
    ['recipes', 'detail', productId],
    async () => {
      const recipe = await unwrap<Recipe | null>(supabase.from('recipes').select('*').eq('product_id', productId!).maybeSingle());
      if (!recipe) return { recipe: null, items: [], extras: [] } satisfies RecipeBundle;
      const [items, extras] = await Promise.all([
        unwrap<RecipeItem[]>(supabase.from('recipe_items').select('*').eq('recipe_id', recipe.id)),
        unwrap<RecipeExtraCost[]>(supabase.from('recipe_extra_costs').select('*').eq('recipe_id', recipe.id)),
      ]);
      return { recipe, items, extras } satisfies RecipeBundle;
    },
    { enabled: Boolean(productId) },
  );
}

export interface RecipeInput {
  yield_quantity: number;
  notes: string | null;
  items: Array<{ ingredient_id: string; quantity: number; unit: string }>;
  extras: Array<{ description: string; amount_cents: number }>;
}

/**
 * Salva a receita completa. Como são cadastros (sem impacto em vendas passadas —
 * o custo é copiado para cada venda), a substituição de itens é feita em etapas;
 * a unidade de cada item é validada pelo banco.
 */
export function useSaveRecipe() {
  return useWrite<{ productId: string; recipeId: string | null; values: RecipeInput }, void>({
    mutationFn: async ({ productId, recipeId, values }, businessId) => {
      let id = recipeId;
      if (id) {
        await unwrap(supabase.from('recipes').update({ yield_quantity: values.yield_quantity, notes: values.notes }).eq('id', id));
      } else {
        const created = await unwrap<{ id: string }>(
          supabase
            .from('recipes')
            .insert({ business_id: businessId, product_id: productId, yield_quantity: values.yield_quantity, notes: values.notes })
            .select('id')
            .single(),
        );
        id = created.id;
      }
      await unwrap(supabase.from('recipe_items').delete().eq('recipe_id', id));
      await unwrap(supabase.from('recipe_extra_costs').delete().eq('recipe_id', id));
      if (values.items.length > 0) {
        await unwrap(supabase.from('recipe_items').insert(values.items.map((item) => ({ ...item, business_id: businessId, recipe_id: id }))));
      }
      if (values.extras.length > 0) {
        await unwrap(
          supabase.from('recipe_extra_costs').insert(values.extras.map((extra) => ({ ...extra, business_id: businessId, recipe_id: id }))),
        );
      }
    },
    success: 'Receita salva.',
  });
}

export function useDeleteRecipe() {
  return useWrite<{ recipeId: string }, void>({
    mutationFn: async ({ recipeId }) => {
      await unwrap(supabase.from('recipes').delete().eq('id', recipeId));
    },
    success: 'Receita removida. O produto passa a usar o custo manual.',
  });
}
