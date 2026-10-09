import { describe, expect, it } from 'vitest';
import type { DayLog, Meal } from '../../types';
import { createSeedData } from '../../store/seed';
import { toFoodMap } from '../nutrition';
import { blockHasContent, dayMeals, dayTotals, isSplit, mealFor, newExtra, personSlot, targetsForDay } from '../day';
import * as DE from '../dayEdit';
import { generateMeals, type GeneratorContext } from '../mealGenerator';
import { favoriteToMeal, filterFavorites } from '../favorites';
import { recentMeals } from '../recent';
import { datesBetween, plannedMeals, shoppingList } from '../planning';
import { toConversionMap } from '../conversions';
import { dayStats } from '../progress';
import { handleBack } from '../back';
import { applyRemote, collectRows, key, touch } from '../../sync/docs';

const seed = createSeedData();
const fm = toFoodMap(seed.foods);
const cm = toConversionMap(seed.conversions);
const ctx: GeneratorContext = { foods: seed.foods, conversions: seed.conversions, profiles: seed.profiles, settings: seed.settings };
const fav = (id: string) => favoriteToMeal(seed.favorites.find((f) => f.id === id)!);
const empty = (fecha = '2026-10-12'): DayLog => ({ fecha, bloques: {} });

describe('comidas solo para una persona', () => {
  it('mealFor deja solo la parte de esa persona', () => {
    const m = mealFor(fav('dm_A1'), 'alba');
    expect(m.para).toBe('alba');
    expect(m.items.every((i) => i.cantidades.dani === 0 && i.cantidades.alba > 0)).toBe(true);
  });

  it('separar un bloque compartido reparte lo que había', () => {
    let d = DE.setSharedSlot(empty(), 'A', { meal: fav('dm_A1') });
    const before = dayTotals(d, fm);
    d = DE.splitBlock(d, 'A');
    expect(isSplit(d, 'A')).toBe(true);
    expect(d.bloques.A).toBeUndefined();
    const after = dayTotals(d, fm);
    expect(after.dani.kcal).toBeCloseTo(before.dani.kcal, 6);
    expect(after.alba.kcal).toBeCloseTo(before.alba.kcal, 6);
  });

  it('cada uno su desayuno: los totales suman lo de cada uno', () => {
    let d = DE.setPersonSlot(empty(), 'A', 'dani', { meal: fav('dm_A1') });
    d = DE.setPersonSlot(d, 'A', 'alba', { meal: fav('dm_A6') });
    const t = dayTotals(d, fm);
    const a1 = dayTotals(DE.setSharedSlot(empty(), 'A', { meal: fav('dm_A1') }), fm);
    const a6 = dayTotals(DE.setSharedSlot(empty(), 'A', { meal: fav('dm_A6') }), fm);
    expect(t.dani.kcal).toBeCloseTo(a1.dani.kcal, 6);
    expect(t.alba.kcal).toBeCloseTo(a6.alba.kcal, 6);
    expect(personSlot(d, 'A', 'dani')).toBeTruthy();
    expect(dayMeals(d)).toHaveLength(2);
    // Dani quita su parte: Alba conserva la suya
    d = DE.setPersonSlot(d, 'A', 'dani', undefined);
    expect(personSlot(d, 'A', 'dani')).toBeUndefined();
    expect(personSlot(d, 'A', 'alba')).toBeTruthy();
  });

  it('juntar une las dos partes en una comida con las cantidades de cada uno', () => {
    let d = DE.setPersonSlot(empty(), 'B', 'dani', { meal: fav('dm_B1') });
    d = DE.setPersonSlot(d, 'B', 'alba', { meal: fav('dm_B2') });
    const before = dayTotals(d, fm);
    d = DE.joinBlock(d, 'B');
    expect(isSplit(d, 'B')).toBe(false);
    const after = dayTotals(d, fm);
    expect(after.dani.kcal).toBeCloseTo(before.dani.kcal, 6);
    expect(after.alba.kcal).toBeCloseTo(before.alba.kcal, 6);
    expect((d.bloques.B as { meal: Meal }).meal.nombre).toContain('Dani: B1');
  });

  it('una comida para ambos sobre un bloque separado lo vuelve a juntar', () => {
    let d = DE.setPersonSlot(empty(), 'C', 'dani', { meal: fav('dm_C1') });
    d = DE.setSharedSlot(d, 'C', { meal: fav('dm_C2') });
    expect(isSplit(d, 'C')).toBe(false);
    expect(blockHasContent(d, 'C')).toBe(true);
  });

  it('el generador para una persona solo optimiza su parte y su objetivo', () => {
    const r = generateMeals(
      {
        bloque: 'A',
        obligatorios: [],
        opcionales: [],
        prohibidos: [],
        disponibles: [],
        estilo: 'equilibrada',
        filtros: { sinLacteos: false, soloSeleccionados: false, usarLoQueTengo: false },
        para: 'alba',
      },
      ctx,
    );
    expect(r.opciones.length).toBeGreaterThanOrEqual(3);
    for (const o of r.opciones) {
      expect(o.meal.para).toBe('alba');
      expect(o.meal.items.every((i) => i.cantidades.dani === 0)).toBe(true);
      expect(['en_rango', 'cerca']).toContain(o.estado.alba);
    }
    expect(r.avisos.join()).not.toMatch(/Ninguna opción/);
  });

  it('lista de la compra, recientes y estadísticas cuentan las partes separadas', () => {
    let d = DE.setPersonSlot(empty('2026-10-05'), 'A', 'dani', { meal: fav('dm_A1') });
    d = DE.setPersonSlot(d, 'A', 'alba', { meal: fav('dm_A6') });
    const pm = plannedMeals([d], datesBetween('2026-10-05', '2026-10-05'));
    expect(pm).toHaveLength(2);
    const list = shoppingList(pm, fm, cm);
    expect(list.find((x) => x.food.id === 'pavo_lonchas')).toBeTruthy(); // de A1 (Dani)
    expect(list.find((x) => x.food.id === 'platano')).toBeTruthy(); // de A6 (Alba)
    expect(recentMeals([d], 'A', 6, '2026-10-08', 'alba')[0].meal.nombre).toBe('A6 Bol plátano-chocolate');
    expect(recentMeals([d], 'A', 6, '2026-10-08')).toHaveLength(0); // ninguna compartida
    expect(dayStats([d], seed.profiles.alba, fm, ['2026-10-05'])[0].registrado).toBe(true);
  });
});

