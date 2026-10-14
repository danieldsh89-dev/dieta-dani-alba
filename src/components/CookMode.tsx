import { useEffect, useState } from 'react';
import type { Meal, WeightView } from '../types';
import { PROFILE_IDS } from '../types';
import { useStore } from '../store/AppStore';
import { displayQuantity, stateLabel } from '../lib/conversions';
import { shortName } from '../lib/mealGenerator';
import { Segmented } from './ui';
import { useBackHandler } from '../lib/back';

interface WakeLockLike {
  release: () => Promise<void>;
}

/**
 * Modo cocinar: pantalla completa con letra grande para pesar en la cocina.
 * Cantidad de Dani, de Alba y el total a pesar si se cocina junto.
 * Mantiene la pantalla encendida (si el móvil lo permite). Toca un ingrediente para marcarlo como pesado.
 */
export function CookMode({ meal, onClose }: { meal: Meal; onClose: () => void }) {
  const { data, fm, cm } = useStore();
  const [view, setView] = useState<WeightView>(data.settings.mostrarPesos);
  const [done, setDone] = useState<Set<number>>(new Set());
  const cols = meal.para ? [meal.para] : PROFILE_IDS;
  useBackHandler(() => {
    onClose();
    return true;
  });

  useEffect(() => {
    let lock: WakeLockLike | null = null;
    const nav = navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<WakeLockLike> } };
    nav.wakeLock
      ?.request('screen')
      .then((l) => (lock = l))
      .catch(() => undefined);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      lock?.release().catch(() => undefined);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const toggle = (i: number) =>
    setDone((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  return (
    <div className="cook" role="dialog" aria-label="Modo cocinar">
      <div className="row between">
        <h2 style={{ fontSize: '1.2rem' }}>👨‍🍳 {meal.nombre}</h2>
        <button className="btn" onClick={onClose}>
          ✕ Salir
        </button>
      </div>
      <div className="row between">
        <span className="sub">
          {done.size}/{meal.items.length} pesados · toca para marcar
        </span>
        <Segmented
          value={view}
          options={[
            { value: 'crudo', label: 'Crudo' },
            { value: 'cocinado', label: 'Cocinado' },
          ]}
          onChange={setView}
        />
      </div>
      {meal.items.map((it, i) => {
        const food = fm[it.foodId];
        if (!food) return null;
        const st = stateLabel(food, view, cm, it.metodoId);
        const qty = (base: number) => {
          if (base <= 0) return '—';
          const d = displayQuantity(food, base, view, cm, it.metodoId);
          return food.unidadBase === 'unidad' ? d.text.split(' (')[0] : `${d.value}`;
        };
        const unit = food.unidadBase === 'unidad' ? '' : food.unidadBase === 'ml' ? 'ml' : 'g';
        const total = PROFILE_IDS.reduce((s, p) => s + (it.cantidades[p] ?? 0), 0);
        return (
          <div key={i} className={`cook-item ${done.has(i) ? 'done' : ''}`} onClick={() => toggle(i)}>
            <div className="row between">
              <span className="name">
                {done.has(i) ? '✅ ' : ''}
                {shortName(food)}
                {it.bloqueado ? ' 🔒' : ''}
              </span>
              {st && <span className="badge info">{st}</span>}
            </div>
            <div className="cook-q" style={cols.length === 1 ? { gridTemplateColumns: '1fr' } : undefined}>
              {cols.map((p) => (
                <div key={p}>
                  <div className={`lbl ${p}`}>{data.profiles[p].nombre}</div>
                  <div className="val">
                    {qty(it.cantidades[p] ?? 0)}
                    {(it.cantidades[p] ?? 0) > 0 && <small> {unit}</small>}
                  </div>
                </div>
              ))}
              {cols.length > 1 && (
              <div>
                <div className="lbl muted">Total</div>
                <div className="val" style={{ color: 'var(--primary)' }}>
                  {qty(total)}
                  <small> {unit}</small>
                </div>
              </div>
              )}
            </div>
          </div>
        );
      })}
      {meal.notas && (
        <div className="card tight" style={{ whiteSpace: 'pre-wrap', fontSize: '1.05rem' }}>
          📝 {meal.notas}
        </div>
      )}
      <CookTimer />
      <div className="tiny muted">La pantalla se mantiene encendida mientras estás en este modo (si el móvil lo permite).</div>
    </div>
  );
}

/** Temporizador de cocina: minutos rápidos o a medida; al acabar vibra y pita. */
function CookTimer() {
  const [left, setLeft] = useState<number | null>(null); // segundos
  const [running, setRunning] = useState(false);
  const [custom, setCustom] = useState('');
  useEffect(() => {
    if (!running || left === null) return;
    if (left <= 0) {
      setRunning(false);
      try {
        navigator.vibrate?.([400, 200, 400, 200, 600]);
        const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        [0, 0.35, 0.7].forEach((t) => {
          const o = ctx.createOscillator();
          o.frequency.value = 880;
          o.connect(ctx.destination);
          o.start(ctx.currentTime + t);
          o.stop(ctx.currentTime + t + 0.2);
        });
      } catch {
        /* sin sonido */
      }
      return;
    }
    const t = setTimeout(() => setLeft((l) => (l === null ? null : l - 1)), 1000);
    return () => clearTimeout(t);
  }, [running, left]);
  const start = (min: number) => {
    setLeft(Math.round(min * 60));
    setRunning(true);
  };
  const mm = left !== null ? `${Math.floor(Math.max(0, left) / 60)}:${String(Math.max(0, left) % 60).padStart(2, '0')}` : '';
  return (
    <div className="card tight">
      <div className="row between">
        <b>⏱️ Temporizador</b>
        {left !== null && <b style={{ fontSize: '1.6rem', color: left <= 0 ? 'var(--bad)' : undefined }}>{left <= 0 ? '¡Listo!' : mm}</b>}
      </div>
      {left === null || left <= 0 ? (
        <div className="row wrap" style={{ gap: 6 }}>
          {[1, 3, 5, 8, 10, 15, 20, 30].map((m) => (
            <button key={m} className="btn small" onClick={() => start(m)}>
              {m} min
            </button>
          ))}
          <input type="text" inputMode="decimal" placeholder="min" value={custom} onChange={(e) => setCustom(e.target.value)} style={{ width: 64 }} />
          <button className="btn small primary" disabled={!Number(custom.replace(',', '.'))} onClick={() => start(Number(custom.replace(',', '.')))}>
            Empezar
          </button>
        </div>
      ) : (
        <div className="btn-row">
          <button className="btn small" onClick={() => setRunning(!running)}>
            {running ? '⏸ Pausa' : '▶ Seguir'}
          </button>
          <button className="btn small" onClick={() => setLeft((l) => (l ?? 0) + 60)}>
            +1 min
          </button>
          <button
            className="btn small danger"
            onClick={() => {
              setRunning(false);
              setLeft(null);
            }}
          >
            Parar
          </button>
        </div>
      )}
    </div>
  );
}
