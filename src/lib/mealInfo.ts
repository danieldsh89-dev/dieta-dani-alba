/**
 * Información extra de las comidas: iconos de sus ingredientes, coste con precios de Mercadona,
 * orden de favoritos y secciones de la compra. Funciones puras — tests en __tests__/mealInfo.test.ts.
 */
import type { Block, Category, Favorite, Food, Meal, MercaLink, MercaProduct, ProfileId, Rating } from '../types';
import { PROFILE_IDS } from '../types';
import type { ConversionMap } from './conversions';
import type { FoodMap } from './nutrition';
import { nutrientsFor } from './nutrition';
import { signature } from './mealGenerator';
import { amountFromProduct, stockAmountFromBase, stockUnitFor } from './stock';

// ───────── iconos ─────────

/** Icono de un alimento: por palabras de su id/nombre y, si no, por categoría */
const FOOD_EMOJI: [RegExp, string][] = [
  [/proteina_|whey/, '💪'],
  [/albondiga/, '🧆'],
  [/hamburguesa/, '🍔'],
  [/chili|carrillada/, '🥩'],
  [/pollo|pavo|contramuslo/, '🍗'],
  [/carne|ternera|vacuno|carrillada|chili|cerdo|lomo/, '🥩'],
  [/salmon|merluza|bacalao|atun|melva|pescado|sardina/, '🐟'],
  [/gamba|marisco|langostino/, '🦐'],
  [/huevo|claras/, '🥚'],
  [/arroz_coliflor|coliflor|brocoli/, '🥦'],
  [/obleas|tortitas_de_arroz/, '🍘'],
  [/arroz/, '🍚'],
  [/papa|patata|gnocchi_patata/, '🥔'],
  [/gnocchi|pasta|espagueti|macarron|cuscus/, '🍝'],
  [/tortilla_maiz|tortitas_maiz|taco/, '🌮'],
  [/pan_|pan$|tostada/, '🍞'],
  [/avena|cereal|muesli/, '🥣'],
  [/obleas|tortitas/, '🍘'],
  [/garbanzo|lenteja|alubia|legumbre|hummus/, '🫘'],
  [/aguacate/, '🥑'],
  [/gazpacho|tomate/, '🍅'],
  [/lechuga|ensalada|canonigo|rucula/, '🥗'],
  [/pepino|calabacin/, '🥒'],
  [/cebolla/, '🧅'],
  [/seta|champi/, '🍄'],
  [/pimiento/, '🫑'],
  [/zanahoria/, '🥕'],
  [/pisto|ratatouille|wok|verdura|salteado/, '🥦'],
  [/queso|cottage|mozzarella|havarti|burrata/, '🧀'],
  [/yogur|leche|fermentada|batido|kefir|bebida_/, '🥛'],
  [/chocolate|cacao/, '🍫'],
  [/nuez|nueces|almendra|cacahuete|frutos_secos/, '🥜'],
  [/aceite/, '🫒'],
  [/platano|banana/, '🍌'],
  [/manzana/, '🍎'],
  [/naranja|mandarina/, '🍊'],
  [/uva/, '🍇'],
  [/sandia|melon/, '🍉'],
  [/fresa/, '🍓'],
  [/arandano|frutos_rojos|frambuesa/, '🫐'],
  [/tropical|pina|mango/, '🍍'],
  [/salsa|ketchup|barbacoa|mostaza/, '🥫'],
];

