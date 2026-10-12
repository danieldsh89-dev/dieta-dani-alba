/**
 * Stock de casa: qué hay, cuánto se gasta y qué entra con cada compra.
 *
 * - Cada cambio es un evento inmutable (set = "hay X", delta = "+/- X", nivel = ok/poco/agotado):
 *   así los dos móviles nunca se pisan al sincronizar.
 * - Los alimentos de la dieta se gastan SOLOS con las comidas registradas (desayuno 9:00,
 *   almuerzo 14:00, cena 21:00, extras 17:00). Una corrección ("quedan 4 huevos") fija la
 *   cantidad y a partir de ahí se vuelve a descontar.
 * - Los pedidos de Mercadona (lo realmente preparado) suman al stock.
 * Funciones puras — tests en __tests__/stock.test.ts.
 */
import type { AppData, Block, DayLog, Food, MercaProduct, StockEvent, StockItem, StockLevel, StockOrder, StockZone } from '../types';
import { PROFILE_IDS } from '../types';
import { dayMeals } from './day';
import { purchaseWeight, parseDate, dateKey, addDays } from './planning';
import type { ConversionMap } from './conversions';
import type { FoodMap } from './nutrition';
import { productSize } from '../integrations/mercadona/basket';
import { enEstaCompra, proxima, registrarCompra } from '../integrations/mercadona/habituales';
import type { OrderLine, OrderSummary } from '../integrations/mercadona/client';

export const BLOCK_HOUR: Record<Block, number> = { A: 9, B: 14, C: 21 };
const EXTRA_HOUR = 17;

export const ZONES: { id: StockZone; label: string; ico: string }[] = [
  { id: 'nevera', label: 'Nevera', ico: '🧊' },
  { id: 'congelador', label: 'Congelador', ico: '❄️' },
  { id: 'fruta', label: 'Fruta y verdura', ico: '🥦' },
  { id: 'despensa', label: 'Despensa', ico: '🥫' },
  { id: 'bebidas', label: 'Bebidas', ico: '🥤' },
  { id: 'limpieza', label: 'Limpieza y hogar', ico: '🧽' },
  { id: 'bano', label: 'Baño e higiene', ico: '🧴' },
  { id: 'otros', label: 'Otros', ico: '📦' },
];

/** Hora local (ms) de una fecha YYYY-MM-DD a una hora dada */
export function momentOf(fecha: string, hour: number): number {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(y, m - 1, d, hour, 0, 0).getTime();
}

const ms = (iso: string) => new Date(iso).getTime();
const r1 = (n: number) => Math.round(n * 10) / 10;

export function uid(prefix = 'e'): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// ───────── alimentos de la dieta como artículos ─────────

export function stockUnitFor(food: Food): 'g' | 'ml' | 'ud' {
  return food.unidadBase === 'unidad' ? 'ud' : food.unidadBase;
}

const CAT_ZONE: Record<Food['categoria'], StockZone> = {
  proteina: 'nevera',
  hidrato: 'despensa',
  verdura: 'fruta',
  salsa: 'despensa',
  queso: 'nevera',
  lacteo: 'nevera',
  fruta: 'fruta',
  postre: 'nevera',
  extra: 'despensa',
};

export const shortName = (nombre: string) => nombre.split(' (')[0];

export function foodItem(food: Food, hoy: string): StockItem {
  return {
    id: food.id,
    nombre: shortName(food.nombre),
    foodId: food.id,
    tipo: 'contado',
    unidad: stockUnitFor(food),
    zona: CAT_ZONE[food.categoria] ?? 'despensa',
    qty: 1,
    aprender: false,
    compras: [],
    creado: hoy,
  };
}

/** Artículo nuevo de casa (no es de la dieta) */
export function casaItem(nombre: string, hoy: string, over: Partial<StockItem> = {}): StockItem {
  return {
    id: uid('c'),
    nombre,
    tipo: 'estado',
    unidad: 'ud',
    zona: 'otros',
    qty: 1,
    aprender: true,
    compras: [],
    creado: hoy,
    ...over,
  };
}

