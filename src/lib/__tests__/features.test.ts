import { describe, expect, it } from 'vitest';
import type { AppData, Meal } from '../../types';
import { createSeedData } from '../../store/seed';
import { applyRemote, collectRows, key, markPushed, tombstone, touch } from '../../sync/docs';
import { decodeLink, encodeLink, generateHouseholdKey, normalizeKey } from '../../sync/link';
import { toConversionMap } from '../conversions';
import { toFoodMap } from '../nutrition';
import {
  addDays,
  batchFromPlan,
  datesBetween,
  plannedMeals,
  shoppingList,
  shoppingText,
  splitRealYield,
  weekDates,
  weekStart,
} from '../planning';
import { isValidBarcode, mapOffProduct } from '../openFoodFacts';

const meal = (items: Meal['items'], nombre = 'm'): Meal => ({ id: nombre, nombre, bloque: 'B', origen: 'manual', items });

describe('sincronización (LWW por documento)', () => {
  it('touch marca pendiente con sello creciente', () => {
    let d = createSeedData();
    d = touch(d, [key('pantry', 'all')], 1000);
    d = touch(d, [key('pantry', 'all')], 1000);
    expect(d.sync.stamps['pantry:all']).toBe(1001);
    expect(d.sync.pending).toEqual(['pantry:all']);
  });

  it('lo remoto más nuevo se aplica; lo más viejo se ignora', () => {
    let a = createSeedData();
    a = touch({ ...a, pantry: ['arroz'] }, [key('pantry', 'all')], 2000);
    const older = applyRemote(a, [{ kind: 'pantry', id: 'all', data: ['pollo_pechuga'], deleted: false, ts: 1500 }]);
    expect(older.applied).toBe(0);
    expect(older.data.pantry).toEqual(['arroz']);
    expect(older.data.sync.pending).toContain('pantry:all');
    const newer = applyRemote(a, [{ kind: 'pantry', id: 'all', data: ['pollo_pechuga'], deleted: false, ts: 3000 }]);
    expect(newer.data.pantry).toEqual(['pollo_pechuga']);
    // el cambio local quedó superado: ya no se sube
    expect(newer.data.sync.pending).not.toContain('pantry:all');
  });

  it('dos móviles convergen: favoritos de ambos, borrados y ediciones', () => {
    let dani = createSeedData();
    let alba = createSeedData();
    const fav = (id: string, nombre: string) => ({ ...dani.favorites[0], id, nombre });
    dani = touch({ ...dani, favorites: [fav('f_d', 'De Dani'), ...dani.favorites] }, [key('fav', 'f_d')], 100);
    alba = touch({ ...alba, favorites: [fav('f_a', 'De Alba'), ...alba.favorites] }, [key('fav', 'f_a')], 110);
    // Alba borra un favorito inicial
    const seedFav = alba.favorites.find((f) => f.id === 'fav_hamburguesa')!;
    alba = tombstone({ ...alba, favorites: alba.favorites.filter((f) => f !== seedFav) }, [key('fav', seedFav.id)], 120);
    // Dani edita su perfil
    dani = touch({ ...dani, profiles: { ...dani.profiles, dani: { ...dani.profiles.dani, pesoActualKg: 94 } } }, [key('profile', 'dani')], 130);

    const server: ReturnType<typeof collectRows> = [];
    const push = (d: AppData) => {
      const rows = collectRows(d, d.sync.pending);
      for (const r of rows) {
        const i = server.findIndex((s) => s.kind === r.kind && s.id === r.id);
        if (i < 0) server.push(r);
        else if (r.ts > server[i].ts) server[i] = r;
      }
      return markPushed(d, rows);
    };
    dani = push(dani);
    alba = push(alba);
    dani = applyRemote(dani, server).data;
    alba = applyRemote(alba, server).data;

    for (const d of [dani, alba]) {
      const ids = d.favorites.map((f) => f.id);
      expect(ids).toContain('f_d');
      expect(ids).toContain('f_a');
      expect(ids).not.toContain('fav_hamburguesa');
      expect(d.profiles.dani.pesoActualKg).toBe(94);
      expect(d.sync.pending).toEqual([]);
    }
    expect(dani.favorites.length).toBe(alba.favorites.length);
  });

  it('días del plan: borrar un día se propaga', () => {
    let a = createSeedData();
    a = touch({ ...a, history: [{ fecha: '2026-10-12', bloques: { B: { meal: meal([]) } } }] }, [key('day', '2026-10-12')], 10);
    const r = applyRemote(a, [{ kind: 'day', id: '2026-10-12', data: null, deleted: true, ts: 20 }]);
    expect(r.data.history).toEqual([]);
    expect(r.data.sync.tombstones['day:2026-10-12']).toBe(20);
  });

  it('código de enlace ida y vuelta', () => {
    const h = generateHouseholdKey();
    expect(h).toHaveLength(24);
    const code = encodeLink({ url: 'https://abc.supabase.co', anonKey: 'k'.repeat(40) }, h);
    const back = decodeLink(code)!;
    expect(back.household).toBe(h);
    expect(back.cfg?.url).toBe('https://abc.supabase.co');
    expect(decodeLink('abcd-efgh')).toBeNull();
    expect(normalizeKey('abcd-efgh-2345')).toBe('ABCDEFGH2345');
  });
});

