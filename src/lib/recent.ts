import type { Block, DayLog, Meal, ProfileId } from '../types';
import { signature } from './mealGenerator';
import { isFree, isSplit, mealFor, personSlot, todayKey } from './day';

export interface RecentMeal {
  meal: Meal;
  /** última vez que se comió (o la más próxima planificada) */
  fecha: string;
  veces: number;
  firma: string;
}

/**
 * Comidas recientes de un bloque (sin repetir combinaciones), de la más reciente a la más antigua.
 * Cuenta días pasados y hoy; las planificadas a futuro no cuentan como "recientes".
 */
export function recentMeals(history: DayLog[], bloque: Block, limit = 6, hoy = todayKey(), para?: ProfileId): RecentMeal[] {
  const map = new Map<string, RecentMeal>();
  const days = [...history].filter((d) => d.fecha <= hoy).sort((a, b) => b.fecha.localeCompare(a.fecha));
  for (const d of days) {
    // para ambos: solo comidas compartidas; para una persona: lo que comió esa persona (su parte)
    const s = para ? personSlot(d, bloque, para) : isSplit(d, bloque) ? undefined : d.bloques[bloque];
    if (!s || isFree(s)) continue;
    const meal = para ? mealFor(s.meal, para) : s.meal;
    const firma = `${meal.nombre}|${signature(meal.items.map((i) => i.foodId))}`;
    const prev = map.get(firma);
    if (prev) prev.veces++;
    else map.set(firma, { meal: { ...meal, bloque }, fecha: d.fecha, veces: 1, firma });
  }
  return [...map.values()].slice(0, limit);
}
