import type { Block, BlockTarget, DayLog, DaySlot, Nutrients, Profile, ProfileId } from '../types';
import { BLOCKS, PROFILE_IDS } from '../types';
import { mealNutrients, ZERO, type FoodMap } from './nutrition';

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

export function dayTotals(day: DayLog | undefined, fm: FoodMap): Record<ProfileId, Nutrients> {
  const out = {} as Record<ProfileId, Nutrients>;
  for (const pid of PROFILE_IDS) {
    const t = { ...ZERO };
    for (const b of BLOCKS) {
      const n = slotNutrients(day?.bloques[b], pid, fm);
      t.kcal += n.kcal;
      t.proteina += n.proteina;
      t.carbohidratos += n.carbohidratos;
      t.grasas += n.grasas;
      t.fibra += n.fibra;
      t.sal += n.sal;
    }
    out[pid] = t;
  }
  return out;
}

/** 0 = lunes … 6 = domingo */
export function weekdayIndex(fecha: string): number {
  const [y, m, d] = fecha.split('-').map(Number);
  return (new Date(y, m - 1, d, 12).getDay() + 6) % 7;
}

/** ¿Es día de entreno para este perfil? (cambio manual del día > días por defecto del perfil) */
export function isTrainingDay(profile: Profile, fecha: string, day?: DayLog): boolean {
  const manual = day?.entreno?.[profile.id];
  if (manual !== undefined) return manual;
  return !!profile.entreno?.activo && profile.entreno.dias.includes(weekdayIndex(fecha));
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
    const others = BLOCKS.filter((b) => b !== block && day.bloques[b]);
    const consumed = others.reduce((s, b) => s + slotNutrients(day.bloques[b], pid, fm).kcal, 0);
    const remainingBlocks = BLOCKS.filter((b) => b === block || !day.bloques[b]);
    const share = g.bloques[block].kcal / remainingBlocks.reduce((s, b) => s + g.bloques[b].kcal, 0);
    out[pid] = { ...g.bloques[block], kcal: Math.max(0, Math.round((planned - consumed) * share)) };
  }
  return out;
}
