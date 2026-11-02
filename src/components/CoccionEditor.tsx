import type { CookingConversion, CookingMethod, Food } from '../types';
import { useStore } from '../store/AppStore';
import { formatNumber, ownConversionId } from '../lib/conversions';
import { NumberInput, Segmented } from './ui';

/** Lo que se edita en la ficha: si cambia al cocinar y con qué conversión (propia u otra) */
export interface CoccionDraft {
  cambia: boolean;
  /** los valores por 100 g son del producto crudo (como se compra) o ya cocinado */
  estado: 'crudo' | 'cocinado';
  modo: 'propia' | 'otra';
  /** conversión de otro alimento (modo "otra") */
  otraId?: string;
  /** conversión propia (modo "propia") */
  propia: CookingConversion;
}

export function newOwnConversion(food: Food): CookingConversion {
  return {
    id: ownConversionId(food.id),
    nombre: food.nombre || 'Alimento',
    estadoInicial: 'crudo',
    metodos: [{ id: 'cocinado', nombre: 'Cocinado', factor: 0.75 }],
    metodoPorDefecto: 'cocinado',
    propiaDe: food.id,
  };
}

/** Borrador inicial a partir del alimento guardado */
export function coccionDraft(food: Food, conversions: CookingConversion[]): CoccionDraft {
  const conv = food.conversionId ? conversions.find((c) => c.id === food.conversionId) : undefined;
  const cambia = !!conv && food.estadoNutricionalBase !== 'listo_para_consumir';
  const propia = conv?.propiaDe === food.id;
  return {
    cambia,
    estado: food.estadoNutricionalBase === 'cocinado' ? 'cocinado' : 'crudo',
    modo: !cambia || propia ? 'propia' : 'otra',
    otraId: !propia ? conv?.id : undefined,
    propia: propia && conv ? structuredClone(conv) : newOwnConversion(food),
  };
}

/** Aplica el borrador al alimento; devuelve la conversión propia a guardar (si la hay) */
export function applyCoccion(food: Food, d: CoccionDraft): { food: Food; conversion?: CookingConversion } {
  if (!d.cambia) return { food: { ...food, estadoNutricionalBase: 'listo_para_consumir', conversionId: undefined } };
  if (d.modo === 'otra' && d.otraId) return { food: { ...food, estadoNutricionalBase: d.estado, conversionId: d.otraId } };
  const conversion: CookingConversion = { ...d.propia, id: ownConversionId(food.id), nombre: food.nombre.trim() || d.propia.nombre, propiaDe: food.id };
  return { food: { ...food, estadoNutricionalBase: d.estado, conversionId: conversion.id }, conversion };
}

const ESTADOS = ['crudo', 'seco', 'congelado', 'escurrido', 'tal cual se compra'];

