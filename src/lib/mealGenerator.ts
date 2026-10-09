/**
 * Generador / optimizador de comidas A/B/C.
 * 100% determinista y basado en reglas: NO usa IA para cantidades ni valores nutricionales.
 *
 * Fases:
 *  1. Construir el "pool" de ingredientes válidos (restricciones, prohibidos, filtros, despensa).
 *  2. Generar conjuntos candidatos de ingredientes: plantillas de receta adaptadas + combinaciones por huecos.
 *  3. Para cada conjunto y cada perfil, optimizar las cantidades dentro de los rangos de ración
 *     (descenso por coordenadas sobre una rejilla discreta) minimizando una función de coste:
 *     desviación de kcal > falta de proteína > objetivo del modo > raciones "naturales".
 *  4. Puntuar, ordenar y elegir 3-5 opciones diversas (máx. volumen, más proteína, con postre…).
 */
import type {
  Block,
  BlockTarget,
  Category,
  CookingConversion,
  Food,
  Meal,
  MealItem,
  Nutrients,
  Profile,
  ProfileId,
  Rating,
  Settings,
} from '../types';
import { PROFILE_IDS } from '../types';
import { RECIPE_TEMPLATES, type RecipeTemplate } from '../data/seedMeals';
import { baseToServing, servingToBase, toConversionMap, type ConversionMap } from './conversions';
import { mealNutrients, rangeStatus, toFoodMap, type FoodMap, type RangeStatus } from './nutrition';
import { portionRange, portionValues, snap, type PortionRange } from './portions';
import { foodAllowedFor, mealWarnings } from './validation';

export type Style = 'equilibrada' | 'volumen' | 'alta_proteina' | 'menos_hidratos' | 'con_postre';

export const STYLE_LABELS: Record<Style, string> = {
  equilibrada: 'Equilibrada',
  volumen: 'Máximo volumen',
  alta_proteina: 'Alta proteína',
  menos_hidratos: 'Menos hidratos',
  con_postre: 'Con postre',
};

export interface GeneratorFilters {
  sinLacteos: boolean;
  soloSeleccionados: boolean;
  usarLoQueTengo: boolean;
}

export interface GeneratorRequest {
  bloque: Block;
  obligatorios: string[];
  opcionales: string[];
  prohibidos: string[];
  disponibles: string[];
  estilo: Style;
  filtros: GeneratorFilters;
  /** nº de opciones (3-5). Por defecto 4 */
  maxOpciones?: number;
  /** firmas de conjuntos ya mostrados (para "Regenerar") */
  excluirFirmas?: string[];
  /** objetivos alternativos (p. ej. compensación de comida libre) */
  objetivos?: Partial<Record<ProfileId, BlockTarget>>;
  /** generar solo para una persona (si no, la misma receta para ambos) */
  para?: ProfileId;
}

export interface GeneratorContext {
  foods: Food[];
  conversions: CookingConversion[];
  profiles: Record<ProfileId, Profile>;
  settings: Pick<Settings, 'mismaRecetaParaAmbos' | 'permitirComplementosDistintos'>;
  /** valoraciones 👍/👎 para aprender gustos */
  ratings?: Record<string, Rating>;
}

export interface GeneratedOption {
  id: string;
  firma: string;
  meal: Meal;
  etiqueta: string;
  plantilla?: string;
  totales: Record<ProfileId, Nutrients>;
  estado: Record<ProfileId, RangeStatus>;
  puntuacion: number;
  avisos: string[];
}

export interface GeneratorResult {
  opciones: GeneratedOption[];
  avisos: string[];
  candidatosEvaluados: number;
}

// ───────────────────────── utilidades internas ─────────────────────────

interface Ctx {
  /** preferencia aprendida por alimento (suma de 👍 −👎, acotada) */
  likes: Record<string, number>;
  ratings: Record<string, Rating>;
  fm: FoodMap;
  cm: ConversionMap;
  profiles: Record<ProfileId, Profile>;
  targets: Record<ProfileId, BlockTarget>;
}

export function targetsFor(
  bloque: Block,
  profiles: Record<ProfileId, Profile>,
  override?: Partial<Record<ProfileId, BlockTarget>>,
): Record<ProfileId, BlockTarget> {
  return {
    dani: override?.dani ?? profiles.dani.bloques[bloque],
    alba: override?.alba ?? profiles.alba.bloques[bloque],
  };
}

export function shortName(food: Food): string {
  return food.nombre.split(' (')[0];
}

const ROLE_ORDER: Category[] = ['proteina', 'hidrato', 'verdura', 'salsa', 'queso', 'lacteo', 'extra', 'fruta', 'postre'];

function sortIds(ids: string[], fm: FoodMap): string[] {
  return [...ids].sort((a, b) => {
    const fa = fm[a];
    const fb = fm[b];
    const ra = ROLE_ORDER.indexOf(fa.categoria) + (fa.tags.includes('acompanante') ? 10 : 0);
    const rb = ROLE_ORDER.indexOf(fb.categoria) + (fb.tags.includes('acompanante') ? 10 : 0);
    return ra - rb || a.localeCompare(b);
  });
}

export function signature(ids: string[]): string {
  return [...ids].sort().join('+');
}

