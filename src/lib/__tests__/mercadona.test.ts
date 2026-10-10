import { describe, expect, it } from 'vitest';
import type { MercaLink, MercaProduct } from '../../types';
import { createSeedData } from '../../store/seed';
import { toFoodMap } from '../nutrition';
import { toConversionMap } from '../conversions';
import { plannedMeals, shoppingList, datesBetween } from '../planning';
import { favoriteToMeal } from '../favorites';
import * as DE from '../dayEdit';
import {
  basketText,
  basketTotal,
  bestMatch,
  buildBasket,
  cartLines,
  cliText,
  mergeCart,
  packsFor,
  queryFor,
} from '../../integrations/mercadona/basket';
import { MercadonaClient, MercaError, toMercaProduct, customerFromJwt } from '../../integrations/mercadona/client';
import { loadIntoCart } from '../../integrations/mercadona/service';
import { decodeLinkCode, encodeLinkCode } from '../../integrations/mercadona/session';
import type { HttpRequest, HttpResponse } from '../../integrations/mercadona/http';

const seed = createSeedData();
const fm = toFoodMap(seed.foods);
const cm = toConversionMap(seed.conversions);

// productos reales del almacén 4418 (datos de la búsqueda del 10/10/2026)
const raw = (id: string, name: string, price: string, size: number, fmt: string, extra: Record<string, unknown> = {}) => ({
  id,
  display_name: name,
  packaging: 'Paquete',
  price_instructions: {
    unit_price: price,
    unit_size: size,
    size_format: fmt,
    selling_method: 0,
    approx_size: false,
    min_bunch_amount: 1,
    increment_bunch_amount: 1,
    reference_price: '1',
    reference_format: fmt,
    ...extra,
  },
});
const P = {
  pollo: toMercaProduct(raw('2787', 'Filetes pechuga de pollo', '4.77', 0.53, 'kg', { approx_size: true })),
  arroz: toMercaProduct(raw('5044', 'Arroz redondo Hacendado', '1.25', 1, 'kg')),
  huevos: toMercaProduct(raw('31504', 'Huevos grandes L', '3.40', 12, 'ud')),
  gazpacho: toMercaProduct(raw('9000', 'Gazpacho tradicional Hacendado', '2.10', 1, 'l')),
  platanoGranel: toMercaProduct(raw('3819', 'Plátano de Canarias IGP', '2.20', 1, 'kg', { selling_method: 2, min_bunch_amount: 0.5, increment_bunch_amount: 0.25, reference_price: '2.20' })),
  papilla: toMercaProduct(raw('22186', 'Papilla plátano Hacendado +4 meses', '2.80', 0.52, 'kg')),
};
const link = (foodId: string, product: MercaProduct): MercaLink => ({ foodId, product, confirmado: true });

describe('de necesidad a paquetes', () => {
  it('redondea hacia arriba con un pequeño margen', () => {
    expect(packsFor(700, undefined, P.arroz).qty).toBe(1); // 700 g → 1 kg
    expect(packsFor(1010, undefined, P.arroz).qty).toBe(1); // 1.010 g ≈ 1 kg (margen 3 %)
    expect(packsFor(1100, undefined, P.arroz).qty).toBe(2);
    const pollo = packsFor(1050, undefined, P.pollo);
    expect(pollo.qty).toBe(2); // bandejas de 530 g
    expect(pollo.aviso).toMatch(/aproximado/);
  });
  it('unidades: 14 huevos → 2 docenas', () => {
    expect(packsFor(770, 14, P.huevos, fm.huevo).qty).toBe(2);
  });
  it('a granel: kg con mínimo e incremento', () => {
    const r = packsFor(620, undefined, P.platanoGranel);
    expect(r.qty).toBe(0.75);
  });
  it('líquidos en litros', () => {
    expect(packsFor(1800, undefined, P.gazpacho).qty).toBe(2);
  });
});

