import type { Food, Nutrients } from '../types';
import { roundTo } from './conversions';
import { nutrientsFor } from './nutrition';

export interface BatchInput {
  /** peso inicial (crudo / seco / congelado) */
  pesoInicial: number;
  /** peso final tras cocinar */
  pesoFinal: number;
  raciones: { nombre: string; cantidad: number; peso: number }[];
}

export interface BatchPortion {
  nombre: string;
  /** gramos cocinados por ración (redondeados a 5) */
  cocinado: number;
  /** equivalente en crudo por ración */
  crudo: number;
  nutrientes: Nutrients;
}

export interface BatchResult {
  rendimiento: number;
  porciones: BatchPortion[];
  /** gramos cocinados que quedan (o faltan si negativo) tras el reparto redondeado */
  sobrante: number;
}

/**
 * Repartir tanda: con el rendimiento real (final/inicial) reparte el peso cocinado
 * proporcionalmente al "peso" de cada tipo de ración (p. ej. Dani 1, Alba 0,7).
 * Los valores nutricionales se calculan sobre el peso inicial equivalente (en el estado base del alimento).
 */
export function splitBatch(food: Food | undefined, input: BatchInput): BatchResult {
  if (input.pesoInicial <= 0 || input.pesoFinal <= 0) throw new Error('Los pesos deben ser positivos');
  const rendimiento = input.pesoFinal / input.pesoInicial;
  const totalShares = input.raciones.reduce((s, r) => s + r.cantidad * r.peso, 0);
  const porciones: BatchPortion[] = [];
  let usado = 0;
  for (const r of input.raciones) {
    if (r.cantidad <= 0) continue;
    const exact = totalShares > 0 ? (input.pesoFinal * r.peso) / totalShares : 0;
    const cocinado = roundTo(exact, 5);
    const crudo = cocinado / rendimiento;
    usado += cocinado * r.cantidad;
    // si el alimento está en base cocinado, sus nutrientes van por peso cocinado
    const baseGrams = food && food.estadoNutricionalBase === 'cocinado' ? cocinado : crudo;
    porciones.push({
      nombre: r.nombre,
      cocinado,
      crudo,
      nutrientes: food ? nutrientsFor(food, baseGrams) : { kcal: 0, proteina: 0, carbohidratos: 0, grasas: 0, fibra: 0, sal: 0 },
    });
  }
  return { rendimiento, porciones, sobrante: input.pesoFinal - usado };
}
