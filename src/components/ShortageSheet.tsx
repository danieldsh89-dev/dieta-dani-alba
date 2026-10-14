import type { Shortage } from '../lib/stock';
import { useStore } from '../store/AppStore';
import { addDays, formatDay } from '../lib/planning';
import { Sheet } from './ui';

/** Detalle del ⚠️ de una comida: qué no llega en casa y qué hacer. */
export function ShortageSheet({
  items,
  onCambiar,
  onClose,
  onToast,
}: {
  items: Shortage[];
  /** cambiar ese ingrediente por otro (variante) */
  onCambiar?: (foodId: string) => void;
  onClose: () => void;
  onToast: Toaster;
}) {
  const { data, fm, stockApply } = useStore();
  const ign = data.stock.config.ignorarFaltas ?? {};
  const unit = (id: string) => (fm[id]?.unidadBase === 'unidad' ? 'ud' : fm[id]?.unidadBase ?? '');
  return (
    <Sheet title="⚠️ Puede faltar en casa" onClose={onClose}>
      <div className="tiny muted">Según la despensa, lo que hay no llega para esta comida. Si ya lo tienes (p. ej., cocinado en la nevera), dilo y no avisará.</div>
      {items.map((s) => {
        const name = fm[s.foodId]?.nombre.split(' (')[0] ?? s.foodId;
        return (
          <div key={s.foodId} className="card tight">
            <div className="small">
              <b>{name}</b>: faltan ≈{Math.round(s.falta)} {unit(s.foodId)}
              {s.faltaTotal > s.falta ? <span className="tiny muted"> (≈{Math.round(s.faltaTotal)} en total los próximos días)</span> : ''}
            </div>
            <div className="btn-row">
              <button
                className="btn small"
                onClick={() => {
                  const hasta = addDays(s.fecha, 6);
                  stockApply({ config: { ignorarFaltas: { ...ign, [s.foodId]: hasta } } });
                  onToast(`${name}: no avisaré hasta el ${formatDay(hasta, { day: 'numeric', month: 'short' })}`, () =>
                    stockApply({ config: { ignorarFaltas: ign } }),
                  );
                  onClose();
                }}
              >
                ✓ Lo tengo (p. ej. cocinado)
              </button>
              {onCambiar && (
                <button
                  className="btn small"
                  onClick={() => {
                    onCambiar(s.foodId);
                    onClose();
                  }}
                >
                  🔁 Cambiar por otro
                </button>
              )}
            </div>
          </div>
        );
      })}
      <div className="tiny muted">También puedes corregir la cantidad en 🧺 Casa, o dejarlo: la compra lo tendrá en cuenta.</div>
    </Sheet>
  );
}
