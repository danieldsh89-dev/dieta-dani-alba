/**
 * Intérprete de frases en español para el stock (reglas, gratis, sin IA y sin conexión).
 * Basado en el de "Despensa": "gasté 2 huevos y se acabó la sal", "quedan 4 huevos",
 * "apunta papel higiénico", "medio paquete de arroz", "el pollo caduca el jueves",
 * "he tirado el pan", "el resto está bien"…
 * Funciones puras — tests en __tests__/voz.test.ts.
 */
import type { AppData, Food, MercaProduct, StockEvent, StockItem, StockLevel } from '../types';
import { addDays, dateKey, parseDate } from './planning';
import { amountFromProduct, casaItem, ev, foodItem, itemProduct, nameTokens, shortName, zoneFor } from './stock';
import { apuntar, posponer } from '../integrations/mercadona/habituales';

// ───────── catálogo ─────────

export interface VozRef {
  /** id del artículo (o del alimento, si aún no tiene artículo) */
  id: string;
  nombre: string;
  tipo: StockItem['tipo'];
  unidad: StockItem['unidad'];
  food?: Food;
  product?: MercaProduct;
  item?: StockItem;
}

/** Cómo se llaman en voz los alimentos de la base (además de su nombre) */
export const FOOD_ALIASES: Record<string, string[]> = {
  papa_fresca: ['patatas', 'papas', 'patata', 'papa'],
  papa_bote: ['papas de bote', 'patatas de bote', 'papas cocidas', 'patatas cocidas'],
  pollo_pechuga: ['pollo', 'pechugas de pollo', 'pechuga'],
  huevo: ['huevos'],
  leche_semi: ['leche', 'leches'],
  pan_integral: ['pan de molde', 'pan'],
  aceite_oliva: ['aceite'],
  arroz: ['arroz'],
  yogur_0: ['yogur natural', 'yogures naturales'],
  yogur_griego_0: ['yogur griego', 'griegos'],
  pavo_lonchas: ['pavo', 'jamon de pavo'],
  queso_batido: ['queso batido'],
  havarti_light: ['queso en lonchas', 'havarti'],
  mozzarella_rallada: ['queso rallado'],
  frutos_rojos_cong: ['frutos rojos'],
  fresa_platano_cong: ['fresa y platano'],
  mix_tropical: ['mix tropical', 'fruta tropical'],
  arroz_coliflor: ['coliflor', 'migas de coliflor'],
  tortilla_maiz: ['tortillas', 'tortillas de maiz'],
  bebida_almendras: ['bebida de almendras', 'leche de almendras'],
  contramuslo: ['contramuslos'],
  carne_picada: ['carne picada', 'picada'],
};

export function vozCatalog(d: AppData, foods: Food[]): VozRef[] {
  const out: VozRef[] = [];
  const seen = new Set<string>();
  for (const it of Object.values(d.stock.items)) {
    seen.add(it.id);
    out.push({ id: it.id, nombre: it.nombre, tipo: it.tipo, unidad: it.unidad, food: it.foodId ? foods.find((f) => f.id === it.foodId) : undefined, product: itemProduct(d, it), item: it });
  }
  for (const f of foods) {
    if (seen.has(f.id)) continue;
    const it = foodItem(f, '');
    out.push({ id: f.id, nombre: it.nombre, tipo: 'contado', unidad: it.unidad, food: f, product: d.mercadona.links[f.id]?.product });
  }
  return out;
}

// ───────── acciones ─────────

