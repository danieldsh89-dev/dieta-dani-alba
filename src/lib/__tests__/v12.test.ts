import { describe, expect, it } from 'vitest';
import type { AppData, DayLog, Favorite, Meal, WeightEntry } from '../../types';
import { createSeedData, mergeWithSeed } from '../../store/seed';
import { SEED_PROFILES } from '../../data/profiles';
import { dayGoals, isTrainingDay, targetsForDay, weekdayIndex } from '../day';
import { toConversionMap, baseToServing } from '../conversions';
import { toFoodMap, mealNutrients } from '../nutrition';
import { generateMeals, learnedLikes, optimizeQuantities, reoptimizeMeal, type GeneratorContext } from '../mealGenerator';
import { dayStats, lastDays, movingAverage, summarize, weeklyRate, weeksToGoal } from '../progress';
import { sortFavorites, favoriteToMeal } from '../favorites';
import { recentMeals } from '../recent';
import { applyRemote, collectRows, key, touch, weightId } from '../../sync/docs';

const seed = createSeedData();
const fm = toFoodMap(seed.foods);
const cm = toConversionMap(seed.conversions);
const ctx: GeneratorContext = { foods: seed.foods, conversions: seed.conversions, profiles: seed.profiles, settings: seed.settings };

describe('días de entreno y descanso', () => {
  it('lunes, miércoles y viernes son de entreno por defecto', () => {
    expect(weekdayIndex('2026-10-12')).toBe(0); // lunes
    expect(isTrainingDay(SEED_PROFILES.dani, '2026-10-12')).toBe(true);
    expect(isTrainingDay(SEED_PROFILES.dani, '2026-10-13')).toBe(false); // martes
  });
  it('el cambio manual del día manda', () => {
    const day: DayLog = { fecha: '2026-10-13', bloques: {}, entreno: { dani: true } };
    expect(isTrainingDay(SEED_PROFILES.dani, '2026-10-13', day)).toBe(true);
    expect(isTrainingDay(SEED_PROFILES.alba, '2026-10-13', day)).toBe(false);
  });
  it('día de entreno: más kcal en B (hidratos), mismo C', () => {
    const train = targetsForDay('2026-10-12', 'B', SEED_PROFILES, undefined, fm);
    const rest = targetsForDay('2026-10-13', 'B', SEED_PROFILES, undefined, fm);
    expect(train.dani.kcal).toBeGreaterThan(rest.dani.kcal);
    expect(train.alba.kcal).toBeGreaterThan(rest.alba.kcal);
    expect(targetsForDay('2026-10-12', 'C', SEED_PROFILES, undefined, fm).dani.kcal).toBe(rest.dani.kcal === 0 ? 0 : SEED_PROFILES.dani.bloques.C.kcal);
    expect(dayGoals(SEED_PROFILES.dani, '2026-10-12').kcalDia).toBeGreaterThan(SEED_PROFILES.dani.kcalDia);
  });
  it('perfiles guardados sin días de entreno los reciben a partir de SUS objetivos', () => {
    const old = createSeedData() as AppData;
    const dani = { ...old.profiles.dani, bloques: { ...old.profiles.dani.bloques, B: { kcal: 700, tolerancia: 50, proteina: 60 } } };
    delete (dani as Partial<typeof dani>).entreno;
    const merged = mergeWithSeed({ ...old, profiles: { ...old.profiles, dani } });
    expect(merged.profiles.dani.entreno.bloques.B.kcal).toBeGreaterThan(700);
    expect(merged.profiles.dani.bloques.B.kcal).toBe(700);
  });
});

