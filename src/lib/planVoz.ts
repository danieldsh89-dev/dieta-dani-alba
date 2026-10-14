/**
 * Planes por voz: "créame un plan para la semana que viene con arroz, pollo y carne de vaca;
 * desayunos variados, algunos días frutos rojos y yogur y tostadas para Dani, y para Alba
 * principalmente yogur". Se interpreta con reglas (gratis, sin IA, sin conexión) en una
 * "idea de plan" que se puede revisar y corregir, y luego se convierte en comidas concretas
 * (favoritos que encajan o comidas del generador), variando día a día.
 * Funciones puras — tests en __tests__/planVoz.test.ts.
 */
import type { Block, DayLog, Favorite, Food, Meal, Profile, ProfileId } from '../types';
import { PROFILE_IDS } from '../types';
import { addDays, parseDate, weekStart } from './planning';
import { generateMeals, signature, type GeneratorContext } from './mealGenerator';
import { favoriteToMeal } from './favorites';
import { isFree, isSplit, mealFor, personSlot } from './day';
import { mealNutrients, type FoodMap } from './nutrition';
import { FOOD_ALIASES, normalize } from './voz';

// ───────── la idea del plan ─────────

/** normal = se reparte entre los de su tipo; algunos = algunos días; principal = casi siempre; todos = siempre */
export type Freq = 'normal' | 'algunos' | 'principal' | 'todos';

export interface PlanItem {
  /** cómo se dijo ("tostadas", "carne de vaca") */
  label: string;
  /** alimentos que valen (cualquiera de ellos) */
  foods: string[];
  freq: Freq;
}

export interface PlanRule {
  bloques: Block[];
  /** solo para una persona (si no, para los dos) */
  para?: ProfileId;
  items: PlanItem[];
  variado: boolean;
}

export interface PlanIdea {
  fechas: string[];
  bloques: Block[];
  reglas: PlanRule[];
  excluir: PlanItem[];
  usarFavoritos: boolean;
  soloHuecos: boolean;
  /** "variado" dicho en general */
  variado: boolean;
  dudas: string[];
}

export const FREQ_LABEL: Record<Freq, string> = {
  normal: '',
  algunos: 'algunos días',
  principal: 'casi siempre',
  todos: 'todos los días',
};

export const BLOCK_LABEL: Record<Block, string> = { A: 'Desayunos', B: 'Comidas', C: 'Cenas' };

// ───────── conceptos (palabras → alimentos) ─────────

interface Concept {
  re: RegExp;
  label: string;
  pick: (f: Food) => boolean;
}

const has = (...ids: string[]) => (f: Food) => ids.includes(f.id);

