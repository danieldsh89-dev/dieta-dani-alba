import type { Block, BlockTarget, DayLog, DaySlot, ExtraItem, Meal, Nutrients, Profile, ProfileId } from '../types';
import { BLOCKS, PROFILE_IDS } from '../types';
import { addNutrients, mealNutrients, nutrientsFor, ZERO, type FoodMap } from './nutrition';

export function todayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isFree(slot: DaySlot | undefined): slot is Extract<DaySlot, { libre: true }> {
  return !!slot && 'libre' in slot;
}

export function slotNutrients(slot: DaySlot | undefined, pid: ProfileId, fm: FoodMap): Nutrients {
  if (!slot) return { ...ZERO };
  if (isFree(slot)) return { ...ZERO, kcal: slot.kcalEstimadas[pid] ?? 0 };
  return mealNutrients(slot.meal, pid, fm);
}

// ───────── bloques compartidos / separados por persona ─────────

/** ¿En este bloque cada uno come algo distinto? */
export function isSplit(day: DayLog | undefined, b: Block): boolean {
  return !!day?.separado?.[b];
}

/** Lo que come `pid` en el bloque `b` (comida compartida o su parte si está separado). */
export function personSlot(day: DayLog | undefined, b: Block, pid: ProfileId): DaySlot | undefined {
  if (!day) return undefined;
  if (isSplit(day, b)) return day.separado![b]![pid];
  const s = day.bloques[b];
  if (!s || isFree(s)) return s;
  // comida compartida en la que esta persona no come nada
  return s.meal.items.some((i) => (i.cantidades[pid] ?? 0) > 0) || s.meal.items.length === 0 ? s : undefined;
}

/** ¿Hay algo planificado en el bloque (para alguien)? */
export function blockHasContent(day: DayLog | undefined, b: Block): boolean {
  if (!day) return false;
  if (isSplit(day, b)) return PROFILE_IDS.some((p) => !!day.separado![b]![p]);
  return !!day.bloques[b];
}

/** Todas las comidas (no libres) de un día, incluidas las de cada persona en bloques separados. */
export function dayMeals(day: DayLog | undefined): { bloque: Block; meal: Meal; para?: ProfileId }[] {
  const out: { bloque: Block; meal: Meal; para?: ProfileId }[] = [];
  if (!day) return out;
  for (const b of BLOCKS) {
    if (isSplit(day, b)) {
      for (const p of PROFILE_IDS) {
        const s = day.separado![b]![p];
        if (s && !isFree(s)) out.push({ bloque: b, meal: s.meal, para: p });
      }
    } else {
      const s = day.bloques[b];
      if (s && !isFree(s)) out.push({ bloque: b, meal: s.meal });
    }
  }
  return out;
}

/** Copia "solo para una persona" de una comida: deja a 0 las cantidades del otro. */
export function mealFor(meal: Meal, pid: ProfileId): Meal {
  return {
    ...structuredClone(meal),
    para: pid,
    items: meal.items
      .filter((i) => (i.cantidades[pid] ?? 0) > 0)
      .map((i) => ({ ...structuredClone(i), cantidades: { ...Object.fromEntries(PROFILE_IDS.map((p) => [p, 0])), [pid]: i.cantidades[pid] } as Record<ProfileId, number> })),
  };
}

export function extrasNutrients(day: DayLog | undefined, pid: ProfileId, fm: FoodMap): Nutrients {
  let t = { ...ZERO };
  for (const e of day?.extras ?? []) {
    const f = fm[e.foodId];
    if (f) t = addNutrients(t, nutrientsFor(f, e.cantidades[pid] ?? 0));
  }
  return t;
}

export function dayTotals(day: DayLog | undefined, fm: FoodMap): Record<ProfileId, Nutrients> {
  const out = {} as Record<ProfileId, Nutrients>;
  for (const pid of PROFILE_IDS) {
    let t = { ...ZERO };
    for (const b of BLOCKS) t = addNutrients(t, slotNutrients(personSlot(day, b, pid), pid, fm));
    out[pid] = addNutrients(t, extrasNutrients(day, pid, fm));
  }
  return out;
}

export function newExtra(foodId: string, cantidades: Record<ProfileId, number>, metodoId?: string): ExtraItem {
  return { id: `x_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, foodId, metodoId, cantidades };
}

// ───────── días de entreno ─────────

/** 0 = lunes … 6 = domingo */
export function weekdayIndex(fecha: string): number {
  const [y, m, d] = fecha.split('-').map(Number);
  return (new Date(y, m - 1, d, 12).getDay() + 6) % 7;
}

/** ¿Es día de entreno para este perfil? Solo si tiene activados los objetivos de entreno. */
export function isTrainingDay(profile: Profile, fecha: string, day?: DayLog): boolean {
  if (!profile.entreno?.activo) return false;
  const manual = day?.entreno?.[profile.id];
  if (manual !== undefined) return manual;
  return profile.entreno.dias.includes(weekdayIndex(fecha));
}

export interface DayGoals {
  entreno: boolean;
  kcalDia: number;
  proteinaDia: number;
  bloques: Record<Block, BlockTarget>;
}

export function dayGoals(profile: Profile, fecha: string, day?: DayLog): DayGoals {
  const entreno = isTrainingDay(profile, fecha, day);
  if (entreno && profile.entreno) {
    return { entreno, kcalDia: profile.entreno.kcalDia, proteinaDia: profile.entreno.proteinaDia, bloques: profile.entreno.bloques };
  }
  return { entreno: false, kcalDia: profile.kcalDia, proteinaDia: profile.proteinaDia, bloques: profile.bloques };
}

/**
 * Objetivos de un bloque para un día concreto: según día de entreno/descanso y,
 * si el usuario lo pidió (day.compensar), compensando lo ya consumido (comidas libres incluidas).
 */
export function targetsForDay(
  fecha: string,
  block: Block,
  profiles: Record<ProfileId, Profile>,
  day: DayLog | undefined,
  fm: FoodMap,
): Record<ProfileId, BlockTarget> {
  const out = {} as Record<ProfileId, BlockTarget>;
  for (const pid of PROFILE_IDS) {
    const g = dayGoals(profiles[pid], fecha, day);
    if (!day?.compensar) {
      out[pid] = g.bloques[block];
      continue;
    }
    const planned = BLOCKS.reduce((s, b) => s + g.bloques[b].kcal, 0);
    const others = BLOCKS.filter((b) => b !== block && personSlot(day, b, pid));
    const consumed =
      others.reduce((s, b) => s + slotNutrients(personSlot(day, b, pid), pid, fm).kcal, 0) + extrasNutrients(day, pid, fm).kcal;
    const remainingBlocks = BLOCKS.filter((b) => b === block || !personSlot(day, b, pid));
    const share = g.bloques[block].kcal / remainingBlocks.reduce((s, b) => s + g.bloques[b].kcal, 0);
    out[pid] = { ...g.bloques[block], kcal: Math.max(0, Math.round((planned - consumed) * share)) };
  }
  return out;
}
