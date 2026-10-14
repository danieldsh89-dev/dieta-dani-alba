import { describe, expect, it } from 'vitest';
import type { DayLog, Favorite, MercaProduct } from '../../types';
import { createSeedData } from '../../store/seed';
import { toFoodMap, nutrientsFor } from '../nutrition';
import { toConversionMap } from '../conversions';
import { mealEmojis, mealCost, pricePerUnit, sortFavoritesBy, sectionFor, foodEmoji } from '../mealInfo';
import { buildVariant, swappable, variantOptions } from '../variants';
import { adherence } from '../adherence';
import * as S from '../stock';
import { favoriteToMeal } from '../favorites';

const seed = createSeedData();
const fm = toFoodMap(seed.foods);
const cm = toConversionMap(seed.conversions);
const gctx = { foods: seed.foods, conversions: seed.conversions, profiles: seed.profiles, settings: seed.settings, ratings: {} };
const prod = (over: Partial<MercaProduct>): MercaProduct => ({ id: '1', nombre: 'P', unitSize: 1, sizeFormat: 'kg', unitPrice: 1, approx: false, sellingMethod: 0, minBunch: 1, incBunch: 1, actualizado: 'x', ...over });

const meal = (items: [string, number, number][], nombre = 'Comida', bloque: 'A' | 'B' | 'C' = 'B') => ({
  id: 'm',
  nombre,
  bloque,
  origen: 'manual' as const,
  items: items.map(([foodId, dani, alba]) => ({ foodId, cantidades: { dani, alba } })),
});

describe('iconos', () => {
  it('ingredientes principales: proteína, hidrato, verdura', () => {
    expect(mealEmojis(meal([['aceite_oliva', 5, 5], ['papa_fresca', 250, 200], ['pollo_pechuga', 150, 120]]), fm)).toEqual(['🍗', '🥔']);
    expect(foodEmoji(fm.arroz)).toBe('🍚');
    expect(foodEmoji(fm.huevo)).toBe('🥚');
    expect(foodEmoji(fm.arroz_coliflor)).toBe('🥦');
  });
});

describe('coste', () => {
  it('precio por gramo desde el producto y coste por persona', () => {
    const pollo = prod({ id: '2787', unitSize: 0.5, unitPrice: 5 }); // 10 €/kg
    expect(pricePerUnit(fm.pollo_pechuga, pollo)).toBeCloseTo(0.01, 5);
    const links = { pollo_pechuga: { foodId: 'pollo_pechuga', product: pollo, confirmado: true } };
    const c = mealCost(meal([['pollo_pechuga', 200, 100], ['arroz', 70, 50]]), fm, cm, links);
    expect(c.porPersona.dani).toBeCloseTo(2, 2);
    expect(c.porPersona.alba).toBeCloseTo(1, 2);
    expect(c.total).toBeCloseTo(3, 2);
    expect(c.sinPrecio).toBe(1); // el arroz no tiene producto
  });
});

describe('ordenar favoritos', () => {
  const fav = (id: string, nombre: string, over: Partial<Favorite> = {}): Favorite => ({
    ...meal([['pollo_pechuga', 150, 120]], nombre),
    id,
    creado: '2026-01-0' + id,
    totales: { dani: nutrientsFor(fm.pollo_pechuga, 150), alba: nutrientsFor(fm.pollo_pechuga, 120) },
    ...over,
  });
  const favs = [fav('1', 'Zanahoria', { usos: 5 }), fav('2', 'Arroz', { usos: 1, ultimoUso: '2026-10-10' }), fav('3', 'Huevos', { items: [{ foodId: 'huevo', cantidades: { dani: 110, alba: 55 } }] })];
  it('por uso, recientes, nuevos, A–Z, en casa', () => {
    expect(sortFavoritesBy(favs, 'usados', fm).map((f) => f.id)).toEqual(['1', '2', '3']);
    expect(sortFavoritesBy(favs, 'recientes', fm)[0].id).toBe('2');
    expect(sortFavoritesBy(favs, 'nuevos', fm)[0].id).toBe('3');
    expect(sortFavoritesBy(favs, 'az', fm).map((f) => f.nombre)).toEqual(['Arroz', 'Huevos', 'Zanahoria']);
    expect(sortFavoritesBy(favs, 'casa', fm, { enCasa: new Set(['huevo']) })[0].id).toBe('3');
  });
});