describe('🔒 bloquear ingredientes', () => {
  const foods = ['pollo_pechuga', 'arroz', 'ratatouille', 'salsa_mexicana'].map((id) => fm[id]);
  it('el optimizador no toca una cantidad fija', () => {
    const t = SEED_PROFILES.dani.bloques.B;
    const r = optimizeQuantities(foods, SEED_PROFILES.dani, t, 'equilibrada', cm, [200, undefined, undefined, undefined]);
    expect(r.serving[0]).toBe(200);
    expect(Math.abs(r.totals.kcal - t.kcal)).toBeLessThanOrEqual(t.tolerancia);
  });
  it('“Ajustar el resto” respeta los bloqueados y cuadra con el objetivo', () => {
    const meal: Meal = {
      id: 'm',
      nombre: 'm',
      bloque: 'B',
      origen: 'manual',
      items: [
        // pollo ya cocinado: 180 g Dani, 120 g Alba (bloqueado)
        { foodId: 'pollo_pechuga', bloqueado: true, cantidades: { dani: 240, alba: 160 } },
        { foodId: 'arroz', cantidades: { dani: 40, alba: 40 } },
        { foodId: 'ratatouille', cantidades: { dani: 100, alba: 100 } },
      ],
    };
    const r = reoptimizeMeal(meal, 'equilibrada', ctx);
    expect(r.meal.items[0].cantidades).toEqual({ dani: 240, alba: 160 });
    expect(baseToServing(fm.pollo_pechuga, r.meal.items[0].cantidades.dani, cm)).toBe(180);
    expect(r.estado.dani).toBe('en_rango');
    expect(r.estado.alba).toBe('en_rango');
    expect(r.meal.items[1].cantidades.dani).not.toBe(40);
  });
});

describe('👍/👎 gustos', () => {
  const req = {
    bloque: 'B' as const,
    obligatorios: ['arroz', 'albondigas'],
    opcionales: [],
    prohibidos: [],
    disponibles: [],
    estilo: 'equilibrada' as const,
    filtros: { sinLacteos: false, soloSeleccionados: false, usarLoQueTengo: false },
  };
  it('aprende por alimento', () => {
    const likes = learnedLikes({
      a: { voto: 1, foods: ['arroz', 'pollo_pechuga'], bloque: 'B', fecha: '2026-10-08' },
      b: { voto: -1, foods: ['arroz', 'cottage'], bloque: 'B', fecha: '2026-10-08' },
    });
    expect(likes).toEqual({ arroz: 0, pollo_pechuga: 1, cottage: -1 });
  });
  it('una combinación con 👎 deja de salir la primera; con 👍 sube', () => {
    const first = generateMeals(req, ctx).opciones[0];
    const ids = first.meal.items.map((i) => i.foodId);
    const disliked = generateMeals(req, { ...ctx, ratings: { [first.firma]: { voto: -1, foods: ids, bloque: 'B', fecha: '2026-10-08' } } });
    expect(disliked.opciones.map((o) => o.firma)).not.toContain(first.firma);
    const second = generateMeals(req, ctx).opciones[1];
    const liked = generateMeals(req, {
      ...ctx,
      ratings: { [second.firma]: { voto: 1, foods: second.meal.items.map((i) => i.foodId), bloque: 'B', fecha: '2026-10-08' } },
    });
    expect(liked.opciones[0].firma).toBe(second.firma);
  });
});

