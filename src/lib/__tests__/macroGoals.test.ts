import { describe, expect, it } from 'vitest';
import { ALBA_1600 } from '../../data/albaCantidades';
import { DIETA_MODULAR } from '../../data/dietaModular';
import { SEED_PROFILES } from '../../data/profiles';
import { createSeedData, DATA_VERSION, mergeWithSeed } from '../../store/seed';
import { key } from '../../sync/docs';
import type { AppData, Profile } from '../../types';
import { BLOCKS } from '../../types';
import { servingToBase, toConversionMap } from '../conversions';
import { dayGoals } from '../day';
import { mealNutrients, rangeStatus, toFoodMap } from '../nutrition';

/** Datos tal como los guardó la v1.11: sin objetivos de hidratos y grasa. */
function datosV3(): AppData {
  const d = createSeedData();
  const antiguo = (p: Profile, kcalDia: number, proteinaDia: number): Profile => {
    const { hidratosDia: _h, grasaDia: _g, ...resto } = p;
    const { hidratosDia: _eh, grasaDia: _eg, ...entreno } = p.entreno;
    return { ...resto, kcalDia, proteinaDia, entreno: { ...entreno, activo: true, dias: [1, 3] } };
  };
  return {
    ...d,
    version: 3,
    profiles: { dani: antiguo(d.profiles.dani, 1900, 160), alba: antiguo(d.profiles.alba, 1400, 100) },
  };
}

/** Favoritos tal como estaban antes de la v1.12.1: cantidades de Alba del documento. */
function datosV4(): AppData {
  const d = createSeedData();
  const fm = toFoodMap(d.foods);
  const cm = toConversionMap(d.conversions);
  const favorites = d.favorites.map((f) => {
    const original = DIETA_MODULAR.find((x) => x.id === f.id);
    if (!original) return f;
    const items = f.items.map((i, k) => ({
      ...i,
      cantidades: { ...i.cantidades, alba: servingToBase(fm[i.foodId], original.items[k].alba, cm, i.metodoId) },
    }));
    return { ...f, items, totales: { ...f.totales, alba: mealNutrients({ ...f, items }, 'alba', fm) } };
  });
  return { ...d, version: 4, favorites };
}

describe('cantidades de Alba en los favoritos', () => {
  const seed = createSeedData();
  const fm = toFoodMap(seed.foods);
  const kcalAlba = (d: AppData, id: string) => {
    const f = d.favorites.find((x) => x.id === id)!;
    return mealNutrients(f, 'alba', fm).kcal;
  };

  it('los 41 favoritos quedan en el rango de sus objetivos', () => {
    for (const sf of DIETA_MODULAR) {
      const f = seed.favorites.find((x) => x.id === sf.id)!;
      expect(rangeStatus(mealNutrients(f, 'alba', fm).kcal, SEED_PROFILES.alba.bloques[sf.bloque]), sf.nombre).toBe('en_rango');
    }
  });

  it('solo cambian ingredientes que existen en la receta, sin duplicados, y no superan la ración de Dani', () => {
    for (const [id, nuevas] of Object.entries(ALBA_1600)) {
      const sf = DIETA_MODULAR.find((x) => x.id === id)!;
      for (const [foodId, q] of Object.entries(nuevas)) {
        const its = sf.items.filter((i) => i.foodId === foodId);
        expect(its, `${id} ${foodId}`).toHaveLength(1);
        expect(q).toBeGreaterThan(its[0].alba);
        if (its[0].dani > 0) expect(q).toBeLessThanOrEqual(its[0].dani);
      }
    }
  });

  it('la migración los actualiza, con totales, sin tocar a Dani, y se sincroniza', () => {
    const v = datosV4();
    const m = mergeWithSeed(v);
    expect(m.version).toBe(DATA_VERSION);
    for (const id of Object.keys(ALBA_1600)) {
      expect(kcalAlba(m, id)).toBeCloseTo(kcalAlba(seed, id), 6);
      const f = m.favorites.find((x) => x.id === id)!;
      expect(f.totales.alba.kcal).toBeCloseTo(kcalAlba(seed, id), 6);
      expect(f.items.map((i) => i.cantidades.dani)).toEqual(v.favorites.find((x) => x.id === id)!.items.map((i) => i.cantidades.dani));
      expect(m.sync.pending).toContain(key('fav', id));
    }
  });

  it('no pisa un favorito cambiado a mano y conserva usos y foto', () => {
    const v = datosV4();
    v.favorites = v.favorites.map((f) => {
      if (f.id === 'dm_B1') return { ...f, items: f.items.map((i) => (i.foodId === 'arroz' ? { ...i, cantidades: { ...i.cantidades, alba: 10 } } : i)) };
      if (f.id === 'dm_B2') return { ...f, usos: 7, foto: 'x' };
      return f;
    });
    const m = mergeWithSeed(v);
    expect(m.favorites.find((f) => f.id === 'dm_B1')!.items.find((i) => i.foodId === 'arroz')!.cantidades.alba).toBe(10);
    expect(m.sync.pending).not.toContain(key('fav', 'dm_B1'));
    expect(m.favorites.find((f) => f.id === 'dm_B2')).toMatchObject({ usos: 7, foto: 'x' });
    expect(kcalAlba(m, 'dm_B2')).toBeCloseTo(kcalAlba(seed, 'dm_B2'), 6);
  });

  it('no repite la migración sobre datos ya actualizados', () => {
    const m = mergeWithSeed({ ...createSeedData(), version: 4 });
    expect(m.sync.pending.filter((k) => k.startsWith('fav:'))).toEqual([]);
  });
});

