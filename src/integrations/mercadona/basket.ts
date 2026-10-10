/**
 * Cesta Mercadona: de la lista de la compra de la app (pesos de compra) a productos y paquetes.
 * Funciones puras — tests en src/lib/__tests__/mercadona.test.ts.
 */
import type { Food, MercaLink, MercaProduct } from '../../types';
import type { ShoppingItem } from '../../lib/planning';
import type { CartLine } from './client';

export type LineStatus = 'ok' | 'sin_vincular' | 'en_casa' | 'quitado' | 'otra_tienda';

export interface BasketLine {
  food: Food;
  item: ShoppingItem;
  link?: MercaLink;
  /** necesidad en la unidad del producto: g, ml o ud */
  need: number;
  needUnit: 'g' | 'ml' | 'ud';
  /** cantidad que va al carrito (unidades de venta; kg si es a granel) */
  qty: number;
  /** lo que se compra en la unidad de la necesidad, y lo que sobra */
  compra: number;
  sobrante: number;
  precio: number;
  status: LineStatus;
  /** la conversión no es exacta (peso aproximado o unidades sin equivalencia) */
  aviso?: string;
}

export interface BasketOptions {
  pantry?: string[];
  /** incluir también lo marcado "en casa" */
  incluirEnCasa?: boolean;
  /** foodIds que el usuario ha quitado de la cesta */
  quitados?: string[];
  /** foodIds que se compran en otra tienda (siempre fuera de la cesta) */
  otraTienda?: string[];
  /** cantidad elegida a mano para el carrito (foodId → qty) */
  ajustes?: Record<string, number>;
}

/** Tamaño de una unidad de venta en g / ml / ud. */
export function productSize(p: MercaProduct): { size: number; unit: 'g' | 'ml' | 'ud' } {
  const f = p.sizeFormat.toLowerCase();
  if (f === 'kg') return { size: p.unitSize * 1000, unit: 'g' };
  if (f === 'g') return { size: p.unitSize, unit: 'g' };
  if (f === 'l') return { size: p.unitSize * 1000, unit: 'ml' };
  if (f === 'ml') return { size: p.unitSize, unit: 'ml' };
  return { size: p.unitSize || 1, unit: 'ud' };
}

const isBulk = (p: MercaProduct) => p.sellingMethod !== 0;

