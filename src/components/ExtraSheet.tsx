import { useState } from 'react';
import type { ProfileId } from '../types';
import { PROFILE_IDS } from '../types';
import { useStore } from '../store/AppStore';
import { servingToBase, stateLabel } from '../lib/conversions';
import { newExtra } from '../lib/day';
import { nutrientsFor, round } from '../lib/nutrition';
import { portionRange } from '../lib/portions';
import { shortName } from '../lib/mealGenerator';
import { FoodPickerList } from './FoodPicker';
import { NumberInput, Segmented, Sheet } from './ui';

type Who = 'ambos' | ProfileId;

/** Añadir un extra fuera del plan en 2 toques: alimento → (quién y cuánto) → guardar. */
export function ExtraSheet({ fecha, onClose, onToast }: { fecha: string; onClose: () => void; onToast: (t: string) => void }) {
  const { data, fm, cm, addExtra } = useStore();
  const [foodId, setFoodId] = useState<string | null>(null);
  const [who, setWho] = useState<Who>(data.settings.yoSoy ?? 'ambos');
  const [qty, setQty] = useState<Partial<Record<ProfileId, number>>>({});
  const food = foodId ? fm[foodId] : undefined;

  const pick = (id: string) => {
    const f = fm[id];
    setFoodId(id);
    const q: Partial<Record<ProfileId, number>> = {};
    for (const p of PROFILE_IDS) q[p] = portionRange(f, data.profiles[p]).habitual;
    setQty(q);
  };

  if (!food) {
    return (
      <Sheet title="🍌 Añadir extra" onClose={onClose}>
        <div className="sub">Algo que habéis comido fuera del plan. Elige el alimento:</div>
        <FoodPickerList selected={[]} onToggle={pick} />
      </Sheet>
    );
  }

  // las cantidades se piden como se comen: cocinado si el alimento se cocina, unidades si va por unidades
  const unit = food.unidadBase === 'unidad' ? food.nombreUnidad ?? 'uds' : `${food.unidadBase === 'ml' ? 'ml' : 'g'} ${stateLabel(food, 'cocinado', cm)}`.trim();
  const eaters: ProfileId[] = who === 'ambos' ? PROFILE_IDS : [who];
  const cantidades = Object.fromEntries(
    PROFILE_IDS.map((p) => [p, eaters.includes(p) ? servingToBase(food, qty[p] ?? 0, cm) : 0]),
  ) as Record<ProfileId, number>;

  return (
    <Sheet title={`🍌 ${shortName(food)}`} onClose={onClose}>
      <Segmented
        full
        value={who}
        options={[{ value: 'ambos', label: 'Los dos' }, ...PROFILE_IDS.map((p) => ({ value: p as Who, label: data.profiles[p].nombre }))]}
        onChange={setWho}
      />
      <div className="grid2">
        {eaters.map((p) => (
          <label key={p} className="field">
            <span className={p}>
              {data.profiles[p].nombre} ({unit})
            </span>
            <NumberInput value={qty[p]} step={food.unidadBase === 'unidad' ? 1 : 5} onChange={(v) => setQty({ ...qty, [p]: v ?? 0 })} />
            <span className="tiny muted">{round(nutrientsFor(food, cantidades[p]).kcal)} kcal</span>
          </label>
        ))}
      </div>
      <div className="btn-row">
        <button className="btn small" onClick={() => setFoodId(null)}>
          ‹ Otro alimento
        </button>
        <button
          className="btn primary"
          disabled={!eaters.some((p) => (qty[p] ?? 0) > 0)}
          onClick={() => {
            addExtra(newExtra(food.id, cantidades), fecha);
            onToast(`Extra añadido: ${shortName(food)}`);
            onClose();
          }}
        >
          Añadir
        </button>
      </div>
      <div className="tiny muted">Cuenta en los totales y gráficas del día. No entra en la lista de la compra.</div>
    </Sheet>
  );
}
