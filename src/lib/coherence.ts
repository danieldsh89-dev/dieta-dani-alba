/**
 * Sentido común en las combinaciones que propone el generador: nada de arroz con yogur y
 * plátano, cuscús con yogur, pollo con frutos rojos en el desayuno, dos carnes en un plato…
 * Lo que el usuario pide expresamente (obligatorio / "quiero incluir") se respeta siempre:
 * solo se juzga lo que añade el generador.
 * Funciones puras — tests en __tests__/coherence.test.ts.
 */
import type { Block, Food } from '../types';
import type { FoodMap } from './nutrition';

/** Hidratos de plato principal (no de desayuno) */
const MAIN_HC = new Set(['arroz', 'pasta', 'pasta_legumbres', 'cuscus', 'papa_fresca', 'papa_bote', 'gnocchi', 'gnocchi_patata', 'garbanzos', 'arroz_coliflor']);
/** Proteínas "de acompañamiento" que sí pueden ir con otra (huevo, claras, fiambre) */
const SIDE_PROT = new Set(['claras', 'huevo', 'pavo_lonchas']);

export const isSweet = (f: Food) =>
  f.tags.includes('dulce') || f.categoria === 'postre' || f.categoria === 'fruta' || /chocolate|cacao|cola_?cao|mermelada|miel/.test(f.id);

/** Lácteos de desayuno/postre (yogur, queso batido, leche…): no pegan con un plato de arroz o cuscús */
export const isBreakfastDairy = (f: Food) => f.categoria === 'lacteo' || f.id.startsWith('yogur') || f.id.startsWith('proteina_');

export const isSavoryMain = (f: Food) =>
  (f.categoria === 'proteina' && !isSweet(f)) || MAIN_HC.has(f.id) || f.categoria === 'verdura' || f.categoria === 'salsa';

const isMainProtein = (f: Food) => f.categoria === 'proteina' && !SIDE_PROT.has(f.id);

/**
 * Motivos por los que una combinación no tiene sentido (vacío = bien).
 * `forced`: lo que pidió el usuario; una pareja en la que ambos son pedidos no cuenta.
 */
export function incoherencias(ids: string[], bloque: Block, fm: FoodMap, forced: Set<string> = new Set(), conPostre = false): string[] {
  const foods = ids.map((id) => fm[id]).filter(Boolean) as Food[];
  const out: string[] = [];
  /** alguna pareja (a de `as`, b de `bs`) en la que al menos uno lo añadió el generador */
  const pair = (as: Food[], bs: Food[]) => as.some((a) => bs.some((b) => a.id !== b.id && !(forced.has(a.id) && forced.has(b.id))));
  const added = (fs: Food[]) => fs.some((f) => !forced.has(f.id));

  if (bloque === 'A') {
    const sweet = foods.filter(isSweet);
    const savory = foods.filter((f) => (f.categoria === 'proteina' && f.tags.includes('salado')) || f.categoria === 'verdura' || f.categoria === 'salsa');
    if (sweet.length && savory.length && pair(sweet, savory)) out.push('mezcla dulce y salado en el desayuno');
    const mainHc = foods.filter((f) => MAIN_HC.has(f.id));
    if (mainHc.length && added(mainHc)) out.push('hidrato de comida en el desayuno');
  } else {
    const main = foods.filter(isSavoryMain);
    if (main.length && !conPostre) {
      // en comida/cena, el dulce o el yogur solo vale si lo pidió el usuario
      const sweet = foods.filter((f) => isSweet(f) && !forced.has(f.id));
      if (sweet.length) out.push('algo dulce con un plato salado');
      const dairy = foods.filter((f) => isBreakfastDairy(f) && !isSweet(f) && !forced.has(f.id));
      if (dairy.length) out.push('yogur / lácteo de desayuno con un plato salado');
    }
    const prots = foods.filter(isMainProtein);
    if (prots.length > 1 && added(prots)) out.push('dos proteínas principales en el plato');
    const hcs = foods.filter((f) => MAIN_HC.has(f.id));
    if (hcs.length > 1 && added(hcs)) out.push('dos hidratos principales en el plato');
  }
  if (foods.filter((f) => f.categoria === 'proteina').length > 2 && added(foods.filter((f) => f.categoria === 'proteina'))) out.push('demasiadas proteínas');
  return out;
}
