import { describe, expect, it } from 'vitest';
import type { AppData, DayLog, MercaProduct } from '../../types';
import { createSeedData } from '../../store/seed';
import { toFoodMap } from '../nutrition';
import { toConversionMap } from '../conversions';
import * as S from '../stock';
import { applyVoz, parseVoz, parseFecha, vozCatalog } from '../voz';

const seed = createSeedData();
const fm = toFoodMap(seed.foods);
const cm = toConversionMap(seed.conversions);
const at = (fecha: string, h: number) => new Date(S.momentOf(fecha, h)).toISOString();

const prod = (over: Partial<MercaProduct> = {}): MercaProduct => ({
  id: '1', nombre: 'Producto', unitSize: 1, sizeFormat: 'ud', unitPrice: 1, approx: false, sellingMethod: 0, minBunch: 1, incBunch: 1, actualizado: '2026-10-01', ...over,
});
const POLLO = prod({ id: '2787', nombre: 'Filetes pechuga de pollo', unitSize: 0.53, sizeFormat: 'kg', unitPrice: 4.77, formato: 'Bandeja' });
const HUEVOS = prod({ id: '30167', nombre: 'Huevos grandes L', unitSize: 12, sizeFormat: 'ud', unitPrice: 2.6, formato: 'Caja' });
const LAVAVAJILLAS = prod({ id: '9001', nombre: 'Lavavajillas Ultra Bosque Verde', unitSize: 1.3, sizeFormat: 'l', unitPrice: 1.8 });

function dayWith(fecha: string, items: [string, number][], bloque: 'A' | 'B' | 'C' = 'B'): DayLog {
  return {
    fecha,
    bloques: {
      [bloque]: { meal: { id: 'm' + fecha, nombre: 'Comida', bloque, origen: 'manual', items: items.map(([foodId, g]) => ({ foodId, cantidades: { dani: g, alba: 0 } })) } },
    },
  };
}

function data(over: Partial<AppData['stock']> = {}, history: DayLog[] = []): AppData {
  const d = createSeedData();
  d.history = history;
  d.mercadona.links = {
    pollo_pechuga: { foodId: 'pollo_pechuga', product: POLLO, confirmado: true },
    huevo: { foodId: 'huevo', product: HUEVOS, confirmado: true },
  };
  d.stock = { ...d.stock, ...over };
  return d;
}