export function mealName(ids: string[], fm: FoodMap): string {
  const names = sortIds(ids, fm).map((id, i) => {
    const n = shortName(fm[id]);
    return i === 0 ? n : n.charAt(0).toLowerCase() + n.slice(1);
  });
  return names.join(' + ');
}

// ───────────────────────── optimizador de cantidades ─────────────────────────

interface OptVar {
  food: Food;
  range: PortionRange;
  values: number[];
  /** nutrientes por unidad de ración */
  kcal: number;
  p: number;
  c: number;
  f: number;
  /** gramos "en el plato" por unidad de ración */
  grams: number;
}

function buildVar(food: Food, profile: Profile, cm: ConversionMap): OptVar {
  const range = portionRange(food, profile);
  const basePerServing = servingToBase(food, 1, cm);
  const k = basePerServing / 100;
  return {
    food,
    range,
    values: portionValues(range),
    kcal: food.kcalPor100 * k,
    p: food.proteinaPor100 * k,
    c: food.carbohidratosPor100 * k,
    f: food.grasasPor100 * k,
    grams: food.unidadBase === 'unidad' ? food.pesoUnidad ?? 0 : 1,
  };
}

interface Totals {
  kcal: number;
  p: number;
  c: number;
  f: number;
  grams: number;
}

function totals(vars: OptVar[], s: number[]): Totals {
  let kcal = 0, p = 0, c = 0, f = 0, grams = 0;
  for (let i = 0; i < vars.length; i++) {
    const v = vars[i];
    const q = s[i];
    kcal += v.kcal * q;
    p += v.p * q;
    c += v.c * q;
    f += v.f * q;
    grams += v.grams * q;
  }
  return { kcal, p, c, f, grams };
}

/** Coste de un perfil (menor = mejor). Exportado para tests. */
export function profileCost(t: Totals, s: number[], vars: OptVar[], target: BlockTarget, style: Style): number {
  // 1) kcal: suave dentro de tolerancia, muy penalizado fuera
  const a = Math.abs(t.kcal - target.kcal) / Math.max(1, target.tolerancia);
  const ck = a <= 1 ? 0.6 * a * a : 0.6 + 2 * (a - 1) + 4 * (a - 1) * (a - 1);
  // 2) proteína mínima
  const P = Math.max(1, target.proteina);
  const short = Math.max(0, P - t.p) / P;
  const cp = 4 * short * short + 1.5 * short;
  // 3) modo
  const kc = Math.max(1, t.kcal);
  const carbShare = (t.c * 4) / kc;
  const fatShare = (t.f * 9) / kc;
  let cs = 0;
  switch (style) {
    case 'volumen':
      cs = -0.8 * Math.min(t.grams / kc, 3);
      break;
    case 'alta_proteina':
      cs = -1.2 * Math.min(t.p / P, 1.8);
      break;
    case 'menos_hidratos':
      cs = 2 * carbShare;
      break;
    default:
      cs = 1.5 * ((carbShare - 0.42) ** 2 + (fatShare - 0.28) ** 2);
  }
  // 4) raciones naturales (cerca de la habitual)
  let cn = 0;
  for (let i = 0; i < vars.length; i++) {
    const r = vars[i].range;
    const span = Math.max(r.max - r.min, r.step);
    cn += 0.7 * ((s[i] - r.habitual) / span) ** 2;
  }
  return ck + cp + cs + cn;
}

/**
 * Optimiza las cantidades (en unidades de ración) de un conjunto de alimentos para un perfil.
 * Descenso por coordenadas + movimientos por pares sobre la rejilla de raciones.
 */
export function optimizeQuantities(
  foods: Food[],
  profile: Profile,
  target: BlockTarget,
  style: Style,
  cm: ConversionMap,
  /** cantidades fijas (en unidades de ración) que no se tocan; undefined = libre */
  fixed: (number | undefined)[] = [],
): { serving: number[]; cost: number; totals: Totals } {
  const vars = foods.map((f, i) => {
    const v = buildVar(f, profile, cm);
    const fx = fixed[i];
    if (fx !== undefined) {
      // bloqueado: un único valor posible y "habitual" = ese valor (no penaliza)
      v.values = [fx];
      v.range = { ...v.range, min: fx, max: fx, habitual: fx };
    }
    return v;
  });
  const evalS = (s: number[]) => profileCost(totals(vars, s), s, vars, target, style);

  const starts: number[][] = [];
  const hab = vars.map((v) => v.range.habitual);
  starts.push(hab);
  const habK = totals(vars, hab).kcal;
  if (habK > 0) {
    const k = target.kcal / habK;
    starts.push(vars.map((v) => snap(v.range.habitual * k, v.range.step, v.range.min, v.range.max)));
  }

  let bestS = hab;
  let bestC = Infinity;
  for (const start of starts) {
    const s = [...start];
    let cur = evalS(s);
    for (let pass = 0; pass < 14; pass++) {
      let improved = false;
      // coordenadas
      for (let i = 0; i < vars.length; i++) {
        const keep = s[i];
        let bi = keep;
        for (const v of vars[i].values) {
          s[i] = v;
          const c = evalS(s);
          if (c < cur - 1e-9) {
            cur = c;
            bi = v;
            improved = true;
          }
        }
        s[i] = bi;
      }
      // pares: pasar kcal de un ingrediente a otro
      for (let i = 0; i < vars.length; i++) {
        for (let j = 0; j < vars.length; j++) {
          if (i === j) continue;
          const vi = vars[i].values;
          const vj = vars[j].values;
          const ii = vi.indexOf(s[i]);
          const jj = vj.indexOf(s[j]);
          if (ii < 0 || jj < 0 || ii + 1 >= vi.length || jj - 1 < 0) continue;
          const oi = s[i];
          const oj = s[j];
          s[i] = vi[ii + 1];
          s[j] = vj[jj - 1];
          const c = evalS(s);
          if (c < cur - 1e-9) {
            cur = c;
            improved = true;
          } else {
            s[i] = oi;
            s[j] = oj;
          }
        }
      }
      if (!improved) break;
    }
    if (cur < bestC) {
      bestC = cur;
      bestS = [...s];
    }
  }
  return { serving: bestS, cost: bestC, totals: totals(vars, bestS) };
}

