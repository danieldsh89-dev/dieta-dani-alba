import { useMemo, useState } from 'react';
import type { Block, DaySlot, FreeMeal, Meal, ProfileId } from '../types';
import { BLOCKS, PROFILE_IDS } from '../types';
import { useStore } from '../store/AppStore';
import {
  blockHasContent,
  dayGoals,
  dayTotals,
  isFree,
  isSplit,
  mealFor,
  personSlot,
  slotNutrients,
  targetsForDay,
  todayKey,
} from '../lib/day';
import { addDays } from '../lib/planning';
import { nutrientsFor, round } from '../lib/nutrition';
import { displayQuantity } from '../lib/conversions';
import { favoriteToMeal, sortFavorites } from '../lib/favorites';
import { shortName } from '../lib/mealGenerator';
import { MealEditor } from '../components/MealEditor';
import { CookMode } from '../components/CookMode';
import { ExtraSheet } from '../components/ExtraSheet';
import { MacroBar, NumberInput, Progress, Sheet } from '../components/ui';
import { FavThumb } from './FavoritesScreen';

const BLOCK_NAMES: Record<Block, string> = {
  A: 'Desayuno / preentreno',
  B: 'Almuerzo / 1ª comida',
  C: 'Cena',
};

/** Qué se está editando/abriendo: un bloque compartido (pid undefined) o la parte de una persona */
interface Target {
  b: Block;
  pid?: ProfileId;
}