/** Lo más específico primero */
const CONCEPTS: Concept[] = [
  { re: /\b(frutos? rojos?|frutos? del bosque|frutos? silvestres?|arandanos?|frutos)\b/, label: 'frutos rojos', pick: has('frutos_rojos_cong', 'arandanos_cong') },
  { re: /\byogur(es)? griegos?\b/, label: 'yogur griego', pick: has('yogur_griego_0') },
  { re: /\byogur(es)? liquidos?\b/, label: 'yogur líquido', pick: has('yogur_liquido_frutos_silvestres') },
  { re: /\b(yogur|yogures|yogurt|yogurts)\b/, label: 'yogur', pick: has('yogur_0', 'yogur_griego_0', 'leche_fermentada_proteica') },
  { re: /\b(queso batido|queso fresco batido)\b/, label: 'queso batido', pick: has('queso_batido') },
  { re: /\b(tostadas?|pan|pan de molde|sandwich|sandwiches)\b/, label: 'tostadas', pick: (f) => f.id.startsWith('pan_') },
  { re: /\b(tortitas?|obleas?)\b/, label: 'tortitas de arroz', pick: has('obleas_arroz') },
  { re: /\b(avena|porridge|gachas|copos de avena)\b/, label: 'avena', pick: has('avena', 'harina_avena') },
  { re: /\b(huevos?|tortillas? francesas?|revuelto)\b/, label: 'huevos', pick: has('huevo', 'claras') },
  { re: /\bclaras\b/, label: 'claras', pick: has('claras') },
  { re: /\b(pavo|jamon de pavo|fiambre)\b/, label: 'pavo', pick: has('pavo_lonchas') },
  { re: /\b(arroz de coliflor|coliflor)\b/, label: 'arroz de coliflor', pick: has('arroz_coliflor') },
  { re: /\barroz\b/, label: 'arroz', pick: has('arroz') },
  { re: /\b(contramuslos?)\b/, label: 'contramuslo', pick: has('contramuslo') },
  { re: /\bpollo\b/, label: 'pollo', pick: has('pollo_pechuga', 'contramuslo') },
  { re: /\b(carne de vaca|ternera|vacuno|carne picada|picada)\b/, label: 'carne de vaca', pick: has('carne_picada') },
  { re: /\balbondigas?\b/, label: 'albóndigas', pick: has('albondigas') },
  { re: /\bhamburguesas?\b/, label: 'hamburguesa', pick: has('hamburguesa') },
  { re: /\bchili\b/, label: 'chili', pick: has('chili') },
  { re: /\b(carne|carnes)\b/, label: 'carne', pick: has('carne_picada', 'albondigas', 'hamburguesa', 'carrilladas', 'chili') },
  { re: /\b(atun)\b/, label: 'atún', pick: has('atun') },
  { re: /\b(pescado|pescados|melva)\b/, label: 'pescado', pick: (f) => f.tags.includes('pescado') },
  { re: /\b(pasta de legumbres)\b/, label: 'pasta de legumbres', pick: has('pasta_legumbres') },
  { re: /\b(pasta|macarrones|espaguetis)\b/, label: 'pasta', pick: has('pasta', 'pasta_legumbres') },
  { re: /\b(gnocchis?|noquis?)\b/, label: 'gnocchi', pick: has('gnocchi', 'gnocchi_patata') },
  { re: /\b(papas?|patatas?)\b/, label: 'papas', pick: has('papa_fresca', 'papa_bote') },
  { re: /\b(cuscus)\b/, label: 'cuscús', pick: has('cuscus') },
  { re: /\b(garbanzos?|legumbres?)\b/, label: 'legumbres', pick: has('garbanzos', 'pasta_legumbres') },
  { re: /\b(tortillas? de maiz|tacos|fajitas|burritos?)\b/, label: 'tortillas de maíz', pick: has('tortilla_maiz') },
  { re: /\b(ensaladas?|lechuga)\b/, label: 'ensalada', pick: has('lechuga', 'tomate', 'pepino') },
  { re: /\b(verduras?|verdura)\b/, label: 'verdura', pick: (f) => f.categoria === 'verdura' && !f.tags.includes('acompanante') },
  { re: /\b(gazpacho)\b/, label: 'gazpacho', pick: has('gazpacho') },
  { re: /\b(platanos?)\b/, label: 'plátano', pick: has('platano') },
  { re: /\b(frutas?)\b/, label: 'fruta', pick: (f) => f.categoria === 'fruta' },
  { re: /\b(queso|quesos)\b/, label: 'queso', pick: (f) => f.categoria === 'queso' },
  { re: /\b(cottage)\b/, label: 'cottage', pick: has('cottage') },
  { re: /\b(proteina en polvo|batidos? de proteina|whey)\b/, label: 'proteína en polvo', pick: has('proteina_whey', 'proteina_chocolate', 'proteina_vegetal') },
  { re: /\b(chocolate)\b/, label: 'chocolate', pick: has('chocolate_85') },
  { re: /\b(aguacate)\b/, label: 'aguacate', pick: has('aguacate') },
];

const FREQ_WORDS: [RegExp, Freq][] = [
  [/\b(todos los dias|cada dia|siempre|a diario|diario)\b/, 'todos'],
  [/\b(principalmente|sobre todo|casi siempre|mayormente|normalmente|la mayoria de (los )?dias|casi todos los dias)\b/, 'principal'],
  [/\b(algunos dias|algun dia|a veces|de vez en cuando|varios dias|un par de dias|ocasionalmente)\b/, 'algunos'],
];
const VARIADO = /\b(variad[oa]s?|variar|variedad|distint[oa]s|diferentes|que cambien|no repetir|sin repetir)\b/;
const EXCLUDE = /\b(sin|nada de|no quiero|no queremos|que no (lleve|lleven|tenga|tengan|haya)|evita|evitar|excepto|menos)\b/;
const DELIM = /,|;|\.|\by que\b|\bpero\b/g;

const BLOCK_WORDS: [RegExp, Block][] = [
  [/\b(desayunos?|desayunar)\b/, 'A'],
  [/\b(almuerzos?|comidas?|mediodia)\b/, 'B'],
  [/\b(cenas?|cenar)\b/, 'C'],
];

export interface Found {
  pos: number;
  end: number;
  item: PlanItem;
}