/** Cuánto hay que comprar de un producto para cubrir una necesidad. */
export function packsFor(
  needG: number,
  needUnits: number | undefined,
  p: MercaProduct,
  food?: Food,
): { qty: number; compra: number; need: number; needUnit: 'g' | 'ml' | 'ud'; aviso?: string } {
  const { size, unit } = productSize(p);
  // a granel: cantidad en kg con mínimo e incremento
  if (isBulk(p)) {
    const kg = needG / 1000;
    const qty = Math.max(p.minBunch, Math.ceil(kg / p.incBunch - 1e-9) * p.incBunch);
    return { qty: round3(qty), compra: qty * 1000, need: needG, needUnit: 'g' };
  }
  let need: number;
  let needUnit: 'g' | 'ml' | 'ud' = unit;
  let aviso: string | undefined;
  if (unit === 'ud') {
    if (needUnits !== undefined) need = needUnits;
    else if (food?.pesoUnidad) need = needG / food.pesoUnidad;
    else {
      // el producto va por unidades y no sabemos cuánto pesa cada una
      need = 1;
      aviso = 'El producto se vende por unidades: revisa la cantidad';
    }
  } else {
    need = needG; // g ≈ ml para líquidos
    needUnit = unit;
  }
  const qty = Math.max(1, Math.ceil(need / size - 0.03)); // 3 % de margen: 505 g en paquetes de 500 g → 1
  if (p.approx && unit !== 'ud') aviso = aviso ?? 'Peso aproximado (bandeja/piezas)';
  return { qty, compra: qty * size, need, needUnit, aviso };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function linePrice(p: MercaProduct, qty: number): number {
  if (isBulk(p)) return round2(qty * (p.refPrice ?? p.unitPrice));
  return round2(qty * p.unitPrice);
}

export function buildBasket(items: ShoppingItem[], links: Record<string, MercaLink>, o: BasketOptions = {}): BasketLine[] {
  return items.map((item) => {
    const food = item.food;
    const link = links[food.id];
    const needG = item.unit === 'unidad' ? (item.unidades ?? 0) * (food.pesoUnidad ?? 0) : item.comprar;
    const enCasa = (o.pantry ?? []).includes(food.id);
    const base = { food, item, link };
    const fuera: LineStatus | undefined = o.otraTienda?.includes(food.id) ? 'otra_tienda' : o.quitados?.includes(food.id) ? 'quitado' : undefined;
    if (!link || fuera === 'otra_tienda') {
      const status: LineStatus = fuera ?? 'sin_vincular';
      return { ...base, need: needG, needUnit: item.unit === 'ml' ? 'ml' : 'g', qty: 0, compra: 0, sobrante: 0, precio: 0, status } as BasketLine;
    }
    const pk = packsFor(needG, item.unit === 'unidad' ? item.unidades : undefined, link.product, food);
    const qty = o.ajustes?.[food.id] ?? pk.qty;
    const compra = isBulk(link.product) ? qty * 1000 : qty * productSize(link.product).size;
    const status: LineStatus = fuera ? fuera : enCasa && !o.incluirEnCasa ? 'en_casa' : 'ok';
    return {
      ...base,
      need: pk.need,
      needUnit: pk.needUnit,
      qty,
      compra,
      sobrante: Math.max(0, compra - pk.need),
      precio: linePrice(link.product, qty),
      status,
      aviso: pk.aviso,
    };
  });
}

export function basketTotal(lines: BasketLine[]): number {
  return round2(lines.filter((l) => l.status === 'ok').reduce((s, l) => s + l.precio, 0));
}

/** Líneas para el carrito (agrupando si dos alimentos usan el mismo producto). */
export function cartLines(lines: BasketLine[]): CartLine[] {
  const map = new Map<string, CartLine>();
  for (const l of lines) {
    if (l.status !== 'ok' || !l.link || l.qty <= 0) continue;
    const id = l.link.product.id;
    const prev = map.get(id);
    if (prev) prev.quantity = round3(prev.quantity + l.qty);
    else map.set(id, { productId: id, quantity: l.qty, nombre: l.link.product.nombre, unitPrice: l.link.product.unitPrice });
  }
  return [...map.values()];
}

/** Une líneas de carrito sumando cantidades del mismo producto. */
export function combineLines(...groups: CartLine[][]): CartLine[] {
  const map = new Map<string, CartLine>();
  for (const l of groups.flat()) {
    const prev = map.get(l.productId);
    if (prev) prev.quantity = Math.round((prev.quantity + l.quantity) * 1000) / 1000;
    else map.set(l.productId, { ...l });
  }
  return [...map.values()];
}

/** Fusiona con el carrito actual: "set" de nuestros productos, conserva el resto; o reemplaza todo. */
export function mergeCart(current: CartLine[], desired: CartLine[], mode: 'sumar' | 'reemplazar'): CartLine[] {
  if (mode === 'reemplazar') return desired.map((l) => ({ ...l }));
  const out = current.map((l) => ({ ...l }));
  for (const d of desired) {
    const i = out.findIndex((l) => l.productId === d.productId);
    if (i >= 0) out[i] = { ...out[i], quantity: d.quantity };
    else out.push({ ...d });
  }
  return out;
}

export function estimateCart(lines: CartLine[], known: Record<string, number>): number {
  return round2(lines.reduce((s, l) => s + l.quantity * (known[l.productId] ?? l.unitPrice ?? 0), 0));
}

// ───────── búsqueda del producto adecuado ─────────

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ ]/g, ' ');

const STOP = new Set(['de', 'del', 'con', 'en', 'y', 'la', 'el', 'los', 'las', 'al', 'sin', 'para', 'a']);

/**
 * Búsquedas afinadas para los alimentos de la base (el nombre de la app no siempre es como lo llama Mercadona).
 * Si Mercadona cambia nombres, basta con tocar esta tabla; y cada vínculo se confirma una vez y se guarda.
 */
