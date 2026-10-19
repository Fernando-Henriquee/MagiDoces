import { areCompatible, IncompatibleUnitsError, type MeasureUnit, unitFactor } from './units';

/**
 * Custo de receitas com aritmética racional exata (BigInt), reproduzindo as
 * views v_recipe_item_costs / v_recipe_costs do banco:
 *
 *   custo por unidade-base = preço / (quantidade adquirida × fator × aproveitamento/100)
 *   custo do item          = quantidade × fator da unidade do item × custo por unidade-base
 *   custo do lote          = Σ itens + Σ custos adicionais
 *   custo unitário         = round(custo do lote / rendimento)  (meio para longe do zero)
 */

class Fraction {
  readonly num: bigint;
  readonly den: bigint;

  constructor(num: bigint, den: bigint) {
    if (den === 0n) throw new Error('Denominador zero');
    this.num = num;
    this.den = den;
  }

  static of(value: number | string): Fraction {
    const text = typeof value === 'number' ? value.toFixed(6) : value;
    if (!/^-?\d+(\.\d+)?$/.test(text)) throw new Error(`Número inválido: ${text}`);
    const negative = text.startsWith('-');
    const [int = '0', frac = ''] = text.replace('-', '').split('.');
    const den = 10n ** BigInt(frac.length);
    const num = BigInt(int) * den + BigInt(frac || '0');
    return new Fraction(negative ? -num : num, den);
  }

  static zero = new Fraction(0n, 1n);

  add(other: Fraction): Fraction {
    return new Fraction(this.num * other.den + other.num * this.den, this.den * other.den);
  }

  mul(other: Fraction): Fraction {
    return new Fraction(this.num * other.num, this.den * other.den);
  }

  div(other: Fraction): Fraction {
    if (other.num === 0n) throw new Error('Divisão por zero');
    const sign = other.num < 0n ? -1n : 1n;
    return new Fraction(this.num * other.den * sign, this.den * other.num * sign);
  }

  /** Arredonda para inteiro, meio para longe do zero. */
  round(): number {
    const negative = this.num < 0n !== this.den < 0n;
    const n = this.num < 0n ? -this.num : this.num;
    const d = this.den < 0n ? -this.den : this.den;
    const q = n / d;
    const r = n % d;
    const rounded = r * 2n >= d ? q + 1n : q;
    return Number(negative ? -rounded : rounded);
  }

  toNumber(): number {
    return Number(this.num) / Number(this.den);
  }
}

export interface IngredientCostInput {
  unit: MeasureUnit;
  purchaseQuantity: number;
  purchasePriceCents: number;
  yieldPercent: number;
}

export interface RecipeItemInput {
  ingredient: IngredientCostInput & { name: string };
  quantity: number;
  unit: MeasureUnit;
}

export interface RecipeCostInput {
  yieldQuantity: number;
  items: RecipeItemInput[];
  extraCosts: Array<{ description: string; amountCents: number }>;
}

export interface RecipeCostBreakdown {
  items: Array<{ name: string; costCents: number; exactCostCents: number }>;
  ingredientsCostCents: number;
  extraCostsCents: number;
  batchCostCents: number;
  unitCostCents: number;
  errors: string[];
}

function costPerBaseUnit(ingredient: IngredientCostInput): Fraction {
  const [fn, fd] = unitFactor(ingredient.unit);
  const usable = Fraction.of(ingredient.purchaseQuantity)
    .mul(new Fraction(fn, fd))
    .mul(Fraction.of(ingredient.yieldPercent))
    .div(Fraction.of(100));
  return Fraction.of(ingredient.purchasePriceCents).div(usable);
}

function itemCost(item: RecipeItemInput): Fraction {
  if (!areCompatible(item.unit, item.ingredient.unit)) {
    throw new IncompatibleUnitsError(item.unit, item.ingredient.unit);
  }
  const [fn, fd] = unitFactor(item.unit);
  return Fraction.of(item.quantity).mul(new Fraction(fn, fd)).mul(costPerBaseUnit(item.ingredient));
}

export function computeRecipeCost(input: RecipeCostInput): RecipeCostBreakdown {
  const errors: string[] = [];
  let ingredients = Fraction.zero;
  const items = input.items.map((item) => {
    try {
      if (!(item.quantity > 0)) throw new Error(`Quantidade inválida para ${item.ingredient.name}.`);
      if (!(item.ingredient.purchaseQuantity > 0)) throw new Error(`Quantidade adquirida inválida para ${item.ingredient.name}.`);
      if (!(item.ingredient.yieldPercent > 0 && item.ingredient.yieldPercent <= 100)) {
        throw new Error(`Aproveitamento inválido para ${item.ingredient.name}.`);
      }
      const cost = itemCost(item);
      ingredients = ingredients.add(cost);
      return { name: item.ingredient.name, costCents: cost.round(), exactCostCents: cost.toNumber() };
    } catch (error) {
      errors.push(error instanceof IncompatibleUnitsError ? `${item.ingredient.name}: ${error.message}` : (error as Error).message);
      return { name: item.ingredient.name, costCents: 0, exactCostCents: 0 };
    }
  });
  const extras = input.extraCosts.reduce((sum, extra) => sum + extra.amountCents, 0);
  const batch = ingredients.add(Fraction.of(extras));
  let unitCostCents = 0;
  if (input.yieldQuantity > 0) {
    unitCostCents = batch.div(Fraction.of(input.yieldQuantity)).round();
  } else {
    errors.push('O rendimento da receita deve ser maior que zero.');
  }
  return {
    items,
    ingredientsCostCents: ingredients.round(),
    extraCostsCents: extras,
    batchCostCents: batch.round(),
    unitCostCents,
    errors,
  };
}
