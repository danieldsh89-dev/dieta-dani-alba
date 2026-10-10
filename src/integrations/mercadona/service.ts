/**
 * Operaciones de alto nivel de la integración con Mercadona (las que usa la interfaz).
 */
import type { MercaConfig } from '../../types';
import { MercadonaClient, MercaError, ERROR_HELP, type Cart } from './client';
import { cartLines, combineLines, estimateCart, mergeCart, type BasketLine } from './basket';
import type { CartLine } from './client';
import { loadSession, saveSession } from './session';
import { isNative, type Transport } from './http';

/** Cliente con la sesión de este móvil; guarda solo el token renovado. */
export function makeClient(config: MercaConfig, transport?: Transport): MercadonaClient {
  return new MercadonaClient({ config, transport, session: loadSession(), onSessionChange: saveSession });
}

export interface LoadResult {
  cart: Cart;
  /** productos de la cesta cargados */
  cargados: number;
  /** total estimado antes de cargar */
  estimado: number;
}

/**
 * Carga la cesta en el carrito de la cuenta.
 * - 'sumar': fija la cantidad de NUESTROS productos y deja el resto de lo que ya hubiera.
 * - 'reemplazar': el carrito queda solo con la cesta.
 * Comprueba el tope ANTES de escribir. Nunca confirma el pedido.
 */
export async function loadIntoCart(
  client: MercadonaClient,
  lines: BasketLine[],
  mode: 'sumar' | 'reemplazar',
  maxEur?: number,
  /** otros productos (habituales) que no salen del plan */
  otros: CartLine[] = [],
): Promise<LoadResult> {
  const desired = combineLines(cartLines(lines), otros);
  if (!desired.length) throw new MercaError('desconocido', 'No hay productos en la cesta');
  const cart = await client.getCart();
  const merged = mergeCart(cart.lines, desired, mode);
  const known = Object.fromEntries(desired.map((d) => [d.productId, d.unitPrice ?? 0]));
  const estimado = estimateCart(merged, known);
  if (maxEur && estimado > maxEur) {
    throw new MercaError('tope', `${ERROR_HELP.tope} (≈${estimado.toFixed(2)} € > ${maxEur} €)`);
  }
  const after = await client.putCart(cart, merged);
  return { cart: after, cargados: desired.length, estimado };
}

export interface DiagStep {
  paso: string;
  ok: boolean | null; // null = no aplica / saltado
  detalle: string;
}

/** Prueba cada pieza sin modificar nada (no escribe en el carrito). */
export async function diagnose(config: MercaConfig, transport?: Transport): Promise<DiagStep[]> {
  const c = makeClient(config, transport);
  const steps: DiagStep[] = [];
  const run = async (paso: string, fn: () => Promise<string>, skip?: string) => {
    if (skip) return steps.push({ paso, ok: null, detalle: skip });
    try {
      steps.push({ paso, ok: true, detalle: await fn() });
    } catch (e) {
      const me = e instanceof MercaError ? e : new MercaError('desconocido', (e as Error).message);
      steps.push({ paso, ok: false, detalle: `${me.message}${me.status ? ` (HTTP ${me.status})` : ''}${me.detail ? ` · ${me.detail.slice(0, 120)}` : ''}` });
    }
  };
  const native = isNative();
  await run('Buscador de productos', async () => {
    const r = await c.search('arroz hacendado', 3);
    if (!r.length) throw new MercaError('cambio_api', 'La búsqueda no devuelve productos');
    return `${r.length} resultados en el almacén ${c.wh} (p. ej. ${r[0].product.nombre} · ${r[0].product.unitPrice.toFixed(2)} €)`;
  });
  await run(
    'Ficha de producto (precio actual)',
    async () => {
      const r = await c.search('leche semidesnatada hacendado', 1);
      if (!r[0]) throw new MercaError('cambio_api', 'Sin producto de prueba');
      const p = await c.product(r[0].product.id);
      return `${p.nombre}: ${p.unitPrice.toFixed(2)} €`;
    },
    native ? undefined : 'Solo en la app instalada (APK)',
  );
  await run(
    'Código postal → almacén',
    async () => {
      const wh = await c.resolveWarehouse(config.cp || '35215');
      return `CP ${config.cp} → almacén ${wh}${config.wh && wh !== config.wh ? ` (configurado: ${config.wh}, actualízalo)` : ''}`;
    },
    native ? undefined : 'Solo en la app instalada (APK)',
  );
  const hasSession = !!c.session?.refreshToken;
  await run(
    'Renovar sesión de la cuenta',
    async () => {
      const s = await c.refresh();
      return `Sesión renovada (cliente ${s.customerId?.slice(0, 8) ?? '?'}…)`;
    },
    !native ? 'Solo en la app instalada (APK)' : !hasSession ? 'Cuenta sin vincular' : undefined,
  );
  await run(
    'Leer el carrito (sin modificarlo)',
    async () => {
      const cart = await c.getCart();
      return `${cart.lines.length} productos en el carrito${cart.total !== undefined ? ` · ${cart.total.toFixed(2)} €` : ''}`;
    },
    !native ? 'Solo en la app instalada (APK)' : !hasSession ? 'Cuenta sin vincular' : undefined,
  );
  return steps;
}