const CAT_EMOJI: Record<Category, string> = {
  proteina: '🍖',
  hidrato: '🍞',
  verdura: '🥦',
  salsa: '🥫',
  queso: '🧀',
  lacteo: '🥛',
  fruta: '🍎',
  postre: '🍮',
  extra: '🥄',
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_');

export function foodEmoji(f: Food): string {
  const key = `${f.id} ${norm(f.nombre)}`;
  for (const [re, e] of FOOD_EMOJI) if (re.test(key)) return e;
  return CAT_EMOJI[f.categoria] ?? '🍽️';
}

/** Lo que más pesa en el plato: proteína, hidrato y verdura primero; salsas y extras al final. */
const ROLE: Category[] = ['proteina', 'hidrato', 'verdura', 'fruta', 'queso', 'lacteo', 'postre', 'salsa', 'extra'];

/** Hasta `max` iconos de los ingredientes principales: "Pollo con papas" → 🍗🥔 */
export function mealEmojis(meal: Pick<Meal, 'items'>, fm: FoodMap, max = 3): string[] {
  const items = meal.items
    .map((it) => {
      const f = fm[it.foodId];
      const base = PROFILE_IDS.reduce((s, p) => s + (it.cantidades[p] ?? 0), 0);
      return f ? { f, kcal: nutrientsFor(f, base).kcal } : null;
    })
    .filter(Boolean) as { f: Food; kcal: number }[];
  items.sort((a, b) => ROLE.indexOf(a.f.categoria) - ROLE.indexOf(b.f.categoria) || b.kcal - a.kcal);
  const out: string[] = [];
  for (const { f } of items) {
    if (f.categoria === 'extra' && out.length) continue;
    const e = foodEmoji(f);
    if (!out.includes(e)) out.push(e);
    if (out.length >= max) break;
  }
  return out.length ? out : ['🍽️'];
}

/** Iconos para elegir a mano */
export const ICON_CHOICES = [
  '🍗', '🥩', '🐟', '🦐', '🥚', '🍳', '🧆', '🍔', '🌮', '🌯', '🥙', '🍕',
  '🍝', '🍚', '🍛', '🍜', '🍲', '🥘', '🥗', '🥔', '🥦', '🍅', '🥑', '🍄',
  '🥞', '🧇', '🥣', '🍞', '🥪', '🧀', '🥛', '🍓', '🍌', '🍎', '🫐', '🍫',
  '💪', '⭐', '❤️', '🔥', '🌱', '🏋️',
];

export const BLOCK_TINT: Record<Block, string> = {
  A: 'rgba(255, 183, 77, 0.2)',
  B: 'rgba(102, 187, 106, 0.2)',
  C: 'rgba(121, 134, 203, 0.24)',
};

// ───────── coste ─────────

/** € por unidad de stock del alimento (g, ml o ud) según su producto de Mercadona */
export function pricePerUnit(food: Food, p: MercaProduct): number | undefined {
  const per = amountFromProduct({ unidad: stockUnitFor(food) }, p, 1, food);
  if (!(per > 0)) return undefined;
  const price = p.sellingMethod !== 0 ? (p.refPrice ?? p.unitPrice) : p.unitPrice;
  return price / per;
}

export interface MealCost {
  /** € de la comida entera */
  total: number;
  porPersona: Record<ProfileId, number>;
  /** ingredientes sin producto de Mercadona (no cuentan) */
  sinPrecio: number;
}

export function mealCost(meal: Pick<Meal, 'items'>, fm: FoodMap, cm: ConversionMap, links: Record<string, MercaLink>): MealCost {
  const porPersona = { dani: 0, alba: 0 } as Record<ProfileId, number>;
  let sinPrecio = 0;
  for (const it of meal.items) {
    const f = fm[it.foodId];
    const link = links[it.foodId];
    const ppu = f && link ? pricePerUnit(f, link.product) : undefined;
    if (!f || ppu === undefined) {
      if (PROFILE_IDS.some((p) => (it.cantidades[p] ?? 0) > 0)) sinPrecio++;
      continue;
    }
    for (const p of PROFILE_IDS) {
      const base = it.cantidades[p] ?? 0;
      if (base > 0) porPersona[p] += stockAmountFromBase(f, base, cm, it.metodoId) * ppu;
    }
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  for (const p of PROFILE_IDS) porPersona[p] = r2(porPersona[p]);
  return { total: r2(PROFILE_IDS.reduce((s, p) => s + porPersona[p], 0)), porPersona, sinPrecio };
}

export const eur = (n: number) => n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });

// ───────── ordenar favoritos ─────────

export type FavSort = 'usados' | 'recientes' | 'nuevos' | 'az' | 'valorados' | 'proteina' | 'kcal' | 'casa' | 'baratos';

export const FAV_SORTS: { id: FavSort; label: string }[] = [
  { id: 'usados', label: 'Más usados' },
  { id: 'recientes', label: 'Usados hace poco' },
  { id: 'nuevos', label: 'Más nuevos' },
  { id: 'az', label: 'A–Z' },
  { id: 'valorados', label: 'Mejor valorados 👍' },
  { id: 'proteina', label: 'Más proteína' },
  { id: 'kcal', label: 'Menos kcal' },
  { id: 'casa', label: '🏠 Con lo que hay en casa' },
  { id: 'baratos', label: '💶 Más baratos' },
];