export type VozAccion =
  | { tipo: 'gastar' | 'comprar' | 'tirar'; ref: VozRef; cantidad?: number; texto: string }
  | { tipo: 'hay'; ref: VozRef; cantidad: number; texto: string }
  | { tipo: 'nivel'; ref: VozRef; nivel: StockLevel; texto: string }
  | { tipo: 'apuntar'; ref?: VozRef; nuevo?: string; texto: string }
  | { tipo: 'quitar'; ref: VozRef; texto: string }
  | { tipo: 'caduca'; ref: VozRef; fecha: string; texto: string }
  | { tipo: 'resto_ok'; texto: string }
  /** cómo se repone al acabarse: "no me gustó", "de vez en cuando", "cómpralo siempre" */
  | { tipo: 'modo'; ref: VozRef; modo: NonNullable<StockItem['reponer']>; texto: string }
  /** algo que aún no está en la despensa ("hay suavizante", "hay 3 rollos de papel de cocina") */
  | { tipo: 'nuevo'; nombre: string; cantidad?: number; unidad: StockItem['unidad']; nivel: StockLevel; texto: string };

export interface VozResult {
  acciones: VozAccion[];
  dudas: string[];
}

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9.,;\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type RuleType = 'quitar' | 'agotado' | 'tirar' | 'poco' | 'apuntar' | 'hay' | 'comprar' | 'ok' | 'gastar';
interface Rule {
  re: RegExp;
  type: RuleType;
}

const NUM = '(\\d+(?:[.,]\\d+)?|uno|una|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|media|medio)';

// El orden importa: lo más específico primero.
const RULES: Rule[] = [
  { re: /\b(quita|quitar|quitame|quitalo|borra|borrar|elimina|eliminar|tacha|tachar)\b|\b(ya )?no (hace|hacen) falta\b|\bya no (necesito|necesitamos|hay que comprar)\b/, type: 'quitar' },
  { re: /\b((he |hemos |se ha |se han )?(tirado|tire|tiramos|tirar)|(se ha |se han |esta |estan )?(puesto malo|puesto mala|puesto malos|estropeado|estropeada|podrido|podrida|caducado|caducada|caducados|caducadas))\b/, type: 'tirar' },
  { re: /\b(se (me |nos )?(ha |han )?(acabado|acabo|acabaron|terminado|termino|terminaron|agotado|agoto|agotaron|gastado del todo)|(me |nos )?(he |hemos |ha |han )?(quedado|quede|quedamos|quedo|quedaron) sin|(estoy|estamos) sin|no (me |nos )?queda(n)?( nada)?( de)?|ya no (queda|quedan|hay|tengo|tenemos)|no (hay|tengo|tenemos)|agotad[oa]s?|vaci[oa]s?|(gaste|gastamos|use|usamos|he gastado|he usado) (el|la|los|las) ultim[oa]s?)\b/, type: 'agotado' },
  { re: /\b(queda(n)? (muy )?poc[oa]s?|casi no (me |nos )?queda(n)?|se (me |nos )?esta(n)? acabando|casi sin|hay poc[oa]s?|queda(n)? (un )?poquit[oa]s?)\b/, type: 'poco' },
  { re: /\b(falta(n)?|hace(n)? falta|necesito|necesitamos|apunta|apuntar|apuntame|anade|anadir|pon|ponme|comprar|hay que comprar)\b/, type: 'apuntar' },
  { re: new RegExp(`\\b(queda(n)?|tengo|tenemos|hay|tenemos|habra|hay como) ${NUM}\\b`), type: 'hay' },
  { re: /\b((he |hemos )?(comprado|compre|compramos|repuesto|repuse|traido|traje)|ha(n)? llegado|llego|llegaron)\b/, type: 'comprar' },
  { re: /\b(ya (hay|tengo|tenemos)|de sobra|lleno|llena|hay bastante|hay suficiente|esta bien|estan bien)\b/, type: 'ok' },
  // recuento: "hay suavizante", "tenemos lavavajillas" (sin cantidad: hay)
  { re: /^(y )?(hay|tenemos|tengo|queda|quedan|nos queda|nos quedan|me queda|me quedan)\b/, type: 'ok' },
  { re: /\b((me |nos )?(he |hemos )?(gastado|gaste|gastamos|usado|use|usamos|consumido|consumi|tomado|tome|bebido|bebi|abierto|abri|comido|comi|comimos|cogido|cogi|gasto))\b/, type: 'gastar' },
];

