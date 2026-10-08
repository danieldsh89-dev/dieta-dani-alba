// Tipos compartidos de dominio. Sin dependencias de React.

export type ProfileId = 'dani' | 'alba';
export const PROFILE_IDS: ProfileId[] = ['dani', 'alba'];

export type Block = 'A' | 'B' | 'C';
export const BLOCKS: Block[] = ['A', 'B', 'C'];

export type Category =
  | 'proteina'
  | 'hidrato'
  | 'verdura'
  | 'salsa'
  | 'queso'
  | 'lacteo'
  | 'fruta'
  | 'postre'
  | 'extra';

/**
 * Unidad en la que se mide la ración:
 * - 'g' / 'ml': gramos o mililitros.
 * - 'unidad': se cuenta en unidades (huevo, rebanada). Los valores nutricionales
 *   siguen siendo por 100 g y `pesoUnidad` indica los gramos de una unidad.
 */
export type Unit = 'g' | 'ml' | 'unidad';

export type NutritionState = 'crudo' | 'cocinado' | 'listo_para_consumir';

/** verificado = etiqueta/usuario; parcial = kcal verificadas, macros estimados; aproximado = valor estándar a revisar */
export type Verification = 'verificado' | 'parcial' | 'aproximado';

/** Etiquetas usadas por restricciones y preferencias */
export type FoodTag =
  | 'pescado'
  | 'leche_vaca'
  | 'lacteo'
  | 'legumbre'
  | 'picante'
  | 'dulce'
  | 'salado'
  | 'acompanante' // p.ej. gazpacho: se usa como entrante/complemento
  | 'sustituto_ligero' // p.ej. arroz de coliflor: no equivalente calóricamente
  | 'solo_si_se_incluye' // p.ej. aceite: el generador no lo añade por su cuenta
  | 'solo_en_receta' // p.ej. proteína en polvo: solo dentro de plantillas (bowl/postre), no suelto
  | 'sal_alta'
  | 'provisional';

export interface ProfileLimit {
  min?: number;
  max?: number;
  habitual?: number;
}

export interface Food {
  id: string;
  nombre: string;
  marca?: string;
  categoria: Category;
  /** Valores por 100 g o 100 ml en el estado `estadoNutricionalBase` */
  kcalPor100: number;
  proteinaPor100: number;
  carbohidratosPor100: number;
  grasasPor100: number;
  fibraPor100?: number;
  salPor100?: number;
  unidadBase: Unit;
  /** gramos por unidad (si unidadBase = 'unidad' o como referencia: rebanada, hamburguesa…) */
  pesoUnidad?: number;
  nombreUnidad?: string;
  estadoNutricionalBase: NutritionState;
  /** id de la conversión de cocción (src/data/conversions.ts) */
  conversionId?: string;
  /**
   * Rango de ración. Se expresa en el ESTADO DE CONSUMO:
   * cocinado si el alimento tiene conversión, si no en su estado base.
   * Para unidadBase = 'unidad' se expresa en unidades.
   */
  porcionMinima: number;
  porcionMaxima: number;
  incremento: number;
  porcionHabitual: number;
  /** Rangos específicos por perfil (mismo sistema de unidades que porcionMinima) */
  limitesPerfil?: Partial<Record<ProfileId, ProfileLimit>>;
  bloques: Block[];
  tags: FoodTag[];
  verificacion: Verification;
  notaVerificacion?: string;
  aviso?: string;
  foto?: string;
  /** EAN/UPC del producto (escáner) */
  codigoBarras?: string;
  archivado?: boolean;
  /** true si el usuario lo ha creado/duplicado */
  personalizado?: boolean;
}

export interface CookingMethod {
  id: string;
  nombre: string;
  /** peso cocinado / peso crudo */
  factor: number;
  personalizado?: boolean;
}

export interface CookingConversion {
  id: string;
  nombre: string;
  /** Nombre del estado inicial (seco, crudo, congelado, producto) */
  estadoInicial: string;
  metodos: CookingMethod[];
  metodoPorDefecto: string;
  nota?: string;
}

export interface BlockTarget {
  kcal: number;
  tolerancia: number;
  proteina: number;
}

