/**
 * Lista de la compra de la casa: una sola lista con
 *  - lo que pide el plan de comidas (descontando lo que ya hay en la despensa),
 *  - lo de casa (limpieza, baño, bebidas…) que se acaba o toca por frecuencia,
 *  - y lo apuntado a mano o por voz (también alimentos fuera del plan).
 * Funciones puras — tests en src/lib/__tests__/compra.test.ts.
 */
import type { AppData, Food, StockEvent, StockItem, StockZone } from '../types';
import type { ConversionMap } from './conversions';
import type { FoodMap } from './nutrition';
import { datesBetween, plannedMeals, shoppingList, type ShoppingItem } from './planning';
import { ev, foodItem, otroEnCompra, preguntarReponer, reponerDe, stockCover, type ItemState } from './stock';
import { sectionFor, SECTIONS } from './mealInfo';
import { registrarCompra } from '../integrations/mercadona/habituales';

/** Pasillos de la tienda: los de comida y los de casa */
export const PASILLOS = [...SECTIONS.filter((s) => s !== 'Otros'), 'Bebidas', 'Limpieza y hogar', 'Baño e higiene', 'Otros'] as const;
export type Pasillo = (typeof PASILLOS)[number];

const ZONA_PASILLO: Partial<Record<StockZone, Pasillo>> = {
  congelador: 'Congelados',
  fruta: 'Fruta y verdura',
  despensa: 'Despensa',
  bebidas: 'Bebidas',
  limpieza: 'Limpieza y hogar',
  bano: 'Baño e higiene',
};

/** De dónde sale cada cosa de la lista */
export type Origen = 'plan' | 'apuntado' | 'acaba' | 'toca';

export const ORIGEN_TEXTO: Record<Origen, string> = {
  plan: 'para el plan',
  apuntado: 'apuntado',
  acaba: 'se acaba',
  toca: 'toca',
};

export interface Entrada {
  /** foodId (alimentos de la dieta) o id del artículo (cosas de casa) */
  key: string;
  nombre: string;
  pasillo: Pasillo;
  origen: Origen;
  /** cuánto comprar, en texto ("500 g", "6 huevos", "× 2"); vacío si no se sabe */
  cantidad: string;
  detalle?: string;
  foodId?: string;
  /** cuánto se compra en la unidad de la despensa (g/ml/ud), si se sabe */
  compra?: number;
}

export interface ListaCompra {
  /** lo que hay que comprar */
  entradas: Entrada[];
  /** lo que pide el plan pero ya está en casa */
  enCasa: Entrada[];
  /** cosas de casa que se han acabado y están en modo "preguntar" */
  preguntas: StockItem[];
  /** alimentos que se acaban y no salen en el plan: se sugieren, no entran solos */
  sugerencias: StockItem[];
}

const plural = (n: number, s: string) => `${n} ${s}${n === 1 ? '' : 's'}`;

function cantidadPlan(food: Food, it: ShoppingItem, falta: number): string {
  if (it.unit === 'unidad') return plural(falta, food.nombreUnidad ?? 'ud');
  return `${falta.toLocaleString('es-ES')} ${it.unit}`;
}

/** Cantidad de un artículo de casa según su producto de Mercadona (o "× n") */
export function cantidadCasa(it: StockItem): string {
  if (it.product && it.product.sellingMethod !== 0) return `${it.qty.toLocaleString('es-ES')} kg`;
  if (it.product || it.qty > 1) return `× ${it.qty}`;
  return '';
}

export function pasilloDe(it: Pick<StockItem, 'zona'>, food?: Food): Pasillo {
  if (food) return sectionFor(food, it.zona);
  return ZONA_PASILLO[it.zona ?? 'otros'] ?? 'Otros';
}

