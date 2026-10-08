import { useMemo, useState } from 'react';
import type { Category, Meal, ProfileId } from '../types';
import { PROFILE_IDS } from '../types';
import { useStore } from '../store/AppStore';
import { displayQuantity, stateLabel } from '../lib/conversions';
import { fillDeficit, replaceItem, substitutesFor, type SubstituteOption } from '../lib/substitutions';
import { shortName } from '../lib/mealGenerator';
import { round } from '../lib/nutrition';
import { Sheet, VerificationBadge } from './ui';

function diffText(d: number): string {
  const r = Math.round(d);
  return r === 0 ? '±0 kcal' : `${r > 0 ? '+' : ''}${r} kcal`;
}

export function SubstituteSheet({
  meal,
  index,
  onApply,
  onClose,
  categorias,
  prohibidos,
}: {
  meal: Meal;
  index: number;
  onApply: (m: Meal, msg?: string) => void;
  onClose: () => void;
  categorias?: Category[];
  prohibidos?: string[];
}) {
  const { activeFoods, data, cm, fm } = useStore();
  const view = data.settings.mostrarPesos;
  const item = meal.items[index];
  const from = fm[item.foodId];
  const subs = useMemo(
    () => substitutesFor(item, activeFoods, data.profiles, cm, { categorias, prohibidos }),
    [item, activeFoods, data.profiles, cm, categorias, prohibidos],
  );
  const [pending, setPending] = useState<SubstituteOption | null>(null);

  const apply = (o: SubstituteOption) => {
    if (o.noEquivalente && PROFILE_IDS.some((p) => o.diffKcal[p] < -20)) {
      setPending(o);
      return;
    }
    onApply(replaceItem(meal, index, o.food.id, o.cantidades), `${shortName(from)} → ${shortName(o.food)}`);
  };

  if (pending) {
    const base = replaceItem(meal, index, pending.food.id, pending.cantidades);
    const deficits = Object.fromEntries(PROFILE_IDS.map((p) => [p, Math.max(0, -pending.diffKcal[p])])) as Record<ProfileId, number>;
    const protein = meal.items.find((i) => fm[i.foodId]?.categoria === 'proteina');
    const canAdd = (id: string) => !!fm[id] && !fm[id].archivado && !prohibidos?.includes(id);
    const fill = (foodId: string, label: string) =>
      onApply(fillDeficit(base, foodId, deficits, fm, cm), `${shortName(pending.food)} + ${label}`);
    return (
      <Sheet title="Sustitución con menos calorías" onClose={onClose}>
        <div className="card">
          <b>
            {shortName(from)} → {shortName(pending.food)}
          </b>
          <div>
            Esta sustitución reduce aproximadamente{' '}
            {PROFILE_IDS.map((p, i) => (
              <span key={p}>
                {i > 0 && ' y '}
                <b className={p}>
                  {Math.round(deficits[p])} kcal ({data.profiles[p].nombre})
                </b>
              </span>
            ))}
            .
          </div>
          <div className="sub">¿Qué quieres hacer con esas calorías?</div>
          <div className="col">
            <button className="btn" onClick={() => onApply(base, 'Déficit mantenido')}>
              Mantener déficit
            </button>
            {protein && (
              <button className="btn" onClick={() => fill(protein.foodId, `más ${shortName(fm[protein.foodId])}`)}>
                Aumentar proteína ({shortName(fm[protein.foodId])})
              </button>
            )}
            {canAdd('cottage') && (
              <button className="btn" onClick={() => fill('cottage', 'cottage')}>
                Añadir cottage
              </button>
            )}
            {canAdd('pan_integral') && (
              <button className="btn" onClick={() => fill('pan_integral', 'pan')}>
                Añadir pan
              </button>
            )}
            {canAdd('papa_fresca') && (
              <button className="btn" onClick={() => fill('papa_fresca', 'papa')}>
                Añadir papa
              </button>
            )}
            {canAdd('yogur_liquido_frutos_silvestres') && (
              <button className="btn" onClick={() => fill('yogur_liquido_frutos_silvestres', 'postre')}>
                Añadir postre (yogur líquido)
              </button>
            )}
          </div>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title={`Sustituir ${shortName(from)}`} onClose={onClose}>
      <div className="sub">
        Equivalencias por <b>calorías</b> (no por peso). Pesos en estado {view === 'crudo' ? 'crudo/seco' : 'cocinado'}.
        Actual:{' '}
        {PROFILE_IDS.filter((p) => item.cantidades[p] > 0).map((p) => (
          <span key={p} className={p}>
            {' '}
            {data.profiles[p].nombre} {displayQuantity(from, item.cantidades[p], view, cm, item.metodoId).text}
          </span>
        ))}
      </div>
      <div className="list">
        {subs.map((o) => (
          <button key={o.food.id} className="list-item" onClick={() => apply(o)}>
            <div className="grow col" style={{ gap: 3 }}>
              <div className="row wrap">
                <span className="ttl">{shortName(o.food)}</span>
                <VerificationBadge food={o.food} compact />
                {o.noEquivalente && <span className="badge info">No equivalente</span>}
                {o.restringido && <span className="badge bad">Restricción</span>}
              </div>
              <div className="row wrap small">
                {PROFILE_IDS.filter((p) => o.cantidades[p] > 0).map((p) => (
                  <span key={p}>
                    <span className={p}>{data.profiles[p].nombre}</span>{' '}
                    <b>{displayQuantity(o.food, o.cantidades[p], view, cm).text}</b>{' '}
                    <span className="tiny muted">{stateLabel(o.food, view, cm)}</span>{' '}
                    <span className={`badge ${Math.abs(o.diffKcal[p]) <= 15 ? 'ok' : 'warn'}`}>{diffText(o.diffKcal[p])}</span>
                  </span>
                ))}
              </div>
              <div className="tiny muted">
                {PROFILE_IDS.filter((p) => o.cantidades[p] > 0)
                  .map((p) => `${data.profiles[p].nombre}: ${round(o.kcal[p])} kcal`)
                  .join(' · ')}
              </div>
            </div>
          </button>
        ))}
        {subs.length === 0 && <div className="empty">No hay sustitutos en esta categoría</div>}
      </div>
    </Sheet>
  );
}
