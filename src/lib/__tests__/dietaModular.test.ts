import { describe, expect, it } from 'vitest';
import { DIETA_MODULAR } from '../../data/dietaModular';
import { createSeedData, mergeWithSeed } from '../../store/seed';
import { toFoodMap, mealNutrients, rangeStatus } from '../nutrition';
import { baseToServing, toConversionMap } from '../conversions';
import { touch, tombstone, key } from '../../sync/docs';
import { PROFILE_IDS } from '../../types';

const seed = createSeedData();
const fm = toFoodMap(seed.foods);
const cm = toConversionMap(seed.conversions);

describe('dieta modular (PDF) como favoritos', () => {
  it('13 A + 14 B + 14 C con los nombres del documento', () => {
    expect(DIETA_MODULAR.filter((f) => f.bloque === 'A')).toHaveLength(13);
    expect(DIETA_MODULAR.filter((f) => f.bloque === 'B')).toHaveLength(14);
    expect(DIETA_MODULAR.filter((f) => f.bloque === 'C')).toHaveLength(14);
    for (const f of DIETA_MODULAR) expect(f.nombre.startsWith(f.id.slice(3) + ' ')).toBe(true);
  });

  it('todos los ingredientes existen en la base', () => {
    for (const f of DIETA_MODULAR) for (const i of f.items) expect(fm[i.foodId], `${f.nombre}: ${i.foodId}`).toBeTruthy();
  });

  it('las cantidades mostradas en cocinado/listo son EXACTAMENTE las del documento', () => {
    for (const sf of DIETA_MODULAR) {
      const fav = seed.favorites.find((x) => x.id === sf.id)!;
      expect(fav, sf.id).toBeTruthy();
      sf.items.forEach((it, i) => {
        const item = fav.items[i];
        for (const p of PROFILE_IDS) {
          const shown = baseToServing(fm[it.foodId], item.cantidades[p], cm, item.metodoId);
          expect(shown, `${sf.nombre} ${it.foodId} ${p}`).toBeCloseTo(it[p], 6);
        }
      });
    }
    // ejemplo: B1 Dani 150 g pollo cocinado = 200 g en crudo
    const b1 = seed.favorites.find((x) => x.id === 'dm_B1')!;
    expect(b1.items[0].cantidades.dani).toBeCloseTo(200, 6);
  });

  it('se añaden a instalaciones existentes, pero no vuelven si el usuario los borró', () => {
    const old = createSeedData();
    const viejo = { ...old, favorites: old.favorites.filter((f) => !f.id.startsWith('dm_')) };
    expect(mergeWithSeed(viejo).favorites.filter((f) => f.id.startsWith('dm_'))).toHaveLength(41);
    const borrado = tombstone({ ...old, favorites: old.favorites.filter((f) => f.id !== 'dm_A1') }, [key('fav', 'dm_A1')]);
    const m = mergeWithSeed(borrado);
    expect(m.favorites.some((f) => f.id === 'dm_A1')).toBe(false);
    expect(m.favorites.filter((f) => f.id.startsWith('dm_'))).toHaveLength(40);
    // y no se duplican
    const conUso = touch({ ...old, favorites: old.favorites.map((f) => (f.id === 'dm_B1' ? { ...f, usos: 3 } : f)) }, [key('fav', 'dm_B1')]);
    const m2 = mergeWithSeed(conUso);
    expect(m2.favorites.filter((f) => f.id === 'dm_B1')).toHaveLength(1);
    expect(m2.favorites.find((f) => f.id === 'dm_B1')!.usos).toBe(3);
  });

  it('informe: kcal y proteína frente a los objetivos del bloque', () => {
    const rows: string[] = [];
    for (const sf of DIETA_MODULAR) {
      const fav = seed.favorites.find((x) => x.id === sf.id)!;
      const cells = PROFILE_IDS.map((p) => {
        const n = mealNutrients(fav, p, fm);
        const prof = seed.profiles[p];
        const rest = prof.bloques[sf.bloque];
        const train = prof.entreno.bloques[sf.bloque];
        const st = rangeStatus(n.kcal, rest);
        const stT = rangeStatus(n.kcal, train);
        return `${p} ${Math.round(n.kcal)} kcal P${Math.round(n.proteina)} HC${Math.round(n.carbohidratos)} G${Math.round(n.grasas)} [obj ${rest.kcal}±${rest.tolerancia}: ${st}${train.kcal !== rest.kcal ? ` | entreno ${train.kcal}: ${stT}` : ''}]`;
      });
      rows.push(`${sf.nombre.padEnd(30)} ${cells.join('  ·  ')}`);
    }
    console.log('INFORME\n' + rows.join('\n'));
  });
});