export interface Profile {
  id: ProfileId;
  nombre: string;
  edad: number;
  alturaCm: number;
  pesoActualKg: number;
  pesoObjetivoKg: number;
  kcalDia: number;
  proteinaDia: number;
  bloques: Record<Block, BlockTarget>;
  /** escala relativa de raciones respecto a la ración "habitual" de la base (Dani = 1) */
  escalaRaciones: number;
  restricciones: {
    permitePescado: boolean;
    permiteLecheVaca: boolean;
    /** gramos máximos de legumbre por comida (null = sin límite) */
    maxLegumbresPorComida: number | null;
  };
  /** días de entrenamiento: objetivos distintos (más hidratos) */
  entreno: TrainingConfig;
  /** preferencias de sabor para el bloque A */
  saborPreferidoA: 'dulce' | 'salado' | 'ambos';
  notas: string;
}

export interface TrainingConfig {
  activo: boolean;
  /** días de la semana que entrena por defecto (0 = lunes … 6 = domingo) */
  dias: number[];
  kcalDia: number;
  proteinaDia: number;
  bloques: Record<Block, BlockTarget>;
}

export interface Nutrients {
  kcal: number;
  proteina: number;
  carbohidratos: number;
  grasas: number;
  fibra: number;
  sal: number;
}

export interface MealItem {
  foodId: string;
  /** método de cocción usado (si el alimento tiene conversión) */
  metodoId?: string;
  /** Cantidad en el ESTADO NUTRICIONAL BASE del alimento (g o ml). 0 = este perfil no lo come */
  cantidades: Record<ProfileId, number>;
  /** cantidad fija: el optimizador no la toca al ajustar el resto */
  bloqueado?: boolean;
}

export interface Meal {
  id: string;
  nombre: string;
  bloque: Block;
  items: MealItem[];
  notas?: string;
  origen: 'generador' | 'favorito' | 'manual' | 'semilla';
}

export interface Favorite extends Meal {
  creado: string;
  /** Instantánea de los totales al guardar */
  totales: Record<ProfileId, Nutrients>;
  /** veces que se ha usado (para ordenar por más usados) */
  usos?: number;
  ultimoUso?: string;
  /** foto (dataURL JPEG reducida) */
  foto?: string;
}

export interface FreeMeal {
  libre: true;
  descripcion?: string;
  kcalEstimadas: Partial<Record<ProfileId, number>>;
}

export type DaySlot = { meal: Meal } | FreeMeal;

export interface DayLog {
  fecha: string; // YYYY-MM-DD
  bloques: Partial<Record<Block, DaySlot>>;
  /** El usuario pidió compensar comidas libres en el resto del día */
  compensar?: boolean;
  /** tipo de día por perfil si se cambia a mano (si no, según los días de entreno del perfil) */
  entreno?: Partial<Record<ProfileId, boolean>>;
}

export interface WeightEntry {
  profile: ProfileId;
  fecha: string;
  kg: number;
}

/** Valoración 👍/👎 de una combinación de ingredientes */
export interface Rating {
  voto: 1 | -1;
  foods: string[];
  bloque: Block;
  fecha: string;
}

export type WeightView = 'crudo' | 'cocinado';

export interface Settings {
  mismaRecetaParaAmbos: boolean;
  permitirComplementosDistintos: boolean;
  mostrarPesos: WeightView;
  mostrarFibraSal: boolean;
}

/** Estado de sincronización en la nube (por dispositivo) */
export interface SyncState {
  /** clave secreta del hogar: quien la conoce puede leer/escribir los datos compartidos */
  household?: string;
  /** configuración de Supabase introducida en la app (si no, se usa la de src/sync/config.ts) */
  url?: string;
  anonKey?: string;
  /** "tipo:id" → marca de tiempo de la última modificación conocida */
  stamps: Record<string, number>;
  /** "tipo:id" → marca de tiempo del borrado */
  tombstones: Record<string, number>;
  /** claves modificadas en este dispositivo pendientes de subir */
  pending: string[];
  /** cursor de descarga (server_ts del servidor) */
  cursor?: string;
  lastSync?: number;
  lastError?: string;
}

export interface AppData {
  version: number;
  foods: Food[];
  conversions: CookingConversion[];
  profiles: Record<ProfileId, Profile>;
  favorites: Favorite[];
  /** días registrados y planificados (fechas pasadas y futuras) */
  history: DayLog[];
  pantry: string[];
  /** ids de alimentos marcados en la lista de la compra */
  shoppingChecked: string[];
  /** registro de peso */
  pesos: WeightEntry[];
  /** firma de ingredientes → valoración */
  ratings: Record<string, Rating>;
  settings: Settings;
  sync: SyncState;
}
