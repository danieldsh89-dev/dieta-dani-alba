import { describe, expect, it } from 'vitest';
import { SEED_FOODS } from '../../data/foods';
import { SEED_CONVERSIONS } from '../../data/conversions';
import { SEED_PROFILES, DEFAULT_SETTINGS } from '../../data/profiles';
import type { Food, Meal } from '../../types';
import {
  baseFromState,
  calibrateFactor,
  cookedToRaw,
  displayQuantity,
  rawToCooked,
  roundTo,
  servingToBase,
  toConversionMap,
  weightInState,
} from '../conversions';
import { macroConsistency, mealNutrients, nutrientsFor, rangeStatus, toFoodMap } from '../nutrition';
import { equivalentBaseGrams, equivalentPortion, fillDeficit, substitutesFor } from '../substitutions';
import { generateMeals, optimizeQuantities, adjustMeal, type GeneratorContext } from '../mealGenerator';
import { foodAllowedFor, mealWarnings, validateFood } from '../validation';
import { portionRange } from '../portions';
import { splitBatch } from '../batch';

const fm = toFoodMap(SEED_FOODS);
const cm = toConversionMap(SEED_CONVERSIONS);
const ctx: GeneratorContext = {
  foods: SEED_FOODS,
  conversions: SEED_CONVERSIONS,
  profiles: SEED_PROFILES,
  settings: DEFAULT_SETTINGS,
};
const f = (id: string): Food => {
  const x = fm[id];
  if (!x) throw new Error('missing ' + id);
  return x;
};

describe('conversiones crudo/cocinado', () => {
  it('65 g arroz seco con factor 2,7 → 175,5 g cocido', () => {
    expect(rawToCooked(65, 2.7)).toBeCloseTo(175.5, 5);
    expect(weightInState(f('arroz'), 65, 'cocinado', cm)).toBeCloseTo(175.5, 5);
  });
  it('200 g pollo crudo con rendimiento 0,75 → 150 g cocinado', () => {
    expect(rawToCooked(200, 0.75)).toBe(150);
    expect(weightInState(f('pollo_pechuga'), 200, 'cocinado', cm)).toBe(150);
  });
  it('300 g papa cruda air fryer 0,78 → 234 g', () => {
    expect(rawToCooked(300, 0.78)).toBeCloseTo(234, 5);
    expect(weightInState(f('papa_fresca'), 300, 'cocinado', cm, 'air_fryer')).toBeCloseTo(234, 5);
  });
  it('papa hervida gana peso (factor 1,05)', () => {
    expect(weightInState(f('papa_fresca'), 300, 'cocinado', cm, 'hervida')).toBeCloseTo(315, 5);
  });
  it('cocinado → crudo es la inversa', () => {
    expect(cookedToRaw(175.5, 2.7)).toBeCloseTo(65, 5);
    expect(baseFromState(f('arroz'), 175.5, 'cocinado', cm)).toBeCloseTo(65, 5);
  });
  it('las conversiones no cambian las kcal totales', () => {
    const base = baseFromState(f('pollo_pechuga'), 150, 'cocinado', cm);
    expect(nutrientsFor(f('pollo_pechuga'), base).kcal).toBeCloseTo(220, 5); // 200 g crudo × 1,10
  });
  it('calibrar cocción: 500 g seco → 1350 g cocido = 2,7', () => {
    expect(calibrateFactor(500, 1350)).toBeCloseTo(2.7, 5);
  });
  it('alimentos listos para consumir no se convierten', () => {
    expect(weightInState(f('papa_bote'), 430, 'crudo', cm)).toBe(430);
  });
  it('redondeo práctico a múltiplos de 5', () => {
    expect(roundTo(137.42)).toBe(135);
    expect(roundTo(138)).toBe(140);
    expect(displayQuantity(f('arroz'), 65, 'cocinado', cm).value).toBe(175);
    expect(displayQuantity(f('arroz'), 65, 'crudo', cm).value).toBe(65);
  });
  it('unidades: 2 rebanadas de pan = 56 g', () => {
    expect(servingToBase(f('pan_integral'), 2, cm)).toBe(56);
    expect(displayQuantity(f('pan_integral'), 56, 'cocinado', cm).text).toContain('2 rebanadas');
  });
});

