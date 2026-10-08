import { useMemo, useState } from 'react';
import type { BlockTarget, Category, Meal, ProfileId } from '../types';
import { PROFILE_IDS } from '../types';
import { useStore } from '../store/AppStore';
import {
  baseFromState,
  baseToServing,
  displayQuantity,
  getMethod,
  hasConversion,
  servingToBase,
  stateLabel,
} from '../lib/conversions';
import { mealNutrients } from '../lib/nutrition';
import { portionRange } from '../lib/portions';
import { mealWarnings } from '../lib/validation';
import { mealName, shortName } from '../lib/mealGenerator';
import { mergeDuplicates } from '../lib/substitutions';
import { FoodPickerList } from './FoodPicker';
import { SubstituteSheet } from './SubstituteSheet';
import { NumberInput, Sheet, TotalsBox, VerificationBadge, Warnings } from './ui';

/**
 * Tabla de una comida con cantidades de Dani y Alba.
 * Si se pasa onChange es editable: +/- por ración, sustituir, método de cocción, quitar, añadir.
 */
export function MealEditor({
  meal,
  onChange,
  targets,
  prohibidos,
  hideTotals,
  substituteRequest,
  onSubstituteHandled,
  onToast,
}: {
  meal: Meal;
  onChange?: (m: Meal) => void;
  targets?: Record<ProfileId, BlockTarget>;
  prohibidos?: string[];
  hideTotals?: boolean;
  /** abrir directamente el comparador para el primer ingrediente de esta categoría */
  substituteRequest?: Category | null;
  onSubstituteHandled?: () => void;
  onToast?: (t: string) => void;
}) {
  const { data, fm, cm } = useStore();
  const view = data.settings.mostrarPesos;
  const [actionIdx, setActionIdx] = useState<number | null>(null);
  const [substIdx, setSubstIdx] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  const editable = !!onChange;
  const totals = useMemo(
    () => Object.fromEntries(PROFILE_IDS.map((p) => [p, mealNutrients(meal, p, fm)])) as Record<ProfileId, ReturnType<typeof mealNutrients>>,
    [meal, fm],
  );
  const warnings = useMemo(
    () => (targets ? mealWarnings(meal, data.profiles, fm, targets) : []),
    [meal, data.profiles, fm, targets],
  );

  // petición externa de "Cambiar hidrato / salsa"
  const requestedIdx =
    substituteRequest != null ? meal.items.findIndex((i) => fm[i.foodId]?.categoria === substituteRequest) : -1;
  const openSubst = substIdx ?? (requestedIdx >= 0 ? requestedIdx : null);

  const update = (m: Meal) => onChange?.(m);

  const step = (idx: number, pid: ProfileId, dir: 1 | -1) => {
    const it = meal.items[idx];
    const food = fm[it.foodId];
    const r = portionRange(food, data.profiles[pid]);
    const cur = baseToServing(food, it.cantidades[pid], cm, it.metodoId);
    let next = Math.round(cur / r.step) * r.step + dir * r.step;
    if (dir < 0 && cur > 0 && next < r.min && cur <= r.min) next = 0;
    else if (dir < 0 && next < r.min) next = r.min;
    if (dir > 0 && cur === 0) next = r.min;
    next = Math.max(0, next);
    const items = meal.items.map((x, i) =>
      i === idx ? { ...x, cantidades: { ...x.cantidades, [pid]: servingToBase(food, next, cm, x.metodoId) } } : x,
    );
    update({ ...meal, items });
  };

  const removeItem = (idx: number) => {
    const items = meal.items.filter((_, i) => i !== idx);
    update({ ...meal, items, nombre: renameIfAuto(meal, items.map((i) => i.foodId)) });
  };

  const renameIfAuto = (m: Meal, ids: string[]) =>
    m.nombre === mealName(m.items.map((i) => i.foodId), fm) ? mealName(ids, fm) : m.nombre;

  const addFood = (id: string) => {
    if (meal.items.some((i) => i.foodId === id)) return;
    const food = fm[id];
    const cantidades = {} as Record<ProfileId, number>;
    for (const p of PROFILE_IDS) cantidades[p] = servingToBase(food, portionRange(food, data.profiles[p]).habitual, cm);
    const items = [...meal.items, { foodId: id, cantidades }];
    update({ ...meal, items, nombre: renameIfAuto(meal, items.map((i) => i.foodId)) });
    setAdding(false);
  };

  return (
    <div className="col">
      <div className="meal-table">
        <div className="meal-head">
          <span className="muted">Ingrediente · {view === 'crudo' ? 'pesos crudos' : 'pesos cocinados'}</span>
          <span className="dani">{data.profiles.dani.nombre}</span>
          <span className="alba">{data.profiles.alba.nombre}</span>
        </div>
        {meal.items.map((it, idx) => {
          const food = fm[it.foodId];
          if (!food) {
            return (
              <div className="meal-row" key={idx}>
                <span className="small muted">Alimento eliminado ({it.foodId})</span>
              </div>
            );
          }
          const st = stateLabel(food, view, cm, it.metodoId);
          return (
            <div className="meal-row" key={`${it.foodId}-${idx}`}>
              <button className="food-name" onClick={() => setActionIdx(idx)} title="Opciones del ingrediente">
                <span className="n">{shortName(food)}</span>
                <span className="row tiny muted" style={{ gap: 4 }}>
                  {st && <span>{st}</span>}
                  {food.verificacion !== 'verificado' && <span title={food.notaVerificacion}>≈ aprox.</span>}
                  {food.aviso && <span title={food.aviso}>⚠️</span>}
                </span>
              </button>
              {PROFILE_IDS.map((pid) => {
                const q = it.cantidades[pid] ?? 0;
                const d = displayQuantity(food, q, view, cm, it.metodoId);
                return (
                  <div className="qty" key={pid}>
                    <span className={`v ${q <= 0 ? 'none' : ''}`}>{q <= 0 ? '—' : food.unidadBase === 'unidad' ? d.text.split(' (')[0] : d.text}</span>
                    {q > 0 && food.unidadBase === 'unidad' && <span className="st">{Math.round(q)} g</span>}
                    {editable && (
                      <div className="stepper">
                        <button onClick={() => step(idx, pid, -1)} aria-label="Menos">
                          −
                        </button>
                        <button onClick={() => step(idx, pid, 1)} aria-label="Más">
                          +
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {editable && (
        <button className="btn small" onClick={() => setAdding(true)}>
          ＋ Añadir ingrediente
        </button>
      )}
      {!hideTotals && (
        <div className="totals">
          {PROFILE_IDS.map((p) => (
            <TotalsBox key={p} pid={p} n={totals[p]} target={targets?.[p]} />
          ))}
        </div>
      )}
      <Warnings items={warnings} />

      {actionIdx !== null && meal.items[actionIdx] && (
        <ItemActions
          meal={meal}
          idx={actionIdx}
          editable={editable}
          onClose={() => setActionIdx(null)}
          onSubstitute={() => {
            setSubstIdx(actionIdx);
            setActionIdx(null);
          }}
          onRemove={() => {
            removeItem(actionIdx);
            setActionIdx(null);
          }}
          onChange={(m) => update(m)}
        />
      )}
      {openSubst !== null && meal.items[openSubst] && (
        <SubstituteSheet
          meal={meal}
          index={openSubst}
          prohibidos={prohibidos}
          onClose={() => {
            setSubstIdx(null);
            onSubstituteHandled?.();
          }}
          onApply={(m, msg) => {
            update({ ...m, items: mergeDuplicates(m.items), nombre: renameIfAuto(meal, m.items.map((i) => i.foodId)) });
            setSubstIdx(null);
            onSubstituteHandled?.();
            if (msg) onToast?.(msg);
          }}
        />
      )}
      {substituteRequest != null && requestedIdx < 0 && (
        <Sheet title="Sin ingrediente" onClose={() => onSubstituteHandled?.()}>
          <div className="empty">Esta comida no tiene ningún ingrediente de esa categoría. Puedes añadir uno con “＋ Añadir ingrediente”.</div>
        </Sheet>
      )}
      {adding && (
        <Sheet title="Añadir ingrediente" onClose={() => setAdding(false)}>
          <FoodPickerList selected={meal.items.map((i) => i.foodId)} onToggle={addFood} />
        </Sheet>
      )}
    </div>
  );
}

function ItemActions({
  meal,
  idx,
  editable,
  onClose,
  onSubstitute,
  onRemove,
  onChange,
}: {
  meal: Meal;
  idx: number;
  editable: boolean;
  onClose: () => void;
  onSubstitute: () => void;
  onRemove: () => void;
  onChange: (m: Meal) => void;
}) {
  const { data, fm, cm } = useStore();
  const view = data.settings.mostrarPesos;
  const it = meal.items[idx];
  const food = fm[it.foodId];
  const conv = food.conversionId ? cm[food.conversionId] : undefined;
  const methods = hasConversion(food, cm) && conv ? conv.metodos : [];
  const method = getMethod(food, cm, it.metodoId);

  const setQty = (pid: ProfileId, shown: number | undefined) => {
    const v = shown ?? 0;
    const base = food.unidadBase === 'unidad' ? v * (food.pesoUnidad ?? 1) : baseFromState(food, v, view, cm, it.metodoId);
    onChange({
      ...meal,
      items: meal.items.map((x, i) => (i === idx ? { ...x, cantidades: { ...x.cantidades, [pid]: base } } : x)),
    });
  };

  return (
    <Sheet title={shortName(food)} onClose={onClose}>
      <div className="row wrap">
        <VerificationBadge food={food} />
        {food.marca && <span className="badge info">{food.marca}</span>}
      </div>
      {food.notaVerificacion && <div className="sub">{food.notaVerificacion}</div>}
      {food.aviso && <Warnings items={[food.aviso]} />}
      <div className="sub">
        {food.kcalPor100} kcal · P {food.proteinaPor100} · HC {food.carbohidratosPor100} · G {food.grasasPor100} por 100{' '}
        {food.unidadBase === 'ml' ? 'ml' : 'g'} ({food.estadoNutricionalBase.replace(/_/g, ' ')})
      </div>
      {editable && (
        <>
          <div className="grid2">
            {PROFILE_IDS.map((pid) => {
              const q = it.cantidades[pid] ?? 0;
              const shown =
                food.unidadBase === 'unidad'
                  ? Math.round((q / (food.pesoUnidad ?? 1)) * 2) / 2
                  : Math.round(displayQuantity(food, q, view, cm, it.metodoId).exact);
              return (
                <label className="field" key={pid}>
                  <span className={pid}>
                    {data.profiles[pid].nombre} ({food.unidadBase === 'unidad' ? food.nombreUnidad ?? 'uds' : `${food.unidadBase === 'ml' ? 'ml' : 'g'} ${stateLabel(food, view, cm, it.metodoId)}`})
                  </span>
                  <NumberInput value={shown} onChange={(v) => setQty(pid, v)} step={food.unidadBase === 'unidad' ? 0.5 : 5} />
                </label>
              );
            })}
          </div>
          <div className="tiny muted">0 = ese perfil no lo lleva.</div>
          {methods.length > 1 && (
            <label className="field">
              Método de cocción
              <select
                value={method?.id}
                onChange={(e) =>
                  onChange({ ...meal, items: meal.items.map((x, i) => (i === idx ? { ...x, metodoId: e.target.value } : x)) })
                }
              >
                {methods.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nombre} (×{m.factor})
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="col">
            <button className="btn soft" onClick={onSubstitute}>
              ⇄ Sustituir (comparador)
            </button>
            <button className="btn danger" onClick={onRemove}>
              Quitar ingrediente
            </button>
          </div>
        </>
      )}
      {!editable && (
        <button className="btn soft" onClick={onSubstitute}>
          ⇄ Ver sustituciones
        </button>
      )}
    </Sheet>
  );
}
