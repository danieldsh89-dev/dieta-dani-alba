import { useEffect, useMemo, useState } from 'react';
import type { DaySlot, Meal, ProfileId } from '../types';
import { PROFILE_IDS } from '../types';
import { useStore } from '../store/AppStore';
import { isSplit, mealFor, newExtra, personSlot, todayKey } from '../lib/day';
import { addDays, formatDay } from '../lib/planning';
import { servingToBase } from '../lib/conversions';
import { favoriteToMeal } from '../lib/favorites';
import { round } from '../lib/nutrition';
import { listen, speechAvailable } from '../lib/speech';
import { parseOrden, type Destino, type Orden } from '../lib/asistente';
import { applyVoz, parseVoz, vozCatalog } from '../lib/voz';
import { buildVariant, variantOptions } from '../lib/variants';
import { targetsForDay } from '../lib/day';
import { BLOCK_LABEL } from '../lib/planVoz';
import { useEnCasa } from '../lib/useStock';
import { FavThumb } from '../screens/FavoritesScreen';
import { Sheet } from './ui';

const EJEMPLOS = [
  'Plan para la semana que viene con arroz, pollo y carne',
  'Hoy he comido el B1',
  'Pon pollo con papas en la cena de mañana',
  'Cambia las papas por arroz en la cena',
  'Esta noche cenamos fuera, unas 900 calorías',
  'Me he tomado un plátano de extra',
  'Peso 78,5',
  'Hemos comido lo planificado',
  'Se acabó la leche y apunta papel higiénico',
  'Abre la despensa',
  'Temporizador de 10 minutos',
];

const fmtDia = (f: string, hoy: string) => (f === hoy ? 'hoy' : f === addDays(hoy, 1) ? 'mañana' : f === addDays(hoy, -1) ? 'ayer' : formatDay(f));

/**
 * 🎤 Asistente: una frase y la app hace lo que haga falta. Lo que cambia el plan o el diario
 * se enseña antes para confirmarlo (y se puede deshacer); ir a una pantalla o la despensa, al momento.
 */
