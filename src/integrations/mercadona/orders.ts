/**
 * Pedidos de Mercadona → despensa.
 * Lee el historial de pedidos; los entregados (y aún no sumados) se leen línea a línea
 * (lo realmente preparado: con faltas y sustituciones) y se suman al stock.
 * Si antes se marcó la compra como "recibida" a mano, se sustituye por la del pedido real.
 */
import type { AppData, StockOrder } from '../../types';
import type { FoodMap } from '../../lib/nutrition';
import { applyOrder, isDelivered } from '../../lib/stock';
import type { StockChange } from '../../store/AppStore';
import type { MercadonaClient, OrderLine, OrderSummary } from './client';

export interface OrdersResult {
  change: StockChange;
  /** pedidos sumados ahora */
  nuevos: StockOrder[];
}

const DAY = 86400000;

export async function syncOrders(client: MercadonaClient, d: AppData, fm: FoodMap, nowMs = Date.now()): Promise<OrdersResult> {
  const known = d.stock.pedidos;
  const first = !Object.values(known).some((p) => !p.manual);
  // la primera vez se lee algo más de historial (para el gasto)
  const pages = first ? 3 : 1;
  const all: OrderSummary[] = [];
  for (let p = 1; p <= pages; p++) {
    const r = await client.orders(p);
    all.push(...r.orders);
    if (!r.next) break;
  }
  const desdeMs = d.stock.config.desde ? new Date(d.stock.config.desde).getTime() : nowMs;
  const change: StockChange = { items: [], events: [], pedidos: [], removeEvents: [] };
  const nuevos: StockOrder[] = [];
  const manuales = Object.values(known).filter((p) => p.manual && p.aplicado);

  for (const o of all.sort((a, b) => a.entrega.localeCompare(b.entrega))) {
    const prev = known[o.id];
    if (prev?.aplicado) continue;
    const entregaMs = new Date(o.entrega).getTime();
    if (!isDelivered(o, nowMs) || entregaMs < desdeMs) {
      // solo para el historial de gasto
      if (!prev && !/cancel/i.test(o.estado)) change.pedidos!.push({ id: o.id, entrega: o.entrega, total: o.total, productos: o.productos });
      continue;
    }
    let lines: OrderLine[];
    try {
      lines = await client.orderLines(o.id);
    } catch {
      continue; // se reintenta la próxima vez
    }
    if (!lines.length) continue;
    const app = applyOrder({ ...d, stock: { ...d.stock, items: { ...d.stock.items, ...Object.fromEntries(change.items!.map((i) => [i.id, i])) } } }, fm, o, lines);
    change.items!.push(...app.items);
    change.events!.push(...app.events);
    change.pedidos!.push(app.pedido);
    nuevos.push(app.pedido);
    // una compra marcada "recibida" a mano en esos días se sustituye por el pedido real
    for (const m of manuales) {
      if (Math.abs(new Date(m.entrega).getTime() - entregaMs) < 3 * DAY) {
        change.removeEvents!.push(...d.stock.events.filter((e) => e.pedido === m.id).map((e) => e.id));
        change.pedidos!.push({ ...m, aplicado: undefined, total: undefined });
      }
    }
  }
  change.config = { pedidosVisto: new Date(nowMs).toISOString() };
  return { change, nuevos };
}

/** "Ya ha llegado la compra" a mano: suma lo cargado en el carrito (si luego llega el pedido real, lo sustituye). */
export function manualReceipt(d: AppData, fm: FoodMap, lines: { productId: string; quantity: number; product?: OrderLine['product'] }[], nowIso = new Date().toISOString()): StockChange {
  const order: OrderSummary = { id: `manual-${nowIso.slice(0, 16)}`, entrega: nowIso, estado: 'delivered', status: 3, productos: lines.length };
  const app = applyOrder(
    d,
    fm,
    order,
    lines.map((l) => ({ productId: l.productId, pedida: l.quantity, preparada: l.quantity, product: l.product })),
    nowIso,
  );
  return { items: app.items, events: app.events, pedidos: [{ ...app.pedido, manual: true }] };
}