// ───────────────────────── pool y candidatos ─────────────────────────

function isDairy(f: Food): boolean {
  return f.tags.includes('lacteo') || f.tags.includes('leche_vaca') || f.categoria === 'queso';
}

interface Pool {
  allowed: (f: Food) => boolean;
  inPool: (id: string) => boolean;
}

function buildPool(req: GeneratorRequest, ctx: Ctx, profilesToCheck: ProfileId[]): Pool {
  const prohibited = new Set(req.prohibidos);
  const mandatory = new Set(req.obligatorios);
  const optional = new Set(req.opcionales);
  const available = new Set(req.disponibles);
  const allowed = (f: Food) => {
    if (mandatory.has(f.id)) return true;
    if (f.archivado || prohibited.has(f.id)) return false;
    if (req.filtros.sinLacteos && isDairy(f)) return false;
    for (const pid of profilesToCheck) if (!foodAllowedFor(f, ctx.profiles[pid])) return false;
    if (f.tags.includes('solo_si_se_incluye') && !optional.has(f.id) && !available.has(f.id)) return false;
    return true;
  };
  const inPool = (id: string) => {
    if (mandatory.has(id)) return true;
    if (req.filtros.soloSeleccionados) return optional.has(id);
    if (req.filtros.usarLoQueTengo) return optional.has(id) || available.has(id);
    return true;
  };
  return { allowed, inPool };
}

interface Slot {
  key: string;
  accepts: (f: Food) => boolean;
  required: boolean;
}

const isComp = (f: Food) =>
  ['postre', 'fruta', 'lacteo', 'queso'].includes(f.categoria) || f.tags.includes('acompanante');

function slotsFor(bloque: Block, style: Style): Slot[] {
  if (bloque === 'A') {
    return [
      { key: 'base', accepts: (f) => f.categoria === 'hidrato', required: false },
      { key: 'prot', accepts: (f) => ['proteina', 'lacteo', 'queso'].includes(f.categoria), required: true },
      {
        key: 'extra',
        accepts: (f) => ['fruta', 'verdura', 'extra', 'queso', 'postre', 'salsa'].includes(f.categoria),
        required: style === 'con_postre',
      },
      { key: 'extra2', accepts: (f) => ['fruta', 'verdura', 'extra', 'queso', 'lacteo'].includes(f.categoria), required: false },
    ];
  }
  return [
    { key: 'prot', accepts: (f) => f.categoria === 'proteina', required: true },
    { key: 'hc', accepts: (f) => f.categoria === 'hidrato', required: false },
    {
      key: 'veg',
      accepts: (f) => f.categoria === 'verdura' && !f.tags.includes('acompanante'),
      required: style === 'volumen',
    },
    { key: 'salsa', accepts: (f) => f.categoria === 'salsa', required: false },
    { key: 'comp', accepts: isComp, required: style === 'con_postre' },
  ];
}

/** Popularidad de cada alimento en las plantillas del bloque (para rellenar huecos con combinaciones conocidas) */
function popularity(bloque: Block): Record<string, number> {
  const pop: Record<string, number> = {};
  for (const t of RECIPE_TEMPLATES) {
    if (!t.bloques.includes(bloque)) continue;
    for (const id of t.ingredientes) pop[id] = (pop[id] ?? 0) + 1;
  }
  return pop;
}

function rankFood(f: Food, req: GeneratorRequest, pop: Record<string, number>, likes: Record<string, number> = {}): number {
  let s = 0;
  if (req.opcionales.includes(f.id)) s += 3;
  if (req.disponibles.includes(f.id)) s += 1;
  s += 0.35 * Math.min(pop[f.id] ?? 0, 6);
  const kcal = Math.max(1, f.kcalPor100);
  switch (req.estilo) {
    case 'volumen':
      s += 1.5 * (1 - Math.min(kcal, 400) / 400);
      break;
    case 'alta_proteina':
      s += 3 * Math.min((f.proteinaPor100 * 4) / kcal, 1);
      break;
    case 'menos_hidratos':
      s -= 2 * Math.min((f.carbohidratosPor100 * 4) / kcal, 1);
      if (f.tags.includes('sustituto_ligero')) s += 1.5;
      break;
    case 'con_postre':
      if (f.categoria === 'postre' || f.categoria === 'fruta' || f.tags.includes('acompanante')) s += 1;
      break;
  }
  if (req.bloque !== 'A' && (f.categoria === 'postre' || f.tags.includes('acompanante'))) s += 0.6;
  s += 0.4 * (likes[f.id] ?? 0);
  if (f.tags.includes('provisional')) s -= 0.2;
  return s;
}

