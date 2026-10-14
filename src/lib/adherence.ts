/**
 * Cumplimiento del plan: cuántos días se registraron y confirmaron, cuántas comidas fueron libres
 * o se corrigieron ("lo que comí de verdad"), extras, y en qué bloque se falla más.
 */
import type { Block, DayLog } from '../types';
import { BLOCKS, PROFILE_IDS } from '../types';
import { addDays, weekStart } from './planning';
import { isFree, isSplit } from './day';

export interface WeekAdherence {
  semana: string; // lunes
  dias: number; // días con algo registrado
  confirmados: number;
  comidas: number; // comidas del plan (por persona)
  libres: number;
  corregidas: number;
  extras: number;
}

export interface Adherence {
  semanas: WeekAdherence[];
  /** comidas libres por bloque (en el periodo) */
  libresPorBloque: Record<Block, number>;
  comidasPorBloque: Record<Block, number>;
  /** % de comidas que se siguieron tal cual (sin libre ni corrección) */
  seguidas: number;
}

export function adherence(history: DayLog[], hoy: string, semanas = 4): Adherence {
  const start = addDays(weekStart(hoy), -7 * (semanas - 1));
  const weeks: WeekAdherence[] = Array.from({ length: semanas }, (_, i) => ({
    semana: addDays(start, i * 7),
    dias: 0,
    confirmados: 0,
    comidas: 0,
    libres: 0,
    corregidas: 0,
    extras: 0,
  }));
  const libresPorBloque = { A: 0, B: 0, C: 0 } as Record<Block, number>;
  const comidasPorBloque = { A: 0, B: 0, C: 0 } as Record<Block, number>;
  for (const day of history) {
    if (day.fecha < start || day.fecha > hoy) continue;
    const w = weeks[Math.floor((Date.parse(day.fecha) - Date.parse(start)) / (7 * 86400000))];
    if (!w) continue;
    let any = false;
    for (const b of BLOCKS) {
      const slots = isSplit(day, b) ? PROFILE_IDS.map((p) => day.separado![b]![p]) : [day.bloques[b]];
      for (const s of slots) {
        if (!s) continue;
        any = true;
        w.comidas++;
        comidasPorBloque[b]++;
        if (isFree(s)) {
          w.libres++;
          libresPorBloque[b]++;
        } else if (s.meal.ajustadoReal) w.corregidas++;
      }
    }
    w.extras += day.extras?.length ?? 0;
    if (any) w.dias++;
    if (any && day.confirmado) w.confirmados++;
  }
  const total = weeks.reduce((s, w) => s + w.comidas, 0);
  const fuera = weeks.reduce((s, w) => s + w.libres + w.corregidas, 0);
  return { semanas: weeks, libresPorBloque, comidasPorBloque, seguidas: total ? Math.round(((total - fuera) / total) * 100) : 0 };
}
