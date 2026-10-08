import type { Category, Food, Meal, MealItem, Profile, ProfileId } from '../types';
import { PROFILE_IDS } from '../types';
import { baseToServing, servingToBase, type ConversionMap } from './conversions';
import { nutrientsFor, type FoodMap } from './nutrition';
import { portionRange, snap } from './portions';
import { foodAllowedFor } from './validation';

/** Cantidad base (g/ml) de `toFood` con las mismas kcal que `fromBase` de `fromFood` (sin redondear). */
export function equivalentBaseGrams(fromFood: Food, fromBase: number, toFood: Food): number {
  if (toFood.kcalPor100 <= 0) return 0;
  return (fromBase * fromFood.kcalPor100) / toFood.kcalPor100;
}

/**
 * Ajusta una cantidad base a una ración práctica:
 * gramos cocinados/base múltiplos de 5 (o del incremento si es menor), unidades enteras (mín. 1).
 */
export function practicalBase(
  food: Food,
  base: number,
  conversions: ConversionMap,
  metodoId?: string,
): number {
  const serving = baseToServing(food, base, conversions, metodoId);
  let snapped: number;
  if (food.unidadBase === 'unidad') snapped = Math.max(1, Math.round(serving));
  else snapped = Math.max(5, Math.round(serving / 5) * 5);
  return servingToBase(food, snapped, conversions, metodoId);
}

export interface Equivalence {
  base: number;
  kcal: number;
  diffKcal: number;
}

/** Cantidad equivalente por calorías, redondeada a ración práctica, con la diferencia de kcal resultante. */
export function equivalentPortion(
  fromFood: Food,
  fromBase: number,
  toFood: Food,
  conversions: ConversionMap,
  metodoId?: string,
): Equivalence {
  const fromKcal = nutrientsFor(fromFood, fromBase).kcal;
  const exact = equivalentBaseGrams(fromFood, fromBase, toFood);
  const base = practicalBase(toFood, exact, conversions, metodoId);
  const kcal = nutrientsFor(toFood, base).kcal;
  return { base, kcal, diffKcal: kcal - fromKcal };
}

/** Categorías entre las que tiene sentido sustituir */
const SUB_GROUPS: Category[][] = [
  ['hidrato'],
  ['proteina'],
  ['verdura'],
  ['salsa'],
  ['queso', 'lacteo', 'postre'],
  ['fruta', 'postre'],
  ['extra'],
];

export function substitutionCategories(cat: Category): Category[] {
  const set = new Set<Category>();
  for (const g of SUB_GROUPS) if (g.includes(cat)) g.forEach((c) => set.add(c));
  return set.size ? [...set] : [cat];
}

export interface SubstituteOption {
  food: Food;
  cantidades: Record<ProfileId, number>;
  kcal: Record<ProfileId, number>;
  diffKcal: Record<ProfileId, number>;
  /** no es equivalente calórico (p. ej. arroz de coliflor): se usa su ración habitual */
  noEquivalente: boolean;
  /** algún perfil tiene restricción con este alimento */
  restringido: boolean;
}

/**
 * Comparador de sustituciones: para un ingrediente de una comida devuelve alternativas
 * ordenadas por diferencia calórica (menor primero). Los sustitutos "ligeros" van al final.
 */
