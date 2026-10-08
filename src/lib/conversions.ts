import type { CookingConversion, CookingMethod, Food, WeightView } from '../types';

/** Redondeo práctico a múltiplos de `step` (por defecto 5 g / 5 ml). */
export function roundTo(value: number, step = 5): number {
  if (step <= 0) return value;
  return Math.round(value / step) * step;
}

/** crudo → cocinado: peso × factor. No cambia las calorías totales. */
export function rawToCooked(rawGrams: number, factor: number): number {
  return rawGrams * factor;
}

/** cocinado → crudo: peso / factor. */
export function cookedToRaw(cookedGrams: number, factor: number): number {
  if (factor <= 0) throw new Error('El factor de cocción debe ser > 0');
  return cookedGrams / factor;
}

/** Calibrar cocción: factor = peso cocinado / peso crudo. */
export function calibrateFactor(rawGrams: number, cookedGrams: number): number {
  if (rawGrams <= 0 || cookedGrams <= 0) throw new Error('Los pesos deben ser positivos');
  return cookedGrams / rawGrams;
}

export type ConversionMap = Record<string, CookingConversion>;

export function toConversionMap(list: CookingConversion[]): ConversionMap {
  return Object.fromEntries(list.map((c) => [c.id, c]));
}

export function getMethod(
  food: Food,
  conversions: ConversionMap,
  metodoId?: string,
): CookingMethod | undefined {
  if (!food.conversionId) return undefined;
  const conv = conversions[food.conversionId];
  if (!conv) return undefined;
  return (
    conv.metodos.find((m) => m.id === metodoId) ??
    conv.metodos.find((m) => m.id === conv.metodoPorDefecto) ??
    conv.metodos[0]
  );
}

/** Factor cocinado/crudo aplicable al alimento (1 si no tiene conversión). */
export function cookingFactor(food: Food, conversions: ConversionMap, metodoId?: string): number {
  return getMethod(food, conversions, metodoId)?.factor ?? 1;
}

export function hasConversion(food: Food, conversions: ConversionMap): boolean {
  return getMethod(food, conversions) !== undefined && food.estadoNutricionalBase !== 'listo_para_consumir';
}

/** Peso (g/ml) en el estado pedido a partir de la cantidad en estado base. */
export function weightInState(
  food: Food,
  baseGrams: number,
  state: WeightView,
  conversions: ConversionMap,
  metodoId?: string,
): number {
  if (!hasConversion(food, conversions)) return baseGrams;
  const f = cookingFactor(food, conversions, metodoId);
  if (food.estadoNutricionalBase === 'crudo') {
    return state === 'crudo' ? baseGrams : rawToCooked(baseGrams, f);
  }
  // base cocinado
  return state === 'cocinado' ? baseGrams : cookedToRaw(baseGrams, f);
}

/** Convierte un peso en `state` a cantidad en estado base. */
export function baseFromState(
  food: Food,
  grams: number,
  state: WeightView,
  conversions: ConversionMap,
  metodoId?: string,
): number {
  if (!hasConversion(food, conversions)) return grams;
  const f = cookingFactor(food, conversions, metodoId);
  if (food.estadoNutricionalBase === 'crudo') {
    return state === 'crudo' ? grams : cookedToRaw(grams, f);
  }
  return state === 'cocinado' ? grams : rawToCooked(grams, f);
}

/**
 * "Unidades de ración": las que usa el generador y los rangos de los alimentos.
 * - unidadBase 'unidad' → nº de unidades
 * - con conversión → gramos cocinados
 * - resto → gramos/ml en estado base
 */
export function servingToBase(
  food: Food,
  serving: number,
  conversions: ConversionMap,
  metodoId?: string,
): number {
  if (food.unidadBase === 'unidad') return serving * (food.pesoUnidad ?? 1);
  return baseFromState(food, serving, 'cocinado', conversions, metodoId);
}

export function baseToServing(
  food: Food,
  baseGrams: number,
  conversions: ConversionMap,
  metodoId?: string,
): number {
  if (food.unidadBase === 'unidad') return baseGrams / (food.pesoUnidad ?? 1);
  return weightInState(food, baseGrams, 'cocinado', conversions, metodoId);
}

/** Texto de unidad corto */
export function unitLabel(food: Food): string {
  return food.unidadBase === 'ml' ? 'ml' : 'g';
}

export interface DisplayQuantity {
  /** valor principal redondeado de forma práctica */
  value: number;
  unit: string;
  /** texto listo para mostrar */
  text: string;
  /** estado mostrado */
  state: 'crudo' | 'cocinado' | 'listo';
  /** valor sin redondear */
  exact: number;
}

/** Cantidad práctica para mostrar (múltiplos de 5 g/ml, o unidades). */
export function displayQuantity(
  food: Food,
  baseGrams: number,
  view: WeightView,
  conversions: ConversionMap,
  metodoId?: string,
): DisplayQuantity {
  if (food.unidadBase === 'unidad') {
    const units = baseGrams / (food.pesoUnidad ?? 1);
    const u = Math.round(units * 2) / 2;
    const name = food.nombreUnidad ?? 'ud';
    const plural = u === 1 ? name : `${name}${/[aeiou]$/.test(name) ? 's' : 'es'}`;
    return {
      value: u,
      unit: name,
      text: `${formatNumber(u)} ${plural} (${Math.round(baseGrams)} g)`,
      state: 'listo',
      exact: units,
    };
  }
  const conv = hasConversion(food, conversions);
  const grams = weightInState(food, baseGrams, view, conversions, metodoId);
  const value = roundTo(grams, 5);
  const unit = unitLabel(food);
  const state: DisplayQuantity['state'] = conv ? view : 'listo';
  return { value, unit, text: `${value} ${unit}`, state, exact: grams };
}

export function formatNumber(n: number, decimals = 1): string {
  const r = Math.round(n * 10 ** decimals) / 10 ** decimals;
  return r.toLocaleString('es-ES', { maximumFractionDigits: decimals });
}

/** Nombre del estado (seco, crudo, congelado…) para mostrar junto al peso */
export function stateLabel(
  food: Food,
  view: WeightView,
  conversions: ConversionMap,
  metodoId?: string,
): string {
  if (!hasConversion(food, conversions) || food.unidadBase === 'unidad') return '';
  const conv = conversions[food.conversionId!];
  if (view === 'crudo') return conv.estadoInicial;
  return (getMethod(food, conversions, metodoId)?.nombre ?? 'cocinado').toLowerCase();
}
