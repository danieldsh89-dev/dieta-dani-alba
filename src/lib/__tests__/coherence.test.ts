import { describe, expect, it } from 'vitest';
import { createSeedData } from '../../store/seed';
import { toFoodMap } from '../nutrition';
import { incoherencias } from '../coherence';
import { generateMeals } from '../mealGenerator';
import { parsePlanVoz, planSlots } from '../planVoz';

const seed = createSeedData();
const fm = toFoodMap(seed.foods);
const gctx = { foods: seed.foods, conversions: seed.conversions, profiles: seed.profiles, settings: seed.settings, ratings: {} };

describe('sentido común', () => {
  it('detecta las combinaciones raras', () => {
    expect(incoherencias(['carne_picada', 'arroz', 'yogur_0', 'platano', 'proteina_chocolate'], 'C', fm)).not.toEqual([]);
    expect(incoherencias(['cuscus', 'pollo_pechuga', 'yogur_0'], 'B', fm)).toContain('yogur / lácteo de desayuno con un plato salado');
    expect(incoherencias(['arroz', 'chocolate_85', 'pollo_pechuga'], 'B', fm)).toContain('algo dulce con un plato salado');
    expect(incoherencias(['pollo_pechuga', 'pan_avena', 'frutos_rojos_cong'], 'A', fm)).toContain('mezcla dulce y salado en el desayuno');
    expect(incoherencias(['carne_picada', 'pollo_pechuga', 'arroz'], 'C', fm)).toContain('dos proteínas principales en el plato');
  });
  it('acepta lo normal y respeta lo que se pide expresamente', () => {
    expect(incoherencias(['pollo_pechuga', 'arroz', 'ratatouille', 'salsa_mexicana'], 'B', fm)).toEqual([]);
    expect(incoherencias(['yogur_0', 'frutos_rojos_cong', 'avena'], 'A', fm)).toEqual([]);
    expect(incoherencias(['pan_integral', 'huevo', 'tomate'], 'A', fm)).toEqual([]);
    // arroz con plátano pedido a propósito: vale
    expect(incoherencias(['arroz', 'platano', 'huevo'], 'B', fm, new Set(['arroz', 'platano']))).toEqual([]);
  });
});

describe('el generador ya no propone combinaciones raras', () => {
  it('cena con carne y arroz obligatorios', () => {
    const r = generateMeals(
      {
        bloque: 'C',
        obligatorios: ['carne_picada', 'arroz'],
        opcionales: [],
        prohibidos: [],
        disponibles: [],
        estilo: 'equilibrada',
        filtros: { sinLacteos: false, soloSeleccionados: false, usarLoQueTengo: false },
      },
      gctx,
    );
    expect(r.opciones.length).toBeGreaterThan(0);
    for (const o of r.opciones) expect(incoherencias(o.meal.items.map((i) => i.foodId), 'C', fm, new Set(['carne_picada', 'arroz']))).toEqual([]);
  });

  it('el plan de la semana de Dani: ninguna comida generada rara', () => {
    const idea = parsePlanVoz(
      'Plan para la semana que viene con arroz, pollo y carne de vaca; desayunos variados, algunos días frutos rojos y yogur y tostadas para Dani, y para Alba principalmente yogur',
      seed.foods,
      seed.profiles,
      '2026-10-14',
    );
    const slots = [...planSlots(idea, { gctx, favorites: [], history: [], bloquesSeparados: [] })];
    const raras = slots
      .filter((s) => s.meal)
      .map((s) => ({ s, why: incoherencias(s.meal!.items.map((i) => i.foodId), s.bloque, fm) }))
      .filter((x) => x.why.length);
    expect(raras.map((x) => `${x.s.fecha} ${x.s.bloque} ${x.s.meal!.nombre}: ${x.why.join(', ')}`)).toEqual([]);
  });
});
