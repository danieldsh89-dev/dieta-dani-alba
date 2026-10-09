/**
 * Planificador semanal, lista de la compra y cocinado en tanda a partir del plan.
 * Funciones puras (sin React) — tests en __tests__/planning.test.ts.
 */
import type { Block, Category, DayLog, Food, ProfileId } from '../types';
import { PROFILE_IDS } from '../types';
import { cookingFactor, hasConversion, roundTo, type ConversionMap } from './conversions';
import { nutrientsFor, type FoodMap } from './nutrition';
import { dayMeals } from './day';

// ───────── fechas ─────────

export function parseDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(key: string, n: number): string {
  const d = parseDate(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

/** Lunes de la semana de `key`. */
export function weekStart(key: string): string {
  const d = parseDate(key);
  const dow = (d.getDay() + 6) % 7; // 0 = lunes
  return addDays(key, -dow);
}

export function weekDates(key: string): string[] {
  const start = weekStart(key);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let k = from; k <= to && out.length < 62; k = addDays(k, 1)) out.push(k);
  return out;
}

export function formatDay(key: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }): string {
  return parseDate(key).toLocaleDateString('es-ES', opts);
}

/** Comidas planificadas (no libres) en un rango de fechas. */
export interface PlannedMeal {
  fecha: string;
  bloque: Block;
  meal: { nombre: string; items: { foodId: string; metodoId?: string; cantidades: Record<ProfileId, number> }[] };
}

export function plannedMeals(history: DayLog[], dates: string[]): PlannedMeal[] {
  const set = new Set(dates);
  const out: PlannedMeal[] = [];
  for (const day of history) {
    if (!set.has(day.fecha)) continue;
    // incluye las comidas de cada persona en los bloques separados
    for (const m of dayMeals(day)) out.push({ fecha: day.fecha, bloque: m.bloque, meal: m.meal });
  }
  return out.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.bloque.localeCompare(b.bloque));
}

// ───────── lista de la compra ─────────

export interface ShoppingItem {
  food: Food;
  /** cantidad total en estado base (g/ml) para ambos perfiles */
  totalBase: number;
  /** cantidad a comprar, en estado crudo/de compra (g o ml), redondeada hacia arriba a 5 */
  comprar: number;
  unit: 'g' | 'ml' | 'unidad';
  /** unidades enteras si el alimento se cuenta por unidades */
  unidades?: number;
  /** nº de comidas que lo usan */
  comidas: number;
  kcal: number;
}

/** Peso en estado de compra (crudo/seco/congelado) a partir del estado base. */
export function purchaseWeight(food: Food, base: number, cm: ConversionMap, metodoId?: string): number {
  if (!hasConversion(food, cm)) return base;
  if (food.estadoNutricionalBase === 'cocinado') return base / cookingFactor(food, cm, metodoId);
  return base;
}

export function shoppingList(meals: PlannedMeal[], fm: FoodMap, cm: ConversionMap): ShoppingItem[] {
  const acc = new Map<string, { base: number; buy: number; meals: Set<string> }>();
  for (const pm of meals) {
    for (const it of pm.meal.items) {
      const food = fm[it.foodId];
      if (!food) continue;
      const base = PROFILE_IDS.reduce((s, p) => s + Math.max(0, it.cantidades[p] ?? 0), 0);
      if (base <= 0) continue;
      const a = acc.get(food.id) ?? { base: 0, buy: 0, meals: new Set<string>() };
      a.base += base;
      a.buy += purchaseWeight(food, base, cm, it.metodoId);
      a.meals.add(`${pm.fecha}|${pm.bloque}`);
      acc.set(food.id, a);
    }
  }
  const items: ShoppingItem[] = [];
  for (const [id, a] of acc) {
    const food = fm[id];
    const unidad = food.unidadBase === 'unidad';
    items.push({
      food,
      totalBase: a.base,
      comprar: Math.ceil(a.buy / 5 - 1e-9) * 5,
      unit: unidad ? 'unidad' : food.unidadBase,
      unidades: unidad ? Math.ceil(a.base / (food.pesoUnidad ?? 1) - 1e-9) : undefined,
      comidas: a.meals.size,
      kcal: nutrientsFor(food, a.base).kcal,
    });
  }
  const ORDER: Category[] = ['proteina', 'hidrato', 'verdura', 'fruta', 'queso', 'lacteo', 'postre', 'salsa', 'extra'];
  return items.sort((x, y) => ORDER.indexOf(x.food.categoria) - ORDER.indexOf(y.food.categoria) || x.food.nombre.localeCompare(y.food.nombre));
}

