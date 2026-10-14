/** Hooks de la despensa para las pantallas (estado, lo que hay, lo que falta para el plan). */
import { useMemo } from 'react';
import { useStore } from '../store/AppStore';
import { computeStock, planShortages, type ItemState, type Shortage } from './stock';
import { mealCost, type MealCost } from './mealInfo';
import { dayMeals } from './day';
import type { DayLog } from '../types';

export function useStockStates(): Record<string, ItemState> {
  const { data, fm, cm } = useStore();
  return useMemo(() => computeStock(data, fm, cm), [data, fm, cm]);
}

/** Alimentos de la dieta que hay en casa (con dato y no agotados) */
export function useEnCasa(): Set<string> {
  const { data } = useStore();
  const st = useStockStates();
  return useMemo(
    () =>
      new Set(
        Object.values(data.stock.items)
          .filter((it) => it.foodId && st[it.id] && st[it.id].fuente !== 'desconocido' && st[it.id].nivel !== 'agotado')
          .map((it) => it.foodId!),
      ),
    [data.stock.items, st],
  );
}

/** Lo que no llega para las comidas planificadas de los próximos 14 días (solo si se lleva la despensa) */
export function useShortages(): Shortage[] {
  const { data, fm, cm } = useStore();
  const st = useStockStates();
  return useMemo(() => {
    if (!data.stock.config.desde) return [];
    const ign = data.stock.config.ignorarFaltas ?? {};
    // "lo tengo cocinado": no se avisa de ese alimento hasta la fecha indicada
    return planShortages(data, fm, cm, st).filter((s) => !(ign[s.foodId] && s.fecha <= ign[s.foodId]));
  }, [data, fm, cm, st]);
}

/** Coste de todas las comidas de un día (precios de Mercadona) */
export function useDayCost(day: DayLog | undefined): MealCost {
  const { data, fm, cm } = useStore();
  return useMemo(() => {
    const out: MealCost = { total: 0, porPersona: { dani: 0, alba: 0 }, sinPrecio: 0 };
    for (const m of dayMeals(day)) {
      const c = mealCost(m.meal, fm, cm, data.mercadona.links);
      out.total += c.total;
      out.porPersona.dani += c.porPersona.dani;
      out.porPersona.alba += c.porPersona.alba;
      out.sinPrecio += c.sinPrecio;
    }
    out.total = Math.round(out.total * 100) / 100;
    return out;
  }, [day, fm, cm, data.mercadona.links]);
}

export function dayCost(day: DayLog | undefined, fm: Parameters<typeof mealCost>[1], cm: Parameters<typeof mealCost>[2], links: Parameters<typeof mealCost>[3]): number {
  return Math.round(dayMeals(day).reduce((s, m) => s + mealCost(m.meal, fm, cm, links).total, 0) * 100) / 100;
}