export interface SortCtx {
  ratings?: Record<string, Rating>;
  /** alimentos que hay en casa (para "con lo que hay") */
  enCasa?: Set<string>;
  cost?: (f: Favorite) => number | undefined;
}

const byName = (a: Favorite, b: Favorite) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true });
const usados = (a: Favorite, b: Favorite) =>
  (b.usos ?? 0) - (a.usos ?? 0) || (b.ultimoUso ?? '').localeCompare(a.ultimoUso ?? '') || (b.creado ?? '').localeCompare(a.creado ?? '') || byName(a, b);
const avg = (f: Favorite, k: 'kcal' | 'proteina') => {
  const ps = f.para ? [f.para] : PROFILE_IDS;
  return ps.reduce((s, p) => s + (f.totales[p]?.[k] ?? 0), 0) / ps.length;
};

/** Parte de los ingredientes (sin contar aceite, especias…) que hay en casa: 0 a 1 */
export function shareInCasa(f: Pick<Meal, 'items'>, enCasa: Set<string>, fm: FoodMap): number {
  const main = f.items.filter((i) => fm[i.foodId] && fm[i.foodId].categoria !== 'extra' && fm[i.foodId].categoria !== 'salsa');
  if (!main.length) return 0;
  return main.filter((i) => enCasa.has(i.foodId)).length / main.length;
}

export function sortFavoritesBy(favs: Favorite[], sort: FavSort, fm: FoodMap, ctx: SortCtx = {}): Favorite[] {
  const list = [...favs];
  switch (sort) {
    case 'recientes':
      return list.sort((a, b) => (b.ultimoUso ?? '').localeCompare(a.ultimoUso ?? '') || usados(a, b));
    case 'nuevos':
      return list.sort((a, b) => (b.creado ?? '').localeCompare(a.creado ?? '') || byName(a, b));
    case 'az':
      return list.sort(byName);
    case 'valorados': {
      const vote = (f: Favorite) => ctx.ratings?.[signature(f.items.map((i) => i.foodId))]?.voto ?? 0;
      return list.sort((a, b) => vote(b) - vote(a) || usados(a, b));
    }
    case 'proteina':
      return list.sort((a, b) => avg(b, 'proteina') - avg(a, 'proteina') || byName(a, b));
    case 'kcal':
      return list.sort((a, b) => avg(a, 'kcal') - avg(b, 'kcal') || byName(a, b));
    case 'casa': {
      const s = (f: Favorite) => (ctx.enCasa ? shareInCasa(f, ctx.enCasa, fm) : 0);
      return list.sort((a, b) => s(b) - s(a) || usados(a, b));
    }
    case 'baratos': {
      const c = (f: Favorite) => ctx.cost?.(f) ?? Infinity;
      return list.sort((a, b) => c(a) - c(b) || byName(a, b));
    }
    default:
      return list.sort(usados);
  }
}

// ───────── secciones de la compra (tienda física) ─────────

export const SECTIONS = ['Fruta y verdura', 'Carne', 'Pescado', 'Charcutería y quesos', 'Huevos y lácteos', 'Panadería', 'Despensa', 'Congelados', 'Otros'] as const;
export type Section = (typeof SECTIONS)[number];

export function sectionFor(f: Food, zona?: string): Section {
  const key = `${f.id} ${norm(f.nombre)}`;
  if (zona === 'congelador' || /congelad|ultracongel|_cong\b|cong$/.test(key)) return 'Congelados';
  if (/salmon|merluza|bacalao|pescado|gamba|marisco/.test(key)) return 'Pescado';
  if (/atun|melva|sardina|_bote|de_bote|en_lata|conserva|gazpacho/.test(key)) return 'Despensa';
  if (/pavo_lonchas|jamon|loncha|queso|cottage|mozzarella|havarti/.test(key)) return 'Charcutería y quesos';
  if (/huevo|claras|yogur|leche|fermentada|batido|kefir|bebida_/.test(key)) return 'Huevos y lácteos';
  if (/pan_|pan$|tortilla_maiz|obleas/.test(key)) return 'Panadería';
  switch (f.categoria) {
    case 'proteina':
      return 'Carne';
    case 'verdura':
    case 'fruta':
      return 'Fruta y verdura';
    case 'queso':
      return 'Charcutería y quesos';
    case 'lacteo':
    case 'postre':
      return 'Huevos y lácteos';
    case 'hidrato':
    case 'salsa':
    case 'extra':
      return 'Despensa';
    default:
      return 'Otros';
  }
}
