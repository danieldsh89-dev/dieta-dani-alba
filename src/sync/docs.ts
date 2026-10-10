/**
 * Modelo de sincronización: cada entidad compartida es un "documento" con clave "tipo:id"
 * y una marca de tiempo. Gana la versión más reciente (last-writer-wins) por documento.
 * Funciones puras: sin red ni React (testeadas en __tests__/sync.test.ts).
 */
import type { AppData, DayLog, Favorite, Food, CookingConversion, MercaConfig, MercaLink, Profile, ProfileId, Rating, SyncState, WeekTemplate, WeightEntry } from '../types';

export type DocKind = 'food' | 'conv' | 'profile' | 'fav' | 'day' | 'pantry' | 'shared' | 'shopping' | 'weight' | 'rating' | 'week' | 'mlink' | 'mconf';

/** id del documento de peso: perfil:fecha */
export const weightId = (w: Pick<WeightEntry, 'profile' | 'fecha'>) => `${w.profile}:${w.fecha}`;

export interface SyncRow {
  kind: DocKind;
  id: string;
  data: unknown;
  deleted: boolean;
  /** marca de tiempo del cliente (ms) */
  ts: number;
}

export const key = (kind: DocKind, id: string) => `${kind}:${id}`;

export function parseKey(k: string): { kind: DocKind; id: string } {
  const i = k.indexOf(':');
  return { kind: k.slice(0, i) as DocKind, id: k.slice(i + 1) };
}

export function emptySync(): SyncState {
  return { stamps: {}, tombstones: {}, pending: [] };
}

/** Marca documentos como modificados localmente (para subirlos). */
export function touch(d: AppData, keys: string[], now = Date.now()): AppData {
  if (!keys.length) return d;
  const stamps = { ...d.sync.stamps };
  const tombstones = { ...d.sync.tombstones };
  const pending = new Set(d.sync.pending);
  for (const k of keys) {
    // marca estrictamente creciente aunque el reloj no avance
    stamps[k] = Math.max(now, (stamps[k] ?? 0) + 1, (tombstones[k] ?? 0) + 1);
    delete tombstones[k];
    pending.add(k);
  }
  return { ...d, sync: { ...d.sync, stamps, tombstones, pending: [...pending] } };
}

/** Marca documentos como borrados localmente. */
export function tombstone(d: AppData, keys: string[], now = Date.now()): AppData {
  if (!keys.length) return d;
  const stamps = { ...d.sync.stamps };
  const tombstones = { ...d.sync.tombstones };
  const pending = new Set(d.sync.pending);
  for (const k of keys) {
    tombstones[k] = Math.max(now, (stamps[k] ?? 0) + 1);
    delete stamps[k];
    pending.add(k);
  }
  return { ...d, sync: { ...d.sync, stamps, tombstones, pending: [...pending] } };
}

/** Ajustes compartidos (el resto, como pesos crudos/cocinados, es de cada móvil). */
function sharedSettings(d: AppData) {
  return {
    mismaRecetaParaAmbos: d.settings.mismaRecetaParaAmbos,
    permitirComplementosDistintos: d.settings.permitirComplementosDistintos,
    bloquesSeparados: d.settings.bloquesSeparados ?? [],
  };
}

/** Contenido actual de un documento local (undefined si no existe). */
export function readDoc(d: AppData, kind: DocKind, id: string): unknown {
  switch (kind) {
    case 'food':
      return d.foods.find((f) => f.id === id);
    case 'conv':
      return d.conversions.find((c) => c.id === id);
    case 'profile':
      return d.profiles[id as ProfileId];
    case 'fav':
      return d.favorites.find((f) => f.id === id);
    case 'day':
      return d.history.find((h) => h.fecha === id);
    case 'pantry':
      return d.pantry;
    case 'shared':
      return sharedSettings(d);
    case 'shopping':
      return d.shoppingChecked;
    case 'weight':
      return d.pesos.find((w) => weightId(w) === id);
    case 'rating':
      return d.ratings[id];
    case 'week':
      return d.semanasTipo.find((w) => w.id === id);
    case 'mlink':
      return d.mercadona.links[id];
    case 'mconf':
      return d.mercadona.config;
  }
}

/** Filas a subir para las claves dadas. */
export function collectRows(d: AppData, keys: string[]): SyncRow[] {
  const rows: SyncRow[] = [];
  for (const k of keys) {
    const { kind, id } = parseKey(k);
    const tomb = d.sync.tombstones[k];
    if (tomb) {
      rows.push({ kind, id, data: null, deleted: true, ts: tomb });
      continue;
    }
    const data = readDoc(d, kind, id);
    if (data === undefined) continue;
    rows.push({ kind, id, data, deleted: false, ts: d.sync.stamps[k] ?? 0 });
  }
  return rows;
}

/** Todas las claves con cambios locales conocidos (para la primera subida al unirse a un hogar). */
export function allKnownKeys(d: AppData): string[] {
  return [...new Set([...Object.keys(d.sync.stamps), ...Object.keys(d.sync.tombstones)])];
}

