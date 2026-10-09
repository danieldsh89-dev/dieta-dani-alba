import type { AppData, Favorite, Meal, ProfileId } from '../types';
import { PROFILE_IDS } from '../types';
import { SEED_FOODS } from '../data/foods';
import { SEED_CONVERSIONS } from '../data/conversions';
import { DEFAULT_SETTINGS, SEED_PROFILES, defaultTraining } from '../data/profiles';
import type { Profile } from '../types';
import { SEED_FAVORITES } from '../data/seedMeals';
import { DIETA_MODULAR } from '../data/dietaModular';
import { servingToBase, toConversionMap } from '../lib/conversions';
import { mealNutrients, toFoodMap } from '../lib/nutrition';
import { emptySync, key, touch } from '../sync/docs';

/** 2 = v1.3: días de entreno desactivados por defecto, comidas por persona, extras y semanas tipo */
export const DATA_VERSION = 2;

export function buildSeedFavorites(): Favorite[] {
  const fm = toFoodMap(SEED_FOODS);
  const cm = toConversionMap(SEED_CONVERSIONS);
  return [...SEED_FAVORITES, ...DIETA_MODULAR].map((sf) => {
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
    shoppingChecked: [],
    pesos: [],
    ratings: {},
    semanasTipo: [],
    settings: { ...DEFAULT_SETTINGS },
    sync: emptySync(),
  };
}

/** Añade a los datos guardados los alimentos/conversiones nuevos de la base sin pisar ediciones del usuario. */
export function mergeWithSeed(saved: AppData): AppData {
  const merged = mergeRaw(saved);
  if ((saved.version ?? 1) >= 2) return merged;
  // Migración a v2: sin diferencias en días de entreno (el usuario puede reactivarlo en Configuración).
  // Se marca como cambio para que también gane en la sincronización frente a perfiles antiguos.
  const profiles = {
    dani: { ...merged.profiles.dani, entreno: { ...merged.profiles.dani.entreno, activo: false } },
    alba: { ...merged.profiles.alba, entreno: { ...merged.profiles.alba.entreno, activo: false } },
  };
  return touch({ ...merged, version: DATA_VERSION, profiles }, [key('profile', 'dani'), key('profile', 'alba')]);
}

function mergeRaw(saved: AppData): AppData {
  const seed = createSeedData();
  const foodIds = new Set(saved.foods.map((f) => f.id));
  const convIds = new Set(saved.conversions.map((c) => c.id));
  return {
    ...seed,
    ...saved,
    foods: [...saved.foods, ...seed.foods.filter((f) => !foodIds.has(f.id))],
    // favoritos de la dieta modular (A1…C14): se añaden a instalaciones existentes, salvo los que el usuario borró
    favorites: [
      ...saved.favorites,
      ...seed.favorites.filter(
        (f) =>
          f.id.startsWith('dm_') &&
          !saved.favorites.some((x) => x.id === f.id) &&
          !saved.sync?.tombstones?.[`fav:${f.id}`],
      ),
    ],
    conversions: [...saved.conversions, ...seed.conversions.filter((c) => !convIds.has(c.id))],
    settings: { ...seed.settings, ...saved.settings },
    shoppingChecked: saved.shoppingChecked ?? [],
    sync: { ...emptySync(), ...saved.sync },
    profiles: {
      dani: normalizeProfile({ ...seed.profiles.dani, ...saved.profiles?.dani }, !!saved.profiles?.dani?.entreno),
      alba: normalizeProfile({ ...seed.profiles.alba, ...saved.profiles?.alba }, !!saved.profiles?.alba?.entreno),
    },
    pesos: saved.pesos ?? [],
    ratings: saved.ratings ?? {},
    semanasTipo: saved.semanasTipo ?? [],
  };
}

/** Perfiles guardados antes de la v1.2 no tienen días de entreno: se crean a partir de SUS objetivos actuales. */
function normalizeProfile(p: Profile, hadTraining: boolean): Profile {
  if (hadTraining) return p;
  return { ...p, entreno: defaultTraining(p.bloques, p.kcalDia, p.proteinaDia, [0, 2, 4]) };
}