const MODOS: [RegExp, NonNullable<StockItem['reponer']>][] = [
  [/\b(no (me|nos) (ha |han )?gust(o|aron|ado)|no (vuelvas|volvamos|volver) a comprar(lo|la|los|las)?|no (lo |la |los |las )?(compres|compremos|repongas) mas|no reponer|ya no (lo |la |los |las )?compramos|nunca mas|no lo quiero mas)\b/, 'nunca'],
  [/\b(de vez en cuando|a veces|esporadic[oa]s?|preguntame|pregunta(me)? antes|no siempre)\b/, 'preguntar'],
  [/\b(compra(lo|la|los|las)? siempre|siempre que se acab[ea]n?|repon(lo|la|los|las)? siempre|reponer siempre|vuelve a comprar(lo|la|los|las)?( siempre)?|es habitual|habitual)\b/, 'habitual'],
];

const CADUCA = /\b(caduca|caducan|vence|vencen|consumir antes de|hay que gastar(lo|la|los|las)?)\b/;
const RESTO_OK = /^(y )?(el resto|todo lo demas|lo demas|todo lo otro|lo otro|todo)( (esta|estan|esta todo|bien|ok|correcto))+$|^(el resto|lo demas) (bien|ok)$/;

const WORD_NUM: Record<string, number> = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, media: 0.5, medio: 0.5,
};
const UNIT_ALIASES: Record<string, 'g' | 'kg' | 'ml' | 'cl' | 'l'> = {
  g: 'g', gr: 'g', gramo: 'g', gramos: 'g', kg: 'kg', kilo: 'kg', kilos: 'kg', l: 'l', litro: 'l', litros: 'l', ml: 'ml', mililitros: 'ml', cl: 'cl',
};
const TO_BASE: Record<string, number> = { g: 1, kg: 1000, ml: 1, cl: 10, l: 1000 };
const PACK = '(paquetes?|botes?|bandejas?|botellas?|bricks?|latas?|bolsas?|cajas?|envases?|tarros?|packs?|garrafas?|rollos?|tarrinas?|mallas?|piezas?)';

interface Qty {
  value: number;
  unit: 'g' | 'kg' | 'ml' | 'cl' | 'l' | 'pack' | null;
  text: string;
}

function findQuantity(clause: string): Qty | null {
  if (/\bmedia docena\b/.test(clause)) return { value: 6, unit: null, text: 'media docena' };
  if (/\b(una )?docena\b/.test(clause)) return { value: 12, unit: null, text: clause.match(/\b(una )?docena\b/)![0] };
  const par = clause.match(/\bun par( de)?\b/);
  if (par) return { value: 2, unit: null, text: par[0] };
  const m = clause.match(new RegExp(`\\b${NUM}\\b(?: y medi[oa])?(?: (g|gr|gramos?|kg|kilos?|l|litros?|ml|mililitros|cl)\\b| ${PACK}\\b)?(?: y medi[oa]\\b)?`));
  if (!m) return null;
  let value = WORD_NUM[m[1]] ?? Number(m[1].replace(',', '.'));
  if (/ y medi[oa]/.test(m[0])) value += 0.5;
  const unit = m[2] ? UNIT_ALIASES[m[2]] : m[3] ? 'pack' : null;
  return { value, unit, text: m[0] };
}

/** Cantidad dicha → unidad del artículo. undefined = no se sabe convertir. */
export function toItemUnit(q: Qty, ref: VozRef): number | undefined {
  if (q.unit && q.unit !== 'pack') {
    const base = q.value * TO_BASE[q.unit];
    if (ref.unidad === 'ud') return ref.food?.pesoUnidad ? base / ref.food.pesoUnidad : undefined;
    return base;
  }
  // envases o número sin unidad
  if (ref.unidad === 'ud' && q.unit !== 'pack') return q.value;
  if (ref.product) return amountFromProduct({ unidad: ref.unidad }, ref.product, q.value, ref.food);
  if (ref.item?.envase && (q.unit === 'pack' || ref.unidad !== 'ud')) return q.value * ref.item.envase;
  if (ref.unidad === 'ud') return q.value;
  if (ref.food?.pesoUnidad && q.unit !== 'pack') return q.value * ref.food.pesoUnidad;
  return undefined;
}