describe('cesta desde el plan', () => {
  // una semana con B1 Pollo-arroz 3 días
  let day = DE.setSharedSlot({ fecha: '2026-10-12', bloques: {} }, 'B', { meal: favoriteToMeal(seed.favorites.find((f) => f.id === 'dm_B1')!) });
  const days = [0, 1, 2].map((i) => ({ ...day, fecha: `2026-10-1${2 + i}` }));
  day = days[0];
  const items = shoppingList(plannedMeals(days, datesBetween('2026-10-12', '2026-10-14')), fm, cm);

  it('vinculados con precio, sin vincular aparte, en casa excluido', () => {
    const lines = buildBasket(items, { pollo_pechuga: link('pollo_pechuga', P.pollo), arroz: link('arroz', P.arroz) }, { pantry: ['arroz'] });
    const pollo = lines.find((l) => l.food.id === 'pollo_pechuga')!;
    // 3 días × (150+100 g cocinado) / 0,75 = 1.000 g crudo → 2 bandejas de 530 g
    expect(pollo.need).toBe(1000);
    expect(pollo.qty).toBe(2);
    expect(pollo.precio).toBeCloseTo(9.54, 2);
    expect(pollo.sobrante).toBe(60);
    expect(lines.find((l) => l.food.id === 'arroz')!.status).toBe('en_casa');
    expect(lines.find((l) => l.food.id === 'ratatouille')!.status).toBe('sin_vincular');
    expect(basketTotal(lines)).toBeCloseTo(9.54, 2); // solo lo que se compra
    expect(cliText(lines)).toBe('2787 2 # Filetes pechuga de pollo');
  });

  it('ajuste manual y quitar', () => {
    const lines = buildBasket(items, { pollo_pechuga: link('pollo_pechuga', P.pollo) }, { ajustes: { pollo_pechuga: 3 }, quitados: [] });
    expect(lines.find((l) => l.food.id === 'pollo_pechuga')!.qty).toBe(3);
    const q = buildBasket(items, { pollo_pechuga: link('pollo_pechuga', P.pollo) }, { quitados: ['pollo_pechuga'] });
    expect(cartLines(q)).toHaveLength(0);
  });

  it('quitar uno sin vincular y "otra tienda" (aunque esté vinculado)', () => {
    const q = buildBasket(items, {}, { quitados: ['ratatouille'] });
    expect(q.find((l) => l.food.id === 'ratatouille')!.status).toBe('quitado');
    const o = buildBasket(items, { pollo_pechuga: link('pollo_pechuga', P.pollo) }, { otraTienda: ['pollo_pechuga', 'ratatouille'] });
    expect(o.find((l) => l.food.id === 'pollo_pechuga')!.status).toBe('otra_tienda');
    expect(o.find((l) => l.food.id === 'ratatouille')!.status).toBe('otra_tienda');
    expect(cartLines(o)).toHaveLength(0);
    expect(basketTotal(o)).toBe(0);
    expect(basketText(o, 'T')).toContain('En otra tienda:');
  });
});

describe('elegir el producto adecuado', () => {
  it('prefiere el producto que encaja y descarta papillas', () => {
    expect(queryFor(fm.platano)).toBe('platano canarias'); // búsqueda afinada
    expect(queryFor({ ...fm.platano, id: 'otro', nombre: 'Kiwi (verde)' })).toBe('Kiwi');
    expect(bestMatch(fm.platano, [P.papilla, P.platanoGranel])!.id).toBe('3819');
    expect(bestMatch(fm.arroz, [P.pollo, P.arroz])!.id).toBe('5044');
    // sin un producto claro, no propone nada (se busca a mano)
    expect(bestMatch(fm.proteina_whey, [P.papilla, P.gazpacho])).toBeUndefined();
  });
});

describe('carrito', () => {
  it('sumar conserva lo que había y fija nuestras cantidades', () => {
    const cur = [
      { productId: 'x', quantity: 1 },
      { productId: '2787', quantity: 5 },
    ];
    const m = mergeCart(cur, [{ productId: '2787', quantity: 2 }, { productId: '5044', quantity: 1 }], 'sumar');
    expect(m).toEqual([
      { productId: 'x', quantity: 1 },
      { productId: '2787', quantity: 2 },
      { productId: '5044', quantity: 1 },
    ]);
    expect(mergeCart(cur, [{ productId: '5044', quantity: 1 }], 'reemplazar')).toEqual([{ productId: '5044', quantity: 1 }]);
  });
});

// ───────── servidor de Mercadona simulado ─────────
const jwt = (uuid: string) => `x.${btoa(JSON.stringify({ customer_uuid: uuid })).replace(/=+$/, '')}.y`;

