import type { Profile, ProfileId, Settings } from '../types';

export const SEED_PROFILES: Record<ProfileId, Profile> = {
  dani: {
    id: 'dani',
    nombre: 'Dani',
    edad: 37,
    alturaCm: 187,
    pesoActualKg: 96,
    pesoObjetivoKg: 89,
    kcalDia: 1900,
    proteinaDia: 160,
    bloques: {
      A: { kcal: 420, tolerancia: 40, proteina: 35 },
      B: { kcal: 670, tolerancia: 50, proteina: 55 },
      C: { kcal: 680, tolerancia: 60, proteina: 55 },
    },
    escalaRaciones: 1,
    restricciones: { permitePescado: false, permiteLecheVaca: true, maxLegumbresPorComida: null },
    saborPreferidoA: 'salado',
    notas:
      'Muy sedentario + entrenamiento 3-4 días/semana. No pescado por norma general. Le gustan las comidas saladas, el picante y las salsas light.',
  },
  alba: {
    id: 'alba',
    nombre: 'Alba',
    edad: 37,
    alturaCm: 157,
    pesoActualKg: 64,
    pesoObjetivoKg: 60,
    kcalDia: 1400,
    proteinaDia: 100,
    bloques: {
      A: { kcal: 300, tolerancia: 40, proteina: 22 },
      B: { kcal: 480, tolerancia: 40, proteina: 35 },
      C: { kcal: 560, tolerancia: 50, proteina: 38 },
    },
    escalaRaciones: 0.72,
    restricciones: { permitePescado: true, permiteLecheVaca: false, maxLegumbresPorComida: 100 },
    saborPreferidoA: 'ambos',
    notas:
      'No toma leche de vaca (sí yogur y queso). Usa bebida de almendras. Legumbres moderadas. Puede usar arroz de coliflor. Muchas veces prefiere dulce en el bloque A.',
  },
};

export const DEFAULT_SETTINGS: Settings = {
  mismaRecetaParaAmbos: true,
  permitirComplementosDistintos: false,
  mostrarPesos: 'cocinado',
  mostrarFibraSal: false,
};
