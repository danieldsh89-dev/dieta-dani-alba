/**
 * Transformaciones puras de un día (DayLog): bloques compartidos / separados por persona,
 * extras y semanas tipo. Las usa el almacén; tests en __tests__/v13.test.ts.
 */
import type { Block, DayLog, DaySlot, ExtraItem, FreeMeal, Meal, MealItem, ProfileId, WeekTemplate } from '../types';
import { BLOCKS, PROFILE_IDS } from '../types';
import { blockHasContent, isFree, isSplit, mealFor } from './day';

const clone = <T>(x: T): T => structuredClone(x);

/** ¿Hay algo guardado en el día? (si no, el día se borra) */
export function dayHasData(day: DayLog): boolean {
  return (
    Object.keys(day.bloques).length > 0 ||
    !!day.compensar ||
    !!day.entreno ||
    Object.keys(day.separado ?? {}).length > 0 ||
    (day.extras ?? []).length > 0
  );
}

/** Comida compartida (o comida libre) para ambos: deshace la separación del bloque. */
export function setSharedSlot(day: DayLog, b: Block, slot: DaySlot | undefined): DayLog {
  const d = clone(day);
  if (d.separado) {
    delete d.separado[b];
    if (!Object.keys(d.separado).length) delete d.separado;
  }
  if (slot) d.bloques[b] = clone(slot);
  else delete d.bloques[b];
  return d;
}

function freeFor(s: FreeMeal, pid: ProfileId): FreeMeal {
  return { ...clone(s), kcalEstimadas: { [pid]: s.kcalEstimadas[pid] } };
}

/** Separa el bloque: cada persona se queda con su parte de lo que hubiera (o vacío). */
export function splitBlock(day: DayLog, b: Block): DayLog {
  if (isSplit(day, b)) return day;
  const d = clone(day);
  const s = d.bloques[b];
  const part: Partial<Record<ProfileId, DaySlot>> = {};
  if (s) {
    for (const p of PROFILE_IDS) {
      if (isFree(s)) part[p] = freeFor(s, p);
      else if (s.meal.items.some((i) => (i.cantidades[p] ?? 0) > 0)) part[p] = { meal: mealFor(s.meal, p) };
    }
  }
  delete d.bloques[b];
  d.separado = { ...(d.separado ?? {}), [b]: part };
  return d;
}

/** Pone (o quita) la comida de UNA persona en un bloque; si era compartido, lo separa antes. */
export function setPersonSlot(day: DayLog, b: Block, pid: ProfileId, slot: DaySlot | undefined): DayLog {
  const d = splitBlock(day, b);
  const part = { ...(d.separado![b] ?? {}) };
  if (slot) {
    part[pid] = isFree(slot) ? freeFor(slot, pid) : { meal: { ...mealFor(slot.meal, pid), nombre: slot.meal.nombre } };
  } else delete part[pid];
  d.separado = { ...d.separado, [b]: part };
  return d;
}

/** Une los platos de cada persona en uno solo (cantidades de cada uno) y vuelve a modo compartido. */
export function mergeMeals(b: Block, dani?: Meal, alba?: Meal): Meal | undefined {
  const parts = [dani, alba].filter(Boolean) as Meal[];
  if (!parts.length) return undefined;
  if (parts.length === 1) return { ...clone(parts[0]), para: undefined };
  const items = new Map<string, MealItem>();
  for (const m of parts) {
    for (const it of m.items) {
      const k = `${it.foodId}|${it.metodoId ?? ''}`;
      const prev = items.get(k);
      if (prev) for (const p of PROFILE_IDS) prev.cantidades[p] = (prev.cantidades[p] ?? 0) + (it.cantidades[p] ?? 0);
      else items.set(k, clone(it));
    }
  }
  const same = dani!.nombre === alba!.nombre;
  return {
    id: `m_${Date.now().toString(36)}`,
    nombre: same ? dani!.nombre : `Dani: ${dani!.nombre} · Alba: ${alba!.nombre}`,
    bloque: b,
    items: [...items.values()],
    origen: 'manual',
  };
}

export function joinBlock(day: DayLog, b: Block): DayLog {
  if (!isSplit(day, b)) return day;
  const part = day.separado![b]!;
  const sd = part.dani;
  const sa = part.alba;
  let shared: DaySlot | undefined;
  if ((sd && isFree(sd)) || (sa && isFree(sa))) {
    shared = {
      libre: true,
      descripcion: [sd, sa].map((s) => (s && isFree(s) ? s.descripcion : undefined)).filter(Boolean).join(' / ') || undefined,
      kcalEstimadas: {
        dani: sd && isFree(sd) ? sd.kcalEstimadas.dani : undefined,
        alba: sa && isFree(sa) ? sa.kcalEstimadas.alba : undefined,
      },
    };
  } else {
    const m = mergeMeals(b, sd && !isFree(sd) ? sd.meal : undefined, sa && !isFree(sa) ? sa.meal : undefined);
    shared = m ? { meal: m } : undefined;
  }
  return setSharedSlot(day, b, shared);
}

/** Copia el bloque `b` de `from` en `to` (tal cual: compartido o separado). */
export function copyBlock(from: DayLog | undefined, to: DayLog, b: Block): DayLog {
  if (!from || !blockHasContent(from, b)) return to;
  if (isSplit(from, b)) {
    const d = setSharedSlot(to, b, undefined);
    d.separado = { ...(d.separado ?? {}), [b]: clone(from.separado![b]!) };
    return d;
  }
  return setSharedSlot(to, b, from.bloques[b]);
}

export function addExtra(day: DayLog, extra: ExtraItem): DayLog {
  return { ...clone(day), extras: [...(day.extras ?? []), clone(extra)] };
}

export function removeExtra(day: DayLog, id: string): DayLog {
  const extras = (day.extras ?? []).filter((e) => e.id !== id);
  const d = clone(day);
  if (extras.length) d.extras = extras;
  else delete d.extras;
  return d;
}

/** Semana tipo a partir de 7 días (lunes…domingo). */
export function makeWeekTemplate(nombre: string, days: (DayLog | undefined)[]): WeekTemplate {
  return {
    id: `wk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    nombre,
    creado: new Date().toISOString(),
    dias: days.map((d) => ({ bloques: clone(d?.bloques ?? {}), ...(d?.separado ? { separado: clone(d.separado) } : {}) })),
  };
}

/** Aplica un día de la plantilla: 'huecos' solo rellena bloques vacíos; 'reemplazar' sustituye las comidas. */
export function applyTemplateDay(day: DayLog, tpl: WeekTemplate['dias'][number], mode: 'huecos' | 'reemplazar'): DayLog {
  const src: DayLog = { fecha: day.fecha, bloques: tpl.bloques, separado: tpl.separado };
  let d = clone(day);
  for (const b of BLOCKS) {
    if (!blockHasContent(src, b)) {
      if (mode === 'reemplazar') d = setSharedSlot(d, b, undefined);
      continue;
    }
    if (mode === 'huecos' && blockHasContent(d, b)) continue;
    d = copyBlock(src, d, b);
  }
  return d;
}
