import { useMemo, useState } from 'react';
import { useStore } from '../store/AppStore';
import { todayKey } from '../lib/day';
import { addDays, datesBetween, formatDay, plannedMeals } from '../lib/planning';
import { filterFavorites } from '../lib/favorites';
import { amountText, itemProduct } from '../lib/stock';
import { useStockStates } from '../lib/useStock';
import { normalize } from './FoodPicker';
import { FavThumb } from '../screens/FavoritesScreen';
import { CATEGORY_ICONS, Sheet } from './ui';

export type SearchTarget =
  | { kind: 'favorito'; id: string }
  | { kind: 'alimento'; id: string }
  | { kind: 'casa'; id: string }
  | { kind: 'plan'; fecha: string };

/** Buscar en toda la app: favoritos, alimentos, lo que hay en casa y las comidas planificadas. */
export function GlobalSearch({ onClose, onGo }: { onClose: () => void; onGo: (t: SearchTarget) => void }) {
  const { data, activeFoods } = useStore();
  const states = useStockStates();
  const [q, setQ] = useState('');
  const n = normalize(q).trim();
  const words = n.split(/\s+/).filter(Boolean);
  const has = (text: string) => words.every((w) => normalize(text).includes(w));

  const res = useMemo(() => {
    if (!words.length) return null;
    const favs = filterFavorites(data.favorites, n, {}, data.foods).slice(0, 8);
    const foods = activeFoods.filter((f) => has(`${f.nombre} ${f.marca ?? ''}`)).slice(0, 8);
    const casa = Object.values(data.stock.items)
      .filter((it) => has(`${it.nombre} ${(it.aliases ?? []).join(' ')} ${it.product?.nombre ?? ''}`))
      .slice(0, 8);
    const hoy = todayKey();
    const foodIds = new Set(foods.map((f) => f.id));
    const plan = plannedMeals(data.history, datesBetween(hoy, addDays(hoy, 13)))
      .filter((m) => has(m.meal.nombre) || m.meal.items.some((i) => foodIds.has(i.foodId)))
      .slice(0, 8);
    return { favs, foods, casa, plan };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, data, activeFoods]);

  const go = (t: SearchTarget) => {
    onGo(t);
    onClose();
  };
  const total = res ? res.favs.length + res.foods.length + res.casa.length + res.plan.length : 0;

  return (
    <Sheet title="🔎 Buscar" onClose={onClose}>
      <input type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="p. ej. albóndigas, arroz, lavavajillas…" />
      {res && total === 0 && <div className="empty">Nada con “{q}”.</div>}
      {res && res.favs.length > 0 && (
        <>
          <b className="small">★ Favoritos</b>
          <div className="list">
            {res.favs.map((f) => (
              <button key={f.id} className="list-item" onClick={() => go({ kind: 'favorito', id: f.id })}>
                <FavThumb fav={f} size={36} />
                <span className="grow small">
                  {f.nombre} <span className="tiny muted">· {f.bloque}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      {res && res.plan.length > 0 && (
        <>
          <b className="small">📅 En el plan (próximas 2 semanas)</b>
          <div className="list">
            {res.plan.map((m, i) => (
              <button key={i} className="list-item" onClick={() => go({ kind: 'plan', fecha: m.fecha })}>
                <span className="grow small">
                  <b style={{ textTransform: 'capitalize' }}>{formatDay(m.fecha)}</b> · {m.bloque} · {m.meal.nombre}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      {res && res.casa.length > 0 && (
        <>
          <b className="small">🧺 En casa</b>
          <div className="list">
            {res.casa.map((it) => {
              const s = states[it.id];
              const label =
                !s || s.fuente === 'desconocido'
                  ? 'sin dato'
                  : s.cantidad !== undefined && s.cantidad > 0
                    ? amountText(it, s.cantidad, itemProduct(data, it))
                    : s.nivel === 'ok'
                      ? 'hay'
                      : s.nivel === 'poco'
                        ? 'queda poco'
                        : 'no queda';
              return (
                <button key={it.id} className="list-item" onClick={() => go({ kind: 'casa', id: it.id })}>
                  <span className="grow small">{it.nombre}</span>
                  <span className="badge">{label}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
      {res && res.foods.length > 0 && (
        <>
          <b className="small">🥕 Alimentos</b>
          <div className="list">
            {res.foods.map((f) => (
              <button key={f.id} className="list-item" onClick={() => go({ kind: 'alimento', id: f.id })}>
                <span className="thumb" style={{ width: 30, height: 30 }}>
                  {CATEGORY_ICONS[f.categoria]}
                </span>
                <span className="grow small">
                  {f.nombre}
                  <span className="tiny muted"> · {f.kcalPor100} kcal/100</span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      {!res && <div className="tiny muted">Busca en favoritos, comidas planificadas, lo que hay en casa y la base de alimentos.</div>}
    </Sheet>
  );
}
