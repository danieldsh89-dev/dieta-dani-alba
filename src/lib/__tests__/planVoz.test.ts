import { describe, expect, it } from 'vitest';
import { createSeedData } from '../../store/seed';
import { toFoodMap } from '../nutrition';
import { hcFamily, parsePlanVoz, planSlots, requiredFor, type PlanIdea } from '../planVoz';
import type { Block } from '../../types';

const seed = createSeedData();
const fm = toFoodMap(seed.foods);
const hoy = '2026-10-14'; // miércoles
const P = (t: string) => parsePlanVoz(t, seed.foods, seed.profiles, hoy);

describe('interpretar un plan dicho por voz', () => {
  it('la frase de Dani', () => {
    const idea = P(
      'Créame un plan para la semana que viene que tenga arroz, pollo, carne de vaca. Y que los desayunos sean variados y tengan algunos días frutos y yogur y tostadas para Daniel, y para Alba principalmente yogur',
    );
    expect(idea.fechas).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
    expect(idea.bloques).toEqual(['A', 'B', 'C']);
    const main = idea.reglas.find((r) => r.bloques.includes('B') && !r.para)!;
    expect(main.items.map((i) => i.label)).toEqual(['arroz', 'pollo', 'carne de vaca']);
    expect(main.bloques).toEqual(['B', 'C']);
    const dani = idea.reglas.find((r) => r.bloques.includes('A') && r.para === 'dani')!;
    expect(dani.variado).toBe(true);
    expect(dani.items.map((i) => [i.label, i.freq])).toEqual([
      ['frutos rojos', 'algunos'],
      ['yogur', 'algunos'],
      ['tostadas', 'algunos'],
    ]);
    const alba = idea.reglas.find((r) => r.bloques.includes('A') && r.para === 'alba')!;
    expect(alba.items.map((i) => [i.label, i.freq])).toEqual([['yogur', 'principal']]);
  });

  it('una sola comida, fechas y exclusiones', () => {
    const c = P('hazme una cena con atún y ensalada para mañana');
    expect(c.fechas).toEqual(['2026-10-15']);
    expect(c.bloques).toEqual(['C']);
    expect(c.reglas[0].items.map((i) => i.label)).toEqual(['atún', 'ensalada']);
    const e = P('plan para esta semana de lunes a viernes, sin pescado, comidas con pasta y cenas con huevos');
    expect(e.fechas).toEqual(['2026-10-14', '2026-10-15', '2026-10-16']);
    expect(e.excluir.map((i) => i.label)).toEqual(['pescado']);
    expect(e.reglas.find((r) => r.bloques.join() === 'B')!.items[0].label).toBe('pasta');
    expect(e.reglas.find((r) => r.bloques.join() === 'C')!.items[0].label).toBe('huevos');
    expect(P('comidas y cenas con pollo los próximos 3 días').reglas[0].bloques).toEqual(['B', 'C']);
  });
});

describe('del plan a comidas', () => {
  it('turna proteínas e hidratos entre días y bloques', () => {
    const items = P('plan con arroz, pollo y carne de vaca').reglas[0].items;
    const b0 = requiredFor(items, 0, 'B', fm).foods;
    const c0 = requiredFor(items, 0, 'C', fm, 1).foods;
    const b1 = requiredFor(items, 1, 'B', fm).foods;
    expect(b0).toContain('arroz');
    expect(b0.some((f) => f === 'pollo_pechuga' || f === 'contramuslo')).toBe(true);
    expect(c0).toContain('carne_picada'); // la cena del mismo día, la otra proteína
    expect(b1).toContain('carne_picada');
  });

  it('genera un hueco por día y bloque, con lo pedido (y respeta lo ya planificado)', () => {
    const idea: PlanIdea = { ...P('plan para el lunes con pollo y arroz'), bloques: ['B'] };
    const gctx = { foods: seed.foods, conversions: seed.conversions, profiles: seed.profiles, settings: seed.settings, ratings: {} };
    const slots = [...planSlots(idea, { gctx, favorites: seed.favorites, history: [], bloquesSeparados: [] })];
    expect(slots).toHaveLength(1);
    expect(slots[0].meal).toBeDefined();
    const ids = slots[0].meal!.items.map((i) => i.foodId);
    expect(ids).toContain('arroz');
    expect(ids.some((f) => f === 'pollo_pechuga' || f === 'contramuslo')).toBe(true);
    // con algo ya planificado ese día, no se toca
    const history = [{ fecha: idea.fechas[0], bloques: { B: { meal: slots[0].meal! } } }];
    const again = [...planSlots(idea, { gctx, favorites: seed.favorites, history, bloquesSeparados: [] })];
    expect(again[0].origen).toBe('existente');
  });

  it('desayunos por persona cuando se pide distinto para cada uno', () => {
    const idea: PlanIdea = { ...P('desayunos con tostadas para Dani y para Alba yogur, el lunes'), bloques: ['A'] };
    const gctx = { foods: seed.foods, conversions: seed.conversions, profiles: seed.profiles, settings: seed.settings, ratings: {} };
    const slots = [...planSlots(idea, { gctx, favorites: seed.favorites, history: [], bloquesSeparados: [] })];
    expect(slots.map((s) => s.para)).toEqual(['dani', 'alba']);
    expect(slots[0].meal!.items.some((i) => i.foodId.startsWith('pan_'))).toBe(true);
    expect(slots[1].meal!.items.some((i) => i.foodId.startsWith('yogur') || i.foodId === 'leche_fermentada_proteica')).toBe(true);
  });
});