function fakeMercadona() {
  const state = {
    cart: { id: 'cart-1', lines: [{ quantity: 1, product_id: '777', product: { id: '777', display_name: 'Leche', price_instructions: { unit_price: '0.95' } } }] } as Record<string, unknown>,
    validAccess: jwt('cust-1'),
    refresh: 'R1',
    puts: [] as unknown[],
    calls: [] as string[],
  };
  const transport = async (req: HttpRequest): Promise<HttpResponse> => {
    state.calls.push(`${req.method} ${req.url.replace('https://tienda.mercadona.es', '')}`);
    if (req.url.endsWith('/api/auth/tokens/')) {
      const b = req.body as { refresh_token: string };
      if (b.refresh_token !== state.refresh) return { status: 401, headers: {}, data: { detail: 'token_not_valid' } };
      state.refresh = 'R2'; // rota
      state.validAccess = jwt('cust-1') + 'n';
      return { status: 200, headers: {}, data: { access_token: state.validAccess, refresh_token: 'R2' } };
    }
    if (req.url.includes('/api/customers/cust-1/cart/')) {
      if (req.headers?.authorization !== `Bearer ${state.validAccess}`) return { status: 401, headers: {}, data: {} };
      if (req.method === 'GET') return { status: 200, headers: {}, data: { ...state.cart, summary: { total: '0.95' } } };
      state.puts.push(req.body);
      state.cart = { ...(req.body as object) };
      return { status: 200, headers: {}, data: state.cart };
    }
    if (req.url.includes('algolia.net')) {
      return { status: 200, headers: {}, data: { hits: [raw('5044', 'Arroz redondo Hacendado', '1.25', 1, 'kg')] } };
    }
    return { status: 404, headers: {}, data: {} };
  };
  return { state, transport };
}

describe('cliente con servidor simulado', () => {
  it('busca y convierte productos', async () => {
    const { transport } = fakeMercadona();
    const c = new MercadonaClient({ config: { wh: '4418' }, transport });
    const r = await c.search('arroz');
    expect(r[0].product).toMatchObject({ id: '5044', unitPrice: 1.25, unitSize: 1, sizeFormat: 'kg' });
  });

  it('con token caducado renueva solo, guarda el token nuevo y carga el carrito sin tocar lo demás', async () => {
    const { state, transport } = fakeMercadona();
    let saved: unknown;
    const c = new MercadonaClient({
      config: { wh: '4418' },
      transport,
      session: { refreshToken: 'R1', accessToken: 'caducado', customerId: 'cust-1', vinculado: '' },
      onSessionChange: (s) => (saved = s),
      sleep: async () => undefined,
    });
    const lines = buildBasket(
      [{ food: fm.arroz, totalBase: 700, comprar: 700, unit: 'g', comidas: 2, kcal: 0 }],
      { arroz: link('arroz', P.arroz) },
    );
    const res = await loadIntoCart(c, lines, 'sumar', 50);
    expect(res.cargados).toBe(1);
    expect((saved as { refreshToken: string }).refreshToken).toBe('R2');
    expect(state.puts[0]).toEqual({
      id: 'cart-1',
      lines: [
        { quantity: 1, product_id: '777', sources: [] },
        { quantity: 1, product_id: '5044', sources: [] },
      ],
    });
  });

  it('no escribe nada si supera el tope', async () => {
    const { state, transport } = fakeMercadona();
    const c = new MercadonaClient({ config: { wh: '4418' }, transport, session: { refreshToken: 'R1', customerId: 'cust-1', vinculado: '' } });
    const lines = buildBasket(
      [{ food: fm.arroz, totalBase: 9000, comprar: 9000, unit: 'g', comidas: 2, kcal: 0 }],
      { arroz: link('arroz', P.arroz) },
    );
    await expect(loadIntoCart(c, lines, 'sumar', 5)).rejects.toMatchObject({ code: 'tope' });
    expect(state.puts).toHaveLength(0);
  });

  it('si la sesión ya no vale, pide volver a vincular', async () => {
    const { transport } = fakeMercadona();
    const c = new MercadonaClient({ config: {}, transport, session: { refreshToken: 'OTRO', vinculado: '' } });
    await expect(c.refresh()).rejects.toBeInstanceOf(MercaError);
    await expect(c.refresh()).rejects.toMatchObject({ code: 'sesion_caducada' });
  });

  it('formato inesperado → cambio_api (para el diagnóstico)', () => {
    expect(() => toMercaProduct({ foo: 1 })).toThrow(MercaError);
  });
});

describe('código de vinculación', () => {
  it('ida y vuelta, y token suelto', () => {
    const code = encodeLinkCode({ refreshToken: 'abc.def-123_456789012345', customerId: 'cust-1' });
    expect(code.startsWith('MERCA1:')).toBe(true);
    expect(decodeLinkCode(code)).toMatchObject({ refreshToken: 'abc.def-123_456789012345', customerId: 'cust-1' });
    expect(decodeLinkCode('abcdefghijklmnopqrstuvwxyz0123')?.refreshToken).toBe('abcdefghijklmnopqrstuvwxyz0123');
    expect(decodeLinkCode('hola')).toBeNull();
    expect(customerFromJwt(jwt('uuid-9'))).toBe('uuid-9');
  });
});