interface CandidateSet {
  ids: string[];
  plantilla?: string;
  bonus: number;
}

function adaptTemplate(
  t: RecipeTemplate,
  req: GeneratorRequest,
  ctx: Ctx,
  pool: Pool,
  ranked: (cat: Category, exclude: Set<string>) => Food | undefined,
): CandidateSet | null {
  const ids: string[] = [];
  let changes = 0;
  for (const id of t.ingredientes) {
    const f = ctx.fm[id];
    if (!f) continue;
    if (pool.allowed(f) && pool.inPool(id)) {
      ids.push(id);
      continue;
    }
    const alt = ranked(f.categoria, new Set([...ids, ...t.ingredientes]));
    changes++;
    if (alt) ids.push(alt.id);
  }
  // colocar obligatorios: sustituyen a un ingrediente de la misma categoría o se añaden
  for (const m of req.obligatorios) {
    if (ids.includes(m)) continue;
    const mf = ctx.fm[m];
    if (!mf) continue;
    const idx = ids.findIndex((id) => ctx.fm[id].categoria === mf.categoria && !req.obligatorios.includes(id));
    if (idx >= 0) ids[idx] = m;
    else ids.push(m);
    changes++;
  }
  const unique = [...new Set(ids)];
  if (unique.length < 2) return null;
  if (changes > Math.max(2, Math.ceil(t.ingredientes.length / 2))) return null;
  return { ids: unique, plantilla: changes === 0 ? t.nombre : `Basada en: ${t.nombre}`, bonus: changes === 0 ? -0.35 : -0.15 };
}

function buildCandidates(req: GeneratorRequest, ctx: Ctx, pool: Pool): CandidateSet[] {
  const pop = popularity(req.bloque);
  const usable = Object.values(ctx.fm).filter(
    (f) => pool.allowed(f) && pool.inPool(f.id) && (f.bloques.includes(req.bloque) || req.obligatorios.includes(f.id) || req.opcionales.includes(f.id)),
  );
  const ranked = (cat: Category, exclude: Set<string>) =>
    usable
      .filter((f) => f.categoria === cat && !exclude.has(f.id))
      .sort((a, b) => rankFood(b, req, pop, ctx.likes) - rankFood(a, req, pop, ctx.likes) || a.id.localeCompare(b.id))[0];

  const out: CandidateSet[] = [];

  // 1) plantillas
  for (const t of RECIPE_TEMPLATES) {
    if (!t.bloques.includes(req.bloque)) continue;
    const c = adaptTemplate(t, req, ctx, pool, ranked);
    if (c) out.push(c);
  }

  // 2) combinaciones por huecos
  const slots = slotsFor(req.bloque, req.estilo);
  const fixed: Record<string, string> = {};
  const extraMandatory: string[] = [];
  for (const m of req.obligatorios) {
    const f = ctx.fm[m];
    if (!f) continue;
    const slot = slots.find((s) => !fixed[s.key] && s.accepts(f));
    if (slot) fixed[slot.key] = m;
    else extraMandatory.push(m);
  }
  const K = 3;
  const options: (string | null)[][] = slots.map((slot) => {
    if (fixed[slot.key]) return [fixed[slot.key]];
    const cands = usable
      .filter(
        (f) =>
          slot.accepts(f) &&
          !req.obligatorios.includes(f.id) &&
          (!f.tags.includes('solo_en_receta') || req.opcionales.includes(f.id) || req.disponibles.includes(f.id)),
      )
      .sort((a, b) => rankFood(b, req, pop, ctx.likes) - rankFood(a, req, pop, ctx.likes) || a.id.localeCompare(b.id));
    // los "quiero incluir" siempre entran como opción
    const top = cands.slice(0, K);
    for (const o of cands) if (req.opcionales.includes(o.id) && !top.includes(o)) top.push(o);
    const ids: (string | null)[] = top.map((f) => f.id);
    if (!slot.required || ids.length === 0) ids.push(null);
    return ids;
  });
  const combos: string[][] = [[]];
  for (const opts of options) {
    const next: string[][] = [];
    for (const c of combos) for (const o of opts) next.push(o ? [...c, o] : c);
    combos.splice(0, combos.length, ...next.slice(0, 2000));
  }
  for (const c of combos) {
    const ids = [...new Set([...c, ...extraMandatory])];
    if (ids.length < 2) continue;
    out.push({ ids, bonus: 0 });
  }
  // dedupe por firma
  const seen = new Map<string, CandidateSet>();
  for (const c of out) {
    const sig = signature(c.ids);
    const prev = seen.get(sig);
    if (!prev || c.bonus < prev.bonus) seen.set(sig, c);
  }
  return [...seen.values()];
}

// ───────────────────────── evaluación de conjuntos ─────────────────────────

interface Evaluated {
  set: CandidateSet;
  firma: string;
  items: MealItem[];
  cost: number;
  perProfileCost: Record<ProfileId, number>;
  estado: Record<ProfileId, RangeStatus>;
  totales: Record<ProfileId, Nutrients>;
  setPenalty: number;
}

