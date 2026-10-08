import type { CookingConversion } from '../types';

/**
 * Factores de cocción iniciales (peso final / peso inicial).
 * Las conversiones NO cambian las calorías totales: solo el peso por agua ganada/perdida.
 * Todos son editables desde la app y calibrables con "Calibrar cocción".
 */
export const SEED_CONVERSIONS: CookingConversion[] = [
  {
    id: 'arroz',
    nombre: 'Arroz',
    estadoInicial: 'seco',
    metodos: [{ id: 'cocido', nombre: 'Cocido', factor: 2.7 }],
    metodoPorDefecto: 'cocido',
    nota: '65 g seco ≈ 175 g cocido; 45 g seco ≈ 120 g cocido',
  },
  {
    id: 'pasta',
    nombre: 'Pasta normal',
    estadoInicial: 'seca',
    metodos: [{ id: 'cocida', nombre: 'Cocida', factor: 2.3 }],
    metodoPorDefecto: 'cocida',
    nota: '65 g seca ≈ 150 g cocida',
  },
  {
    id: 'pasta_legumbres',
    nombre: 'Pasta de legumbres',
    estadoInicial: 'seca',
    metodos: [{ id: 'cocida', nombre: 'Cocida', factor: 2.1 }],
    metodoPorDefecto: 'cocida',
  },
  {
    id: 'cuscus',
    nombre: 'Cuscús',
    estadoInicial: 'seco',
    metodos: [{ id: 'hidratado', nombre: 'Hidratado', factor: 2.4 }],
    metodoPorDefecto: 'hidratado',
  },
  {
    id: 'pollo_pechuga',
    nombre: 'Pechuga de pollo',
    estadoInicial: 'cruda',
    metodos: [
      { id: 'plancha', nombre: 'Plancha', factor: 0.75 },
      { id: 'air_fryer', nombre: 'Air fryer', factor: 0.75 },
    ],
    metodoPorDefecto: 'plancha',
    nota: '200 g crudo ≈ 150 g cocinado',
  },
  {
    id: 'contramuslo',
    nombre: 'Contramuslo',
    estadoInicial: 'crudo',
    metodos: [{ id: 'cocinado', nombre: 'Cocinado', factor: 0.75 }],
    metodoPorDefecto: 'cocinado',
  },
  {
    id: 'carne_picada',
    nombre: 'Carne picada',
    estadoInicial: 'cruda',
    metodos: [{ id: 'cocinada', nombre: 'Cocinada', factor: 0.75 }],
    metodoPorDefecto: 'cocinada',
  },
  {
    id: 'albondigas',
    nombre: 'Albóndigas',
    estadoInicial: 'antes de cocinar',
    metodos: [{ id: 'cocinadas', nombre: 'Cocinadas', factor: 0.85 }],
    metodoPorDefecto: 'cocinadas',
  },
  {
    id: 'papa_fresca',
    nombre: 'Papa fresca',
    estadoInicial: 'cruda',
    metodos: [
      { id: 'air_fryer', nombre: 'Air fryer', factor: 0.78 },
      { id: 'hervida', nombre: 'Hervida', factor: 1.05 },
    ],
    metodoPorDefecto: 'air_fryer',
    nota: 'Air fryer: 300 g cruda ≈ 235 g. Hervida: 300 g cruda ≈ 300-330 g',
  },
  {
    id: 'ratatouille',
    nombre: 'Ratatouille congelado',
    estadoInicial: 'congelado',
    metodos: [{ id: 'cocinado', nombre: 'Cocinado', factor: 0.85 }],
    metodoPorDefecto: 'cocinado',
  },
  {
    id: 'setas',
    nombre: 'Setas congeladas',
    estadoInicial: 'congeladas',
    metodos: [{ id: 'cocinadas', nombre: 'Cocinadas', factor: 0.5 }],
    metodoPorDefecto: 'cocinadas',
  },
  {
    id: 'gnocchi',
    nombre: 'Gnocchi',
    estadoInicial: 'producto',
    metodos: [{ id: 'cocidos', nombre: 'Cocidos', factor: 1.05 }],
    metodoPorDefecto: 'cocidos',
  },
];
