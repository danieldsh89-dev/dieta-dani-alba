import { describe, expect, it } from 'vitest';
import { createSeedData } from '../../store/seed';
import { parseOrden } from '../asistente';
import { favoriteToMeal } from '../favorites';

const d = createSeedData();
const hoy = '2026-10-14'; // miércoles
const O = (t: string) => parseOrden(t, d, d.foods, hoy);

describe('asistente de voz', () => {
  it('planes y comidas a generar', () => {
    expect(O('créame un plan para la semana que viene con pollo').tipo).toBe('plan');
    expect(O('hazme una cena con atún para mañana').tipo).toBe('plan');
  });

  it('registrar una comida (favorito por código o por nombre)', () => {
    const a = O('hoy he comido el B1');
    expect(a).toMatchObject({ tipo: 'comida', fecha: hoy, bloque: 'B' });
    expect(d.favorites.find((f) => f.id === (a as { favId: string }).favId)!.nombre).toMatch(/^B1 /);
    const b = O('pon pollo con papas en la cena de mañana');
    expect(b).toMatchObject({ tipo: 'comida', fecha: '2026-10-15', bloque: 'C' });
    expect(O('hemos desayunado el bol de frutos rojos')).toMatchObject({ tipo: 'comida', bloque: 'A' });
  });

  it('peso, confirmar, repetir, copiar', () => {
    expect(O('peso 78,5')).toEqual({ tipo: 'peso', pid: 'dani', kg: 78.5, fecha: hoy });
    expect(O('Alba pesa 58.2 kilos')).toMatchObject({ tipo: 'peso', pid: 'alba', kg: 58.2 });
    expect(O('hemos comido lo planificado')).toEqual({ tipo: 'confirmar', fecha: hoy });
    expect(O('repite lo de ayer')).toEqual({ tipo: 'repetir_ayer', fecha: hoy });
    expect(O('copia hoy a mañana')).toEqual({ tipo: 'copiar_dia', from: hoy, to: '2026-10-15' });
  });

  it('comida libre, extras, quitar', () => {
    expect(O('esta noche cenamos fuera, unas 900 calorías')).toMatchObject({ tipo: 'libre', bloque: 'C', kcal: 900 });
    expect(O('me he tomado un plátano de extra')).toMatchObject({ tipo: 'extra', foodId: 'platano', personas: ['dani'], unidades: 1 });
    expect(O('quita la cena de mañana')).toEqual({ tipo: 'quitar_comida', fecha: '2026-10-15', bloque: 'C' });
  });

  it('cambiar un ingrediente en una comida del día', () => {
    const dd = createSeedData();
    const b2 = favoriteToMeal(dd.favorites.find((f) => f.nombre.startsWith('B2 '))!);
    dd.history = [{ fecha: hoy, bloques: { B: { meal: b2 } } }];
    const o = parseOrden('cambia las papas por arroz en la comida', dd, dd.foods, hoy);
    expect(o).toMatchObject({ tipo: 'cambiar', bloque: 'B', fromFood: 'papa_fresca', toFoods: ['arroz'] });
  });

  it('ir, buscar, temporizador y despensa', () => {
    expect(O('abre la despensa')).toEqual({ tipo: 'ir', destino: 'casa' });
    expect(O('carga el carrito')).toEqual({ tipo: 'ir', destino: 'mercadona' });
    expect(O('qué hay que comprar')).toEqual({ tipo: 'ir', destino: 'compra' });
    expect(O('busca albóndigas')).toEqual({ tipo: 'buscar', q: 'albondigas' });
    expect(O('pon un temporizador de diez minutos')).toEqual({ tipo: 'temporizador', minutos: 10 });
    expect(O('se acabó la leche y quedan 4 huevos').tipo).toBe('despensa');
  });
});

describe('asistente: más frases de plan', () => {
  it('plurales', () => {
    expect(O('hazme las cenas de esta semana con pescado y verdura, nada de pasta').tipo).toBe('plan');
    expect(O('prepárame los desayunos de mañana').tipo).toBe('plan');
  });
});