function setPenalty(ids: string[], req: GeneratorRequest, ctx: Ctx, profiles: ProfileId[]): number {
  const foods = ids.map((id) => ctx.fm[id]);
  let pen = 0;
  // opcionales "quiero incluir" no presentes
  const missingOpt = req.opcionales.filter((o) => !ids.includes(o) && ctx.fm[o]).length;
  pen += 0.6 * missingOpt;
  if (ids.length > 5) pen += 0.25 * (ids.length - 5);
  const cats = foods.map((f) => f.categoria);
  if (req.bloque !== 'A') {
    if (!cats.includes('proteina')) pen += 1.5;
    if (!cats.includes('hidrato') && req.estilo !== 'menos_hidratos' && req.bloque === 'B') pen += 0.4;
    if (cats.filter((c) => c === 'proteina').length > 1) pen += 0.4;
    if (cats.filter((c) => c === 'hidrato').length > 1) pen += 0.4;
    if (cats.filter((c) => c === 'salsa').length > 1) pen += 0.5;
    if (ids.length < 3) pen += 0.6;
  } else {
    const dulce = foods.some((f) => f.tags.includes('dulce'));
    const salado = foods.some((f) => f.tags.includes('salado') || f.categoria === 'verdura' || f.categoria === 'salsa');
    if (dulce && salado) pen += 1.2;
    const hasBowlBase = foods.some((f) => f.categoria === 'lacteo');
    if (!cats.includes('hidrato') && !hasBowlBase) pen += 0.8;
    for (const pid of profiles) {
      const pref = ctx.profiles[pid].saborPreferidoA;
      if (pref === 'salado' && dulce && !salado) pen += 0.3;
      if (pref === 'dulce' && salado && !dulce) pen += 0.3;
    }
  }
  if (req.estilo === 'con_postre' && !foods.some((f) => isComp(f) && f.categoria !== 'queso')) pen += 2;
  // gustos aprendidos: combinación exacta valorada y alimentos que gustan / no gustan
  const r = ctx.ratings[signature(ids)];
  if (r) pen += r.voto > 0 ? -0.8 : 4;
  pen -= 0.15 * ids.reduce((s, id) => s + (ctx.likes[id] ?? 0), 0);
  if (req.estilo === 'volumen' && !foods.some((f) => f.categoria === 'verdura')) pen += 0.8;
  return pen + 0;
}

function evaluateSet(
  set: CandidateSet,
  req: GeneratorRequest,
  ctx: Ctx,
  style: Style,
  profiles: ProfileId[],
): Evaluated {
  const foods = set.ids.map((id) => ctx.fm[id]);
  const items: MealItem[] = foods.map((f) => ({ foodId: f.id, cantidades: { dani: 0, alba: 0 } }));
  const perProfileCost = { dani: 0, alba: 0 } as Record<ProfileId, number>;
  for (const pid of profiles) {
    const r = optimizeQuantities(foods, ctx.profiles[pid], ctx.targets[pid], style, ctx.cm);
    r.serving.forEach((q, i) => {
      items[i].cantidades[pid] = servingToBase(foods[i], q, ctx.cm);
    });
    perProfileCost[pid] = r.cost;
  }
  const meal = { items };
  const totales = {} as Record<ProfileId, Nutrients>;
  const estado = {} as Record<ProfileId, RangeStatus>;
  for (const pid of PROFILE_IDS) {
    totales[pid] = mealNutrients(meal, pid, ctx.fm);
    estado[pid] = rangeStatus(totales[pid].kcal, ctx.targets[pid]);
  }
  const pen = setPenalty(set.ids, req, ctx, profiles) + set.bonus;
  const cost = profiles.reduce((s, p) => s + perProfileCost[p], 0) + pen;
  return { set, firma: signature(set.ids), items, cost, perProfileCost, estado, totales, setPenalty: pen };
}

function statusRank(e: Evaluated, profiles: ProfileId[]): number {
  let r = 0;
  for (const p of profiles) {
    const s = e.estado[p];
    r += s === 'en_rango' ? 0 : s === 'cerca' ? 1 : 3;
  }
  return r;
}

function diff(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  let d = 0;
  for (const x of sa) if (!sb.has(x)) d++;
  for (const x of sb) if (!sa.has(x)) d++;
  return d;
}

// ───────────────────────── API principal ─────────────────────────

export function learnedLikes(ratings: Record<string, Rating> = {}): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of Object.values(ratings)) for (const id of r.foods) out[id] = (out[id] ?? 0) + r.voto;
  for (const id of Object.keys(out)) out[id] = Math.max(-3, Math.min(3, out[id]));
  return out;
}

function makeCtx(req: GeneratorRequest, gctx: GeneratorContext): Ctx {
  return {
    likes: learnedLikes(gctx.ratings),
    ratings: gctx.ratings ?? {},
    fm: toFoodMap(gctx.foods),
    cm: toConversionMap(gctx.conversions),
    profiles: gctx.profiles,
    targets: targetsFor(req.bloque, gctx.profiles, req.objetivos),
  };
}

let optionCounter = 0;

function toOption(
  e: Evaluated,
  etiqueta: string,
  req: GeneratorRequest,
  ctx: Ctx,
): GeneratedOption {
  const meal: Meal = {
    id: `gen_${Date.now().toString(36)}_${(optionCounter++).toString(36)}`,
    nombre: mealName(e.set.ids, ctx.fm),
    bloque: req.bloque,
    items: sortItems(e.items, ctx.fm),
    origen: 'generador',
    ...(req.para ? { para: req.para } : {}),
  };
  return finalizeOption(meal, etiqueta, ctx, e.cost, e.firma, e.set.plantilla);
}

