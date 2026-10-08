import { useEffect, useMemo, useRef, useState } from 'react';
import type { Block } from '../types';
import { BLOCKS, PROFILE_IDS } from '../types';
import { useStore } from '../store/AppStore';
import { compensatedTargets, dayTotals, isFree, todayKey } from '../lib/day';
import { targetsFor, shortName } from '../lib/mealGenerator';
import { formatNumber } from '../lib/conversions';
import { round } from '../lib/nutrition';
import {
  addDays,
  batchFromPlan,
  datesBetween,
  formatDay,
  plannedMeals,
  shoppingList,
  shoppingText,
  splitRealYield,
  weekDates,
  weekStart,
} from '../lib/planning';
import { MealEditor } from '../components/MealEditor';
import { DateSheet } from '../components/DateSheet';
import { NumberInput, Segmented, Sheet, Warnings, CATEGORY_ICONS } from '../components/ui';
import { FavoritePickSheet, FreeMealSheet } from './HomeScreen';
import { shareText } from './SyncScreen';

type View = 'semana' | 'compra' | 'cocinar';

/** Recuerda la vista/semana/rango al cambiar de pestaña (p. ej. al ir a Generar y volver). */
const memo: { view?: View; anchor?: string; from?: string; to?: string } = {};

function useRemembered<T>(k: keyof typeof memo, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>((memo[k] as T) ?? initial);
  return [
    v,
    (n: T) => {
      (memo as Record<string, unknown>)[k] = n;
      setV(n);
    },
  ];
}

export function PlanScreen({
  onGenerate,
  onToast,
}: {
  onGenerate: (b: Block, fecha: string) => void;
  onToast: (t: string) => void;
}) {
  const today = todayKey();
  const [view, setView] = useRemembered<View>('view', 'semana');
  const [anchor, setAnchor] = useRemembered('anchor', today);
  const [from, setFrom] = useRemembered('from', today);
  const [to, setTo] = useRemembered('to', addDays(weekStart(today), 6));

  return (
    <div className="screen">
      <Segmented
        full
        value={view}
        options={[
          { value: 'semana', label: '📅 Semana' },
          { value: 'compra', label: '🛒 Compra' },
          { value: 'cocinar', label: '🍲 Cocinar' },
        ]}
        onChange={setView}
      />
      {view === 'semana' && <WeekView anchor={anchor} setAnchor={setAnchor} onGenerate={onGenerate} onToast={onToast} />}
      {view !== 'semana' && <RangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} />}
      {view === 'compra' && <ShoppingView from={from} to={to} onToast={onToast} />}
      {view === 'cocinar' && <BatchView from={from} to={to} onToast={onToast} />}
    </div>
  );
}

// ───────────────── Semana ─────────────────

