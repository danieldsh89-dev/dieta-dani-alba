/**
 * Variantes de una comida: cambiar SOLO el hidrato (o la proteína, la verdura…) por otro,
 * con la cantidad equivalente en calorías, y reajustar lo justo para seguir en el objetivo.
 * "Pollo con papas" sin papas en casa → "Pollo con arroz" en un toque.
 */
import type { BlockTarget, Category, Food, Meal, ProfileId } from '../types';
import { PROFILE_IDS } from '../types';
import { nutrientsFor, type FoodMap } from './nutrition';
import { evaluateMeal, mealName, reoptimizeMeal, type GeneratedOption, type GeneratorContext } from './mealGenerator';
import { replaceItem, substitutesFor, type SubstituteOption } from './substitutions';
import { toConversionMap } from './conversions';

export type VariantKind = 'hidrato' | 'proteina' | 'verdura' | 'otro';

export const VARIANT_KINDS: { id: VariantKind; label: string; cats: Category[] }[] = [
  { id: 'hidrato', label: '🍚 Hidrato', cats: ['hidrato'] },
  { id: 'proteina', label: '🍗 Proteína', cats: ['proteina'] },
  { id: 'verdura', label: '🥦 Verdura', cats: ['verdura'] },
  { id: 'otro', label: '🔁 Otro ingrediente', cats: [] },
];

/** Ingredientes que se pueden cambiar de cada tipo (el principal primero, por kcal). */
export function swappable(meal: Pick<Meal, 'items'>, fm: FoodMap, kind: VariantKind): number[] {
  const cats = VARIANT_KINDS.find((k) => k.id === kind)!.cats;
  const kcal = (i: number) => {
    const it = meal.items[i];
    const f = fm[it.foodId];
    return f ? nutrientsFor(f, PROFILE_IDS.reduce((s, p) => s + (it.cantidades[p] ?? 0), 0)).kcal : 0;
  };
  return meal.items
    .map((it, i) => ({ i, f: fm[it.foodId] }))
    .filter(({ f }) => f && (kind === 'otro' || cats.includes(f.categoria)))
    .map(({ i }) => i)
    .sort((a, b) => kcal(b) - kcal(a));
}

export interface VariantOption extends SubstituteOption {
  /** hay en casa */
  enCasa: boolean;
}

/** Alternativas para el ingrediente `index` (las que hay en casa, primero). */
export function variantOptions(meal: Meal, index: number, gctx: GeneratorContext, enCasa: Set<string> = new Set()): VariantOption[] {
  const it = meal.items[index];
  const fm: FoodMap = Object.fromEntries(gctx.foods.map((f) => [f.id, f]));
  const from = fm[it.foodId];
  if (!from) return [];
  const others = new Set(meal.items.map((x) => x.foodId));
  const opts = substitutesFor(it, gctx.foods, gctx.profiles, toConversionMap(gctx.conversions), { categorias: [from.categoria] })
    .filter((o) => !others.has(o.food.id) && o.food.bloques.includes(meal.bloque))
    .map((o) => ({ ...o, enCasa: enCasa.has(o.food.id) }));
  // en casa primero; dentro, el orden de equivalencia calórica
  return [...opts.filter((o) => o.enCasa), ...opts.filter((o) => !o.enCasa)];
}

/**
 * La variante: cambia el ingrediente y reajusta SOLO el nuevo para quedar en el objetivo
 * (todo lo demás, igual). Devuelve la comida con su nombre nuevo y su evaluación.
 */
export function buildVariant(
  meal: Meal,
  index: number,
  to: Food,
  cantidades: Record<ProfileId, number>,
  gctx: GeneratorContext,
  objetivos?: Partial<Record<ProfileId, BlockTarget>>,
): GeneratedOption {
  const fm: FoodMap = Object.fromEntries(gctx.foods.map((f) => [f.id, f]));
  const swapped = replaceItem(meal, index, to.id, cantidades);
  const oldName = meal.nombre;
  const autoName = mealName(swapped.items.map((i) => i.foodId), fm);
  const from = fm[meal.items[index].foodId];
  // si el nombre llevaba el ingrediente ("Pollo con papas"), se cambia en el nombre; si no, nombre automático
  const fromWord = from?.nombre.split(' (')[0].split(' ')[0];
  const toWord = to.nombre.split(' (')[0].split(/[ /]/)[0];
  // sin el código del menú ("B2 ") para no confundirla con la original
  const base = oldName.replace(/^[ABC]\d+\s+/, '');
  const nombre =
    fromWord && new RegExp(`\\b${fromWord}`, 'i').test(base)
      ? base.replace(new RegExp(`\\b${fromWord}[a-záéíóúñ]*`, 'i'), toWord.toLowerCase())
      : autoName;
  // solo el nuevo ingrediente se mueve: los demás, bloqueados mientras se reajusta
  const locked: Meal = {
    ...swapped,
    nombre,
    items: swapped.items.map((x) => ({ ...x, bloqueado: x.foodId === to.id ? false : true })),
  };
  const opt = reoptimizeMeal(locked, 'equilibrada', gctx, objetivos);
  // se devuelven los bloqueos como estaban
  const lockedBefore = new Set(meal.items.filter((x) => x.bloqueado).map((x) => x.foodId));
  const items = opt.meal.items.map((x) => ({ ...x, bloqueado: lockedBefore.has(x.foodId) || undefined }));
  const result: Meal = { ...opt.meal, items, nombre };
  return evaluateMeal(result, gctx, objetivos, 'Variante');
}