describe('stock: lo que hay se gasta con las comidas', () => {
  it('cantidad fijada − comidas registradas después', () => {
    const hist = [dayWith('2026-10-10', [['pollo_pechuga', 200]]), dayWith('2026-10-11', [['pollo_pechuga', 150]], 'C')];
    const d = data(
      {
        items: { pollo_pechuga: S.foodItem(fm.pollo_pechuga, '2026-10-10') },
        events: [S.ev('pollo_pechuga', 'set', { valor: 1000 }, 'revision', at('2026-10-10', 10))],
      },
      hist,
    );
    // el 10 a las 10:00 había 1 kg; comida del 10 (14:00) y cena del 11 (21:00)
    const st = S.computeStock(d, fm, cm, S.momentOf('2026-10-11', 22));
    expect(st.pollo_pechuga.cantidad).toBe(650);
    expect(st.pollo_pechuga.gastado).toBe(350);
    expect(st.pollo_pechuga.fuente).toBe('estimado');
    // antes de la cena del 11 solo se ha gastado la comida del 10
    expect(S.computeStock(d, fm, cm, S.momentOf('2026-10-11', 20)).pollo_pechuga.cantidad).toBe(800);
  });

  it('una corrección posterior manda; huevos por unidades', () => {
    const hist = [dayWith('2026-10-10', [['huevo', 110]], 'A')]; // 2 huevos de 55 g
    const d = data(
      {
        items: { huevo: S.foodItem(fm.huevo, '2026-10-09') },
        events: [S.ev('huevo', 'set', { valor: 12 }, 'revision', at('2026-10-09', 20)), S.ev('huevo', 'set', { valor: 4 }, 'voz', at('2026-10-10', 12))],
      },
      hist,
    );
    const st = S.computeStock(d, fm, cm, S.momentOf('2026-10-10', 13));
    expect(st.huevo.cantidad).toBe(4); // el desayuno fue antes de la corrección
    expect(st.huevo.fuente).toBe('medido');
  });

  it('sin confirmar no descuenta si autoPlan está desactivado', () => {
    const hist = [dayWith('2026-10-10', [['pollo_pechuga', 200]])];
    const d = data({ items: { pollo_pechuga: S.foodItem(fm.pollo_pechuga, 'x') }, events: [S.ev('pollo_pechuga', 'set', { valor: 500 }, 'revision', at('2026-10-10', 8))] }, hist);
    d.stock.config.autoPlan = false;
    expect(S.computeStock(d, fm, cm, S.momentOf('2026-10-10', 20)).pollo_pechuga.cantidad).toBe(500);
    d.history[0].confirmado = true;
    expect(S.computeStock(d, fm, cm, S.momentOf('2026-10-10', 20)).pollo_pechuga.cantidad).toBe(300);
  });

  it('lo que habrá cuando empiece la compra (cubre parte de la cesta)', () => {
    const hist = [dayWith('2026-10-11', [['pollo_pechuga', 300]]), dayWith('2026-10-13', [['pollo_pechuga', 300]])];
    const d = data({ items: { pollo_pechuga: S.foodItem(fm.pollo_pechuga, 'x') }, events: [S.ev('pollo_pechuga', 'set', { valor: 800 }, 'revision', at('2026-10-10', 20))] }, hist);
    const now = S.momentOf('2026-10-10', 21);
    const st = S.computeStock(d, fm, cm, now);
    // compra desde el 13: antes se gasta la comida del 11 → quedan 500 g para cubrir
    expect(S.stockCover(d, fm, cm, st, '2026-10-13', now).pollo_pechuga).toBe(500);
  });
});

describe('stock: artículos de casa por estado y frecuencia', () => {
  it('nivel por eventos; la frecuencia lo marca "previsto" cuando toca', () => {
    const it0 = { ...S.casaItem('Lavavajillas', '2026-09-01'), id: 'lav', product: LAVAVAJILLAS, cadaDias: 21, compras: ['2026-09-15'] };
    const d = data({ items: { lav: it0 }, events: [S.ev('lav', 'nivel', { nivel: 'ok' }, 'pedido', at('2026-09-15', 12))] });
    expect(S.computeStock(d, fm, cm, S.momentOf('2026-09-30', 12)).lav).toMatchObject({ nivel: 'ok', fuente: 'estimado' });
    expect(S.computeStock(d, fm, cm, S.momentOf('2026-10-07', 12)).lav).toMatchObject({ nivel: 'poco', fuente: 'previsto' });
  });
});

describe('pedidos de Mercadona → stock', () => {
  const order = { id: '555', entrega: '2026-10-12T15:00:00Z', estado: 'delivered', status: 3, total: 80, productos: 3 };
  const lines = [
    { productId: '2787', pedida: 2, preparada: 2, product: POLLO },
    { productId: '30167', pedida: 1, preparada: 0, product: HUEVOS }, // falta
    { productId: '9001', pedida: 1, preparada: 1, product: LAVAVAJILLAS, categoria: 'Limpieza y hogar' },
  ];

  it('suma alimentos en su unidad, crea lo nuevo y cuenta faltas', () => {
    const d = data();
    const r = S.applyOrder(d, fm, order, lines, '2026-10-12T18:00:00Z');
    const pollo = r.events.find((e) => e.item === 'pollo_pechuga')!;
    expect(pollo).toMatchObject({ tipo: 'delta', valor: 1060, id: 'o555_2787', pedido: '555' });
    expect(r.events.some((e) => e.item === 'huevo')).toBe(false);
    const lav = r.items.find((i) => i.product?.id === '9001')!;
    expect(lav).toMatchObject({ zona: 'limpieza', tipo: 'estado', compras: ['2026-10-12'] });
    expect(r.pedido.resumen).toEqual({ alimentos: 1, casa: 0, nuevos: 1, faltas: 1 });
  });

  it('ids deterministas: leerlo desde los dos móviles no duplica', () => {
    const a = S.applyOrder(data(), fm, order, lines);
    const b = S.applyOrder(data(), fm, order, lines);
    expect(a.events.map((e) => e.id)).toEqual(b.events.map((e) => e.id));
  });

  it('entregado / cancelado', () => {
    expect(S.isDelivered({ ...order, estado: 'cancelled', status: 4 })).toBe(false);
    expect(S.isDelivered(order)).toBe(true);
    expect(S.isDelivered({ ...order, estado: 'confirmed', status: 2, entrega: new Date(Date.now() + 86400000).toISOString() })).toBe(false);
  });
});

