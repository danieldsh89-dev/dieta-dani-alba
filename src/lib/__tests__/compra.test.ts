import { describe, expect, it } from 'vitest';
import type { AppData, DayLog } from '../../types';
import { createSeedData } from '../../store/seed';
import { toFoodMap } from '../nutrition';
import { toConversionMap } from '../conversions';
import * as S from '../stock';
import { datesBetween, plannedMeals, shoppingList } from '../planning';
import { apuntadosDieta, comprados, listaCompra, listaTexto, porPasillo } from '../compra';

const seed = createSeedData();
const fm = toFoodMap(seed.foods);
const cm = toConversionMap(seed.conversions);
const HOY = '2026-10-15';
const HASTA = '2026-10-18';
const NOW = S.momentOf(HOY, 12);
const at = (fecha: string, h: number) => new Date(S.momentOf(fecha, h)).toISOString();

function dayWith(fecha: string, items: [string, number][], bloque: 'A' | 'B' | 'C' = 'B'): DayLog {
  return {
    fecha,
    bloques: {
      [bloque]: { meal: { id: 'm' + fecha, nombre: 'Comida', bloque, origen: 'manual', items: items.map(([foodId, g]) => ({ foodId, cantidades: { dani: g, alba: 0 } })) } },
    },
  };
}

function data(stock: Partial<AppData['stock']> = {}, history: DayLog[] = []): AppData {
  const d = createSeedData();
  d.history = history;
  d.stock = { ...d.stock, config: { ...d.stock.config, desde: at('2026-10-01', 9) }, ...stock };
  return d;
}

const lista = (d: AppData) => listaCompra(d, fm, cm, S.computeStock(d, fm, cm, NOW), HOY, HASTA, HOY, NOW);
const plan = [dayWith('2026-10-16', [['pollo_pechuga', 300]])];
const necesita = () => shoppingList(plannedMeals(plan, datesBetween(HOY, HASTA)), fm, cm)[0].comprar;

describe('lista de la compra de la casa', () => {
  it('lo del plan entra con lo que falta, descontando la despensa', () => {
    const full = necesita();
    const sinStock = lista(data({}, plan));
    expect(sinStock.entradas).toHaveLength(1);
    expect(sinStock.entradas[0]).toMatchObject({ key: 'pollo_pechuga', origen: 'plan', compra: full, pasillo: 'Carne' });

    const d = data({ items: { pollo_pechuga: S.foodItem(fm.pollo_pechuga, HOY) }, events: [S.ev('pollo_pechuga', 'set', { valor: 100 }, 'revision', at(HOY, 10))] }, plan);
    const l = lista(d);
    expect(l.entradas[0].compra).toBe(Math.ceil((full - 100) / 5) * 5);
    expect(l.entradas[0].detalle).toContain('en casa');
  });

  it('si la despensa lo cubre, va a "ya en casa"', () => {
    const d = data({ items: { pollo_pechuga: S.foodItem(fm.pollo_pechuga, HOY) }, events: [S.ev('pollo_pechuga', 'set', { valor: 2000 }, 'revision', at(HOY, 10))] }, plan);
    const l = lista(d);
    expect(l.entradas).toHaveLength(0);
    expect(l.enCasa.map((e) => e.key)).toEqual(['pollo_pechuga']);
  });

  it('cosas de casa: se acaba, apuntado, preguntar', () => {
    const lav = S.casaItem('Lavavajillas', HOY, { id: 'c1', zona: 'limpieza' });
    const papel = S.casaItem('Papel higiénico', HOY, { id: 'c2', zona: 'bano', apuntado: true });
    const velas = S.casaItem('Velas', HOY, { id: 'c3', reponer: 'preguntar', compras: ['2026-10-01'] });
    const d = data({
      items: { c1: lav, c2: papel, c3: velas },
      events: [S.ev('c1', 'nivel', { nivel: 'agotado' }, 'voz', at(HOY, 9)), S.ev('c3', 'nivel', { nivel: 'agotado' }, 'voz', at(HOY, 9))],
    });
    const l = lista(d);
    expect(l.entradas.map((e) => [e.key, e.origen, e.pasillo])).toEqual([
      ['c1', 'acaba', 'Limpieza y hogar'],
      ['c2', 'apuntado', 'Baño e higiene'],
    ]);
    expect(l.preguntas.map((i) => i.id)).toEqual(['c3']);
  });

  it('alimentos fuera del plan: se sugieren si se acaban; entran si se apuntan', () => {
    const huevo = S.foodItem(fm.huevo, HOY);
    const avena = { ...S.foodItem(fm.avena, HOY), apuntado: true };
    const d = data({ items: { huevo, avena }, events: [S.ev('huevo', 'set', { valor: 0 }, 'revision', at(HOY, 9))] });
    const l = lista(d);
    expect(l.sugerencias.map((i) => i.id)).toEqual(['huevo']);
    expect(l.entradas.map((e) => [e.key, e.origen])).toEqual([['avena', 'apuntado']]);
    expect(apuntadosDieta(d, fm, new Set()).map((s) => s.food.id)).toEqual(['avena']);
    expect(apuntadosDieta(d, fm, new Set(['avena']))).toHaveLength(0);
  });

  it('comprado → despensa: el alimento suma lo comprado y lo de casa aprende la compra', () => {
    const lav = S.casaItem('Lavavajillas', HOY, { id: 'c1', zona: 'limpieza', apuntado: true });
    const d = data({ items: { c1: lav } }, plan);
    const l = lista(d);
    const r = comprados(d, fm, l.entradas, HOY, at(HOY, 18));
    const pollo = r.events.find((e) => e.item === 'pollo_pechuga')!;
    expect(pollo).toMatchObject({ tipo: 'delta', valor: necesita(), origen: 'compra' });
    const casa = r.items.find((i) => i.id === 'c1')!;
    expect(casa.apuntado).toBe(false);
    expect(casa.compras).toContain(HOY);
    expect(r.events.find((e) => e.item === 'c1')).toMatchObject({ tipo: 'nivel', nivel: 'ok' });
  });

  it('texto para compartir, por pasillos', () => {
    const papel = S.casaItem('Papel higiénico', HOY, { id: 'c2', zona: 'bano', apuntado: true });
    const l = lista(data({ items: { c2: papel } }, plan));
    expect(porPasillo(l.entradas).map((g) => g.pasillo)).toEqual(['Carne', 'Baño e higiene']);
    const t = listaTexto(l.entradas, 'Compra', ['c2']);
    expect(t).toContain('— Carne —');
    expect(t).toContain('☑ Papel higiénico');
  });
});