export function findFoods(text: string, foods: Food[]): Found[] {
  const out: Found[] = [];
  let t = text;
  for (const c of CONCEPTS) {
    const re = new RegExp(c.re.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) {
      const ids = foods.filter((f) => !f.archivado && c.pick(f)).map((f) => f.id);
      if (ids.length) out.push({ pos: m.index, end: m.index + m[0].length, item: { label: c.label, foods: ids, freq: 'normal' } });
      t = t.slice(0, m.index) + ' '.repeat(m[0].length) + t.slice(m.index + m[0].length);
    }
  }
  // nombres de alimentos de la base que no son conceptos
  const names = foods
    .filter((f) => !f.archivado)
    .flatMap((f) => [f.nombre.split(' (')[0], ...(FOOD_ALIASES[f.id] ?? [])].map((n) => ({ n: normalize(n), f })))
    .filter((x) => x.n.length >= 4)
    .sort((a, b) => b.n.length - a.n.length);
  for (const { n, f } of names) {
    const i = t.indexOf(n);
    if (i < 0 || (i > 0 && /[a-z]/.test(t[i - 1])) || /[a-z]/.test(t[i + n.length] ?? '')) continue;
    out.push({ pos: i, end: i + n.length, item: { label: n, foods: [f.id], freq: 'normal' } });
    t = t.slice(0, i) + ' '.repeat(n.length) + t.slice(i + n.length);
  }
  return out.sort((a, b) => a.pos - b.pos);
}

// ───────── fechas ─────────

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

