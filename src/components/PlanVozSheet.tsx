import { useEffect, useMemo, useRef, useState } from 'react';
import type { Block, DaySlot, ProfileId } from '../types';
import { PROFILE_IDS } from '../types';
import { useStore } from '../store/AppStore';
import { todayKey } from '../lib/day';
import { addDays, formatDay, weekStart } from '../lib/planning';
import { listen, speechAvailable } from '../lib/speech';
import { BLOCK_LABEL, buildSlot, FREQ_LABEL, parsePlanVoz, planSlots, type Freq, type PlanIdea, type PlanSlot } from '../lib/planVoz';
import { useEnCasa } from '../lib/useStock';
import { signature } from '../lib/mealGenerator';
import { personSlot } from '../lib/day';
import { FavThumb } from '../screens/FavoritesScreen';
import { Sheet } from './ui';

const FREQS: Freq[] = ['normal', 'algunos', 'principal', 'todos'];
const EJEMPLOS = [
  'Plan para la semana que viene con arroz, pollo y carne de vaca; desayunos variados, algunos días frutos rojos y yogur y tostadas para Dani, y para Alba principalmente yogur',
  'Hazme una cena con atún y ensalada para mañana',
  'Comidas y cenas de lunes a viernes con pasta y pollo, sin pescado',
];

type Step = 'decir' | 'idea' | 'propuesta';

/**
 * 🎤 Plan por voz: dices la idea ("plan para la semana que viene con…"), ves lo que se ha
 * entendido y lo corriges, y revisas la propuesta aceptando solo los días/comidas que quieras.
 */