function sortItems(items: MealItem[], fm: FoodMap): MealItem[] {
  const order = sortIds(items.map((i) => i.foodId), fm);
  return [...items].sort((a, b) => order.indexOf(a.foodId) - order.indexOf(b.foodId));
}

function finalizeOption(
  meal: Meal,
  etiqueta: string,
  ctx: Ctx,
  puntuacion: number,
  firma: string,
  plantilla?: string,
): GeneratedOption {
  const totales = {} as Record<ProfileId, Nutrients>;
  const estado = {} as Record<ProfileId, RangeStatus>;
  for (const pid of PROFILE_IDS) {
    totales[pid] = mealNutrients(meal, pid, ctx.fm);
    estado[pid] = rangeStatus(totales[pid].kcal, ctx.targets[pid]);
  }
  const avisos = mealWarnings(meal, ctx.profiles, ctx.fm, ctx.targets).map((w) => w.text);
  return { id: meal.id, firma, meal, etiqueta, plantilla, totales, estado, puntuacion, avisos };
}

/** Genera entre 3 y 5 opciones válidas para el bloque pedido. */
export function generateMeals(req: GeneratorRequest, gctx: GeneratorContext): GeneratorResult {
  const ctx = makeCtx(req, gctx);
  const avisos: string[] = [];
  const maxOpts = Math.min(5, Math.max(3, req.maxOpciones ?? 4));

  const profiles: ProfileId[] = req.para ? [req.para] : PROFILE_IDS;
  for (const m of req.obligatorios) {
    const f = ctx.fm[m];
    if (!f) continue;
    for (const pid of profiles) {
      if (!foodAllowedFor(f, ctx.profiles[pid])) avisos.push(`${f.nombre}: no recomendado para ${ctx.profiles[pid].nombre}`);
    }
    if (req.prohibidos.includes(m)) avisos.push(`${f.nombre} está a la vez en obligatorios y prohibidos: se usa como obligatorio`);
  }

  if (!req.para && !gctx.settings.mismaRecetaParaAmbos) {
    return generateSeparate(req, ctx, maxOpts, avisos);
  }

  const pool = buildPool(req, ctx, profiles);
  const excl = new Set(req.excluirFirmas ?? []);
  const cands = buildCandidates(req, ctx, pool).filter((c) => !excl.has(signature(c.ids)));
  const evals = cands.map((c) => evaluateSet(c, req, ctx, req.estilo, profiles));
  const chosen = pickDiverse(evals, req, ctx, profiles, maxOpts);

  let opciones = chosen.map(({ e, label }) => toOption(e, label, req, ctx));
  if (gctx.settings.permitirComplementosDistintos && !req.para) {
    opciones = opciones.map((o) => addPersonalComplement(o, req, ctx, pool));
  }
  if (opciones.length === 0) {
    avisos.push('No se han encontrado combinaciones con estas condiciones. Prueba a quitar filtros o ingredientes prohibidos.');
  } else if (opciones.every((o) => profiles.some((p) => o.estado[p] === 'bajo' || o.estado[p] === 'alto'))) {
    avisos.push('Ninguna opción entra en el rango calórico con estos ingredientes: se muestran las más cercanas.');
  }
  return { opciones, avisos, candidatosEvaluados: evals.length };
}

function pickDiverse(
  evals: Evaluated[],
  req: GeneratorRequest,
  ctx: Ctx,
  profiles: ProfileId[],
  maxOpts: number,
): { e: Evaluated; label: string }[] {
  const sorted = [...evals].sort((a, b) => statusRank(a, profiles) - statusRank(b, profiles) || a.cost - b.cost);
  const good = sorted.filter((e) => statusRank(e, profiles) <= profiles.length); // en rango o cerca
  const pool = good.length >= maxOpts ? good : sorted;
  const chosen: { e: Evaluated; label: string }[] = [];
  const isFar = (e: Evaluated, minDiff: number) => chosen.every((c) => diff(c.e.set.ids, e.set.ids) >= minDiff);

  const pickBy = (
    label: string,
    style: Style | null,
    filter: (e: Evaluated) => boolean,
    metric: (e: Evaluated) => number,
  ) => {
    for (const minDiff of [2, 1]) {
      const cands = pool.filter((e) => filter(e) && isFar(e, minDiff) && !chosen.some((c) => c.e.firma === e.firma));
      if (!cands.length) continue;
      // re-optimiza el top por métrica con el estilo de la etiqueta
      const top = [...cands].sort((a, b) => metric(a) - metric(b)).slice(0, 6);
      const reopt = style ? top.map((e) => evaluateSet(e.set, req, ctx, style, profiles)) : top;
      const best = reopt
        .filter((e) => statusRank(e, profiles) <= profiles.length || pool === sorted)
        .sort((a, b) => metric(a) - metric(b))[0];
      if (best) {
        chosen.push({ e: best, label });
        return;
      }
    }
  };

  const gramsPerKcal = (e: Evaluated) => {
    let g = 0;
    for (const it of e.items) {
      const f = ctx.fm[it.foodId];
      for (const p of profiles) g += f.unidadBase === 'unidad' ? it.cantidades[p] : baseToServing(f, it.cantidades[p], ctx.cm);
    }
    const k = profiles.reduce((s, p) => s + e.totales[p].kcal, 0);
    return g / Math.max(1, k);
  };
  const protShare = (e: Evaluated) =>
    profiles.reduce((s, p) => s + e.totales[p].proteina * 4, 0) / Math.max(1, profiles.reduce((s, p) => s + e.totales[p].kcal, 0));
  const hasDessert = (e: Evaluated) => e.set.ids.some((id) => {
    const f = ctx.fm[id];
    return f.categoria === 'postre' || f.categoria === 'fruta' || f.tags.includes('acompanante') || (f.categoria === 'lacteo' && req.bloque !== 'A');
  });

  // 1ª opción: la mejor según el estilo elegido
  pickBy(STYLE_LABELS[req.estilo], null, () => true, (e) => e.cost);
  if (req.estilo !== 'volumen') pickBy('Máximo volumen', 'volumen', () => true, (e) => -gramsPerKcal(e) + 0.15 * e.cost);
  if (req.estilo !== 'alta_proteina') pickBy('Más proteína', 'alta_proteina', () => true, (e) => -protShare(e) + 0.05 * e.cost);
  if (req.estilo !== 'con_postre') pickBy('Con acompañamiento / postre', null, hasDessert, (e) => e.cost);
  while (chosen.length < maxOpts) {
    const before = chosen.length;
    pickBy('Alternativa', null, () => true, (e) => e.cost);
    if (chosen.length === before) break;
  }
  return chosen.slice(0, maxOpts);
}

