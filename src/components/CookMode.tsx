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
      {meal.notas && <div className="sub">📝 {meal.notas}</div>}
      <div className="tiny muted">La pantalla se mantiene encendida mientras estás en este modo (si el móvil lo permite).</div>
    </div>
  );
}
