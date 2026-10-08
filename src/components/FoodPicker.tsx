import { useMemo, useState } from 'react';
import type { Category } from '../types';
import { useStore } from '../store/AppStore';
import { shortName } from '../lib/mealGenerator';
import { CATEGORY_ICONS, CATEGORY_LABELS, Sheet } from './ui';

const ALL_CATS = Object.keys(CATEGORY_LABELS) as Category[];

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Lista de alimentos con búsqueda y filtro por categoría, multi-selección. */
export function FoodPickerList({
  selected,
  onToggle,
  chipClass = 'on',
  disabledIds = [],
}: {
  selected: string[];
  onToggle: (id: string) => void;
  chipClass?: string;
  disabledIds?: string[];
}) {
  const { activeFoods } = useStore();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<Category | 'todas'>('todas');
  const list = useMemo(() => {
    const nq = normalize(q);
    return activeFoods
      .filter((f) => (cat === 'todas' || f.categoria === cat) && (!nq || normalize(`${f.nombre} ${f.marca ?? ''}`).includes(nq)))
      .sort((a, b) => ALL_CATS.indexOf(a.categoria) - ALL_CATS.indexOf(b.categoria) || a.nombre.localeCompare(b.nombre));
  }, [activeFoods, q, cat]);
  return (
    <div className="col">
      <input type="search" placeholder="Buscar alimento…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chips">
        <button className={`chip ${cat === 'todas' ? 'on' : ''}`} onClick={() => setCat('todas')}>
          Todas
        </button>
        {ALL_CATS.map((c) => (
          <button key={c} className={`chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>
            {CATEGORY_ICONS[c]} {CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>
      <hr />
      <div className="chips">
        {list.map((f) => {
          const on = selected.includes(f.id);
          const disabled = disabledIds.includes(f.id);
          return (
            <button
              key={f.id}
              className={`chip ${on ? chipClass : ''}`}
              disabled={disabled}
              style={disabled ? { opacity: 0.35 } : undefined}
              onClick={() => onToggle(f.id)}
            >
              {CATEGORY_ICONS[f.categoria]} {shortName(f)}
            </button>
          );
        })}
        {list.length === 0 && <div className="empty">Sin resultados</div>}
      </div>
    </div>
  );
}

/** Selector compacto: chips seleccionados + botón para abrir el selector completo. */
export function FoodSelector({
  title,
  selected,
  onChange,
  chipClass,
  disabledIds,
  emptyText = 'Ninguno',
}: {
  title: string;
  selected: string[];
  onChange: (ids: string[]) => void;
  chipClass: string;
  disabledIds?: string[];
  emptyText?: string;
}) {
  const { fm } = useStore();
  const [open, setOpen] = useState(false);
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <>
      <div className="chips">
        {selected
          .filter((id) => fm[id])
          .map((id) => (
            <button key={id} className={`chip ${chipClass}`} onClick={() => toggle(id)} title="Quitar">
              {shortName(fm[id])} ✕
            </button>
          ))}
        {selected.length === 0 && <span className="sub">{emptyText}</span>}
        <button className="chip" onClick={() => setOpen(true)}>
          ＋ Añadir
        </button>
      </div>
      {open && (
        <Sheet
          title={title}
          onClose={() => setOpen(false)}
          actions={
            <button className="btn primary small" onClick={() => setOpen(false)}>
              Listo
            </button>
          }
        >
          <FoodPickerList selected={selected} onToggle={toggle} chipClass={chipClass} disabledIds={disabledIds} />
        </Sheet>
      )}
    </>
  );
}
