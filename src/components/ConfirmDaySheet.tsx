import type { ProfileId } from '../types';
import { useStore } from '../store/AppStore';
import { dayMeals } from '../lib/day';
import { formatDay } from '../lib/planning';
import { Sheet } from './ui';

const BLOCK: Record<string, string> = { A: 'Desayuno', B: 'Almuerzo', C: 'Cena' };

/** "¿Habéis comido lo planificado?" — confirmar el día (descuenta de la despensa) o ir a corregirlo. */
export function ConfirmDaySheet({ fecha, onClose, onEdit, onToast }: { fecha: string; onClose: () => void; onEdit: () => void; onToast: (t: string) => void }) {
  const { data, confirmDay } = useStore();
  const day = data.history.find((h) => h.fecha === fecha);
  const meals = dayMeals(day);
  const who = (p?: ProfileId) => (p ? ` (${data.profiles[p].nombre})` : '');
  return (
    <Sheet title={`🍽️ ${formatDay(fecha, { weekday: 'long', day: 'numeric', month: 'short' })}`} onClose={onClose}>
      {meals.length === 0 ? (
        <div className="small">No hay comidas registradas ese día.</div>
      ) : (
        <>
          <div className="small">¿Habéis comido esto?</div>
          {meals.map((m, i) => (
            <div key={i} className="small">
              • <b>{BLOCK[m.bloque]}</b>
              {who(m.para)}: {m.meal.nombre}
            </div>
          ))}
          {(day?.extras?.length ?? 0) > 0 && <div className="tiny muted">+ {day!.extras!.length} extra(s)</div>}
        </>
      )}
      <div className="col">
        <button
          className="btn primary"
          disabled={!meals.length}
          onClick={() => {
            confirmDay(fecha, true);
            onToast('✅ Confirmado: la despensa queda al día');
            onClose();
          }}
        >
          ✅ Sí, lo planificado
        </button>
        <button
          className="btn"
          onClick={() => {
            onClose();
            onEdit();
          }}
        >
          ✏️ Hubo cambios (corregir el día)
        </button>
      </div>
      <div className="tiny muted">Corrige en Hoy lo que cambió (“lo que comí de verdad”, comida libre…): la despensa descuenta lo que quede registrado.</div>
    </Sheet>
  );
}
