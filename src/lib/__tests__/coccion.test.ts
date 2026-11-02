import { describe, expect, it } from 'vitest';
import type { AppData, Food } from '../../types';
import { createSeedData, DATA_VERSION, mergeWithSeed } from '../../store/seed';
import { displayQuantity, ownConversionId, servingToBase, toConversionMap, weightInState } from '../conversions';
import { nutrientsFor } from '../nutrition';
import { applyCoccion, coccionDraft, newOwnConversion } from '../../components/CoccionEditor';

const champis: Food = {
  id: 'food_champi',
  nombre: 'Champiñones en lata',
  categoria: 'verdura',
  kcalPor100: 21,
  proteinaPor100: 2,
  carbohidratosPor100: 1,
  grasasPor100: 0.3,
  unidadBase: 'g',
  estadoNutricionalBase: 'listo_para_consumir',
  porcionMinima: 50,
  porcionMaxima: 200,
  incremento: 25,
  porcionHabitual: 100,
  bloques: ['B', 'C'],
  tags: [],
  verificacion: 'verificado',
  personalizado: true,
};

describe('conversión propia de un alimento (crudo ↔ cocinado)', () => {
  it('100 g de lata (21 kcal) son 75 g cocinados con las mismas kcal', () => {
    const d = coccionDraft(champis, []);
    expect(d.cambia).toBe(false);
    const r = applyCoccion(champis, { ...d, cambia: true, estado: 'crudo', propia: { ...newOwnConversion(champis), estadoInicial: 'escurrido' } });
    expect(r.conversion?.id).toBe(ownConversionId(champis.id));
    expect(r.conversion?.propiaDe).toBe(champis.id);
    expect(r.food).toMatchObject({ estadoNutricionalBase: 'crudo', conversionId: ownConversionId(champis.id) });
    const cm = toConversionMap([r.conversion!]);
    expect(weightInState(r.food, 100, 'cocinado', cm)).toBe(75);
    expect(displayQuantity(r.food, 100, 'crudo', cm).text).toBe('100 g');
    // las kcal van con el peso sin cocinar: 75 g cocinados = 100 g de lata = 21 kcal
    expect(nutrientsFor(r.food, servingToBase(r.food, 75, cm)).kcal).toBeCloseTo(21);
    // al reabrir la ficha, vuelve como "propia"
    const again = coccionDraft(r.food, [r.conversion!]);
    expect(again).toMatchObject({ cambia: true, modo: 'propia', estado: 'crudo' });
  });

  it('"no cambia" deja el alimento como listo para consumir y sin conversión', () => {
    const conv = newOwnConversion(champis);
    const food = { ...champis, estadoNutricionalBase: 'crudo' as const, conversionId: conv.id };
    const r = applyCoccion(food, { ...coccionDraft(food, [conv]), cambia: false });
    expect(r.food.conversionId).toBeUndefined();
    expect(r.food.estadoNutricionalBase).toBe('listo_para_consumir');
    expect(r.conversion).toBeUndefined();
  });

  it('usar la conversión de otro alimento no crea una propia', () => {
    const r = applyCoccion(champis, { ...coccionDraft(champis, []), cambia: true, modo: 'otra', otraId: 'setas' });
    expect(r.food.conversionId).toBe('setas');
    expect(r.conversion).toBeUndefined();
  });
});

describe('migración v3: verduras congeladas con conversión', () => {
  const v2 = (): AppData => {
    const d = createSeedData();
    d.version = 2;
    d.foods = d.foods.map((f) => (f.conversionId === 'verdura_congelada' ? { ...f, conversionId: undefined, estadoNutricionalBase: 'listo_para_consumir' } : f));
    d.conversions = d.conversions.filter((c) => c.id !== 'verdura_congelada');
    return d;
  };
  it('las que no ha tocado el usuario ganan la conversión y se marcan para sincronizar', () => {
    const m = mergeWithSeed(v2());
    const pisto = m.foods.find((f) => f.id === 'pisto')!;
    expect(pisto).toMatchObject({ estadoNutricionalBase: 'crudo', conversionId: 'verdura_congelada' });
    expect(m.conversions.some((c) => c.id === 'verdura_congelada')).toBe(true);
    expect(m.sync.pending).toContain('food:pisto');
    expect(m.version).toBe(DATA_VERSION);
  });
  it('si el usuario ya le puso otra conversión, se respeta', () => {
    const d = v2();
    d.foods = d.foods.map((f) => (f.id === 'pisto' ? { ...f, estadoNutricionalBase: 'crudo', conversionId: 'ratatouille' } : f));
    const m = mergeWithSeed(d);
    expect(m.foods.find((f) => f.id === 'pisto')!.conversionId).toBe('ratatouille');
  });
});
