/**
 * Productos habituales de Mercadona que no salen del plan (limpieza, higiene, casa…).
 * La frecuencia se puede fijar a mano y/o aprender de las compras: la mediana de los
 * intervalos entre compras recientes. Funciones puras — tests en src/lib/__tests__/mercadona.test.ts.
 */
import type { MercaHabitual, MercaProduct } from '../../types';
import { addDays } from '../../lib/planning';
import { linePrice } from './basket';
export { combineLines } from './basket';
import type { CartLine } from './client';

/** compras que se recuerdan por producto */
const MAX_COMPRAS = 12;
/** a partir de cuántos intervalos se fía de lo aprendido */
const MIN_INTERVALOS = 2;

const dayNum = (k: string) => Math.round(Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10)) / 86400000);
export const daysBetween = (a: string, b: string) => dayNum(b) - dayNum(a);

export function nuevoHabitual(product: MercaProduct, hoy: string): MercaHabitual {
  return {
    id: product.id,
    product,
    qty: product.sellingMethod !== 0 ? product.minBunch || 1 : 1,
    aprender: true,
    compras: [],
    apuntado: true,
    creado: hoy,
  };
}

/** Intervalo aprendido: mediana de los intervalos entre las últimas compras. */
export function intervaloAprendido(compras: string[]): { dias: number; n: number } | undefined {
  const fechas = [...new Set(compras)].sort().slice(-7);
  const gaps: number[] = [];
  for (let i = 1; i < fechas.length; i++) {
    const g = daysBetween(fechas[i - 1], fechas[i]);
    if (g > 0) gaps.push(g);
  }
  if (gaps.length < MIN_INTERVALOS) return undefined;
  const s = [...gaps].sort((a, b) => a - b);
  const mid = s.length / 2;
  const med = s.length % 2 ? s[Math.floor(mid)] : (s[mid - 1] + s[mid]) / 2;
  return { dias: Math.max(3, Math.round(med)), n: gaps.length };
}

/** Frecuencia que se usa: la aprendida (si aprende y hay datos) o la fijada a mano. */
export function frecuencia(h: MercaHabitual): { dias?: number; aprendida: boolean; n: number } {
  const a = h.aprender ? intervaloAprendido(h.compras) : undefined;
  if (a) return { dias: a.dias, aprendida: true, n: a.n };
  return { dias: h.cadaDias, aprendida: false, n: 0 };
}

/** Próxima fecha en que toca comprarlo (sin frecuencia o sin compras: no se sabe). */
export function proxima(h: MercaHabitual): string | undefined {
  const dias = frecuencia(h).dias;
  const last = [...h.compras].sort().pop();
  if (!dias || !last) return undefined;
  const due = addDays(last, dias);
  return h.pospuesto && h.pospuesto > due ? h.pospuesto : due;
}

export type EstadoHabitual = 'apuntado' | 'toca' | 'pronto' | 'no';

/** Para una compra que cubre hasta `hasta`: si va en esta compra o cuándo tocará. */
export function estado(h: MercaHabitual, hasta: string): EstadoHabitual {
  if (h.apuntado) return 'apuntado';
  const due = proxima(h);
  if (!due) return 'no';
  if (due <= hasta) return 'toca';
  if (due <= addDays(hasta, 7)) return 'pronto';
  return 'no';
}

export const enEstaCompra = (h: MercaHabitual, hasta: string) => {
  const e = estado(h, hasta);
  return e === 'apuntado' || e === 'toca';
};

/** Tras cargarlo en el carrito (o marcar "lo compré"): aprende de la fecha y la cantidad. */
export function registrarCompra(h: MercaHabitual, fecha: string, qty = h.qty): MercaHabitual {
  const compras = [...new Set([...h.compras, fecha])].sort().slice(-MAX_COMPRAS);
  return { ...h, compras, qty, apuntado: false, pospuesto: undefined };
}

/** Quitar de esta compra algo que tocaba: no vuelve a salir hasta después de `hasta`. */
export function posponer(h: MercaHabitual, hasta: string): MercaHabitual {
  return { ...h, apuntado: false, pospuesto: addDays(hasta, 1) };
}

/** Volver a ponerlo en esta compra. */
export function apuntar(h: MercaHabitual): MercaHabitual {
  return { ...h, apuntado: true, pospuesto: undefined };
}

export function precioHabitual(h: MercaHabitual, qty = h.qty): number {
  return linePrice(h.product, qty);
}

/** Gasto mensual aproximado según la frecuencia (sin frecuencia: no se estima). */
export function gastoMes(h: MercaHabitual): number | undefined {
  const dias = frecuencia(h).dias;
  if (!dias) return undefined;
  return Math.round(((precioHabitual(h) * 30) / dias) * 100) / 100;
}

export function habitualCartLine(h: MercaHabitual): CartLine {
  const bulk = h.product.sellingMethod !== 0;
  return {
    productId: h.product.id,
    quantity: h.qty,
    nombre: h.product.nombre,
    unitPrice: bulk ? (h.product.refPrice ?? h.product.unitPrice) : h.product.unitPrice,
  };
}

export function frecuenciaText(h: MercaHabitual): string {
  const f = frecuencia(h);
  if (!f.dias) return h.aprender ? 'aprendiendo la frecuencia' : 'solo cuando lo apuntes';
  const d = f.dias % 7 === 0 && f.dias >= 14 ? `${f.dias / 7} semanas` : f.dias === 7 ? 'semana' : `${f.dias} días`;
  return `cada ${f.aprendida ? '~' : ''}${d}${f.aprendida ? ` (aprendido de ${f.n + 1} compras)` : ''}`;
}
