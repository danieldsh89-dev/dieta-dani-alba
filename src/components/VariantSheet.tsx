import { useMemo, useState } from 'react';
import type { BlockTarget, Meal, ProfileId } from '../types';
import { PROFILE_IDS } from '../types';
import { useStore } from '../store/AppStore';
import { displayQuantity } from '../lib/conversions';
import { shortName, type GeneratedOption } from '../lib/mealGenerator';
import { round } from '../lib/nutrition';
import { computeStock } from '../lib/stock';
import { buildVariant, swappable, variantOptions, VARIANT_KINDS, type VariantKind } from '../lib/variants';
import { Sheet } from './ui';

export interface VariantAction {
  label: string;
  primary?: boolean;
  run: (meal: Meal) => void;
}

/**
 * 🔁 Variante: cambiar SOLO el hidrato (o la proteína, la verdura…) por otro con la cantidad
 * equivalente, reajustando lo justo para seguir en el objetivo. Lo que hay en casa sale primero.
 */
export function VariantSheet({
  meal,
  objetivos,
  actions,
  onClose,
  initial,
}: {
  meal: Meal;
  objetivos?: Partial<Record<ProfileId, BlockTarget>>;
  actions: VariantAction[];
  onClose: () => void;
  /** ingrediente a cambiar ya elegido (p. ej. desde un aviso de "falta …") */
  initial?: { index: number };
}) {
  const { data, fm, cm, genCtx, activeFoods } = useStore();
  const view = data.settings.mostrarPesos;
  const kinds = VARIANT_KINDS.filter((k) => swappable(meal, fm, k.id).length > 0);
  const [kind, setKind] = useState<VariantKind | null>(initial ? null : kinds[0]?.id ?? null);
  const [index, setIndex] = useState<number | null>(initial?.index ?? null);
  const [result, setResult] = useState<GeneratedOption | null>(null);
  const [nombre, setNombre] = useState('');
  const gctx = useMemo(() => ({ ...genCtx, foods: activeFoods }), [genCtx, activeFoods]);

  const enCasa = useMemo(() => {
    const st = computeStock(data, fm, cm);
    return new Set(
      Object.values(data.stock.items)
        .filter((it) => it.foodId && st[it.id] && st[it.id].fuente !== 'desconocido' && st[it.id].nivel !== 'agotado')
        .map((it) => it.foodId!),
    );
  }, [data, fm, cm]);

  const candidates = kind ? swappable(meal, fm, kind) : [];
  const idx = index ?? (candidates.length === 1 ? candidates[0] : null);
  const opts = useMemo(() => (idx === null ? [] : variantOptions(meal, idx, gctx, enCasa)), [meal, idx, gctx, enCasa]);
  const cols = meal.para ? [meal.para] : PROFILE_IDS;
  const qty = (foodId: string, base: number) => {
    const f = fm[foodId];
    return f ? displayQuantity(f, base, view, cm).text : `${Math.round(base)} g`;
  };

  if (result) {
    return (
      <Sheet title="🔁 Variante" onClose={onClose}>
        <label className="field">
          Nombre
          <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </label>
        <div className="card tight">
          {result.meal.items.map((it, i) => (
            <div key={i} className="row between small">
              <span>{fm[it.foodId] ? shortName(fm[it.foodId]) : it.foodId}</span>
              <span className="tiny">
                {cols.map((p, k) => (
                  <span key={p} className={p}>
                    {k > 0 && ' · '}
                    {(it.cantidades[p] ?? 0) > 0 ? qty(it.foodId, it.cantidades[p]) : '—'}
                  </span>
                ))}
              </span>
            </div>
          ))}
          <div className="tiny" style={{ borderTop: '1px solid var(--line)', paddingTop: 6 }}>
            {cols.map((p, k) => (
              <span key={p} className={p}>
                {k > 0 && ' · '}
                {data.profiles[p].nombre} {round(result.totales[p].kcal)} kcal · P {round(result.totales[p].proteina)}
                {result.estado[p] === 'en_rango' ? ' ✓' : result.estado[p] === 'cerca' ? ' ≈' : ' ⚠️'}
              </span>
            ))}
          </div>
          {result.avisos.length > 0 && <div className="tiny muted">{result.avisos.slice(0, 2).join(' · ')}</div>}
        </div>
        <div className="col">
          {actions.map((a) => (
            <button key={a.label} className={`btn ${a.primary ? 'primary' : ''}`} onClick={() => a.run({ ...result.meal, nombre: nombre.trim() || result.meal.nombre })}>
              {a.label}
            </button>
          ))}
          <button className="btn small" onClick={() => setResult(null)}>
            ‹ Elegir otro
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title={`🔁 Variante de “${meal.nombre}”`} onClose={onClose}>
      {!initial && (
        <>
          <div className="small">¿Qué quieres cambiar? Lo demás se queda igual.</div>
          <div className="chips">
            {kinds.map((k) => (
              <button
                key={k.id}
                className={`chip ${kind === k.id ? 'on' : ''}`}
                onClick={() => {
                  setKind(k.id);
                  setIndex(null);
                }}
              >
                {k.label}
              </button>
            ))}
          </div>
        </>
      )}
      {!initial && candidates.length > 1 && (
        <div className="chips">
          {candidates.map((i) => (
            <button key={i} className={`chip ${idx === i ? 'on' : ''}`} onClick={() => setIndex(i)}>
              {shortName(fm[meal.items[i].foodId])}
            </button>
          ))}
        </div>
      )}
      {idx !== null && (
        <>
          <div className="small">
            Cambiar <b>{shortName(fm[meal.items[idx].foodId])}</b> por… <span className="tiny muted">(cantidad equivalente; 🏠 = hay en casa)</span>
          </div>
          <div className="list">
            {opts.slice(0, 25).map((o) => (
              <button
                key={o.food.id}
                className="list-item"
                onClick={() => {
                  const r = buildVariant(meal, idx, o.food, o.cantidades, gctx, objetivos);
                  setResult(r);
                  setNombre(r.meal.nombre);
                }}
              >
                <div className="grow col" style={{ gap: 1 }}>
                  <span className="small">
                    {o.enCasa && '🏠 '}
                    {o.food.nombre}
                    {o.restringido && <span className="badge warn"> restricción</span>}
                    {o.noEquivalente && <span className="badge info"> más ligero</span>}
                  </span>
                  <span className="tiny muted">
                    {cols.map((p, k) => (
                      <span key={p} className={p}>
                        {k > 0 && ' · '}
                        {(o.cantidades[p] ?? 0) > 0 ? qty(o.food.id, o.cantidades[p]) : '—'}
                      </span>
                    ))}
                  </span>
                </div>
                <span className="muted">›</span>
              </button>
            ))}
            {opts.length === 0 && <div className="empty">No hay alternativas de ese tipo para este bloque.</div>}
          </div>
        </>
      )}
    </Sheet>
  );
}