export function AsistenteSheet({
  onClose,
  onToast,
  autoListen,
  onGo,
  onSearch,
  onPlan,
  onTimer,
}: {
  onClose: () => void;
  onToast: Toaster;
  autoListen?: boolean;
  onGo: (d: Destino) => void;
  onSearch: (q: string) => void;
  onPlan: (texto: string) => void;
  onTimer: (min: number) => void;
}) {
  const store = useStore();
  const { data, fm, cm, activeFoods, genCtx, getDay, placeMeal, setDaySlot, setPersonSlot, markFavoriteUsed, addExtra, removeExtra, addWeight, removeWeight, confirmDay, copyBlockTo, copyDay, stockApply } = store;
  const hoy = todayKey();
  const enCasa = useEnCasa();
  const [texto, setTexto] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orden, setOrden] = useState<Orden | null>(null);
  const [resumen, setResumen] = useState<{ lines: string[]; dudas: string[]; undo?: () => void } | null>(null);

  const gctx = useMemo(() => ({ ...genCtx, foods: activeFoods }), [genCtx, activeFoods]);

  const run = (frase: string) => {
    const t = frase.trim();
    if (!t) return;
    setTexto(t);
    setResumen(null);
    const o = parseOrden(t, data, activeFoods, hoy);
    if (o.tipo === 'plan') return onPlan(t), onClose();
    if (o.tipo === 'ir') return onGo(o.destino), onClose();
    if (o.tipo === 'buscar') return onSearch(o.q), onClose();
    if (o.tipo === 'temporizador') return onTimer(o.minutos), onToast(`⏱️ Temporizador de ${o.minutos} min`), onClose();
    if (o.tipo === 'despensa') {
      const r = parseVoz(t, vozCatalog(data, activeFoods), hoy);
      const ch = applyVoz(r.acciones, hoy);
      if (!ch.events.length && !ch.items.length) {
        setOrden(null);
        setResumen({ lines: [], dudas: r.dudas.length ? r.dudas : [`No te he entendido: “${t}”.`] });
        return;
      }
      const before = ch.items.map((i) => data.stock.items[i.id]).filter(Boolean);
      const nuevos = ch.items.filter((i) => !data.stock.items[i.id]).map((i) => i.id);
      stockApply({ items: ch.items, events: ch.events });
      setOrden(null);
      setResumen({
        lines: ch.resumen,
        dudas: r.dudas,
        undo: () => stockApply({ items: before, removeItems: nuevos, removeEvents: ch.events.map((e) => e.id) }),
      });
      return;
    }
    setOrden(o);
  };

  const hablar = async () => {
    setError(null);
    setBusy(true);
    try {
      const t = await listen('Dime qué quieres hacer…');
      if (t) run(t);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (autoListen && speechAvailable()) hablar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ───────── lo que hará cada orden (y cómo deshacerla) ─────────
  const slotOf = (fecha: string, b: 'A' | 'B' | 'C', para?: ProfileId) => {
    const day = getDay(fecha);
    return para ? personSlot(day, b, para) : day?.bloques[b];
  };
  const saveSlot = (fecha: string, b: 'A' | 'B' | 'C', para: ProfileId | undefined, s: DaySlot | undefined) =>
    para ? setPersonSlot(b, para, s, fecha) : setDaySlot(b, s, fecha);

  const plan = useMemo(() => {
    if (!orden) return null;
    switch (orden.tipo) {
      case 'comida': {
        const fav = data.favorites.find((f) => f.id === orden.favId)!;
        return { fav, text: `Poner “${fav.nombre}” en ${BLOCK_LABEL[orden.bloque].toLowerCase().replace(/s$/, '')} de ${fmtDia(orden.fecha, hoy)}${orden.para ? ` (solo ${data.profiles[orden.para].nombre})` : ''}` };
      }
      case 'cambiar': {
        const s = slotOf(orden.fecha, orden.bloque, orden.para);
        if (!s || 'libre' in s) return { text: 'No encuentro esa comida.' };
        const idx = s.meal.items.findIndex((i) => i.foodId === orden.fromFood);
        // el alimento dicho (el primero del concepto: "papas" → papa fresca), salvo que otro esté en casa
        const opts = variantOptions(s.meal, idx, gctx, enCasa)
          .filter((o) => orden.toFoods.includes(o.food.id))
          .sort((x, y) => Number(y.enCasa) - Number(x.enCasa) || orden.toFoods.indexOf(x.food.id) - orden.toFoods.indexOf(y.food.id));
        const o = opts[0];
        if (!o) return { text: `No puedo poner ${fm[orden.toFoods[0]]?.nombre ?? 'eso'} en esa comida.` };
        const v = buildVariant(s.meal, idx, o.food, o.cantidades, gctx, targetsForDay(orden.fecha, orden.bloque, data.profiles, getDay(orden.fecha), fm));
        return {
          variant: v.meal,
          prev: s,
          text: `En ${BLOCK_LABEL[orden.bloque].toLowerCase().replace(/s$/, '')} de ${fmtDia(orden.fecha, hoy)}: ${fm[orden.fromFood].nombre.split(' (')[0]} → ${o.food.nombre.split(' (')[0]} (“${v.meal.nombre}”, ${PROFILE_IDS.map((p) => `${data.profiles[p].nombre} ${round(v.totales[p].kcal)} kcal`).join(' · ')})`,
        };
      }
      case 'libre':
        return { text: `Comida libre en ${BLOCK_LABEL[orden.bloque].toLowerCase().replace(/s$/, '')} de ${fmtDia(orden.fecha, hoy)}${orden.para ? ` (${data.profiles[orden.para].nombre})` : ''}${orden.kcal ? ` · ~${orden.kcal} kcal` : ''}` };
      case 'extra':
        return { text: `Extra de ${fmtDia(orden.fecha, hoy)}: ${orden.unidades} × ${fm[orden.foodId]?.nombre.split(' (')[0]} para ${orden.personas.map((p) => data.profiles[p].nombre).join(' y ')}` };
      case 'peso':
        return { text: `Peso de ${data.profiles[orden.pid].nombre} ${fmtDia(orden.fecha, hoy)}: ${orden.kg} kg` };
      case 'confirmar':
        return { text: `Confirmar que ${fmtDia(orden.fecha, hoy)} se comió lo planificado (la despensa descuenta lo registrado)` };
      case 'repetir_ayer':
        return { text: 'Poner hoy lo mismo que ayer (solo en los bloques vacíos)' };
      case 'copiar_dia':
        return { text: `Copiar ${fmtDia(orden.from, hoy)} a ${fmtDia(orden.to, hoy)} (sustituye lo que hubiera)` };
      case 'quitar_comida':
        return { text: `Quitar ${BLOCK_LABEL[orden.bloque].toLowerCase().replace(/s$/, '')} de ${fmtDia(orden.fecha, hoy)}` };
      default:
        return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orden, data, gctx, enCasa]);

  const hacer = (favOverride?: string) => {
    if (!orden) return;
    switch (orden.tipo) {
      case 'comida': {
        const fav = data.favorites.find((f) => f.id === (favOverride ?? orden.favId))!;
        let m: Meal = favoriteToMeal(fav);
        if (orden.para && !fav.para) m = mealFor(m, orden.para);
        const b = fav.bloque;
        const prev = slotOf(orden.fecha, b, m.para);
        placeMeal(m, orden.fecha);
        markFavoriteUsed(fav.id);
        onToast(`${fav.nombre} → ${fmtDia(orden.fecha, hoy)}`, () => saveSlot(orden.fecha, b, m.para, prev));
        break;
      }
      case 'cambiar': {
        if (!plan || !('variant' in plan) || !plan.variant) return;
        saveSlot(orden.fecha, orden.bloque, orden.para, { meal: plan.variant });
        onToast(`Ahora: ${plan.variant.nombre}`, () => saveSlot(orden.fecha, orden.bloque, orden.para, plan.prev));
        break;
      }
      case 'libre': {
        const prev = slotOf(orden.fecha, orden.bloque, orden.para);
        const who = orden.para ? [orden.para] : PROFILE_IDS;
        const kcalEstimadas = Object.fromEntries(who.map((p) => [p, orden.kcal])) as Partial<Record<ProfileId, number>>;
        saveSlot(orden.fecha, orden.bloque, orden.para, { libre: true, kcalEstimadas: orden.kcal ? kcalEstimadas : {} });
        onToast('Comida libre apuntada', () => saveSlot(orden.fecha, orden.bloque, orden.para, prev));
        break;
      }
      case 'extra': {
        const f = fm[orden.foodId];
        const per = f.unidadBase === 'unidad' ? (f.pesoUnidad ?? 0) * orden.unidades : servingToBase(f, f.porcionHabitual * orden.unidades, cm);
        const cant = Object.fromEntries(PROFILE_IDS.map((p) => [p, orden.personas.includes(p) ? per : 0])) as Record<ProfileId, number>;
        const ex = newExtra(f.id, cant);
        addExtra(ex, orden.fecha);
        onToast(`Extra: ${f.nombre.split(' (')[0]}`, () => removeExtra(ex.id, orden.fecha));
        break;
      }
      case 'peso':
        addWeight(orden.pid, orden.kg, orden.fecha);
        onToast(`Peso guardado: ${orden.kg} kg`, () => removeWeight(orden.pid, orden.fecha));
        break;
      case 'confirmar':
        confirmDay(orden.fecha, true);
        onToast('✅ Día confirmado', () => confirmDay(orden.fecha, false));
        break;
      case 'repetir_ayer': {
        const ayer = addDays(hoy, -1);
        const blocks = (['A', 'B', 'C'] as const).filter((b) => {
          const y = getDay(ayer);
          const t = getDay(hoy);
          const has = (d: typeof y, x: typeof b) => !!d && (!!d.bloques[x] || isSplit(d, x));
          return has(y, b) && !has(t, b);
        });
        blocks.forEach((b) => copyBlockTo(b, ayer, hoy));
        onToast(blocks.length ? `Repetidos ${blocks.length} bloques de ayer` : 'No hay bloques vacíos que rellenar', blocks.length ? () => blocks.forEach((b) => setDaySlot(b, undefined, hoy)) : undefined);
        break;
      }
      case 'copiar_dia':
        copyDay(orden.from, orden.to);
        onToast(`Copiado a ${fmtDia(orden.to, hoy)}`);
        break;
      case 'quitar_comida': {
        const day = getDay(orden.fecha);
        const split = isSplit(day, orden.bloque);
        const prevShared = day?.bloques[orden.bloque];
        const prevP = PROFILE_IDS.map((p) => [p, personSlot(day, orden.bloque, p)] as const);
        if (split) PROFILE_IDS.forEach((p) => setPersonSlot(orden.bloque, p, undefined, orden.fecha));
        else setDaySlot(orden.bloque, undefined, orden.fecha);
        onToast('Comida quitada', () =>
          split ? prevP.forEach(([p, s]) => setPersonSlot(orden.bloque, p, s, orden.fecha)) : setDaySlot(orden.bloque, prevShared, orden.fecha),
        );
        break;
      }
    }
    onClose();
  };

  return (
    <Sheet title="🎤 Asistente" onClose={onClose}>
      {speechAvailable() && (
        <button className="btn primary" style={{ fontSize: '1.05rem', padding: '12px 16px' }} disabled={busy} onClick={hablar}>
          {busy ? '👂 Escuchando…' : '🎤 Hablar'}
        </button>
      )}
      <form
        className="row"
        style={{ gap: 6 }}
        onSubmit={(e) => {
          e.preventDefault();
          run(texto);
        }}
      >
        <input type="text" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="…o escríbelo" />
        <button className="btn small" type="submit" disabled={!texto.trim()}>
          OK
        </button>
      </form>
      {error && <div className="tiny" style={{ color: 'var(--bad)' }}>{error}</div>}

      {orden && plan && (
        <div className="card">
          <b className="small">He entendido:</b>
          <div className="small">{plan.text}</div>
          {orden.tipo === 'comida' && 'fav' in plan && plan.fav && (
            <>
              <div className="row" style={{ gap: 8 }}>
                <FavThumb fav={plan.fav} size={40} />
                <span className="small">{plan.fav.nombre}</span>
              </div>
              {orden.alternativas.length > 0 && (
                <>
                  <div className="tiny muted">¿Era otro?</div>
                  {orden.alternativas.map((id) => {
                    const f = data.favorites.find((x) => x.id === id)!;
                    return (
                      <button key={id} className="list-item" onClick={() => hacer(id)}>
                        <FavThumb fav={f} size={32} />
                        <span className="grow small">{f.nombre}</span>
                      </button>
                    );
                  })}
                </>
              )}
            </>
          )}
          <div className="btn-row">
            <button className="btn primary" disabled={orden.tipo === 'cambiar' && !('variant' in plan && plan.variant)} onClick={() => hacer()}>
              ✓ Hacerlo
            </button>
            <button className="btn" onClick={() => setOrden(null)}>
              No
            </button>
          </div>
        </div>
      )}

      {resumen && (
        <div className="card">
          {resumen.lines.map((l, i) => (
            <div key={i} className="small">
              {l}
            </div>
          ))}
          {resumen.dudas.map((q, i) => (
            <div key={i} className="small" style={{ color: 'var(--warn)' }}>
              ❓ {q}
            </div>
          ))}
          <div className="btn-row">
            {resumen.lines.length > 0 && (
              <button className="btn primary" onClick={onClose}>
                Vale
              </button>
            )}
            {resumen.undo && (
              <button
                className="btn"
                onClick={() => {
                  resumen.undo!();
                  setResumen(null);
                }}
              >
                ↺ Deshacer
              </button>
            )}
          </div>
        </div>
      )}

      {!orden && !resumen && (
        <>
          <div className="tiny muted">Puedes decir, por ejemplo (toca para probar):</div>
          {EJEMPLOS.map((e) => (
            <button key={e} className="btn small" style={{ textAlign: 'left', whiteSpace: 'normal' }} onClick={() => run(e)}>
              “{e}”
            </button>
          ))}
        </>
      )}
    </Sheet>
  );
}