function WeekView({
  anchor,
  setAnchor,
  onGenerate,
  onToast,
}: {
  anchor: string;
  setAnchor: (d: string) => void;
  onGenerate: (b: Block, fecha: string) => void;
  onToast: (t: string) => void;
}) {
  const { data, fm, getDay, copyDay } = useStore();
  const today = todayKey();
  const dates = weekDates(anchor);
  const [slot, setSlot] = useState<{ fecha: string; bloque: Block } | null>(null);
  const [copyFrom, setCopyFrom] = useState<string | null>(null);
  const todayRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (dates.includes(today) && today !== dates[0]) todayRef.current?.scrollIntoView({ block: 'start' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyPrevWeek = () => {
    let n = 0;
    for (const d of dates) {
      const prev = addDays(d, -7);
      if (getDay(prev) && !getDay(d)) {
        copyDay(prev, d);
        n++;
      }
    }
    onToast(n ? `Copiados ${n} días de la semana anterior` : 'No hay días que copiar (o ya están planificados)');
  };

  return (
    <>
      <div className="row between">
        <button className="iconbtn" onClick={() => setAnchor(addDays(anchor, -7))} aria-label="Semana anterior">
          ‹
        </button>
        <div className="col" style={{ alignItems: 'center', gap: 0 }}>
          <b>
            {formatDay(dates[0], { day: 'numeric', month: 'short' })} – {formatDay(dates[6], { day: 'numeric', month: 'short' })}
          </b>
          {!dates.includes(today) && (
            <button className="btn small" style={{ minHeight: 26, padding: '2px 8px' }} onClick={() => setAnchor(today)}>
              Ir a hoy
            </button>
          )}
        </div>
        <button className="iconbtn" onClick={() => setAnchor(addDays(anchor, 7))} aria-label="Semana siguiente">
          ›
        </button>
      </div>
      <button className="btn small" onClick={copyPrevWeek}>
        ⧉ Copiar la semana anterior en los días vacíos
      </button>
      {dates.map((fecha) => {
        const day = getDay(fecha);
        const t = dayTotals(day, fm);
        const past = fecha < today;
        return (
          <div
            key={fecha}
            ref={fecha === today ? todayRef : undefined}
            className="card tight"
            style={{ ...(past ? { opacity: 0.7 } : {}), scrollMarginTop: 64 }}
          >
            <div className="row between">
              <b style={{ textTransform: 'capitalize' }}>
                {formatDay(fecha, { weekday: 'long', day: 'numeric' })} {fecha === today && <span className="badge ok">hoy</span>}
              </b>
              <div className="row">
                {day && (
                  <span className="tiny">
                    <span className="dani">{round(t.dani.kcal)}</span> / <span className="alba">{round(t.alba.kcal)}</span> kcal
                  </span>
                )}
                {day && (
                  <button className="iconbtn" title="Copiar día" onClick={() => setCopyFrom(fecha)}>
                    ⧉
                  </button>
                )}
              </div>
            </div>
            {BLOCKS.map((b) => {
              const s = day?.bloques[b];
              return (
                <button
                  key={b}
                  className="list-item"
                  style={{ padding: '6px 0', borderBottom: 'none' }}
                  onClick={() => setSlot({ fecha, bloque: b })}
                >
                  <b style={{ color: 'var(--primary)', width: 16 }}>{b}</b>
                  <span className={`grow small ${s ? '' : 'muted'}`} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {!s ? 'Añadir…' : isFree(s) ? `🍕 Comida libre${s.descripcion ? `: ${s.descripcion}` : ''}` : s.meal.nombre}
                  </span>
                </button>
              );
            })}
          </div>
        );
      })}
      {slot && (
        <SlotSheet
          fecha={slot.fecha}
          bloque={slot.bloque}
          onClose={() => setSlot(null)}
          onGenerate={() => {
            onGenerate(slot.bloque, slot.fecha);
            setSlot(null);
          }}
          onToast={onToast}
        />
      )}
      {copyFrom && (
        <DateSheet
          title={`Copiar ${formatDay(copyFrom)} a…`}
          note="Se sustituye lo que hubiera planificado en el día de destino."
          onClose={() => setCopyFrom(null)}
          onPick={(d) => {
            copyDay(copyFrom, d);
            onToast(`Copiado a ${formatDay(d)}`);
            setCopyFrom(null);
          }}
        />
      )}
      {data.history.length === 0 && <div className="empty">Toca un bloque para planificar la semana.</div>}
    </>
  );
}

function SlotSheet({
  fecha,
  bloque,
  onClose,
  onGenerate,
  onToast,
}: {
  fecha: string;
  bloque: Block;
  onClose: () => void;
  onGenerate: () => void;
  onToast: (t: string) => void;
}) {
  const { data, fm, getDay, setDaySlot } = useStore();
  const day = getDay(fecha);
  const s = day?.bloques[bloque];
  const [mode, setMode] = useState<'menu' | 'fav' | 'free' | 'copy'>('menu');
  const targets = targetsFor(bloque, data.profiles, compensatedTargets(day, bloque, data.profiles, fm));
  const title = `${bloque} · ${formatDay(fecha, { weekday: 'long', day: 'numeric' })}`;

  if (mode === 'fav')
    return (
      <FavoritePickSheet
        block={bloque}
        onClose={() => setMode('menu')}
        onPick={(m) => {
          setDaySlot(bloque, { meal: m }, fecha);
          onToast(`${m.nombre} → ${title}`);
          onClose();
        }}
      />
    );
  if (mode === 'free')
    return (
      <FreeMealSheet
        initial={isFree(s) ? s : undefined}
        onClose={() => setMode('menu')}
        onSave={(f) => {
          setDaySlot(bloque, f, fecha);
          onClose();
        }}
      />
    );
  if (mode === 'copy' && s)
    return (
      <DateSheet
        title={`Copiar ${bloque} a…`}
        onClose={() => setMode('menu')}
        onPick={(d) => {
          setDaySlot(bloque, structuredClone(s), d);
          onToast(`Copiado a ${formatDay(d)} (${bloque})`);
          onClose();
        }}
      />
    );

  return (
    <Sheet title={title} onClose={onClose}>
      {s && !isFree(s) && (
        <MealEditor meal={s.meal} targets={targets} onChange={(m) => setDaySlot(bloque, { meal: m }, fecha)} onToast={onToast} />
      )}
      {s && isFree(s) && <div className="card tight">🍕 Comida libre{s.descripcion ? `: ${s.descripcion}` : ''}</div>}
      <div className="col">
        <button className="btn primary" onClick={onGenerate}>
          ⚙️ {s ? 'Generar otra' : 'Generar'}
        </button>
        <button className="btn" onClick={() => setMode('fav')}>
          ★ Elegir favorito
        </button>
        <button className="btn" onClick={() => setMode('free')}>
          🍕 Comida libre
        </button>
        {s && (
          <button className="btn" onClick={() => setMode('copy')}>
            ⧉ Copiar a otro día
          </button>
        )}
        {s && (
          <button
            className="btn danger"
            onClick={() => {
              setDaySlot(bloque, undefined, fecha);
              onClose();
            }}
          >
            Quitar
          </button>
        )}
      </div>
    </Sheet>
  );
}

// ───────────────── Rango de fechas ─────────────────

function RangePicker({
  from,
  to,
  setFrom,
  setTo,
}: {
  from: string;
  to: string;
  setFrom: (d: string) => void;
  setTo: (d: string) => void;
}) {
  const today = todayKey();
  const presets = [
    { label: 'Resto de semana', f: today, t: addDays(weekStart(today), 6) },
    { label: 'Próximos 7 días', f: today, t: addDays(today, 6) },
    { label: 'Mañana', f: addDays(today, 1), t: addDays(today, 1) },
    { label: 'Semana que viene', f: addDays(weekStart(today), 7), t: addDays(weekStart(today), 13) },
  ];
  return (
    <div className="card tight">
      <div className="chips">
        {presets.map((p) => (
          <button
            key={p.label}
            className={`chip ${from === p.f && to === p.t ? 'on' : ''}`}
            onClick={() => {
              setFrom(p.f);
              setTo(p.t);
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="grid2">
        <label className="field">
          Desde
          <input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </label>
        <label className="field">
          Hasta
          <input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </label>
      </div>
    </div>
  );
}

// ───────────────── Lista de la compra ─────────────────

function ShoppingView({ from, to, onToast }: { from: string; to: string; onToast: (t: string) => void }) {
  const { data, fm, cm, setShoppingChecked, setPantry } = useStore();
  const meals = useMemo(() => plannedMeals(data.history, datesBetween(from, to)), [data.history, from, to]);
  const items = useMemo(() => shoppingList(meals, fm, cm), [meals, fm, cm]);
  const checked = data.shoppingChecked;
  const toggle = (id: string) => setShoppingChecked(checked.includes(id) ? checked.filter((x) => x !== id) : [...checked, id]);
  const title = `🛒 Compra ${formatDay(from, { day: 'numeric', month: 'short' })} – ${formatDay(to, { day: 'numeric', month: 'short' })}`;

  if (!meals.length)
    return <div className="empty">No hay comidas planificadas en esas fechas. Planifícalas en “Semana”.</div>;

  const pending = items.filter((i) => !checked.includes(i.food.id) && !data.pantry.includes(i.food.id)).length;
  return (
    <>
      <div className="sub">
        {meals.length} comidas · cantidades para Dani y Alba juntas, <b>tal como se compran</b> (en crudo / seco / congelado). Quedan{' '}
        <b>{pending}</b> por comprar.
      </div>
      <div className="list">
        {items.map((it) => {
          const on = checked.includes(it.food.id);
          const home = data.pantry.includes(it.food.id);
          return (
            <label key={it.food.id} className="list-item" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={on} onChange={() => toggle(it.food.id)} style={{ width: 22, height: 22, accentColor: 'var(--primary)' }} />
              <span className="thumb" style={{ width: 30, height: 30 }}>
                {CATEGORY_ICONS[it.food.categoria]}
              </span>
              <span className="grow col" style={{ gap: 1, textDecoration: on ? 'line-through' : undefined, opacity: on ? 0.6 : 1 }}>
                <span className="ttl">{shortName(it.food)}</span>
                <span className="tiny muted">
                  {it.food.marca ? `${it.food.marca} · ` : ''}
                  {it.comidas} comida{it.comidas === 1 ? '' : 's'}
                  {home && <span className="badge ok" style={{ marginLeft: 6 }}>en casa</span>}
                </span>
              </span>
              <b className="small" style={{ whiteSpace: 'nowrap' }}>
                {it.unit === 'unidad'
                  ? `${it.unidades} ${it.food.nombreUnidad ?? 'ud'}${it.unidades === 1 ? '' : 's'}`
                  : `${it.comprar.toLocaleString('es-ES')} ${it.unit}`}
              </b>
            </label>
          );
        })}
      </div>
      <div className="btn-row">
        <button
          className="btn primary small"
          onClick={async () => {
            const r = await shareText(shoppingText(items, title, checked, data.pantry), title);
            onToast(r === 'copied' ? 'Lista copiada' : r === 'shared' ? 'Lista compartida' : 'No se pudo compartir');
          }}
        >
          📤 Compartir lista
        </button>
        <button
          className="btn small"
          disabled={!checked.length}
          onClick={() => {
            setPantry([...new Set([...data.pantry, ...checked])]);
            setShoppingChecked([]);
            onToast('Marcados añadidos a “Tengo en casa”');
          }}
        >
          🏠 Comprados → despensa
        </button>
        <button className="btn small" disabled={!checked.length} onClick={() => setShoppingChecked([])}>
          Desmarcar todo
        </button>
      </div>
      <div className="tiny muted">Las especias no aparecen: no se contabilizan. Revisa formatos (bote, bandeja) al comprar.</div>
    </>
  );
}

// ───────────────── Cocinar en tanda ─────────────────

function BatchView({ from, to, onToast }: { from: string; to: string; onToast: (t: string) => void }) {
  const { data, fm, cm, saveConversion } = useStore();
  const meals = useMemo(() => plannedMeals(data.history, datesBetween(from, to)), [data.history, from, to]);
  const foods = useMemo(() => batchFromPlan(meals, fm, cm), [meals, fm, cm]);
  const [real, setReal] = useState<Record<string, number | undefined>>({});
  const [open, setOpen] = useState<string | null>(null);

  if (!meals.length) return <div className="empty">No hay comidas planificadas en esas fechas. Planifícalas en “Semana”.</div>;
  if (!foods.length) return <div className="empty">Las comidas planificadas no tienen nada que cocinar en tanda.</div>;

  return (
    <>
      <div className="sub">
        Qué cocinar de una vez para las {meals.length} comidas del periodo. Cuando lo tengas cocinado, <b>pésalo</b> y escribe el peso real: se
        reparte en tápers con el rendimiento real.
      </div>
      {foods.map((bf) => {
        const k = `${bf.food.id}|${bf.metodo}`;
        const r = real[k];
        const split = r ? splitRealYield(bf, r) : null;
        const expanded = open === k;
        return (
          <div key={k} className="card tight">
            <div className="row between">
              <b>
                {shortName(bf.food)} <span className="sub">({bf.metodo.toLowerCase()})</span>
              </b>
              <span className="badge info">{bf.porciones.length} raciones</span>
            </div>
            <div>
              Cocina <b>{Math.ceil(bf.totalCrudo / 5) * 5} g</b> en {cm[bf.food.conversionId!]?.estadoInicial ?? 'crudo'} → ≈{' '}
              <b>{Math.round(bf.totalCocinadoEstimado / 5) * 5} g</b> cocinado <span className="tiny muted">(×{formatNumber(bf.factor, 2)})</span>
            </div>
            <div className="row">
              <label className="field grow">
                Peso real tras cocinar (g)
                <NumberInput value={r} allowEmpty placeholder="pesa la tanda" onChange={(v) => setReal({ ...real, [k]: v })} />
              </label>
              <button className="btn small" style={{ alignSelf: 'flex-end' }} onClick={() => setOpen(expanded ? null : k)}>
                {expanded ? 'Ocultar tápers' : 'Ver tápers'}
              </button>
            </div>
            {split && (
              <div className="small">
                Rendimiento real <b>×{formatNumber(split.rendimiento, 3)}</b>
                {Math.abs(split.rendimiento - bf.factor) > 0.02 && (
                  <button
                    className="btn small"
                    style={{ marginLeft: 8 }}
                    onClick={() => {
                      const conv = cm[bf.food.conversionId!];
                      const metodoId = conv.metodos.find((m) => m.nombre === bf.metodo)?.id ?? conv.metodoPorDefecto;
                      saveConversion({
                        ...conv,
                        metodos: conv.metodos.map((m) =>
                          m.id === metodoId ? { ...m, factor: Math.round(split.rendimiento * 1000) / 1000, personalizado: true } : m,
                        ),
                      });
                      onToast(`Factor guardado: ×${formatNumber(split.rendimiento, 3)}`);
                    }}
                  >
                    Guardar como factor
                  </button>
                )}
              </div>
            )}
            {(expanded || split) && (
              <div className="col" style={{ gap: 2 }}>
                {bf.porciones.map((p, i) => (
                  <div key={i} className="row between small" style={{ borderBottom: '1px solid var(--line)', padding: '3px 0' }}>
                    <span>
                      {formatDay(p.fecha, { weekday: 'short', day: 'numeric' })} · {p.bloque} ·{' '}
                      <span className={p.profile}>{data.profiles[p.profile].nombre}</span>
                    </span>
                    <b>{split ? `${split.porciones[i]} g` : `≈${Math.round(p.cocinadoEstimado / 5) * 5} g`}</b>
                  </div>
                ))}
                {split && Math.abs(split.sobrante) >= 5 && (
                  <Warnings
                    items={[
                      split.sobrante > 0
                        ? `Sobran ~${Math.round(split.sobrante)} g por el redondeo.`
                        : `Faltan ~${Math.round(-split.sobrante)} g por el redondeo: quita un poco de alguna ración.`,
                    ]}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
      <div className="tiny muted">
        Raciones en peso cocinado. {PROFILE_IDS.map((p) => data.profiles[p].nombre).join(' y ')} comen la misma receta: cada táper indica para quién es.
      </div>
    </>
  );
}