// ───────── consumo por las comidas ─────────

export interface ConsumoMoment {
  t: number;
  foodId: string;
  /** en la unidad de stock del alimento */
  cantidad: number;
}

/** Cuánto gasta una cantidad (estado base) de un alimento, en su unidad de stock. */
export function stockAmountFromBase(food: Food, base: number, cm: ConversionMap, metodoId?: string): number {
  if (food.unidadBase === 'unidad') return base / (food.pesoUnidad || 1);
  return purchaseWeight(food, base, cm, metodoId);
}

/**
 * Momentos de consumo de las comidas registradas entre `fromMs` (excluido) y `toMs` (incluido).
 * `soloConfirmado`: los días pasados sin confirmar no cuentan (si no se descuenta el plan solo).
 */
export function consumoMoments(
  history: DayLog[],
  fm: FoodMap,
  cm: ConversionMap,
  fromMs: number,
  toMs: number,
  soloConfirmado = false,
): ConsumoMoment[] {
  const out: ConsumoMoment[] = [];
  const fromDay = dateKey(new Date(fromMs - 86400000));
  const toDay = dateKey(new Date(toMs + 86400000));
  for (const day of history) {
    if (day.fecha < fromDay || day.fecha > toDay) continue;
    if (soloConfirmado && !day.confirmado) continue;
    const add = (t: number, foodId: string, base: number, metodoId?: string) => {
      if (t <= fromMs || t > toMs || base <= 0) return;
      const food = fm[foodId];
      if (!food) return;
      out.push({ t, foodId, cantidad: stockAmountFromBase(food, base, cm, metodoId) });
    };
    for (const m of dayMeals(day)) {
      const t = momentOf(day.fecha, BLOCK_HOUR[m.bloque]);
      for (const it of m.meal.items) add(t, it.foodId, PROFILE_IDS.reduce((s, p) => s + Math.max(0, it.cantidades[p] ?? 0), 0), it.metodoId);
    }
    for (const ex of day.extras ?? []) {
      add(momentOf(day.fecha, EXTRA_HOUR), ex.foodId, PROFILE_IDS.reduce((s, p) => s + Math.max(0, ex.cantidades[p] ?? 0), 0), ex.metodoId);
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Consumo previsto por alimento entre dos instantes (para la cesta: lo que se gasta antes de que llegue la compra). */
export function consumoTotal(moments: ConsumoMoment[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of moments) out[m.foodId] = (out[m.foodId] ?? 0) + m.cantidad;
  return out;
}

// ───────── estado de cada artículo ─────────

export interface ItemState {
  /** cantidad en la unidad del artículo (solo contados con dato) */
  cantidad?: number;
  nivel: StockLevel;
  /**
   * medido: alguien lo ha contado hace poco y no se ha gastado desde entonces;
   * estimado: calculado con compras y comidas; previsto: por la frecuencia de compra;
   * desconocido: nunca se ha contado ni comprado
   */
  fuente: 'medido' | 'estimado' | 'previsto' | 'desconocido';
  /** última vez que alguien lo contó o confirmó */
  revisado?: string;
  /** gastado por las comidas desde la última corrección */
  gastado?: number;
}

export function groupEvents(events: StockEvent[]): Record<string, StockEvent[]> {
  const by: Record<string, StockEvent[]> = {};
  for (const e of events) (by[e.item] ??= []).push(e);
  for (const k in by) by[k].sort((a, b) => a.at.localeCompare(b.at));
  return by;
}

export function itemState(
  item: StockItem,
  evs: StockEvent[] = [],
  consumo: ConsumoMoment[] = [],
  nowMs = Date.now(),
  desdeMs = 0,
): ItemState {
  const hoy = dateKey(new Date(nowMs));
  if (item.tipo === 'estado') {
    let nivel: StockLevel | undefined;
    let at: string | undefined;
    let revisado: string | undefined;
    for (const e of evs) {
      if (ms(e.at) > nowMs) continue;
      if (e.tipo === 'nivel' && e.nivel) nivel = e.nivel;
      else if (e.tipo === 'set') nivel = (e.valor ?? 0) > 0 ? 'ok' : 'agotado';
      else if (e.tipo === 'delta' && (e.valor ?? 0) > 0) nivel = 'ok';
      else continue;
      at = e.at;
      if (e.origen === 'revision' || e.origen === 'voz' || e.origen === 'manual') revisado = e.at;
    }
    if (!nivel) {
      const due = proxima(item);
      if (due && due <= hoy) return { nivel: 'poco', fuente: 'previsto' };
      return { nivel: 'ok', fuente: 'desconocido' };
    }
    // comprado y la frecuencia dice que ya toca
    if (nivel === 'ok') {
      const due = proxima(item);
      if (due && due <= hoy && (!at || at.slice(0, 10) < due)) return { nivel: 'poco', fuente: 'previsto', revisado };
    }
    return { nivel, fuente: 'estimado', revisado };
  }

  // contado: última cantidad fijada + compras/ajustes − consumo de las comidas
  let base = 0;
  let baseMs = desdeMs;
  let setMs = -Infinity;
  let known = false;
  let revisado: string | undefined;
  let start = 0;
  for (let i = evs.length - 1; i >= 0; i--) {
    const e = evs[i];
    if (ms(e.at) > nowMs) continue;
    if (e.tipo === 'set' || (e.tipo === 'nivel' && e.nivel === 'agotado')) {
      base = e.tipo === 'set' ? (e.valor ?? 0) : 0;
      setMs = ms(e.at);
      baseMs = Math.max(setMs, desdeMs);
      known = true;
      revisado = e.at;
      start = i + 1;
      break;
    }
  }
  let cantidad = base;
  let hasQty = known; // hay una cantidad (fijada o con compras), no solo "queda poco"
  let poco = false;
  let lastChange = baseMs;
  for (let i = start; i < evs.length; i++) {
    const e = evs[i];
    const t = ms(e.at);
    if (t > nowMs || t < setMs) continue;
    if (e.tipo === 'delta') {
      cantidad += e.valor ?? 0;
      known = true;
      hasQty = true;
      lastChange = t;
      if ((e.valor ?? 0) > 0) poco = false;
    } else if (e.tipo === 'nivel' && e.nivel === 'poco') {
      poco = true;
      known = true;
    } else if (e.tipo === 'nivel' && e.nivel === 'ok') {
      poco = false;
    }
  }
  let gastado = 0;
  if (item.foodId) {
    for (const c of consumo) if (c.foodId === item.foodId && c.t > baseMs && c.t <= nowMs) gastado += c.cantidad;
  }
  if (!known) return { nivel: 'ok', fuente: 'desconocido', gastado: gastado || undefined };
  if (!hasQty) return { nivel: poco ? 'poco' : 'ok', fuente: 'estimado', revisado };
  cantidad = Math.max(0, cantidad - gastado);
  const recent = revisado && nowMs - ms(revisado) < 2 * 86400000 && gastado === 0 && lastChange <= ms(revisado);
  const nivel: StockLevel = cantidad <= 1e-6 ? 'agotado' : poco || (item.minimo !== undefined && cantidad < item.minimo) ? 'poco' : 'ok';
  return { cantidad: r1(cantidad), nivel, fuente: recent ? 'medido' : 'estimado', revisado, gastado: r1(gastado) };
}

/** Estado de todos los artículos (con el consumo de las comidas hasta ahora). */
export function computeStock(d: AppData, fm: FoodMap, cm: ConversionMap, nowMs = Date.now()): Record<string, ItemState> {
  const desdeMs = d.stock.config.desde ? ms(d.stock.config.desde) : 0;
  const by = groupEvents(d.stock.events);
  // el consumo solo importa desde la primera corrección/compra de cada alimento
  let minMs = nowMs;
  for (const it of Object.values(d.stock.items)) if (it.foodId && by[it.id]?.length) minMs = Math.min(minMs, ms(by[it.id][0].at));
  const consumo = consumoMoments(d.history, fm, cm, Math.max(minMs, desdeMs) - 1, nowMs, !d.stock.config.autoPlan);
  const out: Record<string, ItemState> = {};
  for (const it of Object.values(d.stock.items)) out[it.id] = itemState(it, by[it.id], consumo, nowMs, desdeMs);
  return out;
}

/**
 * Cuánto de cada alimento seguirá habiendo cuando empiece la compra (`fromKey`):
 * stock actual − lo planificado entre ahora y ese día. Solo alimentos con stock conocido.
 */
export function stockCover(d: AppData, fm: FoodMap, cm: ConversionMap, states: Record<string, ItemState>, fromKey: string, nowMs = Date.now()): Record<string, number> {
  const startMs = momentOf(fromKey, 0);
  const until = startMs > nowMs ? consumoTotal(consumoMoments(d.history, fm, cm, nowMs, startMs - 1)) : {};
  const out: Record<string, number> = {};
  for (const it of Object.values(d.stock.items)) {
    const s = states[it.id];
    if (!it.foodId || !s || s.fuente === 'desconocido') continue;
    // básicos por estado (aceite, especias…): si hay, cubren lo que pida el plan
    if (it.tipo === 'estado') {
      if (s.nivel === 'ok') out[it.foodId] = 1e9;
      continue;
    }
    if (s.cantidad === undefined) continue;
    out[it.foodId] = Math.max(0, s.cantidad - (until[it.foodId] ?? 0));
  }
  return out;
}

// ───────── cantidades y textos ─────────

/** Producto de Mercadona de un artículo (los alimentos usan su vínculo) */
export function itemProduct(d: AppData, it: StockItem): MercaProduct | undefined {
  return it.product ?? (it.foodId ? d.mercadona.links[it.foodId]?.product : undefined);
}

/** Paso de los botones −/+ (un envase si se sabe) */
export function stepFor(it: StockItem, food?: Food, p?: MercaProduct): number {
  if (it.unidad === 'ud') return 1;
  if (p) {
    const s = productSize(p);
    if (s.unit !== 'ud' && s.size > 0 && s.size <= 3000) return s.size;
  }
  if (it.envase && it.envase <= 3000) return it.envase;
  if (food?.pesoUnidad) return food.pesoUnidad;
  return 100;
}

export function amountText(it: StockItem, cantidad: number, p?: MercaProduct): string {
  if (it.unidad === 'ud') return `${r1(cantidad).toLocaleString('es-ES')} ud`;
  const u = it.unidad;
  const main = cantidad >= 1000 ? `${(Math.round(cantidad / 100) / 10).toLocaleString('es-ES')} ${u === 'g' ? 'kg' : 'L'}` : `${Math.round(cantidad)} ${u}`;
  if (!p && it.envase && cantidad > 0) {
    const packs = cantidad / it.envase;
    return `${main} · ≈${(Math.round(packs * 10) / 10).toLocaleString('es-ES')} env.`;
  }
  if (p && cantidad > 0) {
    const s = productSize(p);
    if (s.unit !== 'ud' && s.size > 0 && p.sellingMethod === 0) {
      const packs = cantidad / s.size;
      return `${main} · ≈${(Math.round(packs * 10) / 10).toLocaleString('es-ES')} ${(p.formato ?? 'envase').toLowerCase()}${packs > 1.05 ? 's' : ''}`;
    }
  }
  return main;
}

/** Cantidad en la unidad del artículo a partir de unidades de venta de un producto. */
export function amountFromProduct(it: Pick<StockItem, 'unidad'>, p: MercaProduct, qty: number, food?: Food): number {
  if (p.sellingMethod !== 0) {
    const g = qty * 1000;
    return it.unidad === 'ud' ? g / (food?.pesoUnidad || 1000) : g;
  }
  const s = productSize(p);
  if (it.unidad === 'ud') {
    if (s.unit === 'ud') return qty * s.size;
    return food?.pesoUnidad ? (qty * s.size) / food.pesoUnidad : qty;
  }
  if (s.unit === 'ud') return food?.pesoUnidad ? qty * s.size * food.pesoUnidad : qty * 100;
  return qty * s.size; // g ≈ ml
}

// ───────── eventos ─────────

export function ev(item: string, tipo: StockEvent['tipo'], data: { valor?: number; nivel?: StockLevel }, origen: StockEvent['origen'], at = new Date().toISOString(), id = uid()): StockEvent {
  return { id, at, item, tipo, ...data, origen };
}

/** Recorta eventos que ya no influyen (anteriores a la última cantidad fijada y con más de 90 días). */
export function compactEvents(events: StockEvent[], nowMs = Date.now()): StockEvent[] {
  const by = groupEvents(events);
  const keep = new Set<string>();
  const limit = nowMs - 90 * 86400000;
  for (const list of Object.values(by)) {
    let lastSet = -1;
    list.forEach((e, i) => {
      if (e.tipo === 'set' || e.tipo === 'nivel') lastSet = i;
    });
    list.forEach((e, i) => {
      if (i >= lastSet || ms(e.at) >= limit) keep.add(e.id);
    });
  }
  return events.filter((e) => keep.has(e.id));
}

// ───────── pedidos de Mercadona → stock ─────────

const CASA_ZONES: [RegExp, StockZone][] = [
  [/congelad/i, 'congelador'],
  [/limpieza|hogar|detergente|celulosa|papel|lavavajillas|friegaplatos|suavizante|lej[ií]a|fregasuelos|multiusos|quitagrasas|estropajo|bolsas? de basura|servilleta|ambientador|bayeta|limpiacristales|wc/i, 'limpieza'],
  [/cabello|facial|corporal|higiene|parafarmacia|maquillaje|bebé|bebe|afeitado|dental|perfum|champ[uú]|gel de ba|desodorante|dent[ií]frico|pasta de dientes|cepillo|compresa|tamp[oó]n|colonia|maquinilla|crema|jab[oó]n de manos/i, 'bano'],
  [/agua|refresco|bodega|zumo|cerveza|vino|bebida|cola|fanta|t[eé] (rojo|helado)|t[oó]nica/i, 'bebidas'],
  [/fruta|verdura/i, 'fruta'],
  [/charcut|queso|huevo|leche|carne|pescado|marisco|yogur|postre|preparad|pizza|mantequilla/i, 'nevera'],
];

export function zoneFor(text: string): StockZone {
  for (const [re, z] of CASA_ZONES) if (re.test(text)) return z;
  return 'despensa';
}

/** Lo que se sigue "por estado" (sin contar unidades): limpieza, higiene, condimentos */
function tipoFor(zona: StockZone, text: string): StockItem['tipo'] {
  if (zona === 'limpieza' || zona === 'bano') return 'estado';
  if (/aceite|especia|sal |salsa|vinagre|azúcar|azucar|condiment|caf[eé]/i.test(text)) return 'estado';
  return 'contado';
}

const BRANDS = /\b(Hacendado|Deliplus|Bosque Verde|Compy|Solcare|Belle|Bebé|Hacendado)\b/gi;

export function nameFromProduct(nombre: string): string {
  const s = nombre.replace(BRANDS, ' ').replace(/\s+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface OrderApplication {
  items: StockItem[];
  events: StockEvent[];
  pedido: StockOrder;
}

/**
 * Suma un pedido entregado al stock. Ids de evento deterministas (pedido + producto):
 * si los dos móviles leen el mismo pedido, no se cuenta dos veces.
 */
export function applyOrder(d: AppData, fm: FoodMap, order: OrderSummary, lines: OrderLine[], nowIso = new Date().toISOString()): OrderApplication {
  const fecha = order.entrega.slice(0, 10);
  const at = order.entrega;
  const byProductFood: Record<string, string> = {};
  for (const l of Object.values(d.mercadona.links)) byProductFood[l.product.id] = l.foodId;
  const byProductItem: Record<string, StockItem> = {};
  for (const it of Object.values(d.stock.items)) if (it.product) byProductItem[it.product.id] = it;

  const items = new Map<string, StockItem>();
  const events: StockEvent[] = [];
  const resumen = { alimentos: 0, casa: 0, nuevos: 0, faltas: 0 };
  for (const l of lines) {
    if (l.preparada < l.pedida) resumen.faltas++;
    if (l.preparada <= 0) continue;
    const id = `o${order.id}_${l.productId}`;
    const foodId = byProductFood[l.productId];
    if (foodId && fm[foodId]) {
      const food = fm[foodId];
      const it = items.get(foodId) ?? d.stock.items[foodId] ?? foodItem(food, fecha);
      const p = d.mercadona.links[foodId].product;
      items.set(foodId, it);
      events.push(ev(foodId, 'delta', { valor: r1(amountFromProduct(it, p, l.preparada, food)) }, 'pedido', at, id));
      resumen.alimentos++;
      continue;
    }
    let it = byProductItem[l.productId];
    // sin vínculo por producto: por nombre (lo importado o dicho por voz aún no tiene producto)
    if (!it && l.product) {
      const m = matchByName(l.product.nombre, [...Object.values(d.stock.items), ...items.values()].filter((x) => !x.product || x.foodId));
      if (m?.foodId && fm[m.foodId]) {
        const food = fm[m.foodId];
        const fi = items.get(m.id) ?? m;
        items.set(fi.id, fi);
        events.push(ev(fi.id, 'delta', { valor: r1(amountFromProduct(fi, l.product, l.preparada, food)) }, 'pedido', at, id));
        resumen.alimentos++;
        continue;
      }
      if (m) it = { ...(items.get(m.id) ?? m), product: l.product, aliases: [...new Set([...(m.aliases ?? []), l.product.nombre])] };
    }
    if (!it) {
      if (!l.product) continue;
      const zona = zoneFor(`${l.categoria ?? ''} ${l.product.nombre}`);
      it = {
        ...casaItem(nameFromProduct(l.product.nombre), fecha),
        id: `m${l.productId}`,
        product: l.product,
        zona,
        tipo: tipoFor(zona, `${l.categoria ?? ''} ${l.product.nombre}`),
        qty: l.pedida || 1,
      };
      resumen.nuevos++;
    } else resumen.casa++;
    it = registrarCompra({ ...it, product: l.product ?? it.product }, fecha, l.pedida || it.qty);
    items.set(it.id, it);
    events.push(
      it.tipo === 'contado'
        ? ev(it.id, 'delta', { valor: r1(amountFromProduct(it, it.product!, l.preparada)) }, 'pedido', at, id)
        : ev(it.id, 'nivel', { nivel: 'ok' }, 'pedido', at, id),
    );
  }
  return {
    items: [...items.values()],
    events: events.map((e) => ({ ...e, pedido: order.id })),
    pedido: { id: order.id, entrega: order.entrega, total: order.total, productos: order.productos, aplicado: nowIso, resumen },
  };
}

/** Pedido entregado y aún no sumado al stock */
export function isDelivered(o: OrderSummary, nowMs = Date.now()): boolean {
  if (/cancel/i.test(o.estado) || o.status === 4) return false;
  if (/deliver|entregad|complet/i.test(o.estado) || o.status === 3) return true;
  // sin estado claro: la franja ya pasó hace más de 2 horas
  return ms(o.entrega) + 2 * 3600000 < nowMs && !/pending|pendiente/i.test(o.estado);
}

// ───────── revisión rápida ─────────

/** Artículos que conviene revisar: contados estimados que nadie ha contado en días (máx. `max`). */
export function reviewCandidates(d: AppData, states: Record<string, ItemState>, nowMs = Date.now(), max = 12): StockItem[] {
  const stale = 4 * 86400000;
  return Object.values(d.stock.items)
    .filter((it) => {
      const s = states[it.id];
      if (!s || s.fuente === 'desconocido') return false;
      if (it.tipo === 'estado') return s.fuente === 'previsto';
      return !s.revisado || nowMs - ms(s.revisado) > stale;
    })
    .sort((a, b) => (states[a.id].revisado ?? '').localeCompare(states[b.id].revisado ?? ''))
    .slice(0, max);
}

/** Caducan en los próximos `dias` (incluye lo ya caducado) */
export function caducanPronto(d: AppData, states: Record<string, ItemState>, hoy: string, dias = 3): StockItem[] {
  const lim = addDays(hoy, dias);
  return Object.values(d.stock.items)
    .filter((it) => it.caduca && it.caduca <= lim && states[it.id]?.nivel !== 'agotado')
    .sort((a, b) => a.caduca!.localeCompare(b.caduca!));
}

export const daysLeft = (fecha: string, hoy: string) => Math.round((parseDate(fecha).getTime() - parseDate(hoy).getTime()) / 86400000);

/** ¿Un artículo de casa (no de la dieta) va en la compra que cubre hasta `hasta`? */
export function otroEnCompra(it: StockItem, s: ItemState | undefined, hasta: string, hoy: string): boolean {
  if (it.foodId) return false;
  if (it.apuntado) return true;
  if (it.pospuesto && it.pospuesto > hoy) return false;
  if (enEstaCompra(it, hasta)) return true;
  return !!s && s.fuente !== 'desconocido' && s.nivel !== 'ok';
}

// ───────── reconocer productos por nombre (de Despensa) ─────────

const IGNORE = new Set('de del la el los las en con y a al sin para por hacendado deliplus bosque verde compy'.split(' '));
const norm = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ ]/g, ' ');
/** raíz sencilla para comparar singular y plural: huevos→huevo, limones→limon */
function stem(w: string): string {
  if (w.length <= 3) return w;
  if (/[lnrdjz]es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s')) return w.slice(0, -1);
  return w;
}
export const nameTokens = (t: string) => norm(t).split(/\s+/).filter((w) => w && !IGNORE.has(w)).map(stem);

/**
 * Artículo cuyo nombre (o alias) aparece entero en el nombre del producto:
 * "leche desnatada" en "Leche desnatada Hacendado". Prefiere el de más palabras y más juntas.
 * Uno de una sola palabra solo vale si el producto empieza por ella ("huevos" ≠ "Claras de huevo").
 */
export function matchByName(productName: string, items: StockItem[]): StockItem | undefined {
  const line = nameTokens(productName);
  let best: { it: StockItem; score: number } | undefined;
  for (const it of items) {
    for (const label of [it.nombre, ...(it.aliases ?? [])]) {
      const want = nameTokens(label.split(' (')[0]);
      if (!want.length || want.length > line.length) continue;
      const pos = want.map((w) => line.indexOf(w));
      if (pos.some((i) => i < 0)) continue;
      if (want.length === 1 && pos[0] !== 0) continue;
      const score = want.length * 10 - (Math.max(...pos) - Math.min(...pos) - (want.length - 1));
      if (!best || score > best.score) best = { it, score };
    }
  }
  return best?.it;
}
