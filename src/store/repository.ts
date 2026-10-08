import type { AppData } from '../types';

/**
 * Capa de persistencia. Hoy: localStorage (offline, sin backend).
 * Para añadir backend en el futuro basta con implementar esta interfaz
 * (p. ej. RemoteRepository que sincronice con una API) y cambiarla en AppStore.
 */
export interface DataRepository {
  load(): AppData | null;
  save(data: AppData): void;
  clear(): void;
}

const KEY = 'dieta-dani-alba:v1';

export class LocalStorageRepository implements DataRepository {
  load(): AppData | null {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as AppData) : null;
    } catch {
      return null;
    }
  }
  save(data: AppData): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      console.error('No se pudo guardar en localStorage', e);
    }
  }
  clear(): void {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }
}