describe('voz', () => {
  const d = data({
    items: {
      lav: { ...S.casaItem('Lavavajillas', 'x'), id: 'lav', zona: 'limpieza' },
      sal: { ...S.casaItem('Sal', 'x'), id: 'sal' },
    },
  });
  const cat = vozCatalog(d, seed.foods);
  const hoy = '2026-10-12'; // lunes

  it('varias cosas en una frase', () => {
    const r = parseVoz('gasté 2 huevos y se acabó la sal, quedan 3 bandejas de pechuga de pollo', cat, hoy);
    expect(r.dudas).toEqual([]);
    expect(r.acciones.map((a) => a.tipo)).toEqual(['gastar', 'nivel', 'hay']);
    expect(r.acciones[0]).toMatchObject({ cantidad: 2 });
    expect(r.acciones[2]).toMatchObject({ cantidad: 1590 }); // 3 × 530 g
  });

  it('apuntar algo nuevo, quedar poco, docenas y kilos', () => {
    const r = parseVoz('apunta velas, queda poco lavavajillas y hay una docena de huevos', cat, hoy);
    expect(r.acciones[0]).toMatchObject({ tipo: 'apuntar', nuevo: 'velas' });
    expect(r.acciones[1]).toMatchObject({ tipo: 'nivel', nivel: 'poco' });
    expect(r.acciones[2]).toMatchObject({ tipo: 'hay', cantidad: 12 });
    expect(parseVoz('quedan 1,5 kilos de arroz blanco', cat, hoy).acciones[0]).toMatchObject({ tipo: 'hay', cantidad: 1500 });
  });

  it('caducidades, tirar y "el resto bien"', () => {
    const r = parseVoz('la pechuga de pollo caduca el jueves. He tirado el plátano. El resto está bien', cat, hoy);
    expect(r.acciones[0]).toMatchObject({ tipo: 'caduca', fecha: '2026-10-15' });
    expect(r.acciones[1]).toMatchObject({ tipo: 'tirar' });
    expect(r.acciones[2]).toMatchObject({ tipo: 'resto_ok' });
    expect(parseFecha('caduca manana', hoy)!.fecha).toBe('2026-10-13');
  });

  it('pregunta cuando no sabe', () => {
    const r = parseVoz('he gastado arroz blanco', cat, hoy);
    expect(r.acciones).toEqual([]);
    expect(r.dudas[0]).toMatch(/Cuánto/);
  });

  it('aplicar: eventos y artículos', () => {
    const r = parseVoz('quedan 4 huevos y se acabó el lavavajillas', cat, hoy);
    const c = applyVoz(r.acciones, hoy, 'voz', '2026-10-12T10:00:00Z');
    expect(c.events).toHaveLength(2);
    expect(c.events[0]).toMatchObject({ item: 'huevo', tipo: 'set', valor: 4 });
    expect(c.events[1]).toMatchObject({ item: 'lav', tipo: 'nivel', nivel: 'agotado' }); // el modo decide si entra en la compra
    expect(c.tocados).toEqual(['huevo', 'lav']);
  });
});

