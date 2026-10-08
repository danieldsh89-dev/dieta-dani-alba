/**
 * Consulta de productos por código de barras en Open Food Facts (base abierta y colaborativa).
 * Los valores se marcan como "aproximado" hasta que el usuario los compruebe con la etiqueta.
 */
import type { Category, Food, FoodTag, NutritionState, Unit } from '../types';

export interface OffProduct {
  code?: string;
  product_name?: string;
  product_name_es?: string;
  brands?: string;
  quantity?: string;
  categories_tags?: string[];
  image_front_small_url?: string;
  nutriments?: Record<string, number | string | undefined>;
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : undefined;
};

const has = (tags: string[], ...needles: string[]) => tags.some((t) => needles.some((n) => t.includes(n)));

function guessCategory(tags: string[]): Category {
  if (has(tags, 'cheeses')) return 'queso';
  if (has(tags, 'yogurts', 'milks', 'dairy-desserts', 'fermented-milk', 'plant-based-milk', 'almond-milk', 'dairy-drinks')) return 'lacteo';
  if (has(tags, 'sauces', 'condiments', 'ketchup', 'mustards', 'mayonnaises', 'tomato-sauces')) return 'salsa';
  if (has(tags, 'meats', 'poultry', 'chicken', 'turkey', 'hams', 'fishes', 'seafood', 'tunas', 'eggs', 'meatballs', 'burgers', 'prepared-meats'))
    return 'proteina';
  if (has(tags, 'fruits', 'frozen-fruits', 'berries')) return 'fruta';
  if (has(tags, 'vegetables', 'soups', 'gazpachos', 'frozen-vegetables', 'salads')) return 'verdura';
  if (
    has(tags, 'cereals', 'pastas', 'rices', 'breads', 'potatoes', 'legumes', 'pulses', 'flours', 'oat', 'tortillas', 'rice-cakes', 'gnocchi', 'couscous')
  )
    return 'hidrato';
  if (has(tags, 'desserts', 'chocolates', 'sweets', 'protein-powders')) return 'postre';
  return 'extra';
}

function guessTags(tags: string[], cat: Category): FoodTag[] {
  const out: FoodTag[] = [];
  if (has(tags, 'fishes', 'seafood', 'tunas', 'sardines', 'mackerels')) out.push('pescado');
  const plant = has(tags, 'plant-based', 'almond', 'soy-milk', 'oat-milk', 'vegetable-milk');
  if (!plant && has(tags, 'en:milks', 'cow-milk', 'semi-skimmed-milks', 'whole-milks', 'skimmed-milks')) out.push('leche_vaca');
  if (!plant && (cat === 'queso' || has(tags, 'dairies', 'dairy', 'yogurts', 'cheeses'))) out.push('lacteo');
  if (has(tags, 'legumes', 'pulses', 'chickpeas', 'lentils', 'beans')) out.push('legumbre');
  return [...new Set(out)];
}

function guessState(tags: string[]): NutritionState {
  // pasta/arroz/legumbre seca: los valores de etiqueta son en crudo
  if (has(tags, 'dried-pastas', 'pastas', 'rices', 'dried-legumes', 'couscous', 'raw-meats', 'fresh-meats', 'poultry-meats')) return 'crudo';
  return 'listo_para_consumir';
}

function guessUnit(quantity?: string): Unit {
  return quantity && /\d\s*(ml|cl|l)\b/i.test(quantity) ? 'ml' : 'g';
}

/** Convierte la respuesta de Open Food Facts en una ficha parcial de alimento. */
export function mapOffProduct(p: OffProduct, code: string): Partial<Food> | null {
  const n = p.nutriments ?? {};
  let kcal = num(n['energy-kcal_100g']);
  if (kcal === undefined) {
    const kj = num(n['energy-kj_100g'] ?? n['energy_100g']);
    if (kj !== undefined) kcal = Math.round(kj / 4.184);
  }
  const nombre = (p.product_name_es || p.product_name || '').trim();
  if (!nombre && kcal === undefined) return null;
  const tags = p.categories_tags ?? [];
  const categoria = guessCategory(tags);
  return {
    nombre: nombre || `Producto ${code}`,
    marca: p.brands?.split(',')[0]?.trim() || undefined,
    codigoBarras: code,
    categoria,
    kcalPor100: kcal ?? 0,
    proteinaPor100: num(n['proteins_100g']) ?? 0,
    carbohidratosPor100: num(n['carbohydrates_100g']) ?? 0,
    grasasPor100: num(n['fat_100g']) ?? 0,
    fibraPor100: num(n['fiber_100g']),
    salPor100: num(n['salt_100g']),
    unidadBase: guessUnit(p.quantity),
    estadoNutricionalBase: guessState(tags),
    tags: guessTags(tags, categoria),
    verificacion: 'aproximado',
    notaVerificacion: `Datos de Open Food Facts (código ${code}${p.quantity ? `, envase ${p.quantity}` : ''}). Compruébalos con la etiqueta y marca “Verificado”.`,
  };
}

export type LookupResult =
  | { status: 'found'; food: Partial<Food>; imageUrl?: string }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

export async function lookupBarcode(code: string, timeoutMs = 10000): Promise<LookupResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const fields = 'code,product_name,product_name_es,brands,quantity,categories_tags,nutriments,image_front_small_url';
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${fields}`, {
      signal: ctrl.signal,
    });
    if (res.status === 404) return { status: 'not_found' };
    if (!res.ok) return { status: 'error', message: `Open Food Facts respondió ${res.status}` };
    const json = (await res.json()) as { status?: number; product?: OffProduct };
    if (!json.product || json.status === 0) return { status: 'not_found' };
    const food = mapOffProduct(json.product, code);
    return food ? { status: 'found', food, imageUrl: json.product.image_front_small_url } : { status: 'not_found' };
  } catch (e) {
    return {
      status: 'error',
      message: (e as Error).name === 'AbortError' ? 'Tiempo de espera agotado' : 'Sin conexión a internet',
    };
  } finally {
    clearTimeout(t);
  }
}

/** Valida un EAN-8/EAN-13/UPC-A por su dígito de control. */
export function isValidBarcode(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}
