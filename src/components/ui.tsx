import { useEffect, useState, type ReactNode } from 'react';
import type { BlockTarget, Food, Nutrients, ProfileId } from '../types';
import { rangeStatus, round, type RangeStatus } from '../lib/nutrition';
import { useStore } from '../store/AppStore';
import { useBackHandler } from '../lib/back';

export function Sheet({ title, onClose, children, actions }: { title: string; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  // botón atrás: cierra esta ventana
  useBackHandler(() => {
    onClose();
    return true;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <div className="row">
            {actions}
            <button className="iconbtn" onClick={onClose} aria-label="Cerrar">
              ✕
            </button>
          </div>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  full,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  full?: boolean;
}) {
  return (
    <div className={`seg ${full ? 'full' : ''}`}>
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)} type="button">
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Toggle global MOSTRAR PESOS [CRUDOS] [COCINADOS] */
export function WeightToggle() {
  const { data, updateSettings } = useStore();
  return (
    <Segmented
      value={data.settings.mostrarPesos}
      options={[
        { value: 'crudo', label: 'Crudos' },
        { value: 'cocinado', label: 'Cocinados' },
      ]}
      onChange={(v) => updateSettings({ mostrarPesos: v })}
    />
  );
}

export function VerificationBadge({ food, compact }: { food: Food; compact?: boolean }) {
  if (food.verificacion === 'verificado') return <span className="badge ok" title="Valor verificado">✓ {compact ? '' : 'Verificado'}</span>;
  if (food.verificacion === 'parcial')
    return (
      <span className="badge warn" title={food.notaVerificacion}>
        ≈ {compact ? '' : 'Parcial – revisar'}
      </span>
    );
  return (
    <span className="badge warn" title={food.notaVerificacion}>
      ≈ {compact ? '' : 'Aproximado – revisar etiqueta'}
    </span>
  );
}

const STATUS_TEXT: Record<RangeStatus, string> = {
  en_rango: 'En rango',
  cerca: 'Cerca',
  bajo: 'Bajo',
  alto: 'Alto',
};

export function RangeBadge({ status }: { status: RangeStatus }) {
  const cls = status === 'en_rango' ? 'ok' : status === 'cerca' ? 'warn' : 'bad';
  return <span className={`badge ${cls}`}>{STATUS_TEXT[status]}</span>;
}

export function Macros({ n, showExtra }: { n: Nutrients; showExtra?: boolean }) {
  const { data } = useStore();
  const extra = showExtra ?? data.settings.mostrarFibraSal;
  return (
    <div className="macros">
      <span>
        P <b>{round(n.proteina)}g</b>
      </span>
      <span>
        HC <b>{round(n.carbohidratos)}g</b>
      </span>
      <span>
        G <b>{round(n.grasas)}g</b>
      </span>
      {extra && (
        <>
          <span>
            Fibra <b>{round(n.fibra, 1)}g</b>
          </span>
          <span>
            Sal <b>{round(n.sal, 1)}g</b>
          </span>
        </>
      )}
    </div>
  );
}

export function TotalsBox({
  pid,
  n,
  target,
}: {
  pid: ProfileId;
  n: Nutrients;
  target?: BlockTarget;
}) {
  const { data } = useStore();
  const st = target ? rangeStatus(n.kcal, target) : undefined;
  return (
    <div className={`total-box ${pid}`}>
      <div className="row between">
        <span className="who">{data.profiles[pid].nombre}</span>
        {st && <RangeBadge status={st} />}
      </div>
      <div className="kcal">
        {round(n.kcal)} kcal
        {target && (
          <span className="tiny muted" style={{ fontWeight: 400 }}>
            {' '}
            / {target.kcal}±{target.tolerancia}
          </span>
        )}
      </div>
      <Macros n={n} />
      <MacroBar n={n} />
    </div>
  );
}

/** Vista "plato": reparto de kcal entre proteína, hidratos y grasa. */
export function MacroBar({ n, height = 8 }: { n: Nutrients; height?: number }) {
  const p = n.proteina * 4;
  const c = n.carbohidratos * 4;
  const f = n.grasas * 9;
  const t = p + c + f;
  if (t <= 0) return null;
  const pct = (x: number) => Math.round((x / t) * 100);
  return (
    <div className="col" style={{ gap: 2 }}>
      <div className="macrobar" style={{ height }} title={`Proteína ${pct(p)}% · Hidratos ${pct(c)}% · Grasa ${pct(f)}%`}>
        <span className="mb-p" style={{ width: `${(p / t) * 100}%` }} />
        <span className="mb-c" style={{ width: `${(c / t) * 100}%` }} />
        <span className="mb-f" style={{ width: `${(f / t) * 100}%` }} />
      </div>
      <div className="tiny muted mb-legend">
        <span>
          <i className="mb-p" /> P {pct(p)}%
        </span>
        <span>
          <i className="mb-c" /> HC {pct(c)}%
        </span>
        <span>
          <i className="mb-f" /> G {pct(f)}%
        </span>
      </div>
    </div>
  );
}

export function Progress({ value, max, who }: { value: number; max: number; who?: ProfileId }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={`progress ${who ?? ''} ${value > max * 1.05 ? 'over' : ''}`}>
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}

export function NumberInput({
  value,
  onChange,
  step = 1,
  min = 0,
  placeholder,
  allowEmpty,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  step?: number;
  min?: number;
  placeholder?: string;
  allowEmpty?: boolean;
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  useEffect(() => {
    const parsed = parseFloat(text.replace(',', '.'));
    if (value === undefined ? text !== '' : parsed !== value) setText(value === undefined ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      type="number"
      inputMode="decimal"
      step={step}
      min={min}
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        if (e.target.value === '') {
          if (allowEmpty) onChange(undefined);
          return;
        }
        const v = parseFloat(e.target.value.replace(',', '.'));
        if (!Number.isNaN(v)) onChange(Math.max(min, v));
      }}
    />
  );
}

export function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2200);
    return () => clearTimeout(t);
  }, [text, onDone]);
  return <div className="toast">{text}</div>;
}

export function Warnings({ items }: { items: { level?: string; text: string }[] | string[] }) {
  if (!items.length) return null;
  return (
    <div className="warnings">
      {items.map((w, i) => {
        const obj = typeof w === 'string' ? { text: w, level: 'aviso' } : w;
        return (
          <div key={i} className={`warning ${obj.level === 'error' ? 'error' : obj.level === 'info' ? 'info' : ''}`}>
            {obj.level === 'error' ? '⛔ ' : obj.level === 'info' ? 'ℹ️ ' : '⚠️ '}
            {obj.text}
          </div>
        );
      })}
    </div>
  );
}

export const CATEGORY_LABELS: Record<Food['categoria'], string> = {
  proteina: 'Proteína',
  hidrato: 'Hidrato',
  verdura: 'Verdura',
  salsa: 'Salsa',
  queso: 'Queso',
  lacteo: 'Lácteo / bebida',
  fruta: 'Fruta',
  postre: 'Complemento / postre',
  extra: 'Extra / grasa',
};

export const CATEGORY_ICONS: Record<Food['categoria'], string> = {
  proteina: '🍗',
  hidrato: '🍚',
  verdura: '🥦',
  salsa: '🥫',
  queso: '🧀',
  lacteo: '🥛',
  fruta: '🍓',
  postre: '🍮',
  extra: '🥑',
};