describe('peso y progreso', () => {
  const w = (fecha: string, kg: number): WeightEntry => ({ profile: 'dani', fecha, kg });
  // baja 0,5 kg por semana exactos
  const series = lastDays('2026-10-28', 28).filter((_, i) => i % 2 === 0).map((f, i) => w(f, 96 - (i * 2 * 0.5) / 7));
  it('ritmo semanal por mínimos cuadrados', () => {
    expect(weeklyRate(series)).toBeCloseTo(-0.5, 5);
    expect(weeklyRate(series.slice(0, 1))).toBeNull();
  });
  it('media móvil de 7 días', () => {
    const ma = movingAverage([w('2026-10-01', 96), w('2026-10-03', 95), w('2026-10-10', 94)]);
    expect(ma[1].kg).toBeCloseTo(95.5, 5);
    expect(ma[2].kg).toBeCloseTo(94, 5); // el 1 y el 3 quedan fuera de la ventana
  });
  it('semanas hasta el objetivo', () => {
    expect(weeksToGoal(95, 89, -0.5)).toBe(12);
    expect(weeksToGoal(95, 89, 0.3)).toBeNull();
  });
  it('cumplimiento diario: kcal ±10 % y proteína ≥ 90 %', () => {
    const fav = seed.favorites.find((f) => f.id === 'fav_pollo_arroz')!;
    const meal = favoriteToMeal(fav);
    const k = mealNutrients(meal, 'dani', fm);
    // un día con 3 veces la misma comida ≈ objetivo diario de Dani; otro con una sola
    const history: DayLog[] = [
      { fecha: '2026-10-13', bloques: { A: { meal }, B: { meal }, C: { meal } } },
      { fecha: '2026-10-14', bloques: { B: { meal } } },
      { fecha: '2026-10-15', bloques: { C: { libre: true, kcalEstimadas: {} } } },
    ];
    const stats = dayStats(history, SEED_PROFILES.dani, fm, ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
    expect(stats[0].kcal).toBeCloseTo(k.kcal * 3, 5);
    expect(stats[0].cumplido).toBe(Math.abs(k.kcal * 3 - 1900) <= 190 && k.proteina * 3 >= 144);
    expect(stats[1].cumplido).toBe(false);
    expect(stats[2].incompleto).toBe(true);
    expect(stats[3].registrado).toBe(false);
    const s = summarize(stats);
    expect(s.diasRegistrados).toBe(3);
    expect(s.kcalMedia).toBeCloseTo((k.kcal * 3 + k.kcal) / 2, 5); // el día incompleto no cuenta en la media
  });
});

describe('comodidad', () => {
  it('favoritos: más usados arriba', () => {
    const base = seed.favorites[0];
    const f = (id: string, usos?: number, ultimoUso?: string): Favorite => ({ ...base, id, usos, ultimoUso });
    const sorted = sortFavorites([f('a'), f('b', 3, '2026-10-01'), f('c', 3, '2026-10-05'), f('d', 1)]);
    expect(sorted.map((x) => x.id)).toEqual(['c', 'b', 'd', 'a']);
    const m = favoriteToMeal({ ...base, foto: 'data:image/jpeg;base64,xx', usos: 4 });
    expect('foto' in m).toBe(false);
  });
  it('comidas recientes del bloque, sin repetir y sin futuras', () => {
    const fav = seed.favorites.find((f) => f.id === 'fav_pollo_arroz')!;
    const m1 = favoriteToMeal(fav);
    const m2 = favoriteToMeal(seed.favorites.find((f) => f.id === 'fav_chili_arroz')!);
    const history: DayLog[] = [
      { fecha: '2026-10-05', bloques: { B: { meal: m1 } } },
      { fecha: '2026-10-06', bloques: { B: { meal: m2 } } },
      { fecha: '2026-10-07', bloques: { B: { meal: m1 } } },
      { fecha: '2026-10-20', bloques: { B: { meal: m2 } } },
    ];
    const r = recentMeals(history, 'B', 6, '2026-10-08');
    expect(r.map((x) => x.meal.nombre)).toEqual([m1.nombre, m2.nombre]);
    expect(r[0].veces).toBe(2);
    expect(r[0].fecha).toBe('2026-10-07');
  });
});

describe('sincronización de pesos y valoraciones', () => {
  it('ida y vuelta', () => {
    let a = createSeedData();
    const entry = { profile: 'alba' as const, fecha: '2026-10-08', kg: 63.4 };
    a = touch({ ...a, pesos: [entry], ratings: { x: { voto: 1, foods: ['arroz'], bloque: 'B', fecha: '2026-10-08' } } }, [
      key('weight', weightId(entry)),
      key('rating', 'x'),
    ]);
    const rows = collectRows(a, a.sync.pending);
    const b = applyRemote(createSeedData(), rows).data;
    expect(b.pesos).toEqual([entry]);
    expect(b.ratings.x.voto).toBe(1);
  });
});