describe('extras', () => {
  it('suman al día de quien los toma y a la compensación', () => {
    const plat = fm.platano;
    let d = DE.addExtra(empty(), newExtra('platano', { dani: 120, alba: 0 }));
    const t = dayTotals(d, fm);
    expect(t.dani.kcal).toBeCloseTo((plat.kcalPor100 * 120) / 100, 6);
    expect(t.alba.kcal).toBe(0);
    d = { ...d, compensar: true };
    const tg = targetsForDay(d.fecha, 'B', seed.profiles, d, fm);
    expect(tg.dani.kcal).toBeLessThan(seed.profiles.dani.bloques.B.kcal);
    d = DE.removeExtra(d, d.extras![0].id);
    expect(d.extras).toBeUndefined();
    expect(DE.dayHasData({ ...d, compensar: false })).toBe(false);
  });
});

describe('semanas tipo', () => {
  it('guardar y aplicar: rellenar huecos o reemplazar', () => {
    const lunes = DE.setSharedSlot(empty('2026-10-12'), 'B', { meal: fav('dm_B1') });
    const martes = DE.setPersonSlot(empty('2026-10-13'), 'A', 'alba', { meal: fav('dm_A6') });
    const tpl = DE.makeWeekTemplate('Semana base', [lunes, martes, undefined, undefined, undefined, undefined, undefined]);
    expect(tpl.dias).toHaveLength(7);

    const destino = DE.setSharedSlot(empty('2026-10-19'), 'B', { meal: fav('dm_B2') });
    const huecos = DE.applyTemplateDay(destino, tpl.dias[0], 'huecos');
    expect((huecos.bloques.B as { meal: Meal }).meal.nombre).toBe('B2 Pollo-papa'); // no pisa
    const reemplazo = DE.applyTemplateDay(destino, tpl.dias[0], 'reemplazar');
    expect((reemplazo.bloques.B as { meal: Meal }).meal.nombre).toBe('B1 Pollo-arroz');

    const martes2 = DE.applyTemplateDay(empty('2026-10-20'), tpl.dias[1], 'huecos');
    expect(isSplit(martes2, 'A')).toBe(true);
    expect(personSlot(martes2, 'A', 'alba')).toBeTruthy();
  });

  it('se sincronizan', () => {
    const tpl = DE.makeWeekTemplate('X', Array(7).fill(undefined));
    const a = touch({ ...createSeedData(), semanasTipo: [tpl] }, [key('week', tpl.id)]);
    const b = applyRemote(createSeedData(), collectRows(a, a.sync.pending)).data;
    expect(b.semanasTipo.map((w) => w.nombre)).toEqual(['X']);
  });
});

describe('buscar y filtrar favoritos', () => {
  it('por ingrediente, sin lácteos y para quién', () => {
    const favs = seed.favorites;
    const conAlb = filterFavorites(favs, 'albondigas', {}, seed.foods);
    expect(conAlb.map((f) => f.id)).toEqual(expect.arrayContaining(['dm_B3', 'dm_C5']));
    expect(conAlb.every((f) => f.items.some((i) => i.foodId === 'albondigas') || /albondigas|albóndigas/i.test(f.nombre))).toBe(true);
    const sinLac = filterFavorites(favs, '', { sinLacteos: true }, seed.foods);
    expect(sinLac.some((f) => f.id === 'dm_A3')).toBe(false); // lleva cottage
    expect(sinLac.some((f) => f.id === 'dm_A1')).toBe(true);
    const soloAlba = { ...favs[0], id: 'solo', para: 'alba' as const };
    expect(filterFavorites([soloAlba, favs[1]], '', { para: 'ambos' }, seed.foods).map((f) => f.id)).toEqual([favs[1].id]);
    expect(filterFavorites([soloAlba], '', { para: 'dani' }, seed.foods)).toHaveLength(0);
  });
});

describe('botón atrás', () => {
  it('sin nada abierto no lo gestiona (la app sale)', () => {
    expect(handleBack()).toBe(false);
  });
});
