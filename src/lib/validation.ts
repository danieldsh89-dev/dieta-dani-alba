import type { BlockTarget, Food, Meal, Profile, ProfileId } from '../types';
import { PROFILE_IDS } from '../types';
import { macroConsistency, mealNutrients, rangeStatus, type FoodMap } from './nutrition';

/** ¿Puede este perfil comer este alimento según sus restricciones? */
export function foodAllowedFor(food: Food, profile: Profile): boolean {
  if (food.tags.includes('pescado') && !profile.restricciones.permitePescado) return false;
  if (food.tags.includes('leche_vaca') && !profile.restricciones.permiteLecheVaca) return false;
  return true;
}

export function restrictionReason(food: Food, profile: Profile): string | null {
  if (food.tags.includes('pescado') && !profile.restricciones.permitePescado)
    return `${profile.nombre} no come pescado (cámbialo en Configuración si quieres)`;
  if (food.tags.includes('leche_vaca') && !profile.restricciones.permiteLecheVaca)
    return `${profile.nombre} no toma leche de vaca`;
  return null;
}

export interface MealWarning {
  profile?: ProfileId;
  level: 'info' | 'aviso' | 'error';
  text: string;
}

/** Avisos de una comida para ambos perfiles. */
export function mealWarnings(
  meal: Pick<Meal, 'items'>,
  profiles: Record<ProfileId, Profile>,
  foods: FoodMap,
  targets: Record<ProfileId, BlockTarget>,
): MealWarning[] {
  const out: MealWarning[] = [];
  for (const pid of PROFILE_IDS) {
    const p = profiles[pid];
    const eats = meal.items.filter((i) => (i.cantidades[pid] ?? 0) > 0);
    if (eats.length === 0) continue;
    const n = mealNutrients(meal, pid, foods);
    const t = targets[pid];
    const st = rangeStatus(n.kcal, t);
    if (st === 'bajo' || st === 'alto') {
      out.push({
        profile: pid,
        level: 'aviso',
        text: `${p.nombre}: ${Math.round(n.kcal)} kcal, ${st === 'bajo' ? 'por debajo' : 'por encima'} del objetivo (${t.kcal} ±${t.tolerancia})`,
      });
    }
    if (n.proteina < t.proteina * 0.7) {
      out.push({
        profile: pid,
        level: 'aviso',
        text: `${p.nombre}: proteína baja (${Math.round(n.proteina)} g de ~${t.proteina} g)`,
      });
    }
    let legumbres = 0;
    for (const it of eats) {
      const f = foods[it.foodId];
      if (!f) continue;
      const reason = restrictionReason(f, p);
      if (reason) out.push({ profile: pid, level: 'error', text: `${f.nombre}: ${reason}` });
      if (f.tags.includes('legumbre') && f.unidadBase !== 'unidad') legumbres += it.cantidades[pid];
      if (f.aviso) out.push({ profile: pid, level: 'info', text: `${f.nombre}: ${f.aviso}` });
      if (it.cantidades[pid] < 0) out.push({ profile: pid, level: 'error', text: `${f.nombre}: cantidad negativa` });
    }
    const legMax = p.restricciones.maxLegumbresPorComida;
    if (legMax != null && legumbres > legMax + 0.5) {
      out.push({
        profile: pid,
        level: 'aviso',
        text: `${p.nombre}: ${Math.round(legumbres)} g de legumbres (máx. configurado ${legMax} g por comida)`,
      });
    }
  }
  // evitar duplicar avisos idénticos de info (p. ej. sal de la soja)
  const seen = new Set<string>();
  return out.filter((w) => {
    const k = w.level === 'info' ? w.text : `${w.profile}|${w.text}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Validación de una ficha de alimento. Devuelve errores (bloquean guardar) y avisos. */
export function validateFood(food: Food): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!food.nombre.trim()) errors.push('El nombre es obligatorio');
  const nums: [string, number | undefined][] = [
    ['kcal', food.kcalPor100],
    ['proteína', food.proteinaPor100],
    ['hidratos', food.carbohidratosPor100],
    ['grasas', food.grasasPor100],
    ['fibra', food.fibraPor100],
    ['sal', food.salPor100],
    ['ración mínima', food.porcionMinima],
    ['ración máxima', food.porcionMaxima],
    ['incremento', food.incremento],
    ['ración habitual', food.porcionHabitual],
    ['peso por unidad', food.pesoUnidad],
  ];
  for (const [label, v] of nums) {
    if (v === undefined) continue;
    if (Number.isNaN(v)) errors.push(`${label}: valor no válido`);
    else if (v < 0) errors.push(`${label}: no puede ser negativo`);
  }
  if (food.porcionMinima > food.porcionMaxima) errors.push('La ración mínima no puede superar la máxima');
  if (food.incremento <= 0) errors.push('El incremento debe ser mayor que 0');
  if (food.unidadBase === 'unidad' && !(food.pesoUnidad && food.pesoUnidad > 0))
    errors.push('Indica el peso de una unidad en gramos');
  if (food.proteinaPor100 + food.carbohidratosPor100 + food.grasasPor100 > 100.5)
    warnings.push('Proteína + hidratos + grasas suman más de 100 g por 100 g');
  const c = macroConsistency(food);
  if (food.kcalPor100 > 0 && Math.abs(c) > 0.25)
    warnings.push(
      `Las kcal por macros (${Math.round(food.kcalPor100 * (1 + c))}) difieren más de un 25% de las kcal indicadas`,
    );
  return { errors, warnings };
}
