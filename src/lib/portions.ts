import type { Food, Profile } from '../types';

/** Rango de ración en "unidades de ración" (cocinado si hay conversión, unidades, o base). */
export interface PortionRange {
  min: number;
  max: number;
  step: number;
  habitual: number;
}

export function snap(value: number, step: number, min: number, max: number): number {
  const s = step > 0 ? Math.round(value / step) * step : value;
  return Math.min(max, Math.max(min, s));
}

/** Rango efectivo de un alimento para un perfil (incluye límites de legumbres). */
export function portionRange(food: Food, profile: Profile): PortionRange {
  const lim = food.limitesPerfil?.[profile.id] ?? {};
  const step = food.incremento > 0 ? food.incremento : food.unidadBase === 'unidad' ? 1 : 5;
  let min = lim.min ?? food.porcionMinima;
  let max = lim.max ?? food.porcionMaxima;
  const legMax = profile.restricciones.maxLegumbresPorComida;
  if (legMax != null && food.tags.includes('legumbre') && food.unidadBase !== 'unidad') {
    max = Math.min(max, legMax);
  }
  if (min > max) min = max;
  min = Math.max(0, min);
  const rawHab = lim.habitual ?? food.porcionHabitual * profile.escalaRaciones;
  const habitual = snap(rawHab, step, min, max);
  return { min, max, step, habitual };
}

/** Lista de valores posibles dentro del rango. */
export function portionValues(r: PortionRange): number[] {
  const out: number[] = [];
  const first = Math.ceil(r.min / r.step) * r.step;
  if (first > r.min) out.push(r.min);
  for (let v = first; v <= r.max + 1e-9; v += r.step) out.push(Math.round(v * 1000) / 1000);
  if (out.length === 0) out.push(r.min);
  if (out[out.length - 1] < r.max) out.push(r.max);
  return out;
}
