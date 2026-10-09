import type { Favorite, Food, Meal, ProfileId } from '../types';

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
    ...(f.para ? { para: f.para } : {}),
  };
}

export interface FavFilter {
  para?: ProfileId | 'ambos';
  sinLacteos?: boolean;
  sinPescado?: boolean;
  conFoto?: boolean;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

/** Búsqueda por nombre o por ingrediente (texto normalizado) + filtros. */
export function filterFavorites(favs: Favorite[], q: string, f: FavFilter, foods: Food[]): Favorite[] {
  const fm = new Map(foods.map((x) => [x.id, x]));
  const words = norm(q).split(/\s+/).filter(Boolean);
  return favs.filter((fav) => {
    const ing = fav.items.map((i) => fm.get(i.foodId)).filter(Boolean) as Food[];
    if (words.length) {
      const hay = norm([fav.nombre, ...ing.map((x) => `${x.nombre} ${x.marca ?? ''}`)].join(' '));
      if (!words.every((w) => hay.includes(w))) return false;
    }
    if (f.para === 'ambos' && fav.para) return false;
    if (f.para && f.para !== 'ambos' && fav.para && fav.para !== f.para) return false;
    if (f.sinLacteos && ing.some((x) => x.tags.includes('lacteo') || x.tags.includes('leche_vaca') || x.categoria === 'queso')) return false;
    if (f.sinPescado && ing.some((x) => x.tags.includes('pescado'))) return false;
    if (f.conFoto && !fav.foto) return false;
    return true;
  });
}