export function parseFechas(t: string, hoy: string): string[] | undefined {
  const range = (a: string, b: string) => {
    const out: string[] = [];
    for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
    return out;
  };
  const lunes = weekStart(hoy);
  const nextMon = addDays(lunes, 7);
  if (/\b(semana que viene|proxima semana|siguiente semana|la otra semana)\b/.test(t)) return filterDays(range(nextMon, addDays(nextMon, 6)), t);
  if (/\b(esta semana|lo que queda de semana|resto de (la )?semana)\b/.test(t)) return filterDays(range(hoy, addDays(lunes, 6)), t);
  if (/\bfin de semana\b/.test(t)) {
    const sat = addDays(lunes, 5) >= hoy ? addDays(lunes, 5) : addDays(nextMon, 5);
    return [sat, addDays(sat, 1)].filter((d) => d >= hoy);
  }
  const prox = t.match(/\b(proximos|siguientes) (\d+|dos|tres|cuatro|cinco|seis|siete|diez|catorce) dias\b/);
  if (prox) {
    const W: Record<string, number> = { dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, diez: 10, catorce: 14 };
    const n = W[prox[2]] ?? Number(prox[2]);
    return range(addDays(hoy, 1), addDays(hoy, n));
  }
  if (/\bpasado manana\b/.test(t)) return [addDays(hoy, 2)];
  if (/\bmanana\b/.test(t.replace(/por la manana/g, ''))) return [addDays(hoy, 1)];
  if (/\bhoy\b/.test(t)) return [hoy];
  const wd = t.match(/\b(el )?(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/);
  if (wd && !/\b(de|del) (lunes|martes|miercoles|jueves|viernes|sabado|domingo) a\b/.test(t)) {
    const target = WEEKDAYS.indexOf(wd[2]);
    const diff = (target - parseDate(hoy).getDay() + 7) % 7 || 7;
    return [addDays(hoy, diff)];
  }
  return undefined;
}

/** "de lunes a viernes" dentro del rango */
function filterDays(days: string[], t: string): string[] {
  const m = t.match(/\b(?:de|del) (lunes|martes|miercoles|jueves|viernes|sabado|domingo) (?:a|al) (lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/);
  if (!m) return days;
  const idx = (w: string) => (WEEKDAYS.indexOf(w) + 6) % 7; // lunes = 0
  const a = idx(m[1]);
  const b = idx(m[2]);
  return days.filter((d) => {
    const i = (parseDate(d).getDay() + 6) % 7;
    return i >= a && i <= b;
  });
}

// ───────── intérprete ─────────

export function parsePlanVoz(text: string, foods: Food[], profiles: Record<ProfileId, Profile>, hoy: string): PlanIdea {
  const t = ` ${normalize(text).replace(/[¿?¡!]/g, ' ')} `;
  const dudas: string[] = [];
  const fechasDichas = parseFechas(t, hoy);

  // bloques mencionados (con su posición)
  const marks: { pos: number; b: Block }[] = [];
  for (const [re, b] of BLOCK_WORDS) {
    const g = new RegExp(re.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = g.exec(t))) marks.push({ pos: m.index, b });
  }
  marks.sort((a, b) => a.pos - b.pos);
  const todasComidas = /\b(todas las comidas|todo el dia|desayuno,? comida y cena)\b/.test(t);

  // personas
  const personRe = new RegExp(
    `\\bpara (${PROFILE_IDS.map((p) => normalize(profiles[p].nombre)).join('|')}|daniel|los dos|ambos|los 2)\\b`,
    'g',
  );
  const personAt = (s: string) =>
    [...s.matchAll(personRe)].map((m) => {
      const w = m[1];
      const pid = PROFILE_IDS.find((p) => w.startsWith(normalize(profiles[p].nombre)) || (p === 'dani' && w === 'daniel'));
      return { pos: m.index!, pid };
    });

  // tramos: lo dicho antes de nombrar un bloque es general (comidas y cenas)
  const segs: { blocks: Block[]; start: number; end: number }[] = [];
  const firstPos = marks.length ? marks[0].pos : t.length;
  segs.push({ blocks: [], start: 0, end: firstPos });
  marks.forEach((m, i) => segs.push({ blocks: [m.b], start: m.pos, end: i + 1 < marks.length ? marks[i + 1].pos : t.length }));

  const excluir: PlanItem[] = [];
  const reglas: PlanRule[] = [];
  let variadoGlobal = VARIADO.test(t);
  let pendingBlocks: Block[] = [];

  for (const seg of segs) {
    const s = t.slice(seg.start, seg.end);
    const found = findFoods(s, foods);
    if (!found.length && seg.blocks.length) {
      // "comidas y cenas con arroz": el bloque se une al siguiente tramo
      pendingBlocks = [...pendingBlocks, ...seg.blocks];
      continue;
    }
    const blocks: Block[] = seg.blocks.length ? [...new Set([...pendingBlocks, ...seg.blocks])] : todasComidas ? ['A', 'B', 'C'] : ['B', 'C'];
    pendingBlocks = [];
    if (!found.length) continue;
    const persons = personAt(s);
    const delims = [...s.matchAll(DELIM)].map((m) => m.index!);
    const freqs = FREQ_WORDS.flatMap(([re, f]) => [...s.matchAll(new RegExp(re.source, 'g'))].map((m) => ({ pos: m.index!, f })));
    const excl = [...s.matchAll(new RegExp(EXCLUDE.source, 'g'))].map((m) => m.index!);
    const variado = VARIADO.test(s);
    const byPerson = new Map<string, PlanItem[]>();
    for (const fd of found) {
      // ¿excluido? ("sin pescado"): una palabra de exclusión poco antes, sin separador entre medias
      const ex = excl.find((p) => p < fd.pos && fd.pos - p < 40 && !delims.some((d) => d > p && d < fd.pos));
      if (ex !== undefined) {
        excluir.push(fd.item);
        continue;
      }
      // frecuencia: la última dicha antes, en la misma frase
      const fq = freqs.filter((f) => f.pos < fd.pos && !delims.some((d) => d > f.pos && d < fd.pos)).pop();
      const item = { ...fd.item, freq: fq?.f ?? 'normal' };
      // persona: la última nombrada antes; si no, la primera de después (sin coma entre medias)
      const before = persons.filter((p) => p.pos < fd.pos).pop();
      const after = persons.find((p) => p.pos > fd.pos && !delims.some((d) => d > fd.pos && d < p.pos));
      const pid = (before ?? after)?.pid;
      const k = pid ?? '';
      byPerson.set(k, [...(byPerson.get(k) ?? []), item]);
    }
    for (const [k, items] of byPerson) {
      const para = (k || undefined) as ProfileId | undefined;
      const prev = reglas.find((r) => r.para === para && r.bloques.join() === blocks.join());
      if (prev) prev.items.push(...items);
      else reglas.push({ bloques: blocks, para, items, variado: variado || variadoGlobal });
    }
  }

  // bloques del plan: los nombrados; si no se nombró ninguno, los tres
  const nombrados = [...new Set([...marks.map((m) => m.b), ...reglas.flatMap((r) => r.bloques)])];
  const soloUna = /\b(una|la) (comida|cena|desayuno)\b/.test(t) || /\b(hazme|prepara(me)?|dame) (una|la) /.test(t);
  const bloques: Block[] = soloUna && marks.length ? [...new Set(marks.map((m) => m.b))] : nombrados.length && !/\bplan\b/.test(t) ? nombrados : ['A', 'B', 'C'];
  let fechas = fechasDichas;
  if (!fechas) {
    fechas = soloUna ? [hoy] : Array.from({ length: 7 }, (_, i) => addDays(hoy, i + 1));
    if (!soloUna) dudas.push('No has dicho fechas: propongo los próximos 7 días (cámbialo abajo).');
  }
  if (!reglas.length && !excluir.length) dudas.push('No he reconocido alimentos: haré un plan variado con vuestros favoritos.');
  return {
    fechas,
    bloques: bloques.sort(),
    reglas,
    excluir,
    usarFavoritos: !/\b(sin favoritos|nuevas|nuevos platos|cosas nuevas)\b/.test(t),
    soloHuecos: !/\b(reemplaza|sustituye|cambia todo|desde cero)\b/.test(t),
    variado: variadoGlobal,
    dudas,
  };
}

// ───────── del plan a comidas ─────────

export interface PlanSlot {
  key: string;
  fecha: string;
  bloque: Block;
  para?: ProfileId;
  meal?: Meal;
  /** favorito usado (para no repetirlo al regenerar) */
  favId?: string;
  origen: 'favorito' | 'generado' | 'existente' | 'sin_opcion';
  /** lo que se pidió para este hueco */
  pedido: string[];
  kcal: Partial<Record<ProfileId, number>>;
  proteina: Partial<Record<ProfileId, number>>;
}

export interface PlanCtx {
  gctx: GeneratorContext;
  favorites: Favorite[];
  history: DayLog[];
  bloquesSeparados: Block[];
  enCasa?: string[];
}

/** Qué alimentos van en el hueco nº k de un bloque/persona (rotando para que varíe). */
export function requiredFor(items: PlanItem[], k: number, bloque: Block, fm: FoodMap, offset = 0): { foods: string[]; groups: string[][]; labels: string[] } {
  const ok = (id: string) => fm[id] && fm[id].bloques.includes(bloque);
  const cat = (it: PlanItem) => fm[it.foods[0]]?.categoria ?? 'extra';
  const out = { foods: [] as string[], groups: [] as string[][], labels: [] as string[] };
  const add = (it: PlanItem, j: number) => {
    const g = it.foods.filter(ok);
    if (!g.length) return;
    out.foods.push(g[(k + j) % g.length]);
    out.groups.push(g);
    out.labels.push(it.label);
  };
  // los "normales" de un mismo tipo se turnan (pollo un día, carne otro…)
  const normales = items.filter((i) => i.freq === 'normal');
  const porCat = new Map<string, PlanItem[]>();
  for (const it of normales) porCat.set(cat(it), [...(porCat.get(cat(it)) ?? []), it]);
  for (const [, list] of porCat) add(list[(k + offset) % list.length], Math.floor((k + offset) / list.length));
  items.forEach((it, idx) => {
    if (it.freq === 'todos') add(it, k);
    else if (it.freq === 'principal' && (k + idx) % 4 !== 3) add(it, k);
    else if (it.freq === 'algunos' && (k + idx) % 2 === 0) add(it, k);
  });
  return out;
}

const slotExists = (day: DayLog | undefined, b: Block, p?: ProfileId) => {
  if (!day) return false;
  if (p) return !!personSlot(day, b, p);
  return !!day.bloques[b] || (isSplit(day, b) && PROFILE_IDS.some((x) => personSlot(day, b, x)));
};

/**
 * Convierte la idea en huecos con su comida. Generador: devuelve un hueco cada vez
 * (para que la pantalla muestre el progreso sin bloquearse).
 */
export function* planSlots(idea: PlanIdea, ctx: PlanCtx): Generator<PlanSlot> {
  const fm: FoodMap = Object.fromEntries(ctx.gctx.foods.map((f) => [f.id, f]));
  const usedFav = new Set<string>();
  const usedSig: string[] = [];
  const counters = new Map<string, number>();
  for (const b of idea.bloques) {
    const rulesB = idea.reglas.filter((r) => r.bloques.includes(b));
    const split = rulesB.some((r) => r.para) || ctx.bloquesSeparados.includes(b);
    const who: (ProfileId | undefined)[] = split ? [...PROFILE_IDS] : [undefined];
    for (const fecha of idea.fechas) {
      const day = ctx.history.find((h) => h.fecha === fecha);
      for (const para of who) {
        const key = `${fecha}|${b}|${para ?? ''}`;
        if (idea.soloHuecos && slotExists(day, b, para)) {
          const s = para ? personSlot(day, b, para) : day?.bloques[b];
          const meal = s && !isFree(s) ? s.meal : undefined;
          yield { key, fecha, bloque: b, para, meal, origen: 'existente', pedido: [], ...totals(meal, fm, para) };
          continue;
        }
        const ck = `${b}|${para ?? ''}`;
        const k = counters.get(ck) ?? 0;
        counters.set(ck, k + 1);
        const slot = buildSlot(idea, ctx, { fecha, bloque: b, para, k, usedFav, usedSig });
        yield slot;
      }
    }
  }
}

/**
 * Un hueco: primero un favorito que lleve lo pedido (sin repetir), si no, el generador con lo
 * pedido como obligatorio (aflojando si no sale). `k` hace variar lo pedido y la opción elegida.
 */
export function buildSlot(
  idea: PlanIdea,
  ctx: PlanCtx,
  o: { fecha: string; bloque: Block; para?: ProfileId; k: number; usedFav: Set<string>; usedSig: string[] },
): PlanSlot {
  const fm: FoodMap = Object.fromEntries(ctx.gctx.foods.map((f) => [f.id, f]));
  const { fecha, bloque: b, para, k, usedFav, usedSig } = o;
  const key = `${fecha}|${b}|${para ?? ''}`;
  const excluded = [...new Set(idea.excluir.flatMap((i) => i.foods))];
  const items = idea.reglas.filter((r) => r.bloques.includes(b) && (!r.para || r.para === para)).flatMap((r) => r.items);
  const req = requiredFor(items, k, b, fm, b === 'C' ? 1 : 0);
  let meal: Meal | undefined;
  let favId: string | undefined;
  let origen: PlanSlot['origen'] = 'sin_opcion';
  if (idea.usarFavoritos) {
    const fav = ctx.favorites
      .filter((f) => f.bloque === b && (para ? !f.para || f.para === para : !f.para))
      .filter((f) => !f.items.some((i) => excluded.includes(i.foodId)))
      .filter((f) => req.groups.every((g) => f.items.some((i) => g.includes(i.foodId))))
      .filter((f) => !usedFav.has(f.id))
      .sort((x, y) => (y.usos ?? 0) - (x.usos ?? 0))[0];
    if (fav) {
      usedFav.add(fav.id);
      favId = fav.id;
      const m = favoriteToMeal(fav);
      meal = para && !fav.para ? mealFor(m, para) : m;
      origen = 'favorito';
    }
  }
  if (!meal) {
    for (let n = req.foods.length; n >= 0 && !meal; n--) {
      try {
        const r = generateMeals(
          {
            bloque: b,
            obligatorios: req.foods.slice(0, n),
            opcionales: [],
            prohibidos: excluded,
            disponibles: ctx.enCasa ?? [],
            estilo: 'equilibrada',
            filtros: { sinLacteos: false, soloSeleccionados: false, usarLoQueTengo: false },
            maxOpciones: 3,
            excluirFirmas: usedSig,
            ...(para ? { para } : {}),
          },
          ctx.gctx,
        );
        const opt = r.opciones[k % Math.max(1, r.opciones.length)] ?? r.opciones[0];
        if (opt) {
          meal = { ...opt.meal, ...(para ? { para } : {}) };
          origen = 'generado';
        }
      } catch {
        /* sin opción con esas condiciones */
      }
    }
  }
  if (meal) usedSig.push(signature(meal.items.map((i) => i.foodId)));
  return { key, fecha, bloque: b, para, meal, favId, origen, pedido: req.labels, ...totals(meal, fm, para) };
}

function totals(meal: Meal | undefined, fm: FoodMap, para?: ProfileId): Pick<PlanSlot, 'kcal' | 'proteina'> {
  const kcal: Partial<Record<ProfileId, number>> = {};
  const proteina: Partial<Record<ProfileId, number>> = {};
  if (!meal) return { kcal, proteina };
  for (const p of para ? [para] : PROFILE_IDS) {
    const n = mealNutrients(meal, p, fm);
    kcal[p] = Math.round(n.kcal);
    proteina[p] = Math.round(n.proteina);
  }
  return { kcal, proteina };
}

/** Resumen legible de una regla: "tostadas (algunos días), yogur" */
export function itemsText(items: PlanItem[]): string {
  return items.map((i) => (i.freq !== 'normal' ? `${i.label} (${FREQ_LABEL[i.freq]})` : i.label)).join(', ');
}
