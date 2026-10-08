import type { SeedFavorite } from './seedMeals';

/**
 * Dieta modular A/B/C diseñada por el usuario (PDF): 13 opciones A, 14 B y 14 C.
 * Cantidades FIJAS en estado de consumo (cocinado / listo para comer; huevos, rebanadas,
 * obleas y tortillas en unidades). No se optimizan: se guardan tal cual como favoritos.
 * Las kcal/macros se calculan con la base de alimentos.
 *
 * Interpretaciones (el PDF no las detalla):
 *  - "salsa" sin más = salsa mexicana; "salsa Zero" = ketchup/salsa tomate Zero.
 *  - "tomate" en platos calientes (pasta, gnocchi, albóndigas, garbanzos) = salsa de tomate con albahaca;
 *    en desayunos y ensaladas = tomate fresco.
 *  - "tomate/cebolla" (C2) = 75 % tomate + 25 % cebolla.
 *  - C9 "tomate + pepino" sin cantidad = 150 g tomate + 100 g pepino.
 *  - "fruta" sin especificar = fresa-plátano congelada.
 *  - "proteína" = whey; Alba en A2 = proteína vegetal; A6 = proteína sabor chocolate.
 *  - "gnocchi" = gnocchi rellenos de queso (producto de referencia); "atún/melva" = atún.
 *  - Rangos ("125-130 g") = el valor menor.
 */
type I = SeedFavorite['items'][number];
const it = (foodId: string, dani: number, alba: number): I => ({ foodId, dani, alba });

// atajos de ids
const PAN = 'pan_integral';
const HUEVO = 'huevo';
const CLARAS = 'claras';
const PAVO = 'pavo_lonchas';
const TOMATE = 'tomate';
const T_ALB = 'salsa_tomate_albahaca';
const MEX = 'salsa_mexicana';
const ZERO = 'ketchup_zero';
const RAT = 'ratatouille';
const GAZ = 'gazpacho';
const COT = 'cottage';
const POLLO = 'pollo_pechuga';
const CARNE = 'carne_picada';
const MOZZ = 'mozzarella_rallada';
const FRUTA = 'fresa_platano_cong';