/** La lista de la compra que cubre de `from` a `to` (ambos incluidos). */
export function listaCompra(
  d: AppData,
  fm: FoodMap,
  cm: ConversionMap,
  states: Record<string, ItemState>,
  from: string,
  to: string,
  hoy: string,
  nowMs = Date.now(),
): ListaCompra {
  const entradas: Entrada[] = [];
  const enCasa: Entrada[] = [];
  const preguntas: StockItem[] = [];
  const sugerencias: StockItem[] = [];

  // 1) el plan, descontando la despensa
  const items = shoppingList(plannedMeals(d.history, datesBetween(from, to)), fm, cm);
  const cubierto = stockCover(d, fm, cm, states, from, nowMs);
  const enPlan = new Set<string>();
  for (const it of items) {
    const food = it.food;
    enPlan.add(food.id);
    const conocido = cubierto[food.id] !== undefined;
    const hay = Math.max(0, cubierto[food.id] ?? 0);
    const total = it.unit === 'unidad' ? (it.unidades ?? 0) : it.comprar;
    const falta = it.unit === 'unidad' ? Math.max(0, Math.ceil(total - hay - 1e-9)) : Math.max(0, Math.ceil((total - hay) / 5 - 1e-9) * 5);
    const marcadoEnCasa = d.pantry.includes(food.id);
    const zona = d.stock.items[food.id]?.zona;
    const detalle = [
      plural(it.comidas, 'comida'),
      hay > 0 && falta > 0 && hay < 1e8 ? `hay ≈${it.unit === 'unidad' ? Math.round(hay) : Math.round(hay) + ' ' + it.unit} en casa` : '',
      food.marca ?? '',
    ]
      .filter(Boolean)
      .join(' · ');
    const e: Entrada = {
      key: food.id,
      foodId: food.id,
      nombre: food.nombre.split(' (')[0],
      pasillo: pasilloDe({ zona }, food),
      origen: 'plan',
      cantidad: cantidadPlan(food, it, falta > 0 ? falta : total),
      compra: falta > 0 ? falta : total,
      detalle,
    };
    if ((conocido && falta === 0) || marcadoEnCasa) enCasa.push(e);
    else entradas.push(e);
  }

  // 2) artículos de la despensa
  for (const it of Object.values(d.stock.items)) {
    const s = states[it.id];
    if (it.foodId) {
      const food = fm[it.foodId];
      if (!food || entradas.some((e) => e.key === it.foodId)) continue;
      if (it.apuntado) {
        // apuntado a mano: entra aunque el plan lo tenga cubierto
        const i = enCasa.findIndex((e) => e.key === it.foodId);
        if (i >= 0) enCasa.splice(i, 1);
        entradas.push({ key: food.id, foodId: food.id, nombre: it.nombre, pasillo: pasilloDe(it, food), origen: 'apuntado', cantidad: '', detalle: food.marca });
        continue;
      }
      if (enPlan.has(it.foodId)) continue;
      const pospuesto = !!it.pospuesto && it.pospuesto > hoy;
      if (s && s.fuente !== 'desconocido' && s.nivel !== 'ok' && reponerDe(it, hoy) !== 'nunca' && !pospuesto) sugerencias.push(it);
      continue;
    }
    if (otroEnCompra(it, s, to, hoy)) {
      const acaba = !!s && s.fuente !== 'desconocido' && s.fuente !== 'previsto' && s.nivel !== 'ok';
      entradas.push({
        key: it.id,
        nombre: it.nombre,
        pasillo: pasilloDe(it),
        origen: it.apuntado ? 'apuntado' : acaba ? 'acaba' : 'toca',
        cantidad: cantidadCasa(it),
        detalle: it.product && it.product.nombre !== it.nombre ? it.product.nombre : undefined,
      });
    } else if (preguntarReponer(it, s, to, hoy)) preguntas.push(it);
  }

  const orden = (a: Entrada, b: Entrada) => PASILLOS.indexOf(a.pasillo) - PASILLOS.indexOf(b.pasillo) || a.nombre.localeCompare(b.nombre);
  entradas.sort(orden);
  enCasa.sort(orden);
  sugerencias.sort((a, b) => a.nombre.localeCompare(b.nombre));
  preguntas.sort((a, b) => a.nombre.localeCompare(b.nombre));
  return { entradas, enCasa, preguntas, sugerencias };
}

/** Agrupa por pasillo, en el orden de la tienda */
export function porPasillo(entradas: Entrada[]): { pasillo: Pasillo; entradas: Entrada[] }[] {
  return PASILLOS.map((p) => ({ pasillo: p, entradas: entradas.filter((e) => e.pasillo === p) })).filter((g) => g.entradas.length);
}

/** Texto para compartir (WhatsApp, notas…) */
export function listaTexto(entradas: Entrada[], titulo: string, marcados: string[] = []): string {
  const out = [titulo];
  for (const g of porPasillo(entradas)) {
    out.push('', `— ${g.pasillo} —`);
    for (const e of g.entradas) out.push(`${marcados.includes(e.key) ? '☑' : '☐'} ${e.nombre}${e.cantidad ? ` — ${e.cantidad}` : ''}`);
  }
  return out.join('\n');
}

/**
 * Lo marcado como comprado → despensa: los alimentos suman lo comprado (o "hay" si no se sabe cuánto)
 * y las cosas de casa apuntan la compra (aprenden la frecuencia) y quedan "hay".
 */
export function comprados(d: AppData, fm: FoodMap, entradas: Entrada[], hoy: string, at = new Date().toISOString()): { items: StockItem[]; events: StockEvent[] } {
  const items: StockItem[] = [];
  const events: StockEvent[] = [];
  for (const e of entradas) {
    if (e.foodId) {
      const food = fm[e.foodId];
      if (!food) continue;
      const prev = d.stock.items[food.id];
      const it: StockItem = prev ?? foodItem(food, hoy);
      items.push(registrarCompra(it, hoy, it.qty));
      events.push(e.compra && it.tipo === 'contado' ? ev(it.id, 'delta', { valor: e.compra }, 'compra', at) : ev(it.id, 'nivel', { nivel: 'ok' }, 'compra', at));
    } else {
      const it = d.stock.items[e.key];
      if (!it) continue;
      items.push(registrarCompra(it, hoy));
      events.push(it.tipo === 'contado' ? ev(it.id, 'delta', { valor: it.qty }, 'compra', at) : ev(it.id, 'nivel', { nivel: 'ok' }, 'compra', at));
    }
  }
  return { items, events };
}

/**
 * Alimentos apuntados a mano que no salen en el plan, como líneas de la cesta
 * (un envase de cada uno; luego se ajusta con −/+).
 */
export function apuntadosDieta(d: AppData, fm: FoodMap, excluir: Set<string>): ShoppingItem[] {
  const out: ShoppingItem[] = [];
  for (const it of Object.values(d.stock.items)) {
    if (!it.foodId || !it.apuntado || excluir.has(it.foodId)) continue;
    const food = fm[it.foodId];
    if (!food) continue;
    const unidad = food.unidadBase === 'unidad';
    out.push({ food, totalBase: 0, comprar: unidad ? 0 : 1, unit: unidad ? 'unidad' : food.unidadBase, unidades: unidad ? 1 : undefined, comidas: 0, kcal: 0 });
  }
  return out;
}
