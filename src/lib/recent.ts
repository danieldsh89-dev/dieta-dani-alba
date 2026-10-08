import type { Block, DayLog, Meal } from '../types';
import { signature } from './mealGenerator';
import { isFree, todayKey } from './day';

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
export function recentMeals(history: DayLog[], bloque: Block, limit = 6, hoy = todayKey()): RecentMeal[] {
  const map = new Map<string, RecentMeal>();
  const days = [...history].filter((d) => d.fecha <= hoy).sort((a, b) => b.fecha.localeCompare(a.fecha));
  for (const d of days) {
    const s = d.bloques[bloque];
    if (!s || isFree(s)) continue;
    const firma = `${s.meal.nombre}|${signature(s.meal.items.map((i) => i.foodId))}`;
    const prev = map.get(firma);
    if (prev) prev.veces++;
    else map.set(firma, { meal: { ...s.meal, bloque }, fecha: d.fecha, veces: 1, firma });
  }
  return [...map.values()].slice(0, limit);
}