describe('objetivos diarios de macros', () => {
  it('Alba: los objetivos pedidos, y sus macros cuadran con las kcal', () => {
    const a = SEED_PROFILES.alba;
    expect([a.kcalDia, a.proteinaDia, a.hidratosDia, a.grasaDia]).toEqual([1600, 130, 150, 55]);
    expect(Math.abs(a.proteinaDia * 4 + a.hidratosDia! * 4 + a.grasaDia! * 9 - a.kcalDia)).toBeLessThanOrEqual(20);
  });

  it('Alba: los bloques suman la proteína del día y dejan sitio al café', () => {
    const b = SEED_PROFILES.alba.bloques;
    expect(BLOCKS.reduce((s, x) => s + b[x].proteina, 0)).toBe(130);
    expect(1600 - BLOCKS.reduce((s, x) => s + b[x].kcal, 0)).toBe(60);
  });

  it('el día de entreno usa sus propios objetivos', () => {
    const alba = { ...SEED_PROFILES.alba, entreno: { ...SEED_PROFILES.alba.entreno, activo: true, dias: [0] } };
    const g = dayGoals(alba, '2026-10-12'); // lunes
    expect(g.entreno).toBe(true);
    expect(g.hidratosDia).toBeGreaterThan(150);
    expect(g.grasaDia).toBe(55);
  });

  it('un perfil sin objetivos (llegado de una versión antigua) da 0', () => {
    const { hidratosDia: _h, grasaDia: _g, ...viejo } = SEED_PROFILES.dani;
    expect(dayGoals(viejo as Profile, '2026-10-13')).toMatchObject({ hidratosDia: 0, grasaDia: 0 });
  });

  it('la migración pone los objetivos a Alba, respeta sus días de entreno y lo sincroniza', () => {
    const m = mergeWithSeed(datosV3());
    expect(m.version).toBe(DATA_VERSION);
    const a = m.profiles.alba;
    expect([a.kcalDia, a.proteinaDia, a.hidratosDia, a.grasaDia]).toEqual([1600, 130, 150, 55]);
    expect(a.bloques).toEqual(SEED_PROFILES.alba.bloques);
    expect(a.entreno).toMatchObject({ activo: true, dias: [1, 3], proteinaDia: 130 });
    expect(m.sync.pending).toEqual(expect.arrayContaining([key('profile', 'alba'), key('profile', 'dani')]));
  });

  it('la migración mantiene kcal y proteína de Dani y añade sus macros', () => {
    const d = mergeWithSeed(datosV3()).profiles.dani;
    expect([d.kcalDia, d.proteinaDia, d.hidratosDia, d.grasaDia]).toEqual([1900, 160, 170, 65]);
    expect(d.entreno.hidratosDia).toBeGreaterThan(170);
  });

  it('no pisa objetivos que ya llegaron por sincronización', () => {
    const v = datosV3();
    v.profiles.alba = { ...v.profiles.alba, kcalDia: 1550, hidratosDia: 140, grasaDia: 50 };
    const m = mergeWithSeed(v);
    expect(m.profiles.alba).toMatchObject({ kcalDia: 1550, hidratosDia: 140, grasaDia: 50 });
    expect(m.sync.pending).not.toContain(key('profile', 'alba'));
  });
});
