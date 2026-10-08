import type { Favorite, Meal } from '../types';

/** Más usados primero; a igualdad, el usado más recientemente; luego los más nuevos; y por nombre (A1, A2… A10). */
export function sortFavorites(favs: Favorite[]): Favorite[] {
  return [...favs].sort(
    (a, b) =>
      (b.usos ?? 0) - (a.usos ?? 0) ||
      (b.ultimoUso ?? '').localeCompare(a.ultimoUso ?? '') ||
      (b.creado ?? '').localeCompare(a.creado ?? '') ||
      a.nombre.localeCompare(b.nombre, 'es', { numeric: true }),
  );
}

/** Copia "ligera" de un favorito para ponerla en un día (sin foto ni contadores). */
export function favoriteToMeal(f: Favorite): Meal {
  return {
    id: `${f.id}_${Date.now().toString(36)}`,
    nombre: f.nombre,
    bloque: f.bloque,
    items: structuredClone(f.items),
    notas: f.notas,
    origen: 'favorito',
  };
}