describe('reconocer por nombre (lo importado sin producto)', () => {
  it('pedido con un producto aún no vinculado: se reconoce y se vincula', () => {
    const d = data({ items: { c1: { ...S.casaItem('Papel higiénico', 'x'), id: 'c1', tipo: 'contado' } } });
    const papel = prod({ id: '777', nombre: 'Papel higiénico doble rollo Bosque Verde', unitSize: 12, sizeFormat: 'ud' });
    const r = S.applyOrder(d, fm, { id: '9', entrega: '2026-10-12T15:00:00Z', estado: 'delivered', status: 3 }, [{ productId: '777', pedida: 1, preparada: 1, product: papel }]);
    expect(r.items[0]).toMatchObject({ id: 'c1', product: { id: '777' } });
    expect(r.pedido.resumen?.nuevos).toBe(0);
    expect(S.matchByName('Claras de huevo líquidas', [S.foodItem(fm.huevo, 'x')])).toBeUndefined();
  });
});

describe('cesta: lo que hay en casa se descuenta', () => {
  it('cubierto en g, unidades y todo cubierto', async () => {
    const { buildBasket } = await import('../../integrations/mercadona/basket');
    const { shoppingList, plannedMeals, datesBetween } = await import('../planning');
    const hist = [dayWith('2026-10-14', [['pollo_pechuga', 1000], ['huevo', 220]])];
    const items = shoppingList(plannedMeals(hist, datesBetween('2026-10-14', '2026-10-14')), fm, cm);
    const links = data().mercadona.links;
    const lines = buildBasket(items, links, { cubierto: { pollo_pechuga: 600, huevo: 4 } });
    const pollo = lines.find((l) => l.food.id === 'pollo_pechuga')!;
    expect(pollo.need).toBe(400); // 1000 − 600
    expect(pollo.qty).toBe(1); // una bandeja de 530 g
    expect(pollo.enCasa).toBe(600);
    expect(lines.find((l) => l.food.id === 'huevo')!.status).toBe('en_casa'); // 4 huevos cubren los 4
  });

  it('voz: envases sin producto usan el tamaño de envase guardado', () => {
    const d = data({ items: { avena: { ...S.foodItem(fm.avena, 'x'), envase: 500 } } });
    d.mercadona.links = {};
    const r = parseVoz('he comprado 2 paquetes de copos de avena', vozCatalog(d, seed.foods), '2026-10-12');
    expect(r.acciones[0]).toMatchObject({ tipo: 'comprar', cantidad: 1000 });
  });
});

describe('voz: recuento desde cero', () => {
  const d = data();
  const cat = vozCatalog(d, seed.foods);
  const p = (t: string) => parseVoz(t, cat, '2026-10-12');

  it('cosas nuevas con y sin cantidad', () => {
    expect(p('hay suavizante').acciones[0]).toMatchObject({ tipo: 'nuevo', nombre: 'suavizante', nivel: 'ok' });
    expect(p('hay 3 rollos de papel de cocina').acciones[0]).toMatchObject({ tipo: 'nuevo', nombre: 'papel de cocina', cantidad: 3, unidad: 'ud' });
    const c = applyVoz(p('tenemos lavavajillas').acciones, '2026-10-12');
    expect(c.items[0]).toMatchObject({ nombre: 'Lavavajillas', tipo: 'estado', zona: 'limpieza' });
  });

  it('plurales, sinónimos y "y medio"', () => {
    const r = p('hay 6 huevos, 2 leches semidesnatadas y medio paquete de arroz blanco');
    expect(r.acciones.map((a) => (a as { ref?: { id: string } }).ref?.id)).toEqual(['huevo', 'leche_semi', 'arroz']);
    expect(p('hay 2 kilos de patatas').acciones[0]).toMatchObject({ tipo: 'hay', cantidad: 2000 });
    expect(p('quedan 2 kilos y medio de arroz blanco').acciones[0]).toMatchObject({ cantidad: 2500 });
    expect(p('quedan uno y medio de huevos').acciones[0]).toMatchObject({ cantidad: 1.5 });
  });
});

