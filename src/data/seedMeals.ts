import type { Block } from '../types';

/**
 * Plantillas de recetas que el generador sabe construir.
 * Solo definen ingredientes: las cantidades las calcula el motor matemático.
 */
export interface RecipeTemplate {
  id: string;
  nombre: string;
  bloques: Block[];
  ingredientes: string[];
  sabor?: 'dulce' | 'salado';
}

export const RECIPE_TEMPLATES: RecipeTemplate[] = [
  // ── Platos B / C ──
  { id: 't_pollo_arroz', nombre: 'Pollo con arroz y ratatouille', bloques: ['B', 'C'], ingredientes: ['pollo_pechuga', 'arroz', 'ratatouille', 'salsa_mexicana'] },
  { id: 't_pollo_papa', nombre: 'Pollo con papa y ratatouille', bloques: ['B', 'C'], ingredientes: ['pollo_pechuga', 'papa_fresca', 'ratatouille', 'salsa_mexicana'] },
  { id: 't_picada_arroz', nombre: 'Carne picada con arroz', bloques: ['B', 'C'], ingredientes: ['carne_picada', 'arroz', 'ratatouille', 'salsa_mexicana'] },
  { id: 't_picada_papa', nombre: 'Carne picada con papa air fryer', bloques: ['B', 'C'], ingredientes: ['carne_picada', 'papa_fresca', 'ratatouille'] },
  { id: 't_albondigas_arroz', nombre: 'Albóndigas con arroz', bloques: ['B', 'C'], ingredientes: ['albondigas', 'arroz', 'ratatouille', 'salsa_tomate_albahaca'] },
  { id: 't_albondigas_papa', nombre: 'Albóndigas con papa', bloques: ['B', 'C'], ingredientes: ['albondigas', 'papa_fresca', 'salsa_tomate_albahaca'] },
  { id: 't_bolonesa', nombre: 'Pasta boloñesa', bloques: ['B', 'C'], ingredientes: ['carne_picada', 'pasta', 'ratatouille', 'salsa_tomate_albahaca'] },
  { id: 't_contramuslo_cuscus', nombre: 'Contramuslo con cuscús', bloques: ['B', 'C'], ingredientes: ['contramuslo', 'cuscus', 'salteado_verduras'] },
  { id: 't_contramuslo_papa', nombre: 'Contramuslo con papa hervida', bloques: ['B', 'C'], ingredientes: ['contramuslo', 'papa_fresca', 'ratatouille'] },
  { id: 't_chili_arroz', nombre: 'Chili con arroz', bloques: ['B', 'C'], ingredientes: ['chili', 'arroz'] },
  { id: 't_chili_papa', nombre: 'Chili con papa', bloques: ['B', 'C'], ingredientes: ['chili', 'papa_fresca'] },
  { id: 't_tacos', nombre: 'Tacos de pollo', bloques: ['B', 'C'], ingredientes: ['pollo_pechuga', 'tortilla_maiz', 'ratatouille', 'mozzarella_rallada', 'salsa_mexicana'] },
  { id: 't_pollo_gnocchi', nombre: 'Pollo con gnocchi', bloques: ['B', 'C'], ingredientes: ['pollo_pechuga', 'gnocchi', 'salsa_tomate_albahaca'] },
  { id: 't_carne_gnocchi', nombre: 'Carne con gnocchi', bloques: ['B', 'C'], ingredientes: ['carne_picada', 'gnocchi', 'salsa_tomate_albahaca'] },
  { id: 't_carrilladas_arroz', nombre: 'Carrilladas con arroz', bloques: ['B', 'C'], ingredientes: ['carrilladas', 'arroz', 'salteado_verduras'] },
  { id: 't_carrilladas_papa', nombre: 'Carrilladas con papa', bloques: ['B', 'C'], ingredientes: ['carrilladas', 'papa_fresca', 'verduras_asadas'] },
  { id: 't_carrilladas_cuscus', nombre: 'Carrilladas con cuscús', bloques: ['B', 'C'], ingredientes: ['carrilladas', 'cuscus'] },
  { id: 't_garbanzos_pollo', nombre: 'Garbanzos con pollo', bloques: ['B', 'C'], ingredientes: ['pollo_pechuga', 'garbanzos', 'salteado_verduras', 'tomate_triturado'] },
  { id: 't_ensalada_pollo', nombre: 'Ensalada de pollo', bloques: ['B', 'C'], ingredientes: ['pollo_pechuga', 'lechuga', 'tomate', 'pepino', 'cebolla', 'pan_integral'] },
  { id: 't_wok_coliflor', nombre: 'Wok de pollo con arroz de coliflor', bloques: ['C'], ingredientes: ['pollo_pechuga', 'arroz_coliflor', 'wok_verduras', 'salsa_soja'] },
  { id: 't_hamburguesa', nombre: 'Hamburguesa con obleas', bloques: ['B', 'C'], ingredientes: ['hamburguesa', 'obleas_arroz', 'havarti_light', 'tomate', 'ketchup_zero'] },
  { id: 't_revuelto_c', nombre: 'Revuelto de setas', bloques: ['C'], ingredientes: ['huevo', 'claras', 'setas', 'pavo_lonchas', 'pan_integral'] },

  // ── Bloque A ──
  { id: 't_tostada_aguacate', nombre: 'Tostadas de aguacate y huevo', bloques: ['A'], ingredientes: ['pan_integral', 'huevo', 'aguacate', 'tomate', 'cebolla', 'havarti_light'], sabor: 'salado' },
  { id: 't_tostada_aguacate_cottage', nombre: 'Tostadas de aguacate con cottage', bloques: ['A'], ingredientes: ['pan_integral', 'huevo', 'aguacate', 'tomate', 'cottage'], sabor: 'salado' },
  { id: 't_tostada_pollo', nombre: 'Tostadas de pollo desmenuzado', bloques: ['A'], ingredientes: ['pan_integral', 'pollo_pechuga', 'queso_batido', 'tomate'], sabor: 'salado' },
  { id: 't_tostada_pollo_aguacate', nombre: 'Tostadas de pollo y aguacate', bloques: ['A'], ingredientes: ['pan_integral', 'pollo_pechuga', 'aguacate', 'tomate'], sabor: 'salado' },
  { id: 't_tostada_pavo', nombre: 'Tostadas de pavo y cottage', bloques: ['A'], ingredientes: ['pan_integral', 'pavo_lonchas', 'cottage', 'tomate'], sabor: 'salado' },
  { id: 't_pancakes_dulce', nombre: 'Pancakes de avena con fruta', bloques: ['A'], ingredientes: ['harina_avena', 'huevo', 'claras', 'fresa_platano_cong'], sabor: 'dulce' },
  { id: 't_pancakes_salado', nombre: 'Crepes salados de avena', bloques: ['A'], ingredientes: ['harina_avena', 'huevo', 'claras', 'pavo_lonchas', 'cottage', 'tomate'], sabor: 'salado' },
  { id: 't_bowl_yogur', nombre: 'Bowl de yogur griego', bloques: ['A'], ingredientes: ['yogur_griego_0', 'avena', 'frutos_rojos_cong'], sabor: 'dulce' },
  { id: 't_bowl_proteico', nombre: 'Bowl de yogur con proteína de chocolate', bloques: ['A', 'C'], ingredientes: ['yogur_0', 'proteina_chocolate', 'avena', 'platano'], sabor: 'dulce' },
  { id: 't_batido', nombre: 'Leche fermentada con fruta y avena', bloques: ['A'], ingredientes: ['leche_fermentada_proteica', 'fresa_platano_cong', 'avena'], sabor: 'dulce' },
  { id: 't_porridge', nombre: 'Porridge con bebida de almendras', bloques: ['A'], ingredientes: ['avena', 'bebida_almendras', 'proteina_chocolate', 'platano'], sabor: 'dulce' },
  { id: 't_obleas', nombre: 'Obleas de arroz rellenas', bloques: ['A'], ingredientes: ['obleas_arroz', 'pavo_lonchas', 'havarti_light', 'tomate'], sabor: 'salado' },
  { id: 't_revuelto_a', nombre: 'Revuelto con tostada', bloques: ['A'], ingredientes: ['huevo', 'claras', 'setas', 'pan_integral', 'salsa_mexicana'], sabor: 'salado' },
];