export function substitutesFor(
  item: MealItem,
  foods: Food[],
  profiles: Record<ProfileId, Profile>,
  conversions: ConversionMap,
  options: { prohibidos?: string[]; categorias?: Category[] } = {},
): SubstituteOption[] {
  const fm: FoodMap = Object.fromEntries(foods.map((f) => [f.id, f]));
  const from = fm[item.foodId];
  if (!from) return [];
  const cats = options.categorias ?? substitutionCategories(from.categoria);
  const out: SubstituteOption[] = [];
  for (const to of foods) {
    if (to.id === from.id || to.archivado || !cats.includes(to.categoria)) continue;
    if (options.prohibidos?.includes(to.id)) continue;
    if (to.tags.includes('solo_si_se_incluye') && from.categoria !== 'extra') continue;
    const ligero = to.tags.includes('sustituto_ligero');
    const cantidades = {} as Record<ProfileId, number>;
    const kcal = {} as Record<ProfileId, number>;
    const diffKcal = {} as Record<ProfileId, number>;
    for (const pid of PROFILE_IDS) {
      const fromBase = item.cantidades[pid] ?? 0;
      if (fromBase <= 0) {
        cantidades[pid] = 0;
        kcal[pid] = 0;
        diffKcal[pid] = 0;
        continue;
      }
      const fromKcal = nutrientsFor(from, fromBase).kcal;
      let base: number;
      if (ligero) {
        const r = portionRange(to, profiles[pid]);
        base = servingToBase(to, r.habitual, conversions);
      } else {
        base = equivalentPortion(from, fromBase, to, conversions).base;
        // respeta el máximo razonable del perfil
        const r = portionRange(to, profiles[pid]);
        const serving = baseToServing(to, base, conversions);
        if (serving > r.max * 1.5) base = servingToBase(to, snap(r.max * 1.5, r.step, 0, Infinity), conversions);
        // límite de legumbres del perfil: nunca se supera
        const legMax = profiles[pid].restricciones.maxLegumbresPorComida;
        if (legMax != null && to.tags.includes('legumbre') && baseToServing(to, base, conversions) > r.max) {
          base = servingToBase(to, r.max, conversions);
        }
      }
      cantidades[pid] = base;
      kcal[pid] = nutrientsFor(to, base).kcal;
      diffKcal[pid] = kcal[pid] - fromKcal;
    }
    const restringido = PROFILE_IDS.some((pid) => cantidades[pid] > 0 && !foodAllowedFor(to, profiles[pid]));
    out.push({ food: to, cantidades, kcal, diffKcal, noEquivalente: ligero, restringido });
  }
  const err = (o: SubstituteOption) =>
    PROFILE_IDS.reduce((s, p) => s + Math.abs(o.diffKcal[p]), 0) + (o.noEquivalente ? 1e6 : 0) + (o.restringido ? 1e5 : 0);
  return out.sort((a, b) => err(a) - err(b));
}

/** Sustituye el ingrediente `index` por `toFoodId` con las cantidades indicadas. */
export function replaceItem(
  meal: Meal,
  index: number,
  toFoodId: string,
  cantidades: Record<ProfileId, number>,
): Meal {
  const items = meal.items.map((it, i) =>
    i === index ? { foodId: toFoodId, cantidades: { ...cantidades } } : it,
  );
  return { ...meal, items: mergeDuplicates(items) };
}

/** Si un alimento queda repetido, suma sus cantidades. */
export function mergeDuplicates(items: MealItem[]): MealItem[] {
  const map = new Map<string, MealItem>();
  for (const it of items) {
    const key = `${it.foodId}|${it.metodoId ?? ''}`;
    const prev = map.get(key);
    if (prev) {
      for (const p of PROFILE_IDS) prev.cantidades[p] = (prev.cantidades[p] ?? 0) + (it.cantidades[p] ?? 0);
    } else map.set(key, { ...it, cantidades: { ...it.cantidades } });
  }
  return [...map.values()];
}

/**
 * Compensa un déficit de kcal añadiendo (o aumentando) un alimento para cada perfil.
 * Ej.: tras cambiar arroz por arroz de coliflor → "añadir cottage / pan / papa / postre".
 */
export function fillDeficit(
  meal: Meal,
  foodId: string,
  deficits: Record<ProfileId, number>,
  foods: FoodMap,
  conversions: ConversionMap,
): Meal {
  const food = foods[foodId];
  if (!food) return meal;
  const items = meal.items.map((it) => ({ ...it, cantidades: { ...it.cantidades } }));
  let item = items.find((i) => i.foodId === foodId);
  if (!item) {
    item = { foodId, cantidades: { dani: 0, alba: 0 } };
    items.push(item);
  }
  for (const pid of PROFILE_IDS) {
    const d = deficits[pid];
    if (d <= 0) continue;
    const exact = (d / food.kcalPor100) * 100;
    item.cantidades[pid] += practicalBase(food, exact, conversions);
  }
  return { ...meal, items };
}
