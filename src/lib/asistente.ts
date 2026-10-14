/**
 * Asistente de voz: una frase → una orden de la app. Reglas (gratis, sin IA, sin conexión).
 * Planes ("plan para la semana que viene…"), comidas ("hoy he comido el B1", "pon pollo con
 * arroz en la cena de mañana"), cambios ("cambia el arroz por papas en la cena"), comida libre,
 * extras, peso, confirmar el día, repetir/copiar días, ir a una pantalla, buscar, temporizador
 * y todo lo de la despensa ("se acabó la leche…").
 * Funciones puras — tests en __tests__/asistente.test.ts.
 */
import type { AppData, Block, Favorite, Food, ProfileId } from '../types';
import { PROFILE_IDS } from '../types';
import { addDays, parseDate } from './planning';
import { normalize } from './voz';
import { findFoods } from './planVoz';
import { dayMeals } from './day';

export type Destino = 'hoy' | 'plan' | 'compra' | 'mercadona' | 'casa' | 'revision' | 'favoritos' | 'progreso' | 'alimentos' | 'generar';

export type Orden =
  | { tipo: 'plan'; texto: string }
  | { tipo: 'peso'; pid: ProfileId; kg: number; fecha: string }
  | { tipo: 'comida'; fecha: string; bloque: Block; para?: ProfileId; favId: string; alternativas: string[] }
  | { tipo: 'libre'; fecha: string; bloque: Block; para?: ProfileId; kcal?: number; descripcion?: string }
  | { tipo: 'extra'; fecha: string; foodId: string; personas: ProfileId[]; unidades: number }
  | { tipo: 'cambiar'; fecha: string; bloque: Block; para?: ProfileId; fromFood: string; toFoods: string[] }
  | { tipo: 'quitar_comida'; fecha: string; bloque: Block; para?: ProfileId }
  | { tipo: 'repetir_ayer'; fecha: string }
  | { tipo: 'copiar_dia'; from: string; to: string }
  | { tipo: 'confirmar'; fecha: string }
  | { tipo: 'ir'; destino: Destino }
  | { tipo: 'buscar'; q: string }
  | { tipo: 'temporizador'; minutos: number }
  | { tipo: 'despensa'; texto: string }
  | { tipo: 'nada'; texto: string };

const NUMS: Record<string, number> = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, quince: 15, veinte: 20, treinta: 30, cuarenta: 40, media: 0.5, medio: 0.5,
};
const num = (w: string) => NUMS[w] ?? Number(w.replace(',', '.'));
const N = '(\\d+(?:[.,]\\d+)?|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|quince|veinte|treinta|cuarenta)';

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

/** Fecha dicha (hoy por defecto) */
export function fechaDe(t: string, hoy: string): string {
  if (/\bpasado manana\b/.test(t)) return addDays(hoy, 2);
  if (/\bmanana\b/.test(t.replace(/por la manana/g, ''))) return addDays(hoy, 1);
  if (/\bantes de ayer\b|\banteayer\b/.test(t)) return addDays(hoy, -2);
  if (/\bayer\b/.test(t)) return addDays(hoy, -1);
  const wd = t.match(/\b(el )?(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/);
  if (wd) {
    const diff = (WEEKDAYS.indexOf(wd[2]) - parseDate(hoy).getDay() + 7) % 7;
    return addDays(hoy, diff);
  }
  return hoy;
}

/** Bloque dicho o deducido del verbo */
export function bloqueDe(t: string): Block | undefined {
  if (/\b(desayun\w*|merienda)\b/.test(t)) return 'A';
  if (/\b(cena|cenas|cenado|cenamos|cenar|ceno|cene)\b/.test(t)) return 'C';
  if (/\b(comida|comidas|almuerzo|almorzado|almorzamos|almorzar|mediodia)\b/.test(t)) return 'B';
  if (/\b(comido|comimos|comemos)\b/.test(t)) {
    const h = new Date().getHours();
    return h < 11 ? 'A' : h < 18 ? 'B' : 'C';
  }
  return undefined;
}

function personaDe(t: string, d: AppData): { pid?: ProfileId; ambos: boolean } {
  for (const p of PROFILE_IDS) {
    const n = normalize(d.profiles[p].nombre);
    if (new RegExp(`\\b(${n}|${p === 'dani' ? 'daniel' : n})\\b`).test(t) && !/\blos dos\b|\bambos\b/.test(t)) return { pid: p, ambos: false };
  }
  if (/\b(los dos|ambos|hemos|nos hemos|nosotros|comimos|cenamos|desayunamos)\b/.test(t)) return { ambos: true };
  return { ambos: false };
}

const yo = (d: AppData): ProfileId => d.settings.yoSoy ?? 'dani';

/** Mejor favorito para una frase (por su código "B1" o por las palabras del nombre e ingredientes) */
export function matchFavorites(t: string, favs: Favorite[], foods: Food[], bloque?: Block): Favorite[] {
  const code = t.match(/\b([abc]) ?(\d{1,2})\b/);
  if (code) {
    const c = `${code[1]}${code[2]}`.toUpperCase();
    const hit = favs.filter((f) => normalize(f.nombre).toUpperCase().startsWith(`${c} `) || f.nombre.toUpperCase().startsWith(c + ' '));
    if (hit.length) return hit;
  }
  const STOP = new Set('el la los las un una de del con y en para hoy ayer manana he hemos comido cenado desayunado pon pone apunta anade comida cena desayuno almuerzo que lo le al a mi'.split(' '));
  const words = t.split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w));
  if (!words.length) return [];
  const fm = new Map(foods.map((f) => [f.id, f]));
  const scored = favs
    .filter((f) => !bloque || f.bloque === bloque)
    .map((f) => {
      const hay = normalize([f.nombre, ...f.items.map((i) => fm.get(i.foodId)?.nombre ?? '')].join(' '));
      const name = normalize(f.nombre);
      const hits = words.filter((w) => hay.includes(w.replace(/s$/, ''))).length;
      const inName = words.filter((w) => name.includes(w.replace(/s$/, ''))).length;
      return { f, score: hits / words.length + 0.25 * inName };
    })
    .filter((x) => x.score >= 0.5)
    .sort((a, b) => b.score - a.score || (b.f.usos ?? 0) - (a.f.usos ?? 0));
  return scored.map((x) => x.f);
}