// ───────── productos ─────────

function variants(term: string): string[] {
  const words = term.split(' ');
  const [first, ...rest] = words;
  const tail = rest.length ? ' ' + rest.join(' ') : '';
  const forms = new Set([first]);
  if (/[aeiou]$/.test(first)) forms.add(first + 's');
  else if (/s$/.test(first)) forms.add(first.replace(/e?s$/, ''));
  else forms.add(first + 'es');
  if (/es$/.test(first)) forms.add(first.slice(0, -1));
  return [...forms].map((f) => f + tail);
}

interface Term {
  term: string;
  ref: VozRef;
}

function buildTerms(cat: VozRef[]): Term[] {
  const terms: Term[] = [];
  for (const r of cat) {
    const names = [r.nombre, ...(r.item?.aliases ?? []), ...(r.food ? (FOOD_ALIASES[r.food.id] ?? []) : [])];
    for (const n of names) for (const v of variants(normalize(n))) terms.push({ term: v, ref: r });
  }
  return terms.sort((a, b) => b.term.length - a.term.length);
}

function levenshtein(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function findRef(clause: string, terms: Term[]): { ref: VozRef; text: string } | null {
  for (const t of terms) if (new RegExp(`\\b${esc(t.term)}\\b`).test(clause)) return { ref: t.ref, text: t.term };
  // errores de dictado: "lavavagillas", "yogurt"
  for (const word of clause.split(' ').filter((w) => w.length >= 5)) {
    for (const t of terms) {
      if (t.term.includes(' ') || t.term.length < 6 || t.term[0] !== word[0]) continue;
      if (levenshtein(word, t.term) <= (t.term.length >= 8 ? 2 : 1)) return { ref: t.ref, text: word };
    }
  }
  // plurales en cualquier palabra: "leches semidesnatadas" → Leche semidesnatada
  const said = new Set(nameTokens(clause));
  let best: { ref: VozRef; n: number } | null = null;
  for (const t of terms) {
    const want = nameTokens(t.ref.nombre.split(' (')[0]);
    if (want.length >= 1 && want.every((w) => said.has(w)) && (!best || want.length > best.n)) best = { ref: t.ref, n: want.length };
  }
  return best ? { ref: best.ref, text: '' } : null;
}

/** Candidatos cuyo nombre contiene todas las palabras dichas: "pollo" → pechuga de pollo, contramuslo de pollo… */
function byWords(rest: string, cat: VozRef[]): VozRef[] {
  const words = rest.split(' ').filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  if (!words.length) return [];
  return cat.filter((r) => {
    const name = ` ${normalize(r.nombre)} `;
    return words.every((w) => variants(w).some((v) => name.includes(` ${v} `) || name.includes(` ${v}`)));
  });
}

const STOPWORDS = new Set(
  (
    'el la los las lo le les un una unos unas de del al a me se nos te he ha han hemos hay mas otro otra ya que y ' +
    'por para con hoy ayer esta este manana noche tarde casa fuera todo toda nada muy casi poco poca ' +
    'pocos pocas algo bastante mucho mucha tambien ademas porfa favor lista compra en'
  ).split(' '),
);

function leftover(clause: string, remove: string[], accents: Map<string, string>): string {
  let rest = clause.replace(/\b(a|en|de) la lista( de la compra)?\b/, ' ');
  for (const r of remove) if (r) rest = rest.replace(r, ' ');
  rest = rest.replace(new RegExp(`\\b${PACK}\\b`, 'g'), ' ').replace(/\b(kilos?|kg|gramos?|gr|g|litros?|l|ml|mililitros|cl)\b/g, ' ');
  const words = rest.split(/\s+/).filter((w) => w && !/^\d/.test(w));
  while (words.length && STOPWORDS.has(words[0])) words.shift();
  while (words.length && STOPWORDS.has(words[words.length - 1])) words.pop();
  return words.map((w) => accents.get(w) ?? w).join(' ');
}

function accentMap(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) if (word) map.set(normalize(word), word);
  return map;
}