export function PlanVozSheet({
  onClose,
  onToast,
  inicial,
  onAdded,
}: {
  onClose: () => void;
  onToast: Toaster;
  inicial?: string;
  /** tras añadir: las fechas que se han rellenado */
  onAdded?: (fechas: string[]) => void;
}) {
  const { data, genCtx, activeFoods, placeMeal, getDay, setDaySlot, setPersonSlot } = useStore();
  const enCasa = useEnCasa();
  const hoy = todayKey();
  const [step, setStep] = useState<Step>(inicial ? 'idea' : 'decir');
  const [texto, setTexto] = useState(inicial ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idea, setIdea] = useState<PlanIdea | null>(() => (inicial ? parsePlanVoz(inicial, activeFoods, data.profiles, hoy) : null));
  const [slots, setSlots] = useState<PlanSlot[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<string | null>(null);
  const cancel = useRef(false);
  const ctx = useMemo(
    () => ({
      gctx: { ...genCtx, foods: activeFoods },
      favorites: data.favorites,
      history: data.history,
      bloquesSeparados: data.settings.bloquesSeparados ?? [],
      enCasa: [...enCasa],
    }),
    [genCtx, activeFoods, data.favorites, data.history, data.settings.bloquesSeparados, enCasa],
  );
  useEffect(() => () => void (cancel.current = true), []);

  const interpretar = (t: string) => {
    if (!t.trim()) return;
    setIdea(parsePlanVoz(t, activeFoods, data.profiles, hoy));
    setStep('idea');
  };
  const hablar = async () => {
    setError(null);
    setBusy(true);
    try {
      const t = await listen('Describe el plan: fechas, comidas, alimentos…');
      if (t) {
        const full = texto ? `${texto}. ${t}` : t;
        setTexto(full);
        interpretar(full);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** Genera los huecos poco a poco (para ver el progreso sin bloquear la pantalla) */
  const generar = async (i: PlanIdea) => {
    setStep('propuesta');
    setSlots([]);
    const out: PlanSlot[] = [];
    const it = planSlots(i, ctx);
    cancel.current = false;
    const total = i.fechas.length * i.bloques.length;
    for (let r = it.next(); !r.done; r = it.next()) {
      if (cancel.current) return;
      out.push(r.value);
      setProgress(`Preparando ${out.length}/${total}…`);
      await new Promise((res) => setTimeout(res, 0));
    }
    setSlots(out);
    setSel(new Set(out.filter((s) => s.meal && s.origen !== 'existente').map((s) => s.key)));
    setProgress(null);
  };

  const regenerar = (s: PlanSlot, attempt: number) => {
    if (!idea) return;
    const usedFav = new Set(slots.map((x) => x.favId).filter(Boolean) as string[]);
    const usedSig = slots.filter((x) => x.meal).map((x) => signature(x.meal!.items.map((i) => i.foodId)));
    const n = buildSlot(idea, ctx, { fecha: s.fecha, bloque: s.bloque, para: s.para, k: attempt, usedFav, usedSig });
    // si es una comida repetida, cambia en todos los días de su grupo
    const same = (x: PlanSlot) => (s.grupo ? x.grupo === s.grupo : x.key === s.key);
    setSlots(
      slots.map((x, i) =>
        same(x) ? { ...n, key: x.key, fecha: x.fecha, grupo: x.grupo, igualQue: x.igualQue, meal: n.meal ? { ...structuredClone(n.meal), id: `${n.meal.id}_g${i}` } : undefined } : x,
      ),
    );
    if (n.meal) setSel(new Set([...sel, ...slots.filter(same).map((x) => x.key)]));
  };

  const aceptar = () => {
    const chosen = slots.filter((s) => sel.has(s.key) && s.meal && s.origen !== 'existente');
    // para deshacer: lo que había antes en cada hueco
    const prev = chosen.map((s) => {
      const day = getDay(s.fecha);
      return { s, before: (s.para ? personSlot(day, s.bloque, s.para) : day?.bloques[s.bloque]) as DaySlot | undefined };
    });
    for (const s of chosen) placeMeal(s.meal!, s.fecha);
    onToast(`${chosen.length} comidas añadidas al plan`, () =>
      prev.forEach(({ s, before }) => (s.para ? setPersonSlot(s.bloque, s.para, before, s.fecha) : setDaySlot(s.bloque, before, s.fecha))),
    );
    onAdded?.([...new Set(chosen.map((s) => s.fecha))].sort());
    onClose();
  };

  // ───────── 1 · decir ─────────
  if (step === 'decir')
    return (
      <Sheet title="🎤 Plan por voz" onClose={onClose}>
        <div className="small">
          Di la idea: <b>fechas</b> (esta semana, la que viene, mañana, de lunes a viernes…), <b>qué comidas</b> (desayunos, comidas, cenas),{' '}
          <b>alimentos</b> y <b>para quién</b>. Luego verás lo que he entendido y podrás corregirlo.
        </div>
        {speechAvailable() && (
          <button className="btn primary" style={{ fontSize: '1.05rem', padding: '12px 16px' }} disabled={busy} onClick={hablar}>
            {busy ? '👂 Escuchando…' : '🎤 Hablar'}
          </button>
        )}
        <label className="field">
          …o escríbelo
          <textarea rows={4} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Plan para la semana que viene con arroz, pollo…" />
        </label>
        {error && <div className="tiny" style={{ color: 'var(--bad)' }}>{error}</div>}
        <button className="btn" disabled={!texto.trim()} onClick={() => interpretar(texto)}>
          Siguiente ›
        </button>
        <div className="tiny muted">Ejemplos (tócalos para probar):</div>
        {EJEMPLOS.map((e) => (
          <button key={e} className="btn small" style={{ textAlign: 'left', whiteSpace: 'normal' }} onClick={() => (setTexto(e), interpretar(e))}>
            “{e}”
          </button>
        ))}
      </Sheet>
    );

  // ───────── 2 · lo que he entendido ─────────
  if (step === 'idea' && idea) {
    const set = (patch: Partial<PlanIdea>) => setIdea({ ...idea, ...patch });
    const lunes = weekStart(hoy);
    const range = (a: string, n: number) => Array.from({ length: n }, (_, i) => addDays(a, i));
    const presets: [string, string[]][] = [
      ['Hoy', [hoy]],
      ['Mañana', [addDays(hoy, 1)]],
      ['Esta semana', range(hoy, 7 - ((new Date().getDay() + 6) % 7))],
      ['Semana que viene', range(addDays(lunes, 7), 7)],
      ['Próximos 7 días', range(addDays(hoy, 1), 7)],
    ];
    const visibles = [...new Set([...idea.fechas, ...range(hoy, 14)])].sort().slice(0, 21);
    return (
      <Sheet title="🎤 Lo que he entendido" onClose={onClose}>
        <div className="tiny muted">“{texto}”</div>
        {idea.dudas.map((d, i) => (
          <div key={i} className="tiny" style={{ color: 'var(--warn)' }}>
            ❓ {d}
          </div>
        ))}
        <b className="small">📅 Días ({idea.fechas.length})</b>
        <div className="chips">
          {presets.map(([l, f]) => (
            <button key={l} className={`chip ${f.join() === idea.fechas.join() ? 'on' : ''}`} onClick={() => set({ fechas: f })}>
              {l}
            </button>
          ))}
        </div>
        <div className="chips">
          {visibles.map((d) => (
            <button
              key={d}
              className={`chip ${idea.fechas.includes(d) ? 'on' : ''}`}
              onClick={() => set({ fechas: idea.fechas.includes(d) ? idea.fechas.filter((x) => x !== d) : [...idea.fechas, d].sort() })}
            >
              {formatDay(d, { weekday: 'short', day: 'numeric' })}
            </button>
          ))}
        </div>
        <b className="small">🍽️ Comidas</b>
        <div className="chips">
          {(['A', 'B', 'C'] as Block[]).map((b) => (
            <button
              key={b}
              className={`chip ${idea.bloques.includes(b) ? 'on' : ''}`}
              onClick={() => set({ bloques: idea.bloques.includes(b) ? idea.bloques.filter((x) => x !== b) : [...idea.bloques, b].sort() })}
            >
              {b} · {BLOCK_LABEL[b]}
            </button>
          ))}
        </div>
        {idea.reglas.map((r, ri) => (
          <div key={ri} className="card tight">
            <div className="row between">
              <b className="small">
                {r.bloques.map((b) => BLOCK_LABEL[b]).join(' y ')}
                {r.para ? ` · solo ${data.profiles[r.para].nombre}` : ' · los dos'}
              </b>
              <button
                className="iconbtn"
                aria-label="Quitar"
                onClick={() => set({ reglas: idea.reglas.filter((_, j) => j !== ri) })}
              >
                ✕
              </button>
            </div>
            <div className="chips">
              {r.items.map((it, ii) => (
                <span key={ii} className="chip on" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <button
                    style={{ background: 'none', border: 'none', color: 'inherit', padding: 0 }}
                    title="Toca para cambiar cada cuánto"
                    onClick={() => {
                      const items = r.items.map((x, j) => (j === ii ? { ...x, freq: FREQS[(FREQS.indexOf(x.freq) + 1) % FREQS.length] } : x));
                      set({ reglas: idea.reglas.map((x, j) => (j === ri ? { ...x, items } : x)) });
                    }}
                  >
                    {it.label}
                    {it.freq !== 'normal' && <span className="tiny"> · {FREQ_LABEL[it.freq]}</span>}
                  </button>
                  <button
                    style={{ background: 'none', border: 'none', color: 'inherit', padding: 0 }}
                    aria-label="Quitar"
                    onClick={() => set({ reglas: idea.reglas.map((x, j) => (j === ri ? { ...x, items: x.items.filter((_, k) => k !== ii) } : x)) })}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
            <label className="check small">
              <input type="checkbox" checked={r.variado} onChange={(e) => set({ reglas: idea.reglas.map((x, j) => (j === ri ? { ...x, variado: e.target.checked } : x)) })} />
              Variado
            </label>
          </div>
        ))}
        {idea.excluir.length > 0 && (
          <div className="small">
            🚫 Sin:{' '}
            {idea.excluir.map((x, i) => (
              <button key={i} className="chip" onClick={() => set({ excluir: idea.excluir.filter((_, j) => j !== i) })}>
                {x.label} ✕
              </button>
            ))}
          </div>
        )}
        <div className="tiny muted">Toca un alimento para cambiar cada cuánto sale (normal → algunos días → casi siempre → todos los días).</div>
        <b className="small">🔁 Repetir cada comida (cocinar menos)</b>
        <div className="chips">
          {[1, 2, 3].map((n) => (
            <button key={n} className={`chip ${(idea.repetir ?? 1) === n ? 'on' : ''}`} onClick={() => set({ repetir: n })}>
              {n === 1 ? 'No, cada día distinto' : `${n} días seguidos`}
            </button>
          ))}
        </div>
        {(idea.repetir ?? 1) > 1 && (
          <div className="tiny muted">
            Cada comida se repite {idea.repetir} días seguidos (p. ej., lunes y martes lo mismo, miércoles y jueves lo mismo…).
          </div>
        )}
        <label className="check small">
          <input type="checkbox" checked={idea.usarFavoritos} onChange={(e) => set({ usarFavoritos: e.target.checked })} />
          Usar mis favoritos cuando encajen (si no, comidas nuevas del generador)
        </label>
        <label className="check small">
          <input type="checkbox" checked={idea.soloHuecos} onChange={(e) => set({ soloHuecos: e.target.checked })} />
          No tocar lo que ya está planificado
        </label>
        <div className="btn-row">
          <button className="btn primary" disabled={!idea.fechas.length || !idea.bloques.length} onClick={() => generar(idea)}>
            ✨ Proponer {idea.fechas.length > 1 ? 'plan' : 'comida'}
          </button>
          <button className="btn" onClick={() => setStep('decir')}>
            ‹ Decirlo otra vez
          </button>
        </div>
      </Sheet>
    );
  }

  // ───────── 3 · propuesta ─────────
  const fechas = [...new Set(slots.map((s) => s.fecha))];
  const nuevos = slots.filter((s) => sel.has(s.key) && s.meal && s.origen !== 'existente').length;
  const toggle = (k: string) => setSel((x) => (x.has(k) ? new Set([...x].filter((y) => y !== k)) : new Set([...x, k])));
  return (
    <Sheet title="✨ Propuesta" onClose={onClose}>
      {progress && <div className="sub">⏳ {progress}</div>}
      {!progress && (
        <div className="tiny muted">
          Marca lo que quieres y pulsa aceptar. 🔄 propone otra para ese hueco. Lo ya planificado se queda como está.
        </div>
      )}
      {fechas.map((f) => {
        const ofDay = slots.filter((s) => s.fecha === f);
        const keys = ofDay.filter((s) => s.meal && s.origen !== 'existente').map((s) => s.key);
        const all = keys.length > 0 && keys.every((k) => sel.has(k));
        return (
          <div key={f} className="card tight">
            <label className="check" style={{ textTransform: 'capitalize' }}>
              <input
                type="checkbox"
                checked={all}
                disabled={!keys.length}
                onChange={() => setSel((x) => (all ? new Set([...x].filter((k) => !keys.includes(k))) : new Set([...x, ...keys])))}
              />
              <b>{formatDay(f, { weekday: 'long', day: 'numeric', month: 'short' })}</b>
            </label>
            {ofDay.map((s, i) => (
              <div key={s.key} className="row" style={{ gap: 8, alignItems: 'center', borderTop: '1px solid var(--line)', paddingTop: 6, opacity: s.origen === 'existente' ? 0.6 : 1 }}>
                <input type="checkbox" checked={sel.has(s.key)} disabled={!s.meal || s.origen === 'existente'} onChange={() => toggle(s.key)} />
                {s.meal ? <FavThumb fav={{ ...s.meal, foto: undefined, icono: undefined }} size={34} /> : <span className="thumb" style={{ width: 34, height: 34 }}>—</span>}
                <div className="grow col" style={{ gap: 1, minWidth: 0 }}>
                  <span className="small">
                    <b style={{ color: 'var(--primary)' }}>{s.bloque}</b>
                    {s.para ? <span className={s.para}> {data.profiles[s.para].nombre}</span> : ''} ·{' '}
                    {s.meal ? s.meal.nombre : 'sin opción con eso'}
                    {s.origen === 'favorito' && <span className="badge info"> ★</span>}
                    {s.origen === 'existente' && <span className="badge"> ya planificado</span>}
                    {s.igualQue && <span className="badge info"> ↻ igual que el {formatDay(s.igualQue, { weekday: 'short', day: 'numeric' })}</span>}
                  </span>
                  {s.meal && (
                    <span className="tiny muted">
                      {(s.para ? [s.para] : PROFILE_IDS).map((p: ProfileId, k) => (
                        <span key={p} className={p}>
                          {k > 0 && ' · '}
                          {s.kcal[p]} kcal · P {s.proteina[p]}
                        </span>
                      ))}
                      {s.pedido.length > 0 && ` · ${s.pedido.join(', ')}`}
                    </span>
                  )}
                </div>
                {s.origen !== 'existente' && (
                  <button className="iconbtn" title="Otra propuesta" onClick={() => regenerar(s, i + 1 + Math.floor(Math.random() * 7))}>
                    🔄
                  </button>
                )}
              </div>
            ))}
          </div>
        );
      })}
      {!progress && (
        <div className="col">
          <button className="btn primary" disabled={!nuevos} onClick={aceptar}>
            ✓ Añadir {nuevos} {nuevos === 1 ? 'comida' : 'comidas'} al plan
          </button>
          <button className="btn small" onClick={() => setStep('idea')}>
            ‹ Cambiar las ideas
          </button>
        </div>
      )}
    </Sheet>
  );
}