export const SEARCH_HINTS: Record<string, string> = {
  pollo_pechuga: 'filetes pechuga pollo',
  contramuslo: 'contramuslo pollo deshuesado',
  carne_picada: 'carne picada vacuno',
  albondigas: 'albondigas pollo cerdo',
  huevo: 'huevos',
  claras: 'claras huevo pasteurizadas',
  pavo_lonchas: 'pechuga pavo lonchas hacendado',
  atun: 'atun natural hacendado',
  melva: 'melva aceite',
  chili: 'chili con carne',
  carrilladas: 'carrillada',
  hamburguesa: 'burger meat vacuno',
  arroz: 'arroz redondo hacendado',
  pasta: 'macarron hacendado',
  pasta_legumbres: 'pasta lentejas',
  cuscus: 'cuscus hacendado',
  papa_fresca: 'papas',
  papa_bote: 'patatas cocidas bote',
  gnocchi: 'gnocchi rellenos queso',
  gnocchi_patata: 'gnocchi patata',
  arroz_coliflor: 'coliflor arroz',
  garbanzos: 'garbanzos cocidos hacendado',
  pan_integral: 'pan molde 100% integral sin corteza',
  pan_avena: 'pan molde avena',
  avena: 'copos avena hacendado',
  harina_avena: 'harina de avena',
  tortilla_maiz: 'tortillas maiz',
  obleas_arroz: 'tortitas arroz',
  ratatouille: 'ratatouille',
  setas: 'salteado setas',
  gazpacho: 'gazpacho tradicional hacendado',
  tomate: 'tomate ensalada',
  cebolla: 'cebollas',
  pepino: 'pepino',
  lechuga: 'lechuga',
  pisto: 'pisto',
  wok_verduras: 'wok verduras',
  salteado_verduras: 'salteado verduras',
  verduras_asadas: 'verduras asadas',
  aguacate: 'aguacate',
  salsa_tomate_albahaca: 'tomate albahaca',
  salsa_mexicana: 'salsa mexicana hacendado',
  salsa_soja: 'salsa soja',
  ketchup_zero: 'ketchup zero',
  barbacoa_zero: 'barbacoa zero',
  mostaza: 'mostaza',
  tomate_triturado: 'tomate triturado hacendado',
  cottage: 'queso cottage hacendado',
  havarti_light: 'havarti light',
  mozzarella_rallada: 'mozzarella rallada',
  mozzarella_bufala: 'mozzarella bufala',
  queso_batido: 'queso fresco batido 0%',
  yogur_0: 'yogur natural desnatado hacendado',
  yogur_griego_0: 'yogur griego 0%',
  leche_fermentada_proteica: 'protein fresa platano',
  bebida_almendras: 'bebida almendras sin azucar',
  leche_semi: 'leche semidesnatada hacendado',
  yogur_liquido_frutos_silvestres: 'yogur liquido frutos',
  chocolate_85: 'chocolate negro 85%',
  nueces: 'nueces peladas',
  aceite_oliva: 'aceite oliva virgen extra hacendado',
  platano: 'platano canarias',
  manzana: 'manzanas',
  naranja: 'naranja',
  mandarina: 'mandarinas',
  uvas: 'uva',
  sandia: 'sandia',
  frutos_rojos_cong: 'frutos rojos ultracongelados',
  arandanos_cong: 'arandanos congelados',
  fresa_platano_cong: 'fresa platano congelado',
  mix_tropical: 'fruta tropical congelada',
};

/** Texto de búsqueda para un alimento (búsqueda afinada, o el nombre sin paréntesis + marca). */
export function queryFor(food: Food): string {
  if (SEARCH_HINTS[food.id]) return SEARCH_HINTS[food.id];
  const base = food.nombre.replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim();
  return food.marca && !norm(base).includes(norm(food.marca)) ? `${base} ${food.marca}` : base;
}

/** Palabras que indican un producto distinto (procesado, postre, infantil…) si no estaban en la búsqueda. */
const OTHER_PRODUCT = [
  'bebe', 'meses', 'papilla', 'tarrito', 'snack', 'preparado', 'precocinad', 'tortitas', 'chocolate', 'frito', 'bifidus',
  'postre', 'sabor', 'galleta', 'barrita', 'zumo', 'batido', 'braseada', 'asada', 'empanad', 'rebozad', 'salsa', 'crema',
  'polvo', 'vinagre', 'margarina', 'infusion', 'trenza', 'panecillo', 'molde', 'melon',
];