describe('cálculo de kcal y macros', () => {
  it('kcal de 175 g arroz cocido', () => {
    const base = baseFromState(f('arroz'), 175, 'cocinado', cm);
    expect(nutrientsFor(f('arroz'), base).kcal).toBeCloseTo((175 / 2.7) * 3.5, 5);
  });
  it('aceite: 10 g = 90 kcal', () => {
    expect(nutrientsFor(f('aceite_oliva'), 10).kcal).toBe(90);
    expect(nutrientsFor(f('aceite_oliva'), 15).kcal).toBe(135);
  });
  it('leche fermentada 250 g ≈ 121 kcal y 17,5 g proteína', () => {
    const n = nutrientsFor(f('leche_fermentada_proteica'), 250);
    expect(n.kcal).toBeCloseTo(120, 0);
    expect(n.proteina).toBeCloseTo(17.5, 5);
  });
  it('macros de una comida completa', () => {
    const meal: Meal = {
      id: 'x', nombre: 'x', bloque: 'B', origen: 'manual',
      items: [
        { foodId: 'pollo_pechuga', cantidades: { dani: 200, alba: 0 } },
        { foodId: 'aceite_oliva', cantidades: { dani: 5, alba: 0 } },
      ],
    };
    const n = mealNutrients(meal, 'dani', fm);
    expect(n.kcal).toBeCloseTo(220 + 45, 5);
    expect(n.proteina).toBeCloseTo(46, 5);
    expect(n.grasas).toBeCloseTo(3 + 5, 5);
    expect(mealNutrients(meal, 'alba', fm).kcal).toBe(0);
  });
  it('cantidades negativas cuentan como 0', () => {
    expect(nutrientsFor(f('arroz'), -50).kcal).toBe(0);
  });
  it('las fichas iniciales son coherentes (kcal vs macros ±25%)', () => {
    for (const food of SEED_FOODS) {
      expect(Math.abs(macroConsistency(food)), food.id).toBeLessThan(0.25);
      expect(validateFood(food).errors, food.id).toEqual([]);
    }
  });
});

describe('sustitución equivalente de hidratos (mismas kcal, no mismo peso)', () => {
  const arrozDani = 65; // g seco
  it('Dani: 65 g arroz seco ≈ 65 g pasta seca', () => {
    expect(roundTo(equivalentBaseGrams(f('arroz'), arrozDani, f('pasta')))).toBe(65);
  });
  it('Dani: ≈ 60-65 g cuscús seco', () => {
    const g = equivalentBaseGrams(f('arroz'), arrozDani, f('cuscus'));
    expect(g).toBeGreaterThanOrEqual(60);
    expect(g).toBeLessThanOrEqual(65);
  });
  it('Dani: ≈ 300 g papa fresca cruda', () => {
    expect(Math.abs(equivalentBaseGrams(f('arroz'), arrozDani, f('papa_fresca')) - 300)).toBeLessThan(10);
  });
  it('Dani: ≈ 430-440 g papa de bote', () => {
    const g = equivalentBaseGrams(f('arroz'), arrozDani, f('papa_bote'));
    expect(g).toBeGreaterThanOrEqual(425);
    expect(g).toBeLessThanOrEqual(440);
  });
  it('Dani: ≈ 160 g gnocchi', () => {
    expect(roundTo(equivalentBaseGrams(f('arroz'), arrozDani, f('gnocchi')))).toBe(160);
  });
  it('Alba: 45 g arroz ≈ 200-210 g papa fresca y ≈ 300 g papa de bote', () => {
    const p = equivalentBaseGrams(f('arroz'), 45, f('papa_fresca'));
    expect(p).toBeGreaterThanOrEqual(200);
    expect(p).toBeLessThanOrEqual(210);
    expect(Math.abs(equivalentBaseGrams(f('arroz'), 45, f('papa_bote')) - 300)).toBeLessThan(5);
    expect(roundTo(equivalentBaseGrams(f('arroz'), 45, f('gnocchi')), 5)).toBe(110);
  });
  it('equivalencia práctica redondeada con diferencia de kcal pequeña', () => {
    const e = equivalentPortion(f('arroz'), 65, f('pasta'), cm);
    expect(Math.abs(e.diffKcal)).toBeLessThan(15);
    // en cocinado es múltiplo de 5
    expect(weightInState(f('pasta'), e.base, 'cocinado', cm) % 5).toBeCloseTo(0, 5);
  });
  it('comparador: el arroz de coliflor va al final y reduce kcal', () => {
    const item = { foodId: 'arroz', cantidades: { dani: 65, alba: 45 } };
    const subs = substitutesFor(item, SEED_FOODS, SEED_PROFILES, cm);
    expect(subs[0].food.categoria).toBe('hidrato');
    const last = subs[subs.length - 1];
    expect(last.food.id).toBe('arroz_coliflor');
    expect(last.noEquivalente).toBe(true);
    expect(last.diffKcal.dani).toBeLessThan(-150);
    // ordenado por diferencia absoluta
    const eq = subs.filter((s) => !s.noEquivalente && !s.restringido);
    for (let i = 1; i < eq.length; i++) {
      const d = (s: typeof eq[number]) => Math.abs(s.diffKcal.dani) + Math.abs(s.diffKcal.alba);
      expect(d(eq[i])).toBeGreaterThanOrEqual(d(eq[i - 1]) - 1e-9);
    }
  });
  it('compensar déficit añadiendo cottage', () => {
    const meal: Meal = { id: 'm', nombre: 'm', bloque: 'B', origen: 'manual', items: [{ foodId: 'arroz_coliflor', cantidades: { dani: 300, alba: 225 } }] };
    const out = fillDeficit(meal, 'cottage', { dani: 93, alba: 0 }, fm, cm);
    const c = out.items.find((i) => i.foodId === 'cottage')!;
    expect(c.cantidades.dani).toBe(100);
    expect(c.cantidades.alba).toBe(0);
  });
  it('frutas intercambiables por calorías', () => {
    const e = equivalentPortion(f('platano'), 110, f('manzana'), cm);
    expect(e.base).toBe(190); // 97,9 kcal / 0,52 ≈ 188 → 190
  });
});