function upsertById<T>(list: T[], item: T, getId: (x: T) => string): T[] {
  const id = getId(item);
  const i = list.findIndex((x) => getId(x) === id);
  if (i < 0) return [...list, item];
  const copy = [...list];
  copy[i] = item;
  return copy;
}

/** Aplica filas remotas: solo si son más recientes que lo que hay en local. No marca pendientes. */
export function applyRemote(d: AppData, rows: SyncRow[]): { data: AppData; applied: number } {
  let out = d;
  let applied = 0;
  const stamps = { ...d.sync.stamps };
  const tombstones = { ...d.sync.tombstones };
  for (const r of rows) {
    const k = key(r.kind, r.id);
    const local = Math.max(stamps[k] ?? 0, tombstones[k] ?? 0);
    if (r.ts <= local) continue;
    applied++;
    if (r.deleted) {
      tombstones[k] = r.ts;
      delete stamps[k];
      out = removeDoc(out, r.kind, r.id);
    } else {
      stamps[k] = r.ts;
      delete tombstones[k];
      out = writeDoc(out, r.kind, r.id, r.data);
    }
  }
  const pending = out.sync.pending.filter((k) => {
    // si lo remoto es más nuevo que el cambio local pendiente, el pendiente ya no aplica
    const remoteTs = Math.max(stamps[k] ?? 0, tombstones[k] ?? 0);
    const localTs = Math.max(d.sync.stamps[k] ?? 0, d.sync.tombstones[k] ?? 0);
    return remoteTs <= localTs;
  });
  return { data: { ...out, sync: { ...out.sync, stamps, tombstones, pending } }, applied };
}

function writeDoc(d: AppData, kind: DocKind, id: string, data: unknown): AppData {
  switch (kind) {
    case 'food':
      return { ...d, foods: upsertById(d.foods, data as Food, (f) => f.id) };
    case 'conv':
      return { ...d, conversions: upsertById(d.conversions, data as CookingConversion, (c) => c.id) };
    case 'profile':
      return { ...d, profiles: { ...d.profiles, [id]: data as Profile } };
    case 'fav':
      return { ...d, favorites: upsertById(d.favorites, data as Favorite, (f) => f.id) };
    case 'day': {
      const history = upsertById(d.history, data as DayLog, (h) => h.fecha).sort((a, b) => b.fecha.localeCompare(a.fecha));
      return { ...d, history };
    }
    case 'pantry':
      return { ...d, pantry: Array.isArray(data) ? (data as string[]) : d.pantry };
    case 'shared':
      return { ...d, settings: { ...d.settings, ...(data as object) } };
    case 'shopping':
      return { ...d, shoppingChecked: Array.isArray(data) ? (data as string[]) : d.shoppingChecked };
    case 'weight':
      return { ...d, pesos: upsertById(d.pesos, data as WeightEntry, weightId).sort((a, b) => a.fecha.localeCompare(b.fecha)) };
    case 'rating':
      return { ...d, ratings: { ...d.ratings, [id]: data as Rating } };
    case 'week':
      return { ...d, semanasTipo: upsertById(d.semanasTipo, data as WeekTemplate, (w) => w.id) };
    case 'mlink':
      return { ...d, mercadona: { ...d.mercadona, links: { ...d.mercadona.links, [id]: data as MercaLink } } };
    case 'mconf':
      return { ...d, mercadona: { ...d.mercadona, config: { ...(data as MercaConfig) } } };
  }
}

function removeDoc(d: AppData, kind: DocKind, id: string): AppData {
  switch (kind) {
    case 'food':
      return { ...d, foods: d.foods.filter((f) => f.id !== id) };
    case 'conv':
      return { ...d, conversions: d.conversions.filter((c) => c.id !== id) };
    case 'fav':
      return { ...d, favorites: d.favorites.filter((f) => f.id !== id) };
    case 'day':
      return { ...d, history: d.history.filter((h) => h.fecha !== id) };
    case 'weight':
      return { ...d, pesos: d.pesos.filter((w) => weightId(w) !== id) };
    case 'rating': {
      const ratings = { ...d.ratings };
      delete ratings[id];
      return { ...d, ratings };
    }
    case 'week':
      return { ...d, semanasTipo: d.semanasTipo.filter((w) => w.id !== id) };
    case 'mlink': {
      const links = { ...d.mercadona.links };
      delete links[id];
      return { ...d, mercadona: { ...d.mercadona, links } };
    }
    default:
      return d;
  }
}

/** Tras subir con éxito, quita de pendientes las claves que no han vuelto a cambiar. */
export function markPushed(d: AppData, pushed: SyncRow[]): AppData {
  const done = new Set(
    pushed
      .filter((r) => {
        const k = key(r.kind, r.id);
        const now = r.deleted ? d.sync.tombstones[k] : d.sync.stamps[k];
        return now === r.ts;
      })
      .map((r) => key(r.kind, r.id)),
  );
  return { ...d, sync: { ...d.sync, pending: d.sync.pending.filter((k) => !done.has(k)) } };
}