/** "Misma receta" desactivado: cada perfil recibe su propio conjunto óptimo. */
function generateSeparate(
  req: GeneratorRequest,
  ctx: Ctx,
  maxOpts: number,
  avisos: string[],
): GeneratorResult {
  const per: Record<ProfileId, { e: Evaluated; label: string }[]> = { dani: [], alba: [] };
  let total = 0;
  for (const pid of PROFILE_IDS) {
    const pool = buildPool(req, ctx, [pid]);
    const cands = buildCandidates(req, ctx, pool);
    const evals = cands.map((c) => evaluateSet(c, req, ctx, req.estilo, [pid]));
    total += evals.length;
    per[pid] = pickDiverse(evals, req, ctx, [pid], maxOpts);
  }
  const n = Math.min(per.dani.length, per.alba.length);
  const opciones: GeneratedOption[] = [];
  for (let i = 0; i < n; i++) {
    const d = per.dani[i].e;
    const a = per.alba[i].e;
    const items: MealItem[] = [
      ...d.items.map((it) => ({ foodId: it.foodId, cantidades: { dani: it.cantidades.dani, alba: 0 } })),
      ...a.items.map((it) => ({ foodId: it.foodId, cantidades: { dani: 0, alba: it.cantidades.alba } })),
    ];
    const merged = new Map<string, MealItem>();
    for (const it of items) {
      const prev = merged.get(it.foodId);
      if (prev) {
        prev.cantidades.dani += it.cantidades.dani;
        prev.cantidades.alba += it.cantidades.alba;
      } else merged.set(it.foodId, { ...it, cantidades: { ...it.cantidades } });
    }
    const meal: Meal = {
      id: `gen_${Date.now().toString(36)}_${(optionCounter++).toString(36)}`,
      nombre: `Dani: ${mealName(d.set.ids, ctx.fm)} · Alba: ${mealName(a.set.ids, ctx.fm)}`,
      bloque: req.bloque,
      items: sortItems([...merged.values()], ctx.fm),
      origen: 'generador',
    };
    opciones.push(finalizeOption(meal, per.dani[i].label, ctx, d.cost + a.cost, `${d.firma}|${a.firma}`));
  }
  return { opciones, avisos, candidatosEvaluados: total };
}

/** Si un perfil queda corto de kcal, añade un complemento SOLO para él (requiere autorización en ajustes). */
function addPersonalComplement(o: GeneratedOption, req: GeneratorRequest, ctx: Ctx, pool: Pool): GeneratedOption {
  const low = PROFILE_IDS.filter((p) => o.totales[p].kcal < ctx.targets[p].kcal - ctx.targets[p].tolerancia);
  if (low.length !== 1) return o;
  const pid = low[0];
  const deficit = ctx.targets[pid].kcal - o.totales[pid].kcal;
  const cands = Object.values(ctx.fm).filter(
    (f) =>
      (f.categoria === 'postre' || f.categoria === 'fruta') &&
      pool.allowed(f) &&
      pool.inPool(f.id) &&
      foodAllowedFor(f, ctx.profiles[pid]) &&
      !o.meal.items.some((i) => i.foodId === f.id),
  );
  let best: { f: Food; serving: number; err: number } | null = null;
  for (const f of cands) {
    const r = portionRange(f, ctx.profiles[pid]);
    for (const v of portionValues(r)) {
      const kcal = (f.kcalPor100 * servingToBase(f, v, ctx.cm)) / 100;
      const err = Math.abs(kcal - deficit);
      if (!best || err < best.err) best = { f, serving: v, err };
    }
  }
  if (!best) return o;
  const meal: Meal = {
    ...o.meal,
    items: [
      ...o.meal.items,
      { foodId: best.f.id, cantidades: { dani: 0, alba: 0, [pid]: servingToBase(best.f, best.serving, ctx.cm) } as Record<ProfileId, number> },
    ],
  };
  const res = finalizeOption(meal, o.etiqueta, ctx, o.puntuacion, o.firma, o.plantilla);
  res.avisos.unshift(`Complemento solo para ${ctx.profiles[pid].nombre}: ${shortName(best.f)}`);
  void req;
  return res;
}