describe('repetir comidas y un solo hidrato', () => {
  const gctx = { foods: seed.foods, conversions: seed.conversions, profiles: seed.profiles, settings: seed.settings, ratings: {} };

  it('entiende "repetir dos días"', () => {
    expect(P('plan para la semana que viene con pollo, que se repitan las comidas dos días seguidos').repetir).toBe(2);
    expect(P('semana que viene, lunes y martes las mismas comidas, miércoles y jueves igual').repetir).toBe(2);
    expect(P('plan de esta semana para cocinar para dos días').repetir).toBe(2);
    expect(P('plan para los próximos dos días con arroz').repetir).toBe(1);
  });

  it('el segundo día de cada pareja lleva la misma comida', () => {
    const idea = { ...P('plan para la semana que viene con arroz, pollo y carne de vaca'), bloques: ['B' as const], repetir: 2 };
    const slots = [...planSlots(idea, { gctx, favorites: seed.favorites, history: [], bloquesSeparados: [] })];
    expect(slots).toHaveLength(7);
    const sig = (i: number) => slots[i].meal!.items.map((x) => x.foodId).sort().join();
    expect(sig(1)).toBe(sig(0));
    expect(slots[1].igualQue).toBe(slots[0].fecha);
    expect(sig(3)).toBe(sig(2));
    expect(sig(2)).not.toBe(sig(0)); // la pareja siguiente cambia
  });

  it('nunca dos hidratos o dos proteínas pedidos en la misma comida', () => {
    const items = P('plan con pasta, algunos días papas, pollo y carne').reglas[0].items;
    for (let k = 0; k < 7; k++) {
      const r = requiredFor(items, k, 'B', fm);
      const cats = r.foods.map((f) => fm[f].categoria);
      expect(cats.filter((c) => c === 'hidrato').length).toBeLessThanOrEqual(1);
      expect(cats.filter((c) => c === 'proteina').length).toBeLessThanOrEqual(1);
    }
  });
});

describe('hidrato distinto en comida y cena del mismo día', () => {
  const gctx = { foods: seed.foods, conversions: seed.conversions, profiles: seed.profiles, settings: seed.settings, ratings: {} };
  const fam = (ids: string[]) => ids.filter((i) => fm[i]?.categoria === 'hidrato').map(hcFamily);

  it('por defecto, comida y cena de cada día con hidratos distintos (también con favoritos y repeticiones)', () => {
    for (const repetir of [1, 2]) {
      const idea = { ...P('plan para la semana que viene con papas, arroz y pasta, pollo y carne'), bloques: ['B', 'C'] as Block[], repetir };
      expect(idea.hidratoDistinto).toBe(true);
      const slots = [...planSlots(idea, { gctx, favorites: seed.favorites, history: [], bloquesSeparados: [] })];
      for (const f of idea.fechas) {
        const b = slots.find((s) => s.fecha === f && s.bloque === 'B')!.meal!;
        const c = slots.find((s) => s.fecha === f && s.bloque === 'C')!.meal!;
        const hb = fam(b.items.map((i) => i.foodId));
        const hc = fam(c.items.map((i) => i.foodId));
        expect(hb.filter((x) => hc.includes(x))).toEqual([]);
      }
    }
  });

  it('se puede desactivar', () => {
    expect(P('plan con papas, se puede repetir el hidrato').hidratoDistinto).toBe(false);
  });
});