export function parseOrden(text: string, d: AppData, foods: Food[], hoy: string): Orden {
  const t = ` ${normalize(text).replace(/[¿?¡!;]/g, ' ').replace(/(?<!\d)[.,]|[.,](?!\d)/g, ' ').replace(/\s+/g, ' ')} `;
  const fecha = fechaDe(t, hoy);

  // temporizador
  const tm = t.match(new RegExp(`\\b(temporizador|alarma|avisame|cuenta atras)\\b.*?\\b${N} (minutos?|min)\\b`));
  if (tm) return { tipo: 'temporizador', minutos: num(tm[2]) };

  // confirmar el día
  if (/\b(hemos|he|habeis) (comido|seguido) (lo )?(planificado|previsto|del plan|el plan)\b|\bconfirma(r)? (el )?dia\b|\btodo segun (el )?plan\b/.test(t))
    return { tipo: 'confirmar', fecha: /\bayer\b/.test(t) ? addDays(hoy, -1) : hoy };

  // plan / generar una comida
  if (/\b(plan|menu|planifica\w*)\b/.test(t) || /\b(hazme|haz|prepara(me)?|crea(me)?|genera(me)?|proponme|propon|sugiere(me)?)\b .*\b(desayun\w*|comidas?|cenas?|almuerzos?)\b/.test(t))
    return { tipo: 'plan', texto: text };

  // peso
  const pw = t.match(/\b(peso|pesa|pesado|pesamos|pese)\b\D*?(\d{2,3}(?:[.,]\d+)?)/);
  if (pw) {
    const who = personaDe(t, d);
    return { tipo: 'peso', pid: who.pid ?? yo(d), kg: Number(pw[2].replace(',', '.')), fecha };
  }

  // repetir ayer / copiar un día
  if (/\b(repite|repetir|repetimos|igual que|lo mismo que) (lo de |el dia de )?ayer\b/.test(t)) return { tipo: 'repetir_ayer', fecha: hoy };
  const cp = t.match(/\bcopia(r)? (el dia de |lo de )?(hoy|ayer|manana) (a|para|en) (hoy|manana|pasado manana|el \w+)\b/);
  if (cp) return { tipo: 'copiar_dia', from: fechaDe(` ${cp[3]} `, hoy), to: fechaDe(` ${cp[5]} `, hoy) };

  // navegación y búsqueda
  const ir = t.match(/\b(abre|abrir|ve a|vete a|vamos a|ensename|muestrame|llevame a|quiero ver|ir a) (la |el |los |las |mis |mi )?(despensa|casa|lista de la compra|lista|compra|mercadona|carrito|plan|semana|favoritos|progreso|peso|alimentos|generador|recuento|revision)\b/);
  if (ir) {
    const m: Record<string, Destino> = { despensa: 'casa', casa: 'casa', 'lista de la compra': 'compra', lista: 'compra', compra: 'compra', mercadona: 'mercadona', carrito: 'mercadona', plan: 'plan', semana: 'plan', favoritos: 'favoritos', progreso: 'progreso', peso: 'progreso', alimentos: 'alimentos', generador: 'generar', recuento: 'revision', revision: 'revision' };
    return { tipo: 'ir', destino: m[ir[3]] };
  }
  if (/\b(carga|cargar|llena|prepara) (el )?carrito\b|\bhaz(me)? (la|el) (compra|pedido)\b/.test(t)) return { tipo: 'ir', destino: 'mercadona' };
  if (/\bque (hay que|tengo que|tenemos que) comprar\b/.test(t)) return { tipo: 'ir', destino: 'compra' };
  const bs = t.match(/\b(busca|buscar|buscame|donde esta|donde estan) (.+)$/);
  if (bs) return { tipo: 'buscar', q: bs[2].trim() };

  // cambiar un ingrediente de una comida
  const ch = t.match(/\b(cambia|cambiar|cambiame|sustituye|sustituir|cambiamos) (el |la |los |las )?(.+?) por (el |la |los |las )?(.+?)(?: en | para | de |$)/);
  if (ch) {
    const from = findFoods(` ${ch[3]} `, foods)[0];
    const to = findFoods(` ${ch[5]} `, foods)[0];
    if (from && to) {
      const b = bloqueDe(t.slice(t.indexOf(ch[5]) + ch[5].length)) ?? bloqueDe(t);
      // la comida de ese día que lleva el ingrediente
      const day = d.history.find((h) => h.fecha === fecha);
      const meals = dayMeals(day).filter((m) => (!b || m.bloque === b) && m.meal.items.some((i) => from.item.foods.includes(i.foodId)));
      const m = meals[0];
      if (m) {
        const fromFood = m.meal.items.find((i) => from.item.foods.includes(i.foodId))!.foodId;
        return { tipo: 'cambiar', fecha, bloque: m.bloque, para: m.para, fromFood, toFoods: to.item.foods };
      }
    }
  }

  // quitar una comida
  const qt = t.match(/\b(quita|quitar|borra|borrar|elimina|eliminar) (el |la )?(desayuno|comida|almuerzo|cena)\b/);
  if (qt) return { tipo: 'quitar_comida', fecha, bloque: bloqueDe(` ${qt[3]} `)! };

  // comida libre
  if (/\b(comida libre|cena libre|desayuno libre|(comido|cenado|desayunado|comemos|cenamos|comimos) fuera|fuera de casa|en un restaurante|hemos pedido)\b/.test(t)) {
    const k = t.match(/\b(\d{3,4}) (calorias|kcal)\b/);
    const who = personaDe(t, d);
    return { tipo: 'libre', fecha, bloque: bloqueDe(t) ?? 'B', para: who.ambos ? undefined : who.pid, kcal: k ? Number(k[1]) : undefined };
  }

  // extras / picoteo
  const ex = /\b(extra|picoteo|picado|picar|me he tomado|nos hemos tomado|se ha tomado|me he comido un|me he comido una|de postre)\b/.test(t);
  if (ex) {
    const f = findFoods(t, foods)[0];
    if (f) {
      const who = personaDe(t, d);
      const q = t.match(new RegExp(`\\b${N} (?!kilo|gram)`));
      return {
        tipo: 'extra',
        fecha,
        foodId: f.item.foods[0],
        personas: who.ambos ? [...PROFILE_IDS] : [who.pid ?? yo(d)],
        unidades: q ? num(q[1]) : 1,
      };
    }
  }

  // poner / registrar una comida (favorito)
  if (/\b(he|hemos|ha) (comido|cenado|desayunado|almorzado)\b|\b(pon|ponme|pone|apunta|anade|planifica|mete)\b/.test(t)) {
    const b = bloqueDe(t);
    const favs = matchFavorites(t, d.favorites, foods, b);
    if (favs.length) {
      const who = personaDe(t, d);
      return { tipo: 'comida', fecha, bloque: b ?? favs[0].bloque, para: who.ambos ? undefined : who.pid, favId: favs[0].id, alternativas: favs.slice(1, 4).map((f) => f.id) };
    }
  }

  // lo demás: despensa ("se acabó la leche, quedan 4 huevos…")
  return { tipo: 'despensa', texto: text };
}