/**
 * Re-optimiza una comida existente (mismos ingredientes) con otro estilo.
 * Respeta los ingredientes que un perfil no come (cantidad 0).
 */
export function reoptimizeMeal(
  meal: Meal,
  style: Style,
  gctx: GeneratorContext,
  objetivos?: Partial<Record<ProfileId, BlockTarget>>,
): GeneratedOption {
  const req: GeneratorRequest = {
    bloque: meal.bloque,
    obligatorios: [],
    opcionales: [],
    prohibidos: [],
    disponibles: [],
    estilo: style,
    filtros: { sinLacteos: false, soloSeleccionados: false, usarLoQueTengo: false },
    objetivos,
  };
  const ctx = makeCtx(req, gctx);
  const items = meal.items.map((it) => ({ ...it, cantidades: { ...it.cantidades } }));
  for (const pid of PROFILE_IDS) {
    const idx = items.map((it, i) => (it.cantidades[pid] > 0 ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) continue;
    const foods = idx.map((i) => ctx.fm[items[i].foodId]).filter(Boolean);
    if (foods.length !== idx.length) continue;
    // 🔒 los ingredientes bloqueados mantienen su cantidad; se ajusta el resto
    const fixed = idx.map((i, k) =>
      items[i].bloqueado ? baseToServing(foods[k], items[i].cantidades[pid], ctx.cm, items[i].metodoId) : undefined,
    );
    if (fixed.every((f) => f !== undefined)) continue;
    const r = optimizeQuantities(foods, ctx.profiles[pid], ctx.targets[pid], style, ctx.cm, fixed);
    idx.forEach((i, k) => {
      if (items[i].bloqueado) return;
      items[i].cantidades[pid] = servingToBase(foods[k], r.serving[k], ctx.cm, items[i].metodoId);
    });
  }
  const m: Meal = { ...meal, items };
  return finalizeOption(m, STYLE_LABELS[style], ctx, 0, signature(items.map((i) => i.foodId)));
}

/** Más volumen / más proteína: añade un ingrediente adecuado si hace falta y re-optimiza. */
export function adjustMeal(
  meal: Meal,
  goal: 'volumen' | 'alta_proteina',
  gctx: GeneratorContext,
  prohibidos: string[] = [],
  objetivos?: Partial<Record<ProfileId, BlockTarget>>,
): GeneratedOption {
  const fm = toFoodMap(gctx.foods);
  const ids = meal.items.map((i) => i.foodId);
  const ok = (f: Food) =>
    !f.archivado &&
    !prohibidos.includes(f.id) &&
    !ids.includes(f.id) &&
    f.bloques.includes(meal.bloque) &&
    (meal.para ? [meal.para] : PROFILE_IDS).every((p) => foodAllowedFor(f, gctx.profiles[p])) &&
    !f.tags.includes('solo_si_se_incluye');
  let add: Food | undefined;
  if (goal === 'volumen') {
    const hasVeg = ids.some((id) => fm[id]?.categoria === 'verdura' && !fm[id].tags.includes('acompanante'));
    if (!hasVeg) {
      add = gctx.foods
        .filter((f) => f.categoria === 'verdura' && !f.tags.includes('acompanante') && ok(f))
        .sort((a, b) => a.kcalPor100 - b.kcalPor100)[0];
    }
  } else {
    const proteinFoods = ['cottage', 'queso_batido', 'claras', 'yogur_griego_0', 'pavo_lonchas', 'pollo_pechuga'];
    const hasExtraProtein = ids.some((id) => proteinFoods.includes(id));
    if (!hasExtraProtein) {
      add = proteinFoods.map((id) => fm[id]).find((f) => f && ok(f));
    }
  }
  const items = [...meal.items];
  if (add) {
    const base = { dani: 0, alba: 0 } as Record<ProfileId, number>;
    const cm = toConversionMap(gctx.conversions);
    for (const p of PROFILE_IDS)
      base[p] = meal.para && p !== meal.para ? 0 : servingToBase(add, portionRange(add, gctx.profiles[p]).habitual, cm);
    items.push({ foodId: add.id, cantidades: base });
  }
  const fmNames = toFoodMap(gctx.foods);
  const updated: Meal = { ...meal, items, nombre: add ? mealName(items.map((i) => i.foodId), fmNames) : meal.nombre };
  const res = reoptimizeMeal(updated, goal, gctx, objetivos);
  res.etiqueta = goal === 'volumen' ? 'Más volumen' : 'Más proteína';
  if (add) res.avisos.unshift(`Añadido: ${shortName(add)}`);
  return res;
}

/** Recalcula totales/estado/avisos de una comida editada a mano. */
export function evaluateMeal(
  meal: Meal,
  gctx: GeneratorContext,
  objetivos?: Partial<Record<ProfileId, BlockTarget>>,
  etiqueta = '',
): GeneratedOption {
  const req = { bloque: meal.bloque, objetivos } as GeneratorRequest;
  const ctx = makeCtx(req, gctx);
  return finalizeOption(meal, etiqueta, ctx, 0, signature(meal.items.map((i) => i.foodId)));
}
