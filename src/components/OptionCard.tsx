import { useState } from 'react';
import type { BlockTarget, Category, Meal, ProfileId } from '../types';
import { useStore } from '../store/AppStore';
import { adjustMeal, signature, type GeneratedOption } from '../lib/mealGenerator';
import { MealEditor } from './MealEditor';
import { NameSheet } from './NameSheet';
import { DateSheet } from './DateSheet';
import { formatDay } from '../lib/planning';

export function OptionCard({
  option,
  index,
  targets,
  prohibidos,
  onChange,
  onRegenerate,
  onUse,
  useLabel,
  onToast,
}: {
  option: GeneratedOption;
  index: number;
  targets: Record<ProfileId, BlockTarget>;
  prohibidos: string[];
  onChange: (o: GeneratedOption) => void;
  onRegenerate?: () => void;
  onUse: (meal: Meal) => void;
  useLabel?: string;
  onToast: (t: string) => void;
}) {
  const { data, genCtx, addFavorite, placeMeal, rateMeal } = useStore();
  const [planning, setPlanning] = useState(false);
  const [subst, setSubst] = useState<Category | null>(null);
  const [saving, setSaving] = useState(false);
  const meal = option.meal;

  const ids = meal.items.map((i) => i.foodId);
  const firma = signature(ids);
  const voto = data.ratings[firma]?.voto ?? 0;
  const vote = (v: 1 | -1) => {
    const nuevo = voto === v ? 0 : v;
    rateMeal(firma, nuevo, ids, meal.bloque);
    if (nuevo) onToast(nuevo > 0 ? '👍 Anotado: os gusta esta combinación' : '👎 Anotado: el generador la evitará');
  };
  const setMeal = (m: Meal) => onChange({ ...option, meal: m, plantilla: undefined });
  const adjust = (goal: 'volumen' | 'alta_proteina') => {
    const r = adjustMeal(meal, goal, genCtx, prohibidos, targets);
    onChange({ ...r, id: option.id, etiqueta: r.etiqueta });
    onToast(goal === 'volumen' ? 'Re-optimizado para más volumen' : 'Re-optimizado para más proteína');
  };

  return (
    <div className="card">
      <div className="col" style={{ gap: 2 }}>
        <div className="row between">
          <span className="option-label">
            Opción {index + 1} · {option.etiqueta}
          </span>
          <div className="thumbs">
            <button className={voto > 0 ? 'on' : ''} onClick={() => vote(1)} aria-label="Nos gusta" title="Nos gusta">
              👍
            </button>
            <button className={voto < 0 ? 'on' : ''} onClick={() => vote(-1)} aria-label="No nos gusta" title="No nos gusta">
              👎
            </button>
          </div>
        </div>
        <h3 style={{ fontSize: '0.98rem' }}>
          {meal.para && <span className={`badge ${meal.para}`}>solo {data.profiles[meal.para].nombre}</span>} {meal.nombre}
        </h3>
        {option.plantilla && <span className="tiny muted">{option.plantilla}</span>}
      </div>
      {option.avisos
        .filter((a) => a.startsWith('Añadido') || a.startsWith('Complemento'))
        .map((a) => (
          <span key={a} className="badge info">
            {a}
          </span>
        ))}
      <MealEditor
        meal={meal}
        onChange={setMeal}
        targets={targets}
        prohibidos={prohibidos}
        substituteRequest={subst}
        onSubstituteHandled={() => setSubst(null)}
        onToast={onToast}
      />
      <div className="btn-row">
        <button className="btn primary small" onClick={() => setSaving(true)}>
          ★ Guardar
        </button>
        <button className="btn soft small" onClick={() => onUse(meal)}>
          ✓ {useLabel ?? `Usar hoy (${meal.bloque})`}
        </button>
        <button className="btn small" onClick={() => setPlanning(true)}>
          📅 Al plan…
        </button>
        <button className="btn small" onClick={() => setSubst('hidrato')}>
          ⇄ Cambiar hidrato
        </button>
        <button className="btn small" onClick={() => setSubst('salsa')}>
          ⇄ Cambiar salsa
        </button>
        <button className="btn small" onClick={() => adjust('volumen')}>
          ⬆ Más volumen
        </button>
        <button className="btn small" onClick={() => adjust('alta_proteina')}>
          ⬆ Más proteína
        </button>
        {onRegenerate && (
          <button className="btn small" onClick={onRegenerate}>
            ↻ Regenerar
          </button>
        )}
      </div>
      {planning && (
        <DateSheet
          title={`Añadir al plan (${meal.bloque})`}
          note="Se pondrá en el bloque de este día (sustituye lo que hubiera)."
          onClose={() => setPlanning(false)}
          onPick={(d) => {
            placeMeal({ ...meal, origen: 'generador' }, d);
            setPlanning(false);
            onToast(`Planificada: ${formatDay(d)} · ${meal.bloque}`);
          }}
        />
      )}
      {saving && (
        <NameSheet
          title="Guardar en favoritos"
          initial={meal.nombre}
          onClose={() => setSaving(false)}
          onSave={(nombre) => {
            addFavorite({ ...meal, nombre });
            setSaving(false);
            onToast(`Guardado en Favoritos ${meal.bloque}`);
          }}
        />
      )}
    </div>
  );
}
