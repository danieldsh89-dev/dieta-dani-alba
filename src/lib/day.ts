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

/**
 * Objetivos del bloque compensando lo ya consumido (comidas libres incluidas).
 * Solo se aplica si el usuario lo pidió (day.compensar).
 */
export function compensatedTargets(
  day: DayLog | undefined,
  block: Block,
  profiles: Record<ProfileId, Profile>,
  fm: FoodMap,
): Record<ProfileId, BlockTarget> | undefined {
  if (!day?.compensar) return undefined;
  const out = {} as Record<ProfileId, BlockTarget>;
  for (const pid of PROFILE_IDS) {
    const p = profiles[pid];
    const planned = BLOCKS.reduce((s, b) => s + p.bloques[b].kcal, 0);
    const others = BLOCKS.filter((b) => b !== block && day.bloques[b]);
    const consumed = others.reduce((s, b) => s + slotNutrients(day.bloques[b], pid, fm).kcal, 0);
    const remainingBlocks = BLOCKS.filter((b) => b === block || !day.bloques[b]);
    const share = p.bloques[block].kcal / remainingBlocks.reduce((s, b) => s + p.bloques[b].kcal, 0);
    const kcal = Math.max(0, Math.round((planned - consumed) * share));
    out[pid] = { ...p.bloques[block], kcal };
  }
  return out;
}