describe('planificador y lista de la compra', () => {
  const d = createSeedData();
  const fm = toFoodMap(d.foods);
  const cm = toConversionMap(d.conversions);
  // B: pollo 150/100 g cocinado, arroz 175/120 g cocido → en base cruda
  const polloArroz = meal(
    [
      { foodId: 'pollo_pechuga', cantidades: { dani: 200, alba: 133.33 } },
      { foodId: 'arroz', cantidades: { dani: 65, alba: 45 } },
      { foodId: 'huevo', cantidades: { dani: 110, alba: 55 } },
    ],
    'Pollo con arroz',
  );
  const history = [
    { fecha: '2026-10-12', bloques: { B: { meal: polloArroz }, C: { libre: true as const, kcalEstimadas: {} } } },
    { fecha: '2026-10-13', bloques: { B: { meal: polloArroz } } },
    { fecha: '2026-10-20', bloques: { B: { meal: polloArroz } } },
  ];

  it('semanas empiezan en lunes', () => {
    expect(weekStart('2026-10-15')).toBe('2026-10-12'); // jueves → lunes
    expect(weekDates('2026-10-18')[6]).toBe('2026-10-18'); // domingo
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(datesBetween('2026-10-12', '2026-10-18')).toHaveLength(7);
  });

  it('solo cuenta comidas planificadas del rango (no las libres)', () => {
    const pm = plannedMeals(history, datesBetween('2026-10-12', '2026-10-18'));
    expect(pm).toHaveLength(2);
  });

  it('suma cantidades de ambos perfiles en peso de compra, redondeando hacia arriba', () => {
    const pm = plannedMeals(history, datesBetween('2026-10-12', '2026-10-18'));
    const list = shoppingList(pm, fm, cm);
    const pollo = list.find((i) => i.food.id === 'pollo_pechuga')!;
    expect(pollo.comprar).toBe(670); // 2 × 333,33 g crudo = 666,7 → 670
    expect(pollo.comidas).toBe(2);
    const arroz = list.find((i) => i.food.id === 'arroz')!;
    expect(arroz.comprar).toBe(220); // 2 × 110 g seco
    const huevo = list.find((i) => i.food.id === 'huevo')!;
    expect(huevo.unidades).toBe(6);
    const txt = shoppingText(list, 'Compra', ['arroz']);
    expect(txt).toContain('☑ Arroz blanco');
    expect(txt).toContain('☐ Huevo (talla M) — 6 huevos');
  });

  it('tanda: total crudo y reparto con el rendimiento real', () => {
    const pm = plannedMeals(history, datesBetween('2026-10-12', '2026-10-18'));
    const batch = batchFromPlan(pm, fm, cm);
    const pollo = batch.find((b) => b.food.id === 'pollo_pechuga')!;
    expect(pollo.porciones).toHaveLength(4); // 2 días × Dani y Alba
    expect(pollo.totalCrudo).toBeCloseTo(666.66, 1);
    expect(pollo.totalCocinadoEstimado).toBeCloseTo(500, 0);
    // el huevo no tiene conversión → no aparece
    expect(batch.some((b) => b.food.id === 'huevo')).toBe(false);
    // real: 520 g cocinado → rendimiento 0,78
    const s = splitRealYield(pollo, 520);
    expect(s.rendimiento).toBeCloseTo(0.78, 2);
    expect(s.porciones[0]).toBe(155); // Dani 200 g crudo × 0,78 = 156 → 155
    expect(s.porciones[1]).toBe(105); // Alba 133 g × 0,78 = 104 → 105
    expect(Math.abs(s.sobrante)).toBeLessThan(10);
  });
});

describe('Open Food Facts', () => {
  it('mapea un producto', () => {
    const f = mapOffProduct(
      {
        product_name: 'Queso fresco batido 0%',
        brands: 'Hacendado, Mercadona',
        quantity: '500 g',
        categories_tags: ['en:dairies', 'en:cheeses', 'en:fresh-cheeses'],
        nutriments: { 'energy-kcal_100g': 46, proteins_100g: 8, carbohydrates_100g: 3.5, fat_100g: 0.1, salt_100g: 0.09 },
      },
      '8480000123456',
    )!;
    expect(f.nombre).toBe('Queso fresco batido 0%');
    expect(f.marca).toBe('Hacendado');
    expect(f.categoria).toBe('queso');
    expect(f.kcalPor100).toBe(46);
    expect(f.tags).toContain('lacteo');
    expect(f.verificacion).toBe('aproximado');
    expect(f.codigoBarras).toBe('8480000123456');
  });
  it('calcula kcal desde kJ si faltan', () => {
    const f = mapOffProduct({ product_name: 'X', nutriments: { 'energy-kj_100g': 418.4 } }, '1')!;
    expect(f.kcalPor100).toBe(100);
  });
  it('pescado, legumbres y bebidas vegetales', () => {
    expect(mapOffProduct({ product_name: 'Atún', categories_tags: ['en:fishes', 'en:tunas'] }, '1')!.tags).toContain('pescado');
    expect(mapOffProduct({ product_name: 'Garbanzos', categories_tags: ['en:legumes', 'en:chickpeas'] }, '1')!.tags).toContain('legumbre');
    const almendra = mapOffProduct({ product_name: 'Bebida almendra', quantity: '1 l', categories_tags: ['en:plant-based-milk-alternatives', 'en:almond-milks'] }, '1')!;
    expect(almendra.tags).not.toContain('leche_vaca');
    expect(almendra.unidadBase).toBe('ml');
  });
  it('valida EAN', () => {
    expect(isValidBarcode('3017620422003')).toBe(true);
    expect(isValidBarcode('3017620422004')).toBe(false);
  });
});
