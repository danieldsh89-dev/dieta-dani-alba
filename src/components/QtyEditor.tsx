import { useEffect, useState } from 'react';
import type { QtyUnit } from '../lib/stock';

/** Unidad elegida por artículo (se recuerda mientras la app está abierta) */
const unitMemo: Record<string, QtyUnit['id']> = {};

const round = (n: number) => Math.round(n * 100) / 100;
const show = (n: number) => round(n).toLocaleString('es-ES', { maximumFractionDigits: 2 });

/**
 * Escribir una cantidad: −/+ las veces que haga falta, en envases (bolsa, paquete…), gramos, kg o
 * unidades, y "Guardar" una sola vez. Devuelve la cantidad en la unidad del artículo.
 */
export function QtyEditor({
  itemId,
  units,
  value,
  onSave,
  saveLabel = 'Guardar',
  compact,
}: {
  itemId: string;
  units: QtyUnit[];
  /** cantidad actual en la unidad del artículo (undefined = sin dato) */
  value?: number;
  onSave: (base: number) => void;
  saveLabel?: string;
  compact?: boolean;
}) {
  const [unitId, setUnitId] = useState<QtyUnit['id']>(unitMemo[itemId] ?? units[0].id);
  const unit = units.find((u) => u.id === unitId) ?? units[0];
  const toUnit = (base?: number) => (base === undefined ? 0 : round(base / unit.factor));
  const [draft, setDraft] = useState<number>(toUnit(value));
  const [text, setText] = useState(show(toUnit(value)));
  // si la cantidad guardada cambia por fuera (otro móvil, voz), se refleja
  useEffect(() => {
    setDraft(toUnit(value));
    setText(show(toUnit(value)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const set = (n: number) => {
    const v = Math.max(0, round(n));
    setDraft(v);
    setText(show(v));
  };
  const changeUnit = (u: QtyUnit) => {
    const base = draft * unit.factor;
    unitMemo[itemId] = u.id;
    setUnitId(u.id);
    const v = round(base / u.factor);
    setDraft(v);
    setText(show(v));
  };
  const dirty = value === undefined || Math.abs(draft * unit.factor - value) > 1e-6;

  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn small" type="button" aria-label="Menos" onClick={() => set(draft - unit.step)}>
          −
        </button>
        <input
          type="text"
          inputMode="decimal"
          value={text}
          style={{ width: compact ? 64 : 80, textAlign: 'center' }}
          onChange={(e) => {
            setText(e.target.value);
            const v = Number(e.target.value.replace(',', '.'));
            if (Number.isFinite(v) && v >= 0) setDraft(v);
          }}
        />
        <button className="btn small" type="button" aria-label="Más" onClick={() => set(draft + unit.step)}>
          +
        </button>
        {units.length > 1 ? (
          <select value={unit.id} onChange={(e) => changeUnit(units.find((u) => u.id === e.target.value)!)} style={{ maxWidth: compact ? 150 : 190 }}>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="small muted">{unit.label}</span>
        )}
        <button className={`btn small ${dirty ? 'primary' : ''}`} type="button" onClick={() => onSave(round(draft * unit.factor))}>
          {dirty ? `✓ ${saveLabel}` : '✅ Está bien'}
        </button>
      </div>
    </div>
  );
}