describe('restricciones por usuario', () => {
  it('Dani no pescado, Alba no leche de vaca', () => {
    expect(foodAllowedFor(f('atun'), SEED_PROFILES.dani)).toBe(false);
    expect(foodAllowedFor(f('atun'), SEED_PROFILES.alba)).toBe(true);
    expect(foodAllowedFor(f('leche_semi'), SEED_PROFILES.alba)).toBe(false);
    expect(foodAllowedFor(f('yogur_0'), SEED_PROFILES.alba)).toBe(true);
    expect(foodAllowedFor(f('bebida_almendras'), SEED_PROFILES.alba)).toBe(true);
  });
  it('legumbres de Alba limitadas a 100 g por comida', () => {
    const r = portionRange(f('garbanzos'), SEED_PROFILES.alba);
    expect(r.max).toBe(100);
    expect(r.min).toBe(60);
  });
  it('avisos: Alba con leche, Dani con pescado, legumbres de más', () => {
    const meal: Meal = {
      id: 'w', nombre: 'w', bloque: 'B', origen: 'manual',
      items: [
        { foodId: 'atun', cantidades: { dani: 100, alba: 100 } },
        { foodId: 'leche_semi', cantidades: { dani: 200, alba: 200 } },
        { foodId: 'garbanzos', cantidades: { dani: 150, alba: 150 } },
      ],
    };
    const w = mealWarnings(meal, SEED_PROFILES, fm, { dani: SEED_PROFILES.dani.bloques.B, alba: SEED_PROFILES.alba.bloques.B });
    const texts = w.map((x) => x.text).join('\n');
    expect(texts).toMatch(/Dani no come pescado/);
    expect(texts).toMatch(/Alba no toma leche de vaca/);
    expect(texts).toMatch(/legumbres/);
  });
  it('validación de ficha: no negativos', () => {
    const bad = { ...f('arroz'), kcalPor100: -1 };
    expect(validateFood(bad).errors.length).toBeGreaterThan(0);
  });
});

describe('objetivos A/B/C', () => {
  it('estado de rango', () => {
    const t = SEED_PROFILES.dani.bloques.B; // 670 ± 50
    expect(rangeStatus(700, t)).toBe('en_rango');
    expect(rangeStatus(730, t)).toBe('cerca');
    expect(rangeStatus(800, t)).toBe('alto');
    expect(rangeStatus(500, t)).toBe('bajo');
  });
  it('el optimizador ajusta pollo+arroz+ratatouille+salsa al rango de cada perfil', () => {
    const foods = ['pollo_pechuga', 'arroz', 'ratatouille', 'salsa_mexicana'].map(f);
    for (const pid of ['dani', 'alba'] as const) {
      const t = SEED_PROFILES[pid].bloques.B;
      const r = optimizeQuantities(foods, SEED_PROFILES[pid], t, 'equilibrada', cm);
      expect(Math.abs(r.totals.kcal - t.kcal)).toBeLessThanOrEqual(t.tolerancia);
      // todas las raciones son múltiplos de 5 g
      r.serving.forEach((q) => expect(q % 5).toBe(0));
    }
  });
});

