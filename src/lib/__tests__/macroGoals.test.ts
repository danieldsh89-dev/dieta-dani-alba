import { describe, expect, it } from 'vitest';
import { SEED_PROFILES } from '../../data/profiles';
import { createSeedData, DATA_VERSION, mergeWithSeed } from '../../store/seed';
import { key } from '../../sync/docs';
import type { AppData, Profile } from '../../types';
import { BLOCKS } from '../../types';
import { dayGoals } from '../day';

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