/**
 * Favoritos iniciales con cantidades explícitas.
 * Cantidades en ESTADO DE CONSUMO (cocinado si hay conversión, unidades si la ración es por unidades).
 * 0 = ese perfil no lo lleva.
 */
export interface SeedFavorite {
  id: string;
  nombre: string;
  bloque: Block;
  notas?: string;
  items: { foodId: string; dani: number; alba: number; metodoId?: string }[];
}

export const SEED_FAVORITES: SeedFavorite[] = [
  {
    id: 'fav_pancakes_1',
    nombre: 'Pancakes avena (Dani salados / Alba dulces)',
    bloque: 'A',
    notas: 'Misma masa base. Alba puede cambiar la fruta por 10 g de chocolate 85% o 40-50 g de yogur 0%.',
    items: [
      { foodId: 'harina_avena', dani: 40, alba: 30 },
      { foodId: 'huevo', dani: 1, alba: 1 },
      { foodId: 'claras', dani: 150, alba: 100 },
      { foodId: 'pavo_lonchas', dani: 60, alba: 0 },
      { foodId: 'cottage', dani: 80, alba: 0 },
      { foodId: 'tomate', dani: 100, alba: 0 },
      { foodId: 'fresa_platano_cong', dani: 0, alba: 100 },
    ],
  },
  {
    id: 'fav_pancakes_2',
    nombre: 'Crepes avena 2 huevos + cottage',
    bloque: 'A',
    items: [
      { foodId: 'harina_avena', dani: 40, alba: 30 },
      { foodId: 'huevo', dani: 2, alba: 1 },
      { foodId: 'claras', dani: 100, alba: 100 },
      { foodId: 'cottage', dani: 60, alba: 0 },
      { foodId: 'tomate', dani: 100, alba: 0 },
      { foodId: 'yogur_0', dani: 0, alba: 45 },
    ],
  },
  {
    id: 'fav_tostada_aguacate',
    nombre: 'Tostadas de aguacate',
    bloque: 'A',
    notas: 'Dani puede cambiar los 20 g de Havarti por 80 g de cottage.',
    items: [
      { foodId: 'pan_integral', dani: 2, alba: 2 },
      { foodId: 'huevo', dani: 2, alba: 1 },
      { foodId: 'aguacate', dani: 50, alba: 30 },
      { foodId: 'tomate', dani: 100, alba: 100 },
      { foodId: 'cebolla', dani: 30, alba: 20 },
      { foodId: 'havarti_light', dani: 20, alba: 0 },
      { foodId: 'cottage', dani: 0, alba: 50 },
    ],
  },
  {
    id: 'fav_tostada_pollo',
    nombre: 'Tostadas de pollo desmenuzado',
    bloque: 'A',
    notas: 'Especias al gusto (no cuentan). Puedes usar queso batido 0% en lugar de yogur.',
    items: [
      { foodId: 'pan_integral', dani: 2, alba: 2 },
      { foodId: 'pollo_pechuga', dani: 130, alba: 95 },
      { foodId: 'yogur_0', dani: 70, alba: 50 },
      { foodId: 'tomate', dani: 100, alba: 100 },
    ],
  },
  {
    id: 'fav_tostada_pollo_aguacate',
    nombre: 'Tostadas de pollo y aguacate',
    bloque: 'A',
    items: [
      { foodId: 'pan_integral', dani: 2, alba: 2 },
      { foodId: 'pollo_pechuga', dani: 120, alba: 90 },
      { foodId: 'aguacate', dani: 50, alba: 30 },
      { foodId: 'tomate', dani: 100, alba: 100 },
    ],
  },
  {
    id: 'fav_hamburguesa',
    nombre: 'Hamburguesa con obleas y Havarti',
    bloque: 'C',
    items: [
      { foodId: 'hamburguesa', dani: 180, alba: 135 },
      { foodId: 'obleas_arroz', dani: 3, alba: 2 },
      { foodId: 'havarti_light', dani: 20, alba: 20 },
      { foodId: 'tomate', dani: 100, alba: 100 },
      { foodId: 'ketchup_zero', dani: 30, alba: 20 },
    ],
  },
  {
    id: 'fav_chili_arroz',
    nombre: 'Chili con arroz y gazpacho',
    bloque: 'B',
    notas: 'Formato de 420 g de chili: Dani 250 g, Alba 170 g.',
    items: [
      { foodId: 'chili', dani: 250, alba: 170 },
      { foodId: 'arroz', dani: 175, alba: 140 },
      { foodId: 'gazpacho', dani: 200, alba: 150 },
    ],
  },
  {
    id: 'fav_pollo_arroz',
    nombre: 'Pollo arroz ratatouille mexicana',
    bloque: 'B',
    items: [
      { foodId: 'pollo_pechuga', dani: 150, alba: 100 },
      { foodId: 'arroz', dani: 175, alba: 120 },
      { foodId: 'ratatouille', dani: 170, alba: 130 },
      { foodId: 'salsa_mexicana', dani: 50, alba: 40 },
    ],
  },
];