// ───────── fechas ("caduca el jueves") ─────────

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

export function parseFecha(clause: string, hoy: string): { fecha: string; text: string } | null {
  if (/\bpasado manana\b/.test(clause)) return { fecha: addDays(hoy, 2), text: 'pasado manana' };
  if (/\bmanana\b/.test(clause)) return { fecha: addDays(hoy, 1), text: 'manana' };
  if (/\bhoy\b/.test(clause)) return { fecha: hoy, text: 'hoy' };
  const en = clause.match(/\ben (\d+|un|una|dos|tres|cuatro|cinco|seis|siete) (dias?|semanas?)\b/);
  if (en) {
    const n = WORD_NUM[en[1]] ?? Number(en[1]);
    return { fecha: addDays(hoy, en[2].startsWith('semana') ? n * 7 : n), text: en[0] };
  }
  const wd = clause.match(/\b(el )?(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/);
  if (wd) {
    const target = WEEKDAYS.indexOf(wd[2]);
    const cur = parseDate(hoy).getDay();
    const diff = (target - cur + 7) % 7 || 7;
    return { fecha: addDays(hoy, diff), text: wd[0] };
  }
  const dia = clause.match(/\b(el )?(dia )?(\d{1,2})( de [a-z]+)?\b/);
  if (dia) {
    const n = Number(dia[3]);
    if (n >= 1 && n <= 31) {
      const d = parseDate(hoy);
      let target = new Date(d.getFullYear(), d.getMonth(), n, 12);
      if (dateKey(target) < hoy) target = new Date(d.getFullYear(), d.getMonth() + 1, n, 12);
      return { fecha: dateKey(target), text: dia[0] };
    }
  }
  return null;
}

// ───────── intérprete ─────────

export function parseVoz(text: string, cat: VozRef[], hoy: string): VozResult {
  const accents = accentMap(text);
  const terms = buildTerms(cat);
  const clauses = normalize(text)
    .replace(/^(oye|vale|a ver|bueno) /, '')
    .split(/(?<!\d)[.,;]|[.,;](?!\d)|\s+(?:y|e|tambien|ademas|luego)\s+/)
    .map((c) => c.trim())
    .filter(Boolean)
    .reduce<string[]>((acc, c) => {
      const prev = acc[acc.length - 1];
      if (prev && /^medi[oa]\b/.test(c) && /(\d|\b(un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)|kilos?|litros?|gramos?)$/.test(prev)) acc[acc.length - 1] = `${prev} y ${c}`;
      else acc.push(c);
      return acc;
    }, []);

  const acciones: VozAccion[] = [];
  const dudas: string[] = [];
  let previous: Rule | null = null;
  // último producto nombrado ("se acabó el yogur y no me gustó")
  const lastRef = () => {
    for (let i = acciones.length - 1; i >= 0; i--) {
      const r = (acciones[i] as { ref?: VozRef }).ref;
      if (r) return r;
    }
    return undefined;
  };

  for (const clause of clauses) {
    if (RESTO_OK.test(clause)) {
      acciones.push({ tipo: 'resto_ok', texto: clause });
      continue;
    }
    // cómo se repone
    const modo = MODOS.find(([re]) => re.test(clause));
    if (modo) {
      const found = findRef(clause, terms) ?? (lastRef() ? { ref: lastRef()!, text: '' } : null);
      if (found) acciones.push({ tipo: 'modo', ref: found.ref, modo: modo[1], texto: clause });
      else dudas.push(`¿De qué producto hablas? No he entendido "${clause}".`);
      continue;
    }
    // caducidades
    if (CADUCA.test(clause)) {
      const f = parseFecha(clause, hoy);
      const found = findRef(clause, terms);
      if (found && f) acciones.push({ tipo: 'caduca', ref: found.ref, fecha: f.fecha, texto: clause });
      else dudas.push(found ? `¿Cuándo caduca ${found.ref.nombre}? Di, por ejemplo, "caduca el jueves".` : `¿Qué caduca? No he entendido "${clause}".`);
      continue;
    }

    const own = RULES.find((r) => r.re.test(clause)) ?? null;
    const rule: Rule | null = own ?? previous;
    previous = rule;
    const verbText = own ? clause.match(own.re)![0] : '';
    const qty = findQuantity(clause);
    let found = findRef(clause, terms);
    const rest = found ? '' : leftover(clause, [verbText, qty?.text ?? ''], accents);

    if (!found && rest) {
      const cands = byWords(normalize(rest), cat);
      if (cands.length === 1) found = { ref: cands[0], text: rest };
      else if (cands.length > 1 && cands.length <= 6) {
        const names = cands.map((r) => r.nombre);
        dudas.push(`¿Cuál? ${names.slice(0, -1).join(', ')} o ${names[names.length - 1]}.`);
        continue;
      }
    }

    if (!rule) {
      // solo nombre + cantidad en un recuento: "huevos 6" / "6 huevos"
      if (found && qty) {
        const c = toItemUnit(qty, found.ref);
        if (c !== undefined) {
          acciones.push({ tipo: 'hay', ref: found.ref, cantidad: c, texto: clause });
          continue;
        }
      }
      dudas.push(found ? `¿Qué pasa con ${found.ref.nombre}? Di por ejemplo "quedan 2 ${found.ref.nombre}" o "se acabó ${found.ref.nombre}".` : `No he entendido "${clause}".`);
      continue;
    }

    if (!found) {
      if (rule.type === 'apuntar' || rule.type === 'poco' || rule.type === 'agotado') {
        if (rest && rest.split(' ').length <= 4) acciones.push({ tipo: 'apuntar', nuevo: rest, texto: clause });
        else if (rest) dudas.push(`No he entendido "${clause}".`);
        continue;
      }
      // algo nuevo en un recuento o una compra: se crea en la despensa
      if ((rule.type === 'hay' || rule.type === 'ok' || rule.type === 'comprar') && rest && rest.split(' ').length <= 5) {
        const masa = !!qty?.unit && qty.unit !== 'pack';
        acciones.push({
          tipo: 'nuevo',
          nombre: rest,
          cantidad: qty ? (masa ? qty.value * TO_BASE[qty.unit!] : qty.value) : undefined,
          unidad: masa ? (qty!.unit === 'g' || qty!.unit === 'kg' ? 'g' : 'ml') : 'ud',
          nivel: qty && qty.value === 0 ? 'agotado' : 'ok',
          texto: clause,
        });
        continue;
      }
      if (rest) dudas.push(`No encuentro "${rest}". Si es algo nuevo, di "apunta ${rest}" o "hay ${rest}".`);
      continue;
    }

    const ref = found.ref;
    const cant = qty ? toItemUnit(qty, ref) : undefined;
    switch (rule.type) {
      case 'quitar':
        acciones.push({ tipo: 'quitar', ref, texto: clause });
        break;
      case 'agotado':
        acciones.push({ tipo: 'nivel', ref, nivel: 'agotado', texto: clause });
        break;
      case 'poco':
        acciones.push({ tipo: 'nivel', ref, nivel: 'poco', texto: clause });
        break;
      case 'ok':
        acciones.push({ tipo: 'nivel', ref, nivel: 'ok', texto: clause });
        break;
      case 'apuntar':
        acciones.push({ tipo: 'apuntar', ref, texto: clause });
        break;
      case 'hay':
        if (cant === undefined) {
          // no se sabe cuánto trae el envase: al menos se sabe si hay (la cantidad llegará con el próximo pedido)
          if (qty) acciones.push({ tipo: 'nivel', ref, nivel: qty.value <= 0 ? 'agotado' : qty.value < 1 ? 'poco' : 'ok', texto: clause });
          else dudas.push(`¿Cuánto ${ref.nombre} queda? Di, por ejemplo, "quedan 500 gramos de ${ref.nombre}".`);
        } else acciones.push({ tipo: 'hay', ref, cantidad: cant, texto: clause });
        break;
      case 'tirar':
        acciones.push({ tipo: 'tirar', ref, cantidad: cant, texto: clause });
        break;
      case 'comprar':
        if (qty && cant === undefined && ref.tipo === 'contado') dudas.push(`¿Cuánto ${ref.nombre} has comprado? Di, por ejemplo, "he comprado 2 paquetes de ${ref.nombre}".`);
        else acciones.push({ tipo: 'comprar', ref, cantidad: cant ?? (ref.tipo === 'contado' ? toItemUnit({ value: 1, unit: 'pack', text: '' }, ref) : undefined), texto: clause });
        break;
      case 'gastar':
        if (ref.tipo === 'estado') acciones.push({ tipo: 'nivel', ref, nivel: 'poco', texto: clause });
        else if (cant === undefined) {
          const one = ref.unidad === 'ud' ? 1 : undefined;
          if (one) acciones.push({ tipo: 'gastar', ref, cantidad: one, texto: clause });
          else dudas.push(`¿Cuánto ${ref.nombre} has gastado? Di, por ejemplo, "he gastado 200 gramos de ${ref.nombre}".`);
        } else acciones.push({ tipo: 'gastar', ref, cantidad: cant, texto: clause });
        break;
    }
  }
  return { acciones, dudas };
}

// ───────── aplicar ─────────

export interface VozChanges {
  items: StockItem[];
  events: StockEvent[];
  /** artículos mencionados (para "el resto está bien") */
  tocados: string[];
  resumen: string[];
}

const fmtQty = (r: VozRef, c: number) =>
  r.unidad === 'ud' ? `${Math.round(c * 10) / 10}` : c >= 1000 ? `${Math.round(c / 100) / 10} ${r.unidad === 'g' ? 'kg' : 'L'}` : `${Math.round(c)} ${r.unidad}`;

/** Convierte las acciones en cambios del stock (artículos nuevos/actualizados y eventos). */
export function applyVoz(acciones: VozAccion[], hoy: string, origen: StockEvent['origen'] = 'voz', at = new Date().toISOString()): VozChanges {
  const items = new Map<string, StockItem>();
  const events: StockEvent[] = [];
  const tocados: string[] = [];
  const resumen: string[] = [];
  const itemFor = (r: VozRef): StockItem => items.get(r.id) ?? r.item ?? (r.food ? foodItem(r.food, hoy) : casaItem(r.nombre, hoy));
  const touch = (it: StockItem) => {
    items.set(it.id, it);
    tocados.push(it.id);
  };
  for (const a of acciones) {
    if (a.tipo === 'resto_ok') continue;
    if (a.tipo === 'nuevo') {
      const contado = a.cantidad !== undefined;
      const it = casaItem(capitalize(a.nombre), hoy, { tipo: contado ? 'contado' : 'estado', unidad: a.unidad, zona: zoneFor(a.nombre) });
      events.push(contado ? ev(it.id, 'set', { valor: a.cantidad }, origen, at) : ev(it.id, 'nivel', { nivel: a.nivel }, origen, at));
      touch(it);
      resumen.push(`🆕 ${it.nombre}: ${contado ? `hay ${a.cantidad} ${a.unidad}` : 'hay'}`);
      continue;
    }
    if (a.tipo === 'apuntar' && !a.ref) {
      // algo nuevo apuntado a mano: si se acaba, se pregunta antes de volver a comprarlo
      const it = casaItem(capitalize(a.nuevo!), hoy, { apuntado: true, reponer: 'preguntar' });
      touch(it);
      resumen.push(`📝 ${it.nombre}: apuntado (nuevo)`);
      continue;
    }
    const ref = (a as { ref: VozRef }).ref;
    let it = itemFor(ref);
    switch (a.tipo) {
      case 'hay':
        events.push(it.tipo === 'contado' ? ev(it.id, 'set', { valor: a.cantidad }, origen, at) : ev(it.id, 'nivel', { nivel: a.cantidad > 0 ? 'ok' : 'agotado' }, origen, at));
        resumen.push(`✔️ ${it.nombre}: hay ${it.tipo === 'contado' ? fmtQty(ref, a.cantidad) : a.cantidad > 0 ? 'suficiente' : 'nada'}`);
        break;
      case 'nivel':
        if (it.tipo === 'contado' && a.nivel === 'agotado') events.push(ev(it.id, 'set', { valor: 0 }, origen, at));
        else events.push(ev(it.id, 'nivel', { nivel: a.nivel }, origen, at));
        resumen.push(`${a.nivel === 'agotado' ? '🔴' : a.nivel === 'poco' ? '🟡' : '🟢'} ${it.nombre}: ${a.nivel === 'agotado' ? 'se acabó' : a.nivel === 'poco' ? 'queda poco' : 'hay'}`);
        break;
      case 'gastar':
        events.push(ev(it.id, 'delta', { valor: -(a.cantidad ?? 0) }, origen, at));
        resumen.push(`➖ ${it.nombre}: −${fmtQty(ref, a.cantidad ?? 0)}`);
        break;
      case 'tirar':
        events.push(a.cantidad !== undefined && it.tipo === 'contado' ? ev(it.id, 'delta', { valor: -a.cantidad }, 'tirado', at) : ev(it.id, it.tipo === 'contado' ? 'set' : 'nivel', it.tipo === 'contado' ? { valor: 0 } : { nivel: 'agotado' }, 'tirado', at));
        resumen.push(`🗑️ ${it.nombre}: tirado${a.cantidad !== undefined ? ` (${fmtQty(ref, a.cantidad)})` : ''}`);
        break;
      case 'comprar':
        events.push(it.tipo === 'contado' && a.cantidad !== undefined ? ev(it.id, 'delta', { valor: a.cantidad }, 'compra', at) : ev(it.id, 'nivel', { nivel: 'ok' }, 'compra', at));
        it = { ...it, apuntado: false, compras: [...new Set([...it.compras, hoy])].sort().slice(-12), pospuesto: undefined };
        resumen.push(`🛍️ ${it.nombre}: comprado${a.cantidad !== undefined && it.tipo === 'contado' ? ` (+${fmtQty(ref, a.cantidad)})` : ''}`);
        break;
      case 'apuntar':
        it = apuntar(it);
        resumen.push(`📝 ${it.nombre}: apuntado`);
        break;
      case 'quitar':
        it = posponer(it, hoy);
        resumen.push(`✕ ${it.nombre}: quitado de la lista`);
        break;
      case 'modo':
        it = { ...it, reponer: a.modo, ...(a.modo === 'nunca' ? { apuntado: false } : {}) };
        resumen.push(`${a.modo === 'nunca' ? '🚫' : a.modo === 'preguntar' ? '❓' : '🔁'} ${it.nombre}: ${a.modo === 'nunca' ? 'no se repondrá' : a.modo === 'preguntar' ? 'se preguntará antes de reponer' : 'se repone siempre'}`);
        break;
      case 'caduca':
        it = { ...it, caduca: a.fecha };
        resumen.push(`⏳ ${it.nombre}: caduca el ${parseDate(a.fecha).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric' })}`);
        break;
    }
    touch(it);
  }
  return { items: [...items.values()], events, tocados: [...new Set(tocados)], resumen };
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const vozRestoOk = (acciones: VozAccion[]) => acciones.some((a) => a.tipo === 'resto_ok');

export { shortName };
