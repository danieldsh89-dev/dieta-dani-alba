import { useState } from 'react';
import { addDays, formatDay } from '../lib/planning';
import { todayKey } from '../lib/day';
import { Sheet } from './ui';

/** Elegir una fecha (con atajos: hoy, mañana y próximos días). */
export function DateSheet({
  title,
  initial,
  onPick,
  onClose,
  note,
}: {
  title: string;
  initial?: string;
  onPick: (fecha: string) => void;
  onClose: () => void;
  note?: string;
}) {
  const today = todayKey();
  const [fecha, setFecha] = useState(initial ?? addDays(today, 1));
  const quick = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  return (
    <Sheet title={title} onClose={onClose}>
      {note && <div className="sub">{note}</div>}
      <div className="chips">
        {quick.map((d, i) => (
          <button key={d} className={`chip ${fecha === d ? 'on' : ''}`} onClick={() => setFecha(d)}>
            {i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : formatDay(d, { weekday: 'short', day: 'numeric' })}
          </button>
        ))}
      </div>
      <label className="field">
        Otra fecha
        <input type="date" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} />
      </label>
      <button className="btn primary block" onClick={() => onPick(fecha)}>
        Elegir {formatDay(fecha, { weekday: 'long', day: 'numeric', month: 'long' })}
      </button>
    </Sheet>
  );
}
