import type { AppData, Favorite, Meal, ProfileId } from '../types';
import { PROFILE_IDS } from '../types';
import { SEED_FOODS } from '../data/foods';
import { SEED_CONVERSIONS } from '../data/conversions';
import { DEFAULT_SETTINGS, SEED_PROFILES } from '../data/profiles';
import { SEED_FAVORITES } from '../data/seedMeals';
import { servingToBase, toConversionMap } from '../lib/conversions';
import { mealNutrients, toFoodMap } from '../lib/nutrition';

export const DATA_VERSION = 1;

export function buildSeedFavorites(): Favorite[] {
  const fm = toFoodMap(SEED_FOODS);
  const cm = toConversionMap(SEED_CONVERSIONS);
  return SEED_FAVORITES.map((sf) => {
    const meal: Meal = {
      id: sf.id,
      nombre: sf.nombre,
      bloque: sf.bloque,
      notas: sf.notas,
      origen: 'semilla',
      items: sf.items.map((it) => ({
        foodId: it.foodId,
        metodoId: it.metodoId,
        cantidades: {
          dani: servingToBase(fm[it.foodId], it.dani, cm, it.metodoId),
          alba: servingToBase(fm[it.foodId], it.alba, cm, it.metodoId),
        },
      })),
    };
    const totales = Object.fromEntries(PROFILE_IDS.map((p) => [p, mealNutrients(meal, p, fm)])) as Record<
      ProfileId,
      ReturnType<typeof mealNutrients>
    >;
    return { ...meal, creado: new Date(0).toISOString(), totales };
  });
}

export function createSeedData(): AppData {
  return {
    version: DATA_VERSION,
    foods: structuredClone(SEED_FOODS),
    conversions: structuredClone(SEED_CONVERSIONS),
    profiles: structuredClone(SEED_PROFILES),
    favorites: buildSeedFavorites(),
    history: [],
    pantry: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

/** Añade a los datos guardados los alimentos/conversiones nuevos de la base sin pisar ediciones del usuario. */
export function mergeWithSeed(saved: AppData): AppData {
  const seed = createSeedData();
  const foodIds = new Set(saved.foods.map((f) => f.id));
  const convIds = new Set(saved.conversions.map((c) => c.id));
  return {
    ...seed,
    ...saved,
    foods: [...saved.foods, ...seed.foods.filter((f) => !foodIds.has(f.id))],
    conversions: [...saved.conversions, ...seed.conversions.filter((c) => !convIds.has(c.id))],
    settings: { ...seed.settings, ...saved.settings },
    profiles: {
      dani: { ...seed.profiles.dani, ...saved.profiles?.dani },
      alba: { ...seed.profiles.alba, ...saved.profiles?.alba },
    },
  };
}