describe('secciones de la compra', () => {
  it('cada alimento a su pasillo', () => {
    expect(sectionFor(fm.pollo_pechuga)).toBe('Carne');
    expect(sectionFor(fm.huevo)).toBe('Huevos y lácteos');
    expect(sectionFor(fm.platano)).toBe('Fruta y verdura');
    expect(sectionFor(fm.frutos_rojos_cong)).toBe('Congelados');
    expect(sectionFor(fm.arroz)).toBe('Despensa');
    expect(sectionFor(fm.pan_integral)).toBe('Panadería');
  });
});

describe('variantes', () => {
  const b1 = favoriteToMeal(seed.favorites.find((f) => f.id === 'dm_B1')!);

  it('cambiar solo el hidrato: equivalente en calorías y el resto igual', () => {
    const idx = swappable(b1, fm, 'hidrato');
    expect(idx.length).toBeGreaterThan(0);
    const from = b1.items[idx[0]];
    const opts = variantOptions(b1, idx[0], gctx, new Set(['papa_fresca']));
    expect(opts.length).toBeGreaterThan(2);
    const papa = opts.find((o) => o.food.id === 'papa_fresca');
    if (papa && from.foodId !== 'papa_fresca') expect(opts[0].food.id).toBe('papa_fresca'); // lo que hay en casa, primero
    const pick = opts.find((o) => !o.noEquivalente)!;
    const v = buildVariant(b1, idx[0], pick.food, pick.cantidades, gctx);
    // el resto de ingredientes, con las mismas cantidades
    for (const it of b1.items) {
      if (it.foodId === from.foodId) continue;
      const same = v.meal.items.find((x) => x.foodId === it.foodId);
      expect(same?.cantidades).toEqual(it.cantidades);
    }
    expect(v.meal.items.some((x) => x.foodId === pick.food.id)).toBe(true);
    expect(v.meal.items.some((x) => x.foodId === from.foodId)).toBe(false);
    // y las kcal, cerca de las originales
    const kcal = (m: typeof b1) => m.items.reduce((s, it) => s + nutrientsFor(fm[it.foodId], it.cantidades.dani).kcal, 0);
    expect(Math.abs(kcal(v.meal) - kcal(b1))).toBeLessThan(kcal(b1) * 0.15);
  });
});

describe('faltas para el plan', () => {
  it('avisa de la primera comida a la que no llega lo que hay', () => {
    const now = S.momentOf('2026-10-12', 8);
    const day = (fecha: string, g: number): DayLog => ({ fecha, bloques: { B: { meal: { ...meal([['papa_fresca', g, 0]]), id: fecha } } } });
    const d = createSeedData();
    d.history = [day('2026-10-12', 300), day('2026-10-13', 300), day('2026-10-14', 300)];
    d.stock.items = { papa_fresca: S.foodItem(fm.papa_fresca, 'x') };
    d.stock.events = [S.ev('papa_fresca', 'set', { valor: 500 }, 'revision', new Date(now - 3600000).toISOString())];
    const st = S.computeStock(d, fm, cm, now);
    const sh = S.planShortages(d, fm, cm, st, now);
    expect(sh).toHaveLength(1);
    expect(sh[0]).toMatchObject({ foodId: 'papa_fresca', fecha: '2026-10-13', bloque: 'B' });
    expect(sh[0].faltaTotal).toBeGreaterThan(300);
  });
});

describe('cumplimiento', () => {
  it('días, confirmados, libres y corregidas', () => {
    const m = meal([['pollo_pechuga', 150, 120]]);
    const h: DayLog[] = [
      { fecha: '2026-10-12', confirmado: true, bloques: { A: { meal: m }, B: { libre: true, kcalEstimadas: {} } } },
      { fecha: '2026-10-13', bloques: { C: { meal: { ...m, ajustadoReal: true } } }, extras: [{ id: 'x', foodId: 'platano', cantidades: { dani: 100, alba: 0 } }] },
    ];
    const a = adherence(h, '2026-10-14', 2);
    const w = a.semanas[1];
    expect(w).toMatchObject({ dias: 2, confirmados: 1, comidas: 3, libres: 1, corregidas: 1, extras: 1 });
    expect(a.libresPorBloque.B).toBe(1);
    expect(a.seguidas).toBe(33);
  });
});
