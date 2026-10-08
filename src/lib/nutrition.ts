import type { BlockTarget, Food, Meal, MealItem, Nutrients, ProfileId } from '../types';

export const ZERO: Nutrients = { kcal: 0, proteina: 0, carbohidratos: 0, grasas: 0, fibra: 0, sal: 0 };

export type FoodMap = Record<string, Food>;

export function toFoodMap(list: Food[]): FoodMap {
  return Object.fromEntries(list.map((f) => [f.id, f]));
}

/** Nutrientes de `baseGrams` (g/ml en estado nutricional base) de un alimento. */
export function nutrientsFor(food: Food, baseGrams: number): Nutrients {
  const q = Math.max(0, baseGrams) / 100;
  return {
    kcal: food.kcalPor100 * q,
    proteina: food.proteinaPor100 * q,
    carbohidratos: food.carbohidratosPor100 * q,
    grasas: food.grasasPor100 * q,
    fibra: (food.fibraPor100 ?? 0) * q,
    sal: (food.salPor100 ?? 0) * q,
  };
}

export function addNutrients(a: Nutrients, b: Nutrients): Nutrients {
  return {
    kcal: a.kcal + b.kcal,
    proteina: a.proteina + b.proteina,
    carbohidratos: a.carbohidratos + b.carbohidratos,
    grasas: a.grasas + b.grasas,
    fibra: a.fibra + b.fibra,
    sal: a.sal + b.sal,
  };
}

export function sumNutrients(list: Nutrients[]): Nutrients {
  return list.reduce(addNutrients, { ...ZERO });
}

export function itemNutrients(item: MealItem, profile: ProfileId, foods: FoodMap): Nutrients {
  const food = foods[item.foodId];
  if (!food) return { ...ZERO };
  return nutrientsFor(food, item.cantidades[profile] ?? 0);
}

export function mealNutrients(meal: Pick<Meal, 'items'>, profile: ProfileId, foods: FoodMap): Nutrients {
  return sumNutrients(meal.items.map((i) => itemNutrients(i, profile, foods)));
}

/** kcal estimadas a partir de macros (Atwater 4/4/9), útil para validar fichas. */
export function kcalFromMacros(p: number, c: number, f: number): number {
  return p * 4 + c * 4 + f * 9;
}

/** Diferencia relativa entre kcal declaradas y kcal por macros (para avisar fichas incoherentes). */
export function macroConsistency(food: Food): number {
  const est = kcalFromMacros(food.proteinaPor100, food.carbohidratosPor100, food.grasasPor100);
  if (food.kcalPor100 === 0) return 0;
  return (est - food.kcalPor100) / food.kcalPor100;
}

export type RangeStatus = 'en_rango' | 'cerca' | 'bajo' | 'alto';

/** Estado respecto al objetivo de bloque: en rango, cerca (≤1,5× tolerancia) o fuera. */
export function rangeStatus(kcal: number, target: BlockTarget): RangeStatus {
  const d = kcal - target.kcal;
  if (Math.abs(d) <= target.tolerancia) return 'en_rango';
  if (Math.abs(d) <= target.tolerancia * 1.5) return 'cerca';
  return d < 0 ? 'bajo' : 'alto';
}

export function round(n: number, decimals = 0): number {
  const m = 10 ** decimals;
  return Math.round(n * m) / m;
}