/** Texto de la lista para compartir por WhatsApp, etc. */
export function shoppingText(items: ShoppingItem[], title: string, checked: string[] = [], pantry: string[] = []): string {
  const lines = [title, ''];
  for (const it of items) {
    const done = checked.includes(it.food.id) || pantry.includes(it.food.id);
    const qty =
      it.unit === 'unidad'
        ? `${it.unidades} ${it.food.nombreUnidad ?? 'ud'}${(it.unidades ?? 0) === 1 ? '' : 's'}`
        : `${it.comprar.toLocaleString('es-ES')} ${it.unit}`;
    lines.push(`${done ? '☑' : '☐'} ${it.food.nombre}${it.food.marca ? ` (${it.food.marca})` : ''} — ${qty}`);
  }
  return lines.join('\n');
}

// ───────── cocinado en tanda ─────────

export interface BatchPortion {
  fecha: string;
  bloque: Block;
  profile: ProfileId;
  comida: string;
  /** cantidad en estado crudo (g) */
  crudo: number;
  /** estimación cocinada con el factor configurado */
  cocinadoEstimado: number;
}

export interface BatchFood {
  food: Food;
  metodo: string;
  factor: number;
  totalCrudo: number;
  totalCocinadoEstimado: number;
  porciones: BatchPortion[];
}

/** Alimentos a cocinar (con conversión crudo→cocinado) agrupados, con sus raciones por comida. */
export function batchFromPlan(meals: PlannedMeal[], fm: FoodMap, cm: ConversionMap): BatchFood[] {
  const map = new Map<string, BatchFood>();
  for (const pm of meals) {
    for (const it of pm.meal.items) {
      const food = fm[it.foodId];
      if (!food || !hasConversion(food, cm) || food.unidadBase === 'unidad') continue;
      const factor = cookingFactor(food, cm, it.metodoId);
      const conv = cm[food.conversionId!];
      const metodo = conv.metodos.find((m) => m.id === (it.metodoId ?? conv.metodoPorDefecto))?.nombre ?? '';
      const k = `${food.id}|${metodo}`;
      const bf = map.get(k) ?? { food, metodo, factor, totalCrudo: 0, totalCocinadoEstimado: 0, porciones: [] };
      for (const p of PROFILE_IDS) {
        const base = it.cantidades[p] ?? 0;
        if (base <= 0) continue;
        const crudo = food.estadoNutricionalBase === 'cocinado' ? base / factor : base;
        bf.porciones.push({ fecha: pm.fecha, bloque: pm.bloque, profile: p, comida: pm.meal.nombre, crudo, cocinadoEstimado: crudo * factor });
        bf.totalCrudo += crudo;
        bf.totalCocinadoEstimado += crudo * factor;
      }
      map.set(k, bf);
    }
  }
  return [...map.values()].sort((a, b) => b.totalCrudo - a.totalCrudo);
}

/**
 * Reparte el peso cocinado REAL entre las raciones, en proporción a su peso crudo.
 * Devuelve el peso cocinado de cada ración (múltiplos de 5 g) y el sobrante por redondeo.
 */
export function splitRealYield(bf: BatchFood, pesoCocinadoReal: number): { porciones: number[]; rendimiento: number; sobrante: number } {
  const rendimiento = bf.totalCrudo > 0 ? pesoCocinadoReal / bf.totalCrudo : 0;
  const porciones = bf.porciones.map((p) => roundTo(p.crudo * rendimiento, 5));
  const sobrante = pesoCocinadoReal - porciones.reduce((s, x) => s + x, 0);
  return { porciones, rendimiento, sobrante };
}
