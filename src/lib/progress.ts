/**
 * Progreso: peso (tendencia y ritmo semanal) y cumplimiento diario de kcal/proteína.
 * Funciones puras — tests en __tests__/progress.test.ts.
 */
import type { DayLog, Profile, ProfileId, WeightEntry } from '../types';
import { BLOCKS } from '../types';
import { dayGoals, dayTotals } from './day';
import type { FoodMap } from './nutrition';
import { addDays } from './planning';

const DAY_MS = 86400000;
/** nº de día exacto (UTC puro: sin saltos por el cambio de hora) */
const dayNum = (fecha: string) => {
  const [y, m, d] = fecha.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
};

export function weightSeries(pesos: WeightEntry[], pid: ProfileId): WeightEntry[] {
  return pesos.filter((w) => w.profile === pid).sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/** Media móvil de los registros de los últimos `days` días (incluido el propio). */
export function movingAverage(series: WeightEntry[], days = 7): { fecha: string; kg: number }[] {
  return series.map((w) => {
    const d = dayNum(w.fecha);
    const win = series.filter((x) => dayNum(x.fecha) <= d && dayNum(x.fecha) > d - days);
    return { fecha: w.fecha, kg: win.reduce((s, x) => s + x.kg, 0) / win.length };
  });
}

/**
 * Ritmo en kg/semana: pendiente de la recta de mínimos cuadrados con los registros
 * de los últimos `windowDays` días. null si hay menos de 2 registros o menos de 4 días de rango.
 */
export function weeklyRate(series: WeightEntry[], windowDays = 28): number | null {
  if (series.length < 2) return null;
  const last = dayNum(series[series.length - 1].fecha);
  const pts = series.filter((w) => dayNum(w.fecha) > last - windowDays).map((w) => [dayNum(w.fecha), w.kg] as const);
  if (pts.length < 2) return null;
  const xs = pts.map((p) => p[0]);
  if (Math.max(...xs) - Math.min(...xs) < 4) return null;
  const mx = xs.reduce((s, x) => s + x, 0) / pts.length;
  const my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let num = 0;
  let den = 0;
  for (const [x, y] of pts) {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  }
  return den === 0 ? null : (num / den) * 7;
}

/** Semanas hasta el objetivo al ritmo actual (null si no se acerca). */
export function weeksToGoal(current: number, goal: number, ratePerWeek: number | null): number | null {
  if (ratePerWeek === null || ratePerWeek === 0) return null;
  const diff = goal - current;
  if (Math.abs(diff) < 0.05) return 0;
  if (Math.sign(diff) !== Math.sign(ratePerWeek)) return null;
  return diff / ratePerWeek;
}

export interface DayStat {
  fecha: string;
  /** hay alguna comida registrada ese día */
  registrado: boolean;
  /** hay comidas libres sin kcal estimadas: los totales son incompletos */
  incompleto: boolean;
  kcal: number;
  proteina: number;
  kcalObjetivo: number;
  proteinaObjetivo: number;
  entreno: boolean;
  /** kcal dentro de ±10 % del objetivo y proteína ≥ 90 % */
  cumplido: boolean;
}

export function dayStats(
  history: DayLog[],
  profile: Profile,
  fm: FoodMap,
  dates: string[],
): DayStat[] {
  return dates.map((fecha) => {
    const day = history.find((h) => h.fecha === fecha);
    const g = dayGoals(profile, fecha, day);
    const t = dayTotals(day, fm)[profile.id];
    const slots = BLOCKS.map((b) => day?.bloques[b]).filter(Boolean);
    const incompleto = slots.some((s) => s && 'libre' in s && !s.kcalEstimadas[profile.id]);
    const registrado = slots.length > 0;
    const cumplido =
      registrado && !incompleto && Math.abs(t.kcal - g.kcalDia) <= g.kcalDia * 0.1 && t.proteina >= g.proteinaDia * 0.9;
    return {
      fecha,
      registrado,
      incompleto,
      kcal: t.kcal,
      proteina: t.proteina,
      kcalObjetivo: g.kcalDia,
      proteinaObjetivo: g.proteinaDia,
      entreno: g.entreno,
      cumplido,
    };
  });
}

export interface PeriodSummary {
  diasRegistrados: number;
  diasCumplidos: number;
  /** % de días cumplidos sobre los registrados (null si no hay registrados) */
  cumplimiento: number | null;
  kcalMedia: number | null;
  proteinaMedia: number | null;
  kcalObjetivoMedio: number;
  proteinaObjetivoMedia: number;
}

export function summarize(stats: DayStat[]): PeriodSummary {
  const reg = stats.filter((s) => s.registrado && !s.incompleto);
  const avg = (f: (s: DayStat) => number, list: DayStat[]) => (list.length ? list.reduce((a, s) => a + f(s), 0) / list.length : null);
  const done = stats.filter((s) => s.cumplido).length;
  return {
    diasRegistrados: stats.filter((s) => s.registrado).length,
    diasCumplidos: done,
    cumplimiento: reg.length ? (done / reg.length) * 100 : null,
    kcalMedia: avg((s) => s.kcal, reg),
    proteinaMedia: avg((s) => s.proteina, reg),
    kcalObjetivoMedio: avg((s) => s.kcalObjetivo, stats) ?? 0,
    proteinaObjetivoMedia: avg((s) => s.proteinaObjetivo, stats) ?? 0,
  };
}

/** Últimos `n` días terminando en `end` (incluido). */
export function lastDays(end: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDays(end, i - n + 1));
}