describe('cómo se repone (habitual / preguntar / no reponer)', () => {
  const st = { nivel: 'agotado', fuente: 'estimado' } as const;
  const base = { ...S.casaItem('Yogur de mango', '2026-09-01'), id: 'y', compras: ['2026-10-01'] };
  const hoy = '2026-10-12';

  it('habitual entra solo; preguntar va a "¿Volver a comprar?"; nunca no entra (salvo apuntado)', () => {
    expect(S.otroEnCompra(base, st, '2026-10-18', hoy)).toBe(true);
    const q = { ...base, reponer: 'preguntar' as const };
    expect(S.otroEnCompra(q, st, '2026-10-18', hoy)).toBe(false);
    expect(S.preguntarReponer(q, st, '2026-10-18', hoy)).toBe(true);
    const n = { ...base, reponer: 'nunca' as const };
    expect(S.otroEnCompra(n, st, '2026-10-18', hoy)).toBe(false);
    expect(S.preguntarReponer(n, st, '2026-10-18', hoy)).toBe(false);
    expect(S.otroEnCompra({ ...n, apuntado: true }, st, '2026-10-18', hoy)).toBe(true);
  });

  it('preguntar sin comprar en 2 meses deja de preguntar', () => {
    const q = { ...base, reponer: 'preguntar' as const, compras: ['2026-08-01'] };
    expect(S.reponerDe(q, hoy)).toBe('nunca');
    expect(S.reponerDe({ ...q, compras: ['2026-09-01'] }, hoy)).toBe('preguntar');
  });

  it('nuevo en un pedido → preguntar; segunda compra → habitual (salvo "solo esta vez")', () => {
    const yog = prod({ id: '55', nombre: 'Yogur de soja sabor mango' });
    const o = (id: string, fecha: string) => ({ id, entrega: `${fecha}T15:00:00Z`, estado: 'delivered', status: 3 });
    const line = [{ productId: '55', pedida: 1, preparada: 1, product: yog }];
    const r1 = S.applyOrder(data(), fm, o('1', '2026-09-01'), line);
    expect(r1.items[0].reponer).toBe('preguntar');
    const d2 = data({ items: { [r1.items[0].id]: r1.items[0] } });
    expect(S.applyOrder(d2, fm, o('2', '2026-10-01'), line).items[0].reponer).toBe('habitual');
    const d3 = data({ items: { [r1.items[0].id]: { ...r1.items[0], soloEstaVez: true } } });
    const r3 = S.applyOrder(d3, fm, o('3', '2026-10-01'), line).items[0];
    expect(r3.reponer).toBe('preguntar');
    expect(r3.soloEstaVez).toBeUndefined();
  });

  it('por voz', () => {
    const d = data({ items: { y: base } });
    const cat = vozCatalog(d, seed.foods);
    expect(parseVoz('el yogur de mango no me gustó', cat, hoy).acciones[0]).toMatchObject({ tipo: 'modo', modo: 'nunca' });
    const two = parseVoz('se acabó el yogur de mango y no me gustó', cat, hoy).acciones;
    expect(two.map((a) => a.tipo)).toEqual(['nivel', 'modo']);
    expect(parseVoz('el yogur de mango solo de vez en cuando', cat, hoy).acciones[0]).toMatchObject({ tipo: 'modo', modo: 'preguntar' });
    const r = parseVoz('vuelve a comprar el yogur de mango siempre', cat, hoy);
    expect(r.acciones[0]).toMatchObject({ tipo: 'modo', modo: 'habitual' });
    expect(applyVoz(r.acciones, hoy).items[0].reponer).toBe('habitual');
  });
});