export function HomeScreen({
  onGenerate,
  onProgress,
  onToast,
}: {
  onGenerate: (b: Block, para: ProfileId | 'ambos') => void;
  onProgress: () => void;
  onToast: (t: string) => void;
}) {
  const { data, fm, cm, getDay, setDaySlot, setPersonSlot, splitBlock, joinBlock, placeMeal, copyBlockTo, removeExtra, setCompensar, setDayTraining } =
    useStore();
  const fecha = todayKey();
  const ayer = addDays(fecha, -1);
  const manana = addDays(fecha, 1);
  const day = getDay(fecha);
  const dayAyer = getDay(ayer);
  const dayManana = getDay(manana);
  const totals = useMemo(() => dayTotals(day, fm), [day, fm]);
  const [favFor, setFavFor] = useState<Target | null>(null);
  const [freeFor, setFreeFor] = useState<Target | null>(null);
  const [editFor, setEditFor] = useState<(Target & { real?: boolean }) | null>(null);
  const [cookFor, setCookFor] = useState<Target | null>(null);
  const [menuFor, setMenuFor] = useState<Target | null>(null);
  const [extra, setExtra] = useState(false);
  const hasFree = BLOCKS.some((b) => PROFILE_IDS.some((p) => isFree(personSlot(day, b, p))));
  const separados = data.settings.bloquesSeparados ?? [];

  const rawDate = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  const dateText = rawDate.charAt(0).toUpperCase() + rawDate.slice(1);

  const ayerParaHoy = BLOCKS.filter((b) => blockHasContent(dayAyer, b) && !blockHasContent(day, b));
  const hoyParaManana = BLOCKS.filter((b) => blockHasContent(day, b) && !blockHasContent(dayManana, b));

  /** slot actual de un objetivo (compartido o de una persona) */
  const slotOf = (t: Target): DaySlot | undefined => (t.pid ? personSlot(day, t.b, t.pid) : day?.bloques[t.b]);
  const saveSlot = (t: Target, s: DaySlot | undefined) => (t.pid ? setPersonSlot(t.b, t.pid, s, fecha) : setDaySlot(t.b, s, fecha));

  /** Botonera de una comida ya puesta */
  const MealActions = ({ t }: { t: Target }) => (
    <div className="btn-row">
      <button className="btn small soft" onClick={() => setEditFor(t)}>
        Ver / editar
      </button>
      <button className="btn small" onClick={() => setCookFor(t)}>
        👨‍🍳 Cocinar
      </button>
      <button className="btn small" onClick={() => onGenerate(t.b, t.pid ?? 'ambos')}>
        Cambiar
      </button>
      <button className="btn small" aria-label="Más opciones" onClick={() => setMenuFor(t)}>
        ⋯
      </button>
    </div>
  );

  /** Botonera de un hueco vacío */
  const EmptyActions = ({ t }: { t: Target }) => {
    const ayerSlot = t.pid ? personSlot(dayAyer, t.b, t.pid) : isSplit(dayAyer, t.b) ? undefined : dayAyer?.bloques[t.b];
    return (
      <div className="btn-row">
        <button className="btn primary small" onClick={() => onGenerate(t.b, t.pid ?? 'ambos')}>
          ⚙️ Generar
        </button>
        <button className="btn small" onClick={() => setFavFor(t)}>
          ★ Favoritos
        </button>
        {ayerSlot && (
          <button
            className="btn small"
            title={isFree(ayerSlot) ? 'Comida libre' : ayerSlot.meal.nombre}
            onClick={() => {
              saveSlot(t, structuredClone(ayerSlot));
              onToast('Igual que ayer');
            }}
          >
            ↻ Como ayer
          </button>
        )}
        <button className="btn small" onClick={() => setFreeFor(t)}>
          🍕 Libre
        </button>
      </div>
    );
  };

  /** Contenido de una comida (compartida o de una persona) */
  const SlotView = ({ t, slot }: { t: Target; slot: DaySlot }) =>
    isFree(slot) ? (
      <>
        <b className="small">🍕 Comida libre{slot.descripcion ? `: ${slot.descripcion}` : ''}</b>
        <div className="small">
          {(t.pid ? [t.pid] : PROFILE_IDS).map((p) => (
            <span key={p} className={p} style={{ marginRight: 10 }}>
              {data.profiles[p].nombre}: {slot.kcalEstimadas[p] ? `~${slot.kcalEstimadas[p]} kcal` : 'sin estimar'}
            </span>
          ))}
        </div>
        <div className="btn-row">
          <button className="btn small" onClick={() => setFreeFor(t)}>
            Editar
          </button>
          <button className="btn small danger" onClick={() => saveSlot(t, undefined)}>
            Quitar
          </button>
        </div>
      </>
    ) : (
      <>
        <b style={{ fontSize: '0.95rem' }}>
          {slot.meal.nombre} {slot.meal.ajustadoReal && <span className="badge ok">✍️ real</span>}
        </b>
        <div className="small">
          {(t.pid ? [t.pid] : PROFILE_IDS).map((p) => {
            const n = slotNutrients(slot, p, fm);
            return (
              <span key={p} className={p} style={{ marginRight: 10 }}>
                {data.profiles[p].nombre}: <b>{round(n.kcal)}</b> kcal · P {round(n.proteina)}
              </span>
            );
          })}
        </div>
        <MacroBar n={slotNutrients(slot, t.pid ?? 'dani', fm)} height={5} />
        <MealActions t={t} />
      </>
    );

  return (
    <div className="screen">
      <div className="row between">
        <div>
          <h2 style={{ fontSize: '1.3rem' }}>Hoy</h2>
          <div className="sub">{dateText}</div>
        </div>
        <button className="btn small" onClick={onProgress}>
          📈 Progreso
        </button>
      </div>

      <div className="card">
        {PROFILE_IDS.map((pid) => {
          const p = data.profiles[pid];
          const g = dayGoals(p, fecha, day);
          const t = totals[pid];
          return (
            <div key={pid} className="col" style={{ gap: 4 }}>
              <div className="row between small">
                <span className="row" style={{ gap: 6 }}>
                  <b className={pid}>{p.nombre}</b>
                  {p.entreno?.activo && (
                    <button
                      className={`badge ${g.entreno ? 'ok' : 'info'}`}
                      style={{ border: 'none', cursor: 'pointer' }}
                      title="Toca para cambiar el tipo de día"
                      onClick={() => setDayTraining(pid, !g.entreno, fecha)}
                    >
                      {g.entreno ? '🏋️ entreno' : '😴 descanso'}
                    </button>
                  )}
                </span>
                <span>
                  <b>{round(t.kcal)}</b> / {g.kcalDia} kcal · P <b>{round(t.proteina)}</b>/{g.proteinaDia} g
                </span>
              </div>
              <Progress value={t.kcal} max={g.kcalDia} who={pid} />
              <Progress value={t.proteina} max={g.proteinaDia} />
              <div className="tiny muted">
                HC {round(t.carbohidratos)} g · G {round(t.grasas)} g
                {data.settings.mostrarFibraSal && ` · Fibra ${round(t.fibra, 1)} g · Sal ${round(t.sal, 1)} g`}
              </div>
              {t.kcal > 0 && <MacroBar n={t} height={6} />}
            </div>
          );
        })}
        {hasFree && (
          <label className="check small">
            <input type="checkbox" checked={!!day?.compensar} onChange={(e) => setCompensar(e.target.checked)} />
            Compensar la comida libre en el resto de bloques de hoy
          </label>
        )}
      </div>

      {(ayerParaHoy.length > 0 || hoyParaManana.length > 0) && (
        <div className="btn-row">
          {ayerParaHoy.length > 0 && (
            <button
              className="btn small soft"
              onClick={() => {
                ayerParaHoy.forEach((b) => copyBlockTo(b, ayer, fecha));
                onToast(`Repetidos ${ayerParaHoy.length} bloques de ayer`);
              }}
              title="Copia las comidas de ayer en los bloques vacíos de hoy"
            >
              ↻ Repetir ayer ({ayerParaHoy.length})
            </button>
          )}
          {hoyParaManana.length > 0 && (
            <button
              className="btn small"
              onClick={() => {
                hoyParaManana.forEach((b) => copyBlockTo(b, fecha, manana));
                onToast(`Copiados ${hoyParaManana.length} bloques a mañana`);
              }}
              title="Copia las comidas de hoy en los bloques vacíos de mañana"
            >
              ⧉ Copiar hoy a mañana ({hoyParaManana.length})
            </button>
          )}
        </div>
      )}

      {BLOCKS.map((b) => {
        const targets = targetsForDay(fecha, b, data.profiles, day, fm);
        // separado: de verdad, o por defecto (ajuste) si el bloque está vacío
        const split = isSplit(day, b) || (!blockHasContent(day, b) && separados.includes(b));
        const shared = !split ? day?.bloques[b] : undefined;
        return (
          <div key={b} className="card block-card">
            <div className="block-letter">{b}</div>
            <div className="col" style={{ minWidth: 0 }}>
              <div className="row between">
                <span className="sub">{BLOCK_NAMES[b]}</span>
                <span className="tiny muted">
                  <span className="dani">{targets.dani.kcal}</span> / <span className="alba">{targets.alba.kcal}</span> kcal
                </span>
              </div>
              {!split && !shared && (
                <>
                  <EmptyActions t={{ b }} />
                  <button className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => splitBlock(b, fecha)}>
                    ✂️ Cada uno lo suyo
                  </button>
                </>
              )}
              {!split && shared && <SlotView t={{ b }} slot={shared} />}
              {split && (
                <>
                  {PROFILE_IDS.map((pid) => {
                    const s = personSlot(day, b, pid);
                    return (
                      <div key={pid} className={`half half-${pid}`}>
                        <span className={`who ${pid}`}>{data.profiles[pid].nombre}</span>
                        {s ? <SlotView t={{ b, pid }} slot={s} /> : <EmptyActions t={{ b, pid }} />}
                      </div>
                    );
                  })}
                  <button
                    className="btn small"
                    style={{ alignSelf: 'flex-start' }}
                    onClick={() => {
                      if (isSplit(day, b)) joinBlock(b, fecha);
                      else onGenerate(b, 'ambos');
                    }}
                    title="Volver a comer la misma receta"
                  >
                    🔗 {isSplit(day, b) && blockHasContent(day, b) ? 'Juntar en una comida' : 'Lo mismo para los dos'}
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}

      <div className="card">
        <div className="row between">
          <b>🍌 Extras de hoy</b>
          <button className="btn small" onClick={() => setExtra(true)}>
            ＋ Añadir
          </button>
        </div>
        {(day?.extras ?? []).length === 0 && <div className="tiny muted">¿Algo fuera del plan? Apúntalo aquí y cuenta en el día.</div>}
        {(day?.extras ?? []).map((e) => {
          const f = fm[e.foodId];
          if (!f) return null;
          return (
            <div key={e.id} className="row between small" style={{ borderTop: '1px solid var(--line)', paddingTop: 6 }}>
              <span className="grow">
                <b>{shortName(f)}</b>{' '}
                {PROFILE_IDS.filter((p) => (e.cantidades[p] ?? 0) > 0).map((p) => (
                  <span key={p} className={p} style={{ marginRight: 8 }}>
                    {data.profiles[p].nombre} {displayQuantity(f, e.cantidades[p], 'cocinado', cm).text.split(' (')[0]} ·{' '}
                    {round(nutrientsFor(f, e.cantidades[p]).kcal)} kcal
                  </span>
                ))}
              </span>
              <button className="iconbtn" aria-label="Quitar extra" onClick={() => removeExtra(e.id, fecha)}>
                ✕
              </button>
            </div>
          );
        })}
      </div>

      {menuFor && (
        <Sheet title={`${menuFor.b}${menuFor.pid ? ` · ${data.profiles[menuFor.pid].nombre}` : ''}`} onClose={() => setMenuFor(null)}>
          <div className="col">
            <button
              className="btn"
              onClick={() => {
                setEditFor({ ...menuFor, real: true });
                setMenuFor(null);
              }}
            >
              ✍️ Apuntar lo que comí de verdad
            </button>
            {!menuFor.pid && (
              <button
                className="btn"
                onClick={() => {
                  splitBlock(menuFor.b, fecha);
                  setMenuFor(null);
                  onToast('Bloque separado: cada uno puede cambiar su parte');
                }}
              >
                ✂️ Separar: cada uno lo suyo
              </button>
            )}
            <button
              className="btn danger"
              onClick={() => {
                saveSlot(menuFor, undefined);
                setMenuFor(null);
              }}
            >
              Quitar
            </button>
          </div>
        </Sheet>
      )}
      {favFor && (
        <FavoritePickSheet
          block={favFor.b}
          para={favFor.pid}
          onClose={() => setFavFor(null)}
          onPick={(m) => {
            placeMeal(m, fecha);
            onToast(`${m.nombre} → ${favFor.b}`);
            setFavFor(null);
          }}
        />
      )}
      {freeFor && (
        <FreeMealSheet
          para={freeFor.pid}
          initial={(() => {
            const s = slotOf(freeFor);
            return isFree(s) ? s : undefined;
          })()}
          onClose={() => setFreeFor(null)}
          onSave={(f) => {
            saveSlot(freeFor, f);
            setFreeFor(null);
          }}
        />
      )}
      {editFor &&
        (() => {
          const s = slotOf(editFor);
          if (!s || isFree(s)) return null;
          const targets = targetsForDay(fecha, editFor.b, data.profiles, day, fm);
          return (
            <Sheet title={`${editFor.b} · ${s.meal.nombre}`} onClose={() => setEditFor(null)}>
              {editFor.real && (
                <div className="sub">
                  ✍️ Ajusta las cantidades a lo que comisteis de verdad (o quita/añade ingredientes). Es opcional: si no tocas nada, cuenta lo
                  planificado.
                </div>
              )}
              <MealEditor
                meal={s.meal}
                targets={targets}
                onChange={(m) => saveSlot(editFor, { meal: editFor.real ? { ...m, ajustadoReal: true } : m })}
                onToast={onToast}
              />
              {s.meal.notas && <div className="sub">{s.meal.notas}</div>}
            </Sheet>
          );
        })()}
      {cookFor &&
        (() => {
          const s = slotOf(cookFor);
          if (!s || isFree(s)) return null;
          return <CookMode meal={s.meal} onClose={() => setCookFor(null)} />;
        })()}
      {extra && <ExtraSheet fecha={fecha} onClose={() => setExtra(false)} onToast={onToast} />}
    </div>
  );
}

/** Elegir un favorito del bloque (más usados primero, con foto). Para una persona, se usa solo su parte. */
export function FavoritePickSheet({
  block,
  para,
  onPick,
  onClose,
}: {
  block: Block;
  para?: ProfileId;
  onPick: (m: Meal) => void;
  onClose: () => void;
}) {
  const { data, markFavoriteUsed } = useStore();
  const favs = sortFavorites(data.favorites.filter((f) => f.bloque === block && (!para || !f.para || f.para === para)));
  return (
    <Sheet title={`Favoritos ${block}${para ? ` · solo ${data.profiles[para].nombre}` : ''}`} onClose={onClose}>
      <div className="sub">Los más usados, arriba.</div>
      <div className="list">
        {favs.map((f) => (
          <button
            key={f.id}
            className="list-item"
            onClick={() => {
              markFavoriteUsed(f.id);
              const m = favoriteToMeal(f);
              onPick(para ? mealFor(m, para) : m);
            }}
          >
            <FavThumb fav={f} size={44} />
            <div className="grow">
              <div className="ttl">
                {f.para && <span className={`badge ${f.para}`}>solo {data.profiles[f.para].nombre}</span>} {f.nombre}
              </div>
              <div className="tiny">
                {(para ? [para] : f.para ? [f.para] : PROFILE_IDS).map((p, i) => (
                  <span key={p} className={p}>
                    {i > 0 && ' · '}
                    {data.profiles[p].nombre} {round(f.totales[p].kcal)} kcal · P {round(f.totales[p].proteina)}
                  </span>
                ))}
              </div>
            </div>
            {(f.usos ?? 0) > 0 && <span className="badge info">×{f.usos}</span>}
          </button>
        ))}
        {favs.length === 0 && <div className="empty">Aún no hay favoritos para {block}. Genera una comida y pulsa “Guardar”.</div>}
      </div>
    </Sheet>
  );
}

export function FreeMealSheet({
  initial,
  para,
  onSave,
  onClose,
}: {
  initial?: FreeMeal;
  para?: ProfileId;
  onSave: (f: FreeMeal) => void;
  onClose: () => void;
}) {
  const { data } = useStore();
  const [desc, setDesc] = useState(initial?.descripcion ?? '');
  const [kcal, setKcal] = useState<Partial<Record<ProfileId, number>>>(initial?.kcalEstimadas ?? {});
  return (
    <Sheet title={`Comida libre${para ? ` · ${data.profiles[para].nombre}` : ''}`} onClose={onClose}>
      <div className="sub">
        Se registra como comida libre. Las calorías del resto del día NO se compensan automáticamente (puedes activarlo en Hoy).
      </div>
      <label className="field">
        Descripción (opcional)
        <input type="text" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Ej.: pizza con amigos" />
      </label>
      <div className="grid2">
        {(para ? [para] : PROFILE_IDS).map((p) => (
          <label key={p} className="field">
            <span className={p}>{data.profiles[p].nombre}: kcal estimadas</span>
            <NumberInput value={kcal[p]} allowEmpty placeholder="opcional" onChange={(v) => setKcal({ ...kcal, [p]: v })} step={10} />
          </label>
        ))}
      </div>
      <button className="btn primary block" onClick={() => onSave({ libre: true, descripcion: desc || undefined, kcalEstimadas: kcal })}>
        Guardar comida libre
      </button>
    </Sheet>
  );
}
