import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { n, productId, TestEnv } from './env';

let env: TestEnv;
let ana: string;
let biz: string;
let bolo: string;
let recipeId: string;
const ingredient: Record<string, string> = {};

beforeAll(async () => {
  env = await TestEnv.create();
  ana = await env.createUser('ana@example.com');
  biz = await env.createBusiness('Magi Doces', [{ userId: ana, role: 'owner' }]);

  await env.as(ana, async (s) => {
    bolo = await productId(s, biz, 'Bolo de pote');
    const add = async (name: string, unit: string, qty: number, price: number, yieldPercent = 100) => {
      const row = await s.one<{ id: string }>(
        `insert into public.ingredients (business_id, name, unit, purchase_quantity, purchase_price_cents, yield_percent)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [biz, name, unit, qty, price, yieldPercent],
      );
      ingredient[name] = row.id;
    };
    await add('Farinha', 'kg', 5, 2500); // R$ 25,00 / 5 kg → 0,5 centavo/g
    await add('Leite', 'l', 1, 600); // R$ 6,00 / l → 0,6 centavo/ml
    await add('Ovos', 'dz', 1, 1200); // R$ 12,00 / dúzia → 100 centavos/un
    await add('Morango', 'g', 1000, 3000, 75); // R$ 30,00/kg com 75% de aproveitamento
    const recipe = await s.one<{ id: string }>(
      `insert into public.recipes (business_id, product_id, yield_quantity) values ($1, $2, 12) returning id`,
      [biz, bolo],
    );
    recipeId = recipe.id;
  });
});

afterAll(async () => {
  await env.close();
});

describe('custo de receitas', () => {
  it('converte unidades compatíveis e considera rendimento', async () => {
    await env.as(ana, async (s) => {
      const item = (ing: string, qty: number, unit: string) =>
        s.query(`insert into public.recipe_items (business_id, recipe_id, ingredient_id, quantity, unit) values ($1, $2, $3, $4, $5)`, [
          biz,
          recipeId,
          ingredient[ing],
          qty,
          unit,
        ]);
      await item('Farinha', 500, 'g'); // 500 g × 0,5 = 250
      await item('Leite', 0.3, 'l'); // 300 ml × 0,6 = 180
      await item('Ovos', 4, 'un'); // 4 × 100 = 400
      await item('Morango', 0.2, 'kg'); // 200 g × (3000 / (1000 × 0,75)) = 800
    });
    const costs = await env.as(ana, (s) =>
      s.query<{ ingredient_name: string; cost_cents_exact: string }>(
        `select ingredient_name, cost_cents_exact from public.v_recipe_item_costs where recipe_id = $1 order by ingredient_name`,
        [recipeId],
      ),
    );
    expect(costs.map((c) => [c.ingredient_name, n(c.cost_cents_exact)])).toEqual([
      ['Farinha', 250],
      ['Leite', 180],
      ['Morango', 800],
      ['Ovos', 400],
    ]);
    const recipe = await env.as(ana, (s) =>
      s.one<{ batch_cost_cents_exact: string; unit_cost_cents: number }>(
        `select batch_cost_cents_exact, unit_cost_cents from public.v_recipe_costs where recipe_id = $1`,
        [recipeId],
      ),
    );
    expect(n(recipe.batch_cost_cents_exact)).toBe(1630);
    expect(recipe.unit_cost_cents).toBe(136); // 1630 / 12 = 135,83 → 136
  });

  it('inclui custos adicionais declarados no custo do lote', async () => {
    await env.as(ana, (s) =>
      s.query(`insert into public.recipe_extra_costs (business_id, recipe_id, description, amount_cents) values ($1, $2, 'Potes e tampas', 600)`, [
        biz,
        recipeId,
      ]),
    );
    const recipe = await env.as(ana, (s) =>
      s.one<{ extra_costs_cents: string; unit_cost_cents: number }>(
        `select extra_costs_cents, unit_cost_cents from public.v_recipe_costs where recipe_id = $1`,
        [recipeId],
      ),
    );
    expect(n(recipe.extra_costs_cents)).toBe(600);
    expect(recipe.unit_cost_cents).toBe(186); // 2230 / 12 = 185,83 → 186
  });

  it('não converte unidades incompatíveis', async () => {
    await expect(
      env.as(ana, (s) =>
        s.query(`update public.recipe_items set unit = 'ml' where recipe_id = $1 and ingredient_id = $2`, [recipeId, ingredient.Farinha]),
      ),
    ).rejects.toThrow(/Unidade incompatível/);
    await expect(
      env.as(ana, (s) => s.query(`update public.ingredients set unit = 'l' where id = $1`, [ingredient.Ovos])),
    ).rejects.toThrow(/usado em receitas/);
  });

  it('custo efetivo do produto vem da receita quando o modo é receita', async () => {
    await env.as(ana, (s) =>
      s.query(`update public.products set cost_mode = 'manual', manual_unit_cost_cents = 300, price_cents = 1200 where id = $1`, [bolo]),
    );
    let product = await env.as(ana, (s) =>
      s.one<{ effective_unit_cost_cents: number; cost_source: string }>(
        `select effective_unit_cost_cents, cost_source from public.v_products where id = $1`,
        [bolo],
      ),
    );
    expect(product).toEqual({ effective_unit_cost_cents: 300, cost_source: 'manual' });

    await env.as(ana, (s) => s.query(`update public.products set cost_mode = 'recipe' where id = $1`, [bolo]));
    product = await env.as(ana, (s) =>
      s.one(`select effective_unit_cost_cents, cost_source from public.v_products where id = $1`, [bolo]),
    );
    expect(product).toEqual({ effective_unit_cost_cents: 186, cost_source: 'recipe' });
  });

  it('venda copia o custo da receita vigente e não muda quando o ingrediente encarece', async () => {
    const today = await env.today();
    const saleId = await env.as(ana, (s) =>
      s.rpc<string>('create_sale', {
        p_business_id: biz,
        p_request_id: crypto.randomUUID(),
        p_sale: { sale_date: today, items: [{ product_id: bolo, quantity: 2 }] },
      }),
    );
    await env.as(ana, (s) => s.query(`update public.ingredients set purchase_price_cents = 5000 where id = $1`, [ingredient.Farinha]));
    const row = await env.as(ana, (s) =>
      s.one<{ unit_cost_cents: number; cost_source: string; line_cost_cents: string }>(
        `select unit_cost_cents, cost_source, line_cost_cents from public.sale_items where sale_id = $1`,
        [saleId],
      ),
    );
    expect(row.unit_cost_cents).toBe(186);
    expect(row.cost_source).toBe('recipe');
    expect(n(row.line_cost_cents)).toBe(372);
    const current = await env.as(ana, (s) =>
      s.one<{ unit_cost_cents: number }>(`select unit_cost_cents from public.v_recipe_costs where recipe_id = $1`, [recipeId]),
    );
    expect(current.unit_cost_cents).toBe(207); // farinha dobrou: (2480) / 12 = 206,67 → 207
  });

  it('modo receita sem componentes cai para o custo manual', async () => {
    await env.as(ana, async (s) => {
      const torta = await productId(s, biz, 'Torta de limão');
      await s.query(`update public.products set cost_mode = 'recipe', manual_unit_cost_cents = 700 where id = $1`, [torta]);
      await s.query(`insert into public.recipes (business_id, product_id, yield_quantity) values ($1, $2, 8)`, [biz, torta]);
      const product = await s.one(`select effective_unit_cost_cents, cost_source from public.v_products where id = $1`, [torta]);
      expect(product).toEqual({ effective_unit_cost_cents: 700, cost_source: 'manual' });
    });
  });

  it('valida rendimento e aproveitamento', async () => {
    await expect(
      env.as(ana, (s) =>
        s.query(
          `insert into public.ingredients (business_id, name, unit, purchase_quantity, purchase_price_cents, yield_percent)
           values ($1, 'Açúcar', 'kg', 1, 500, 0)`,
          [biz],
        ),
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      env.as(ana, (s) => s.query(`update public.recipes set yield_quantity = 0 where id = $1`, [recipeId])),
    ).rejects.toThrow(/check constraint/);
  });
});
