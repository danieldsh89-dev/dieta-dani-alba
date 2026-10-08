/**
 * "Línea base" al activar la sincronización.
 * Los datos creados antes de tener sincronización (p. ej. con la v1.0) no tienen marca de tiempo,
 * así que no se subirían. Al crear/unirse a un hogar se marcan con una marca baja:
 *  - cualquier cambio real (marca = fecha actual) sigue ganando siempre;
 *  - entre datos antiguos de los dos móviles gana el que CREA el hogar (base mayor);
 *  - lo que solo existe en un móvil se suma al otro.
 */
import type { AppData } from '../types';
import { PROFILE_IDS } from '../types';
import { createSeedData } from '../store/seed';
import { key, readDoc, weightId, type DocKind } from './docs';

export const BASELINE_CREATOR = 2_000_000;
export const BASELINE_JOINER = 1_000_000;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Claves de documentos que difieren de los datos iniciales y aún no tienen marca. */
export function unstampedChanges(d: AppData): { changed: string[]; deleted: string[] } {
  const seed = createSeedData();
  const known = (k: string) => k in d.sync.stamps || k in d.sync.tombstones;
  const changed: string[] = [];
  const deleted: string[] = [];
  const check = (kind: DocKind, id: string) => {
    const k = key(kind, id);
    if (known(k)) return;
    if (!same(readDoc(d, kind, id), readDoc(seed, kind, id))) changed.push(k);
  };
  d.foods.forEach((f) => check('food', f.id));
  d.conversions.forEach((c) => check('conv', c.id));
  PROFILE_IDS.forEach((p) => check('profile', p));
  d.favorites.forEach((f) => check('fav', f.id));
  d.history.forEach((h) => check('day', h.fecha));
  d.pesos.forEach((w) => check('weight', weightId(w)));
  Object.keys(d.ratings).forEach((id) => check('rating', id));
  check('pantry', 'all');
  check('shopping', 'all');
  check('shared', 'all');
  // favoritos iniciales que este móvil borró
  for (const f of seed.favorites) {
    const k = key('fav', f.id);
    if (!known(k) && !d.favorites.some((x) => x.id === f.id)) deleted.push(k);
  }
  return { changed, deleted };
}

/** Asigna la marca base a los cambios sin marca y los deja pendientes de subir. */
export function applyBaseline(d: AppData, base: number): AppData {
  const { changed, deleted } = unstampedChanges(d);
  const stamps = { ...d.sync.stamps };
  const tombstones = { ...d.sync.tombstones };
  for (const k of changed) stamps[k] = base;
  for (const k of deleted) tombstones[k] = base;
  const pending = [...new Set([...d.sync.pending, ...Object.keys(stamps), ...Object.keys(tombstones)])];
  return { ...d, sync: { ...d.sync, stamps, tombstones, pending } };
}