describe('generación con ingredientes obligatorios', () => {
  const res = generateMeals(
    {
      bloque: 'B',
      obligatorios: ['arroz', 'albondigas'],
      opcionales: [],
      prohibidos: ['cottage'],
      disponibles: [],
      estilo: 'equilibrada',
      filtros: { sinLacteos: false, soloSeleccionados: false, usarLoQueTengo: false },
    },
    ctx,
  );
  it('devuelve al menos 3 opciones', () => {
    expect(res.opciones.length).toBeGreaterThanOrEqual(3);
  });
  it('todas incluyen arroz y albóndigas y ninguna cottage', () => {
    for (const o of res.opciones) {
      const ids = o.meal.items.map((i) => i.foodId);
      expect(ids).toContain('arroz');
      expect(ids).toContain('albondigas');
      expect(ids).not.toContain('cottage');
    }
  });
  it('misma receta: mismos ingredientes para Dani y Alba, distintas cantidades', () => {
    for (const o of res.opciones) {
      for (const it of o.meal.items) {
        expect(it.cantidades.dani).toBeGreaterThan(0);
        expect(it.cantidades.alba).toBeGreaterThan(0);
      }
      expect(o.totales.dani.kcal).toBeGreaterThan(o.totales.alba.kcal);
    }
  });
  it('respetan el presupuesto calórico (en rango o cerca)', () => {
    for (const o of res.opciones) {
      expect(['en_rango', 'cerca']).toContain(o.estado.dani);
      expect(['en_rango', 'cerca']).toContain(o.estado.alba);
    }
    expect(res.opciones.filter((o) => o.estado.dani === 'en_rango' && o.estado.alba === 'en_rango').length).toBeGreaterThanOrEqual(2);
  });
  it('nunca sugiere pescado a Dani ni leche a Alba', () => {
    for (const o of res.opciones) {
      for (const it of o.meal.items) {
        expect(fm[it.foodId].tags).not.toContain('pescado');
        expect(fm[it.foodId].tags).not.toContain('leche_vaca');
      }
    }
  });
  it('las opciones son distintas entre sí', () => {
    const firmas = new Set(res.opciones.map((o) => o.firma));
    expect(firmas.size).toBe(res.opciones.length);
  });
  it('"usar solo seleccionados" restringe los ingredientes', () => {
    const r = generateMeals(
      {
        bloque: 'B', obligatorios: ['pollo_pechuga'], opcionales: ['papa_fresca', 'ratatouille', 'salsa_mexicana'],
        prohibidos: [], disponibles: [], estilo: 'equilibrada',
        filtros: { sinLacteos: false, soloSeleccionados: true, usarLoQueTengo: false },
      },
      ctx,
    );
    const allowed = new Set(['pollo_pechuga', 'papa_fresca', 'ratatouille', 'salsa_mexicana']);
    expect(r.opciones.length).toBeGreaterThan(0);
    for (const o of r.opciones) for (const it of o.meal.items) expect(allowed.has(it.foodId)).toBe(true);
  });
  it('"tengo esto en casa" genera 3-5 opciones con la despensa', () => {
    const r = generateMeals(
      {
        bloque: 'C', obligatorios: [], opcionales: [],
        prohibidos: [], disponibles: ['arroz', 'albondigas', 'ratatouille', 'cottage', 'salsa_tomate_albahaca', 'gazpacho', 'pollo_pechuga', 'papa_fresca'],
        estilo: 'equilibrada',
        filtros: { sinLacteos: false, soloSeleccionados: false, usarLoQueTengo: true },
      },
      ctx,
    );
    expect(r.opciones.length).toBeGreaterThanOrEqual(3);
    expect(r.opciones.length).toBeLessThanOrEqual(5);
  });
  it('sin lácteos excluye quesos y yogures', () => {
    const r = generateMeals(
      {
        bloque: 'A', obligatorios: [], opcionales: [], prohibidos: [], disponibles: [], estilo: 'alta_proteina',
        filtros: { sinLacteos: true, soloSeleccionados: false, usarLoQueTengo: false },
      },
      ctx,
    );
    expect(r.opciones.length).toBeGreaterThanOrEqual(3);
    for (const o of r.opciones) for (const it of o.meal.items) {
      const fd = fm[it.foodId];
      expect(fd.categoria).not.toBe('queso');
      expect(fd.tags).not.toContain('lacteo');
    }
  });
  it('Más proteína aumenta la proteína', () => {
    const o = res.opciones[0];
    const adj = adjustMeal(o.meal, 'alta_proteina', ctx, ['cottage']);
    expect(adj.totales.dani.proteina).toBeGreaterThanOrEqual(o.totales.dani.proteina - 1);
    expect(adj.meal.items.map((i) => i.foodId)).not.toContain('cottage');
  });
});

describe('batch cooking', () => {
  it('1000 g pollo crudo → 760 g: rendimiento 0,76 y reparto 3 Dani + 3 Alba', () => {
    const r = splitBatch(f('pollo_pechuga'), {
      pesoInicial: 1000,
      pesoFinal: 760,
      raciones: [
        { nombre: 'Dani', cantidad: 3, peso: 1 },
        { nombre: 'Alba', cantidad: 3, peso: 0.7 },
      ],
    });
    expect(r.rendimiento).toBeCloseTo(0.76, 5);
    const [d, a] = r.porciones;
    expect(d.cocinado % 5).toBe(0);
    expect(d.cocinado).toBe(150); // 760×1/5,1 = 149
    expect(a.cocinado).toBe(105); // 104,3
    expect(Math.abs(r.sobrante)).toBeLessThan(20);
    expect(d.nutrientes.kcal).toBeCloseTo((150 / 0.76) * 1.1, 5);
  });
});