/** Puntuación de un producto para un alimento: palabras en común, marca, y penaliza productos distintos. */
export function scoreProduct(food: Food, p: MercaProduct): number {
  const q = norm(queryFor(food));
  const fw = q.split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  const pn = norm(p.nombre);
  const pw = pn.split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  let s = 0;
  for (const w of fw) if (pn.includes(w)) s += 2;
  if (fw.length && fw.every((w) => pn.includes(w))) s += 2;
  const marca = norm(food.marca ?? 'hacendado');
  if (pn.includes(marca)) s += 1;
  else if (pn.includes('hacendado')) s += 0.4;
  for (const bad of OTHER_PRODUCT) if (pn.includes(bad) && !q.includes(bad) && !norm(food.nombre).includes(bad)) s -= 3;
  // palabras de más en el nombre del producto: lo más parecido gana
  s -= 0.3 * pw.filter((w) => !fw.some((f) => w.includes(f) || f.includes(w))).length;
  if ((food.unidadBase === 'unidad') !== (productSize(p).unit === 'ud') && !(food.pesoUnidad && productSize(p).unit !== 'ud')) s -= 0.5;
  return s;
}

/** Puntuación mínima para proponer un producto automáticamente (si no, se busca a mano). */
export const MIN_SCORE = 1.5;

export function bestMatch(food: Food, hits: MercaProduct[], minScore = MIN_SCORE): MercaProduct | undefined {
  const best = [...hits].sort((a, b) => scoreProduct(food, b) - scoreProduct(food, a))[0];
  return best && scoreProduct(food, best) >= minScore ? best : undefined;
}

// ───────── textos para copiar / exportar ─────────

const eur = (n: number) => n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });

export function sizeText(p: MercaProduct): string {
  const { size, unit } = productSize(p);
  if (unit === 'ud') return `${size} ud`;
  return size >= 1000 ? `${(size / 1000).toLocaleString('es-ES')} ${unit === 'g' ? 'kg' : 'L'}` : `${Math.round(size)} ${unit}`;
}

export function qtyText(l: BasketLine): string {
  if (!l.link) return '';
  return isBulk(l.link.product) ? `${l.qty.toLocaleString('es-ES')} kg` : `× ${l.qty}`;
}

/** Lista legible para buscar a mano en la app de Mercadona (alternativa sin API). */
export function basketText(lines: BasketLine[], title: string, otros: CartLine[] = []): string {
  const out = [title, ''];
  for (const l of lines) {
    if (l.status === 'quitado' || l.status === 'otra_tienda') continue;
    const mark = l.status === 'en_casa' ? '☑' : '☐';
    if (l.link) {
      out.push(`${mark} ${l.link.product.nombre} (${l.link.product.formato ?? ''} ${sizeText(l.link.product)}) ${qtyText(l)} — ${eur(l.precio)}`.replace(/\(\s+/, '('));
    } else {
      out.push(`${mark} ${l.food.nombre} — ${l.item.unit === 'unidad' ? `${l.item.unidades} ud` : `${l.item.comprar} ${l.item.unit}`} (sin producto)`);
    }
  }
  if (otros.length) {
    out.push('', 'Otros:');
    for (const o of otros) out.push(`☐ ${o.nombre ?? o.productId} × ${o.quantity.toLocaleString('es-ES')} — ${eur(round2(o.quantity * (o.unitPrice ?? 0)))}`);
  }
  const extra = otros.reduce((t, o) => t + o.quantity * (o.unitPrice ?? 0), 0);
  out.push('', `Total estimado: ${eur(round2(basketTotal(lines) + extra))}`);
  const otra = lines.filter((l) => l.status === 'otra_tienda');
  if (otra.length) out.push('', `En otra tienda: ${otra.map((l) => l.food.nombre.split(' (')[0]).join(', ')}`);
  return out.join('\n');
}

/** Formato de mercadona-cli: "<id> <cantidad> # nombre" (para `mercadona cart set-many -f cesta.txt`). */
export function cliText(lines: BasketLine[], otros: CartLine[] = []): string {
  return combineLines(cartLines(lines), otros)
    .map((l) => `${l.productId} ${l.quantity} # ${l.nombre ?? ''}`)
    .join('\n');
}