export const DIETA_MODULAR: SeedFavorite[] = [
  // ═══════════ BLOQUE A ═══════════
  { id: 'dm_A1', bloque: 'A', nombre: 'A1 Huevos y tostadas', items: [it(PAN, 2, 2), it(HUEVO, 2, 1), it(CLARAS, 150, 100), it(PAVO, 60, 40), it(TOMATE, 150, 100)] },
  {
    id: 'dm_A2',
    bloque: 'A',
    nombre: 'A2 Bol frutos rojos',
    notas: 'Dani: proteína whey · Alba: proteína vegetal.',
    items: [it('yogur_0', 250, 200), it('proteina_whey', 30, 0), it('proteina_vegetal', 0, 20), it('avena', 30, 15), it('frutos_rojos_cong', 150, 120)],
  },
  { id: 'dm_A3', bloque: 'A', nombre: 'A3 Cottage y huevo', items: [it(PAN, 2, 1), it(HUEVO, 2, 1), it(CLARAS, 100, 100), it(COT, 80, 70), it(PAVO, 60, 50), it(TOMATE, 100, 100)] },
  {
    id: 'dm_A4',
    bloque: 'A',
    nombre: 'A4 Obleas saladas',
    items: [it('obleas_arroz', 3, 2), it(HUEVO, 2, 1), it(CLARAS, 150, 100), it(PAVO, 60, 50), it('havarti_light', 20, 15), it(TOMATE, 150, 100), it(ZERO, 30, 20)],
  },
  {
    id: 'dm_A5',
    bloque: 'A',
    nombre: 'A5 Taco desayuno',
    items: [it('tortilla_maiz', 2, 1), it(HUEVO, 1, 1), it(CLARAS, 150, 100), it(PAVO, 60, 40), it(MOZZ, 15, 10), it(RAT, 85, 70), it(MEX, 30, 30)],
  },
  {
    id: 'dm_A6',
    bloque: 'A',
    nombre: 'A6 Bol plátano-chocolate',
    items: [it('yogur_0', 200, 170), it('proteina_chocolate', 25, 20), it('avena', 25, 10), it('platano', 100, 70), it('chocolate_85', 5, 5)],
  },
  {
    id: 'dm_A7',
    bloque: 'A',
    nombre: 'A7 Revuelto de setas',
    items: [it(HUEVO, 2, 1), it(CLARAS, 150, 100), it('setas', 100, 75), it('havarti_light', 25, 15), it(PAN, 2, 2), it(ZERO, 30, 20)],
  },
  {
    id: 'dm_A8',
    bloque: 'A',
    nombre: 'A8 Pavo-cottage',
    items: [it(PAN, 2, 1), it(HUEVO, 1, 1), it(PAVO, 80, 50), it(COT, 100, 70), it(TOMATE, 150, 100), it('mandarina', 150, 100)],
  },
  {
    id: 'dm_A9',
    bloque: 'A',
    nombre: 'A9 Yogur líquido y fruta',
    items: [
      it('yogur_liquido_frutos_silvestres', 300, 220),
      it('avena', 40, 25),
      it(FRUTA, 150, 120),
      it('proteina_whey', 10, 5),
      it('chocolate_85', 10, 5),
    ],
  },
  {
    id: 'dm_A10',
    bloque: 'A',
    nombre: 'A10 Pancakes dulces',
    items: [it('harina_avena', 45, 30), it(HUEVO, 1, 1), it(CLARAS, 150, 100), it(FRUTA, 150, 100), it('yogur_0', 50, 40)],
  },
  {
    id: 'dm_A11',
    bloque: 'A',
    nombre: 'A11 Pancakes pavo-cottage',
    items: [it('harina_avena', 40, 30), it(HUEVO, 1, 1), it(CLARAS, 150, 100), it(PAVO, 60, 40), it(COT, 80, 40), it(TOMATE, 100, 100)],
  },
  {
    id: 'dm_A12',
    bloque: 'A',
    nombre: 'A12 Crepes huevo-cottage',
    items: [it('harina_avena', 40, 30), it(HUEVO, 2, 1), it(CLARAS, 100, 100), it(COT, 60, 50), it(TOMATE, 100, 100)],
  },
  {
    id: 'dm_A13',
    bloque: 'A',
    nombre: 'A13 Obleas huevo-pavo',
    items: [
      it('obleas_arroz', 3, 2),
      it(HUEVO, 2, 1),
      it(CLARAS, 150, 100),
      it(PAVO, 60, 40),
      it(COT, 80, 60),
      it(TOMATE, 100, 100),
      it(FRUTA, 80, 80),
    ],
  },

  // ═══════════ BLOQUE B ═══════════
  { id: 'dm_B1', bloque: 'B', nombre: 'B1 Pollo-arroz', items: [it(POLLO, 150, 100), it('arroz', 175, 120), it(RAT, 170, 130), it(GAZ, 250, 150), it(MEX, 50, 40)] },
  { id: 'dm_B2', bloque: 'B', nombre: 'B2 Pollo-papa', items: [it(POLLO, 150, 100), it('papa_fresca', 235, 170), it(RAT, 170, 130), it(GAZ, 250, 150), it(MEX, 50, 40)] },
  { id: 'dm_B3', bloque: 'B', nombre: 'B3 Albóndigas', items: [it('albondigas', 150, 95), it('papa_fresca', 195, 140), it(RAT, 85, 85), it(T_ALB, 100, 100)] },
  { id: 'dm_B4', bloque: 'B', nombre: 'B4 Boloñesa', items: [it(CARNE, 120, 85), it('pasta', 150, 105), it(RAT, 85, 85), it(T_ALB, 100, 100), it(MOZZ, 15, 10)] },
  { id: 'dm_B5', bloque: 'B', nombre: 'B5 Contramuslo-cuscús', items: [it('contramuslo', 105, 70), it('cuscus', 145, 95), it(RAT, 130, 85), it(GAZ, 200, 150), it(MEX, 30, 20)] },
  { id: 'dm_B6', bloque: 'B', nombre: 'B6 Chili-arroz', items: [it('chili', 250, 170), it('arroz', 160, 110), it(COT, 100, 70), it(GAZ, 150, 150)] },
  {
    id: 'dm_B7',
    bloque: 'B',
    nombre: 'B7 Tacos pollo',
    items: [it(POLLO, 135, 90), it('tortilla_maiz', 3, 2), it(RAT, 130, 85), it(MOZZ, 30, 20), it(COT, 80, 70), it(MEX, 50, 40), it(GAZ, 150, 150)],
  },
  { id: 'dm_B8', bloque: 'B', nombre: 'B8 Carne-arroz', items: [it(CARNE, 120, 85), it('arroz', 175, 120), it(RAT, 130, 85), it(T_ALB, 100, 100), it(GAZ, 150, 150)] },
  {
    id: 'dm_B9',
    bloque: 'B',
    nombre: 'B9 Pollo-gnocchi',
    items: [it(POLLO, 150, 100), it('gnocchi', 170, 115), it(RAT, 130, 100), it(T_ALB, 100, 100), it(COT, 50, 30), it(GAZ, 150, 150)],
  },
  { id: 'dm_B10', bloque: 'B', nombre: 'B10 Carrilladas-arroz', items: [it('carrilladas', 250, 170), it('arroz', 175, 120), it(RAT, 130, 100), it(MEX, 50, 30), it(GAZ, 150, 150)] },
  {
    id: 'dm_B11',
    bloque: 'B',
    nombre: 'B11 Pollo-garbanzos',
    items: [
      it(POLLO, 150, 100),
      it('garbanzos', 180, 90),
      it('papa_fresca', 80, 80),
      it(RAT, 130, 100),
      it(T_ALB, 100, 100),
      it(COT, 30, 20),
      it(GAZ, 150, 150),
    ],
  },
  {
    id: 'dm_B12',
    bloque: 'B',
    nombre: 'B12 Carrilladas-papa',
    items: [it('carrilladas', 230, 170), it('papa_fresca', 235, 155), it('setas', 100, 75), it(MEX, 50, 40), it(COT, 50, 40), it(GAZ, 200, 150)],
  },
  { id: 'dm_B13', bloque: 'B', nombre: 'B13 Gnocchi-carne', items: [it(CARNE, 115, 75), it('gnocchi', 190, 125), it(RAT, 100, 85), it(T_ALB, 100, 100), it(MOZZ, 15, 10)] },
  {
    id: 'dm_B14',
    bloque: 'B',
    nombre: 'B14 Pollo-cuscús-garbanzos',
    items: [
      it(POLLO, 120, 85),
      it('cuscus', 120, 85),
      it('garbanzos', 100, 60),
      it(RAT, 130, 85),
      it(COT, 80, 50),
      it(GAZ, 150, 150),
      it(MEX, 40, 30),
    ],
  },

  // ═══════════ BLOQUE C ═══════════
  {
    id: 'dm_C1',
    bloque: 'C',
    nombre: 'C1 Revuelto grande',
    items: [it(HUEVO, 3, 2), it(CLARAS, 200, 150), it(PAVO, 80, 60), it('setas', 125, 125), it(COT, 120, 100), it(PAN, 2, 2), it(GAZ, 200, 150)],
  },
  {
    id: 'dm_C2',
    bloque: 'C',
    nombre: 'C2 Burger bowl',
    notas: '“Tomate/cebolla”: 150 g tomate + 50 g cebolla (Alba 110 + 40).',
    items: [
      it(CARNE, 120, 90),
      it('papa_fresca', 195, 155),
      it(TOMATE, 150, 110),
      it('cebolla', 50, 40),
      it('havarti_light', 20, 15),
      it(COT, 50, 50),
      it(MEX, 50, 40),
      it(GAZ, 150, 150),
    ],
  },
  {
    id: 'dm_C3',
    bloque: 'C',
    nombre: 'C3 Tacos pollo',
    items: [it(POLLO, 135, 110), it('tortilla_maiz', 3, 2), it(RAT, 130, 100), it(MOZZ, 25, 20), it(COT, 80, 90), it(MEX, 50, 40), it(GAZ, 200, 150)],
  },
  {
    id: 'dm_C4',
    bloque: 'C',
    nombre: 'C4 Ensalada atún-mozzarella',
    notas: 'Lleva atún: Dani no come pescado por defecto (la app lo avisará). Alba puede usar melva.',
    items: [
      it('atun', 100, 80),
      it(HUEVO, 2, 1),
      it('mozzarella_bufala', 60, 50),
      it(TOMATE, 200, 200),
      it('pepino', 150, 150),
      it('aceite_oliva', 5, 5),
      it(PAN, 2, 2),
      it(GAZ, 200, 150),
    ],
  },
  {
    id: 'dm_C5',
    bloque: 'C',
    nombre: 'C5 Albóndigas-papa',
    items: [it('albondigas', 125, 95), it('papa_fresca', 195, 140), it(RAT, 130, 85), it(T_ALB, 150, 120), it(COT, 50, 50), it(GAZ, 100, 150)],
  },
  {
    id: 'dm_C6',
    bloque: 'C',
    nombre: 'C6 Pollo-cuscús',
    items: [it(POLLO, 120, 90), it('cuscus', 130, 95), it(RAT, 130, 100), it(COT, 80, 70), it(HUEVO, 1, 1), it(MEX, 50, 40), it(GAZ, 200, 150)],
  },
  {
    id: 'dm_C7',
    bloque: 'C',
    nombre: 'C7 Obleas rellenas',
    items: [
      it('obleas_arroz', 4, 3),
      it(POLLO, 105, 75),
      it(HUEVO, 2, 2),
      it(CLARAS, 100, 100),
      it(COT, 100, 70),
      it(RAT, 130, 85),
      it(ZERO, 30, 20),
      it(GAZ, 200, 150),
    ],
  },
  {
    id: 'dm_C8',
    bloque: 'C',
    nombre: 'C8 Pasta gratinada',
    items: [it(CARNE, 105, 75), it('pasta', 125, 90), it(RAT, 100, 85), it(T_ALB, 100, 100), it(MOZZ, 15, 10), it(COT, 70, 60), it(GAZ, 150, 150)],
  },
  {
    id: 'dm_C9',
    bloque: 'C',
    nombre: 'C9 Ensalada garbanzos',
    notas: 'Lleva atún: Dani no come pescado por defecto (la app lo avisará). Tomate y pepino sin cantidad en el PDF: 150 g + 100 g.',
    items: [
      it('garbanzos', 160, 90),
      it('atun', 100, 80),
      it(HUEVO, 2, 1),
      it(TOMATE, 150, 150),
      it('pepino', 100, 100),
      it('aceite_oliva', 5, 5),
      it(COT, 40, 40),
      it(PAN, 2, 2),
      it(GAZ, 150, 150),
    ],
  },
  {
    id: 'dm_C10',
    bloque: 'C',
    nombre: 'C10 Gnocchi pollo',
    items: [it(POLLO, 120, 90), it('gnocchi', 190, 125), it(RAT, 100, 85), it(T_ALB, 100, 100), it(MOZZ, 20, 15), it(COT, 80, 60), it(GAZ, 150, 150)],
  },
  {
    id: 'dm_C11',
    bloque: 'C',
    nombre: 'C11 Crepes salados',
    items: [
      it('harina_avena', 40, 30),
      it(HUEVO, 2, 1),
      it(CLARAS, 150, 150),
      it(PAVO, 80, 60),
      it(COT, 100, 80),
      it('setas', 75, 75),
      it('havarti_light', 10, 10),
      it(PAN, 1, 1),
      it(GAZ, 150, 150),
    ],
  },
  {
    id: 'dm_C12',
    bloque: 'C',
    nombre: 'C12 Carrilladas-cuscús',
    items: [it('carrilladas', 220, 160), it('cuscus', 130, 95), it('setas', 100, 75), it(RAT, 130, 100), it(COT, 80, 60), it(GAZ, 150, 150)],
  },
  {
    id: 'dm_C13',
    bloque: 'C',
    nombre: 'C13 Rollitos oblea',
    items: [
      it('obleas_arroz', 4, 3),
      it(POLLO, 120, 85),
      it(HUEVO, 2, 2),
      it(CLARAS, 100, 100),
      it(COT, 100, 70),
      it(RAT, 130, 85),
      it(MEX, 50, 40),
      it(GAZ, 200, 150),
    ],
  },
  {
    id: 'dm_C14',
    bloque: 'C',
    nombre: 'C14 Carrilladas-gnocchi',
    items: [it('carrilladas', 200, 150), it('gnocchi', 170, 115), it(RAT, 130, 100), it(T_ALB, 100, 100), it(COT, 60, 50), it(GAZ, 150, 150)],
  },
];
