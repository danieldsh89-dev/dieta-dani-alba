import type { AppData } from '../types';
import { applyRemote, collectRows, markPushed } from './docs';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';
import { pullRows, pushRows, type CloudConfig } from './supabase';

export function cloudConfig(d: AppData): CloudConfig | null {
  const url = d.sync.url || SUPABASE_URL;
  const anonKey = d.sync.anonKey || SUPABASE_ANON_KEY;
  return url && anonKey ? { url, anonKey } : null;
}

export function isSyncEnabled(d: AppData): boolean {
  return !!cloudConfig(d) && !!d.sync.household;
}

const CHUNK = 400;
/** solapamiento del cursor para no perder escrituras concurrentes (aplicar dos veces es inocuo) */
const OVERLAP_MS = 5000;

/**
 * Un ciclo de sincronización: sube lo pendiente y descarga lo nuevo.
 * `getData` debe devolver siempre el estado más reciente; `update` aplica cambios funcionales.
 */
export async function syncOnce(
  getData: () => AppData,
  update: (fn: (d: AppData) => AppData) => void,
): Promise<{ pushed: number; pulled: number }> {
  const start = getData();
  const cfg = cloudConfig(start);
  const household = start.sync.household;
  if (!cfg || !household) throw new Error('Sincronización no configurada');

  // 1) subir
  const rows = collectRows(start, start.sync.pending);
  for (let i = 0; i < rows.length; i += CHUNK) {
    await pushRows(cfg, household, rows.slice(i, i + CHUNK));
  }
  if (rows.length) update((d) => markPushed(d, rows));

  // 2) descargar
  let since = start.sync.cursor
    ? new Date(new Date(start.sync.cursor).getTime() - OVERLAP_MS).toISOString()
    : undefined;
  let pulledTotal = 0;
  for (let page = 0; page < 20; page++) {
    const pulled = await pullRows(cfg, household, since);
    if (!pulled.length) break;
    pulledTotal += pulled.length;
    const maxTs = pulled.reduce((m, r) => (r.serverTs > m ? r.serverTs : m), pulled[0].serverTs);
    update((d) => {
      const { data } = applyRemote(d, pulled);
      const cursor = !d.sync.cursor || maxTs > d.sync.cursor ? maxTs : d.sync.cursor;
      return { ...data, sync: { ...data.sync, cursor } };
    });
    if (pulled.length < 5000) break;
    since = maxTs;
  }
  update((d) => ({ ...d, sync: { ...d.sync, lastSync: Date.now(), lastError: undefined } }));
  return { pushed: rows.length, pulled: pulledTotal };
}