export function CoccionEditor({ food, draft, onChange }: { food: Food; draft: CoccionDraft; onChange: (d: CoccionDraft) => void }) {
  const { data } = useStore();
  const set = (patch: Partial<CoccionDraft>) => onChange({ ...draft, ...patch });
  const setPropia = (patch: Partial<CookingConversion>) => set({ propia: { ...draft.propia, ...patch } });
  const setMetodo = (i: number, patch: Partial<CookingMethod>) =>
    setPropia({ metodos: draft.propia.metodos.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  const otras = data.conversions.filter((c) => c.propiaDe !== food.id);
  const unidad = food.unidadBase === 'ml' ? 'ml' : 'g';
  const m0 = draft.propia.metodos.find((m) => m.id === draft.propia.metodoPorDefecto) ?? draft.propia.metodos[0];
  const factor = draft.modo === 'otra' ? (otras.find((c) => c.id === draft.otraId)?.metodos[0]?.factor ?? 1) : (m0?.factor ?? 1);
  const inicial = draft.modo === 'otra' ? (otras.find((c) => c.id === draft.otraId)?.estadoInicial ?? 'crudo') : draft.propia.estadoInicial;
  // ejemplo: 100 g en el estado de los valores → su equivalente en el otro estado, mismas kcal
  const ejemplo =
    draft.estado === 'crudo'
      ? `100 ${unidad} ${inicial} = ${formatNumber(100 * factor, 0)} ${unidad} cocinado`
      : `100 ${unidad} cocinado = ${formatNumber(100 / factor, 0)} ${unidad} ${inicial}`;

  return (
    <div className="card tight coccion">
      <b className="small">🍳 Crudo y cocinado</b>
      <div className="tiny muted">¿Cambia de peso al cocinarlo (pierde agua, la absorbe…)?</div>
      <Segmented
        full
        value={draft.cambia ? 'si' : 'no'}
        options={[
          { value: 'no', label: 'No: se come tal cual' },
          { value: 'si', label: 'Sí, cambia' },
        ]}
        onChange={(v) => set({ cambia: v === 'si' })}
      />
      {draft.cambia && (
        <>
          <label className="field">
            Los valores por 100 {unidad} de arriba son del producto…
            <select value={draft.estado} onChange={(e) => set({ estado: e.target.value as CoccionDraft['estado'] })}>
              <option value="crudo">Sin cocinar (como se compra: crudo, seco, congelado, escurrido…)</option>
              <option value="cocinado">Ya cocinado</option>
            </select>
          </label>
          <Segmented
            full
            value={draft.modo}
            options={[
              { value: 'propia', label: 'Conversión propia' },
              { value: 'otra', label: 'La de otro alimento' },
            ]}
            onChange={(v) => set({ modo: v, otraId: v === 'otra' ? (draft.otraId ?? otras[0]?.id) : draft.otraId })}
          />
          {draft.modo === 'otra' ? (
            <label className="field">
              Usar la conversión de
              <select value={draft.otraId ?? ''} onChange={(e) => set({ otraId: e.target.value })}>
                {otras.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre} ({c.metodos.map((m) => `×${m.factor}`).join(', ')})
                  </option>
                ))}
              </select>
              <span className="tiny muted">Es compartida: si cambias su factor, cambia para todos los alimentos que la usan.</span>
            </label>
          ) : (
            <>
              <label className="field">
                Sin cocinar está…
                <select value={ESTADOS.includes(draft.propia.estadoInicial) ? draft.propia.estadoInicial : 'crudo'} onChange={(e) => setPropia({ estadoInicial: e.target.value })}>
                  {ESTADOS.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </label>
              {draft.propia.metodos.map((m, i) => (
                <div key={m.id} className="coccion-metodo">
                  <label className="field">
                    Forma
                    <input type="text" value={m.nombre} onChange={(e) => setMetodo(i, { nombre: e.target.value })} placeholder="Cocinado, plancha…" />
                  </label>
                  <label className="field">
                    {unidad} cocinados por 100 {unidad} {draft.propia.estadoInicial}
                    <NumberInput
                      value={Math.round(m.factor * 1000) / 10}
                      step={1}
                      onChange={(v) => v && v > 0 && setMetodo(i, { factor: Math.round(v * 10) / 1000, personalizado: true })}
                    />
                  </label>
                  {draft.propia.metodos.length > 1 && (
                    <button
                      className="rm"
                      aria-label={`Quitar ${m.nombre}`}
                      onClick={() => {
                        const metodos = draft.propia.metodos.filter((_, j) => j !== i);
                        setPropia({ metodos, metodoPorDefecto: metodos.some((x) => x.id === draft.propia.metodoPorDefecto) ? draft.propia.metodoPorDefecto : metodos[0].id });
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              <div className="btn-row">
                <button
                  className="btn small"
                  onClick={() => setPropia({ metodos: [...draft.propia.metodos, { id: `m${Date.now().toString(36)}`, nombre: 'Otra forma', factor: 1 }] })}
                >
                  ＋ Otra forma de cocinarlo
                </button>
                {draft.propia.metodos.length > 1 && (
                  <select value={draft.propia.metodoPorDefecto} onChange={(e) => setPropia({ metodoPorDefecto: e.target.value })} aria-label="Forma por defecto">
                    {draft.propia.metodos.map((m) => (
                      <option key={m.id} value={m.id}>
                        Por defecto: {m.nombre}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </>
          )}
          <div className="coccion-ejemplo">
            <b>{ejemplo}</b>
            <span>
              Las dos cantidades tienen las mismas calorías ({formatNumber(food.kcalPor100, 0)} kcal): solo cambia el peso.
            </span>
          </div>
          <div className="tiny muted">
            Con esto, la app te muestra el peso en crudo o en cocinado según elijas, y el generador calcula las raciones en {unidad} cocinados.
          </div>
        </>
      )}
    </div>
  );
}
