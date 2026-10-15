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
import { favoriteToMeal } from '../lib/favorites';
import { shortName } from '../lib/mealGenerator';
import { MealEditor } from '../components/MealEditor';
import { CookMode } from '../components/CookMode';
import { ExtraSheet } from '../components/ExtraSheet';
import { MacroBar, NumberInput, Progress, Sheet } from '../components/ui';
import { FavThumb, SortSelect, useFavSorting } from './FavoritesScreen';
import { VariantSheet } from '../components/VariantSheet';
import { ShortageSheet } from '../components/ShortageSheet';
import { useDayCost, useShortages } from '../lib/useStock';
import { eur } from '../lib/mealInfo';
import { filterFavorites } from '../lib/favorites';
import { normalize } from '../components/FoodPicker';
import { dayMeals } from '../lib/day';
import { Icon } from '../components/icons';

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
  onToast: Toaster;
}) {
  const { data, fm, cm, getDay, setDaySlot, setPersonSlot, splitBlock, joinBlock, placeMeal, copyBlockTo, removeExtra, addExtra, addFavorite, setCompensar, setDayTraining, confirmDay } =
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
  const [variantFor, setVariantFor] = useState<(Target & { index?: number }) | null>(null);
  const [warnB, setWarnB] = useState<Block | null>(null);
  const cost = useDayCost(day);
  const shortages = useShortages();
  // lo que falta para las comidas de hoy, con la comida y el ingrediente para cambiarlo
  const faltasHoy = shortages
    .filter((s) => s.fecha === fecha && s.bloque)
    .map((s) => {
      const b = s.bloque!;
      const targets: Target[] = isSplit(day, b) ? PROFILE_IDS.map((pid) => ({ b, pid })) : [{ b }];
      for (const t of targets) {
        const sl = t.pid ? personSlot(day, b, t.pid) : day?.bloques[b];
        if (sl && !isFree(sl)) {
          const index = sl.meal.items.findIndex((i) => i.foodId === s.foodId);
          if (index >= 0) return { s, t, index };
        }
      }
      return null;
    })
    .filter(Boolean) as { s: (typeof shortages)[number]; t: Target; index: number }[];
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
    <div className="meal-actions">
      <button className="btn small soft" onClick={() => setEditFor(t)}>
        Ver / editar
      </button>
      <button className="btn small" onClick={() => setCookFor(t)}>
        <Icon name="pot" size={17} /> Cocinar
      </button>
      <button className="btn small" onClick={() => onGenerate(t.b, t.pid ?? 'ambos')}>
        <Icon name="generar" size={16} /> Cambiar
      </button>
      <button className="btn small" title="Cambiar solo el hidrato, la proteína…" onClick={() => setVariantFor(t)}>
        <Icon name="sync" size={16} /> Variante
      </button>
    </div>
  );

  /** Botonera de un hueco vacío */
  const EmptyActions = ({ t }: { t: Target }) => {
    const ayerSlot = t.pid ? personSlot(dayAyer, t.b, t.pid) : isSplit(dayAyer, t.b) ? undefined : dayAyer?.bloques[t.b];
    return (
      <div className="btn-row">
        <button className="btn primary small" onClick={() => onGenerate(t.b, t.pid ?? 'ambos')}>
          <Icon name="generar" size={17} /> Generar
        </button>
        <button className="btn small" onClick={() => setFavFor(t)}>
          <Icon name="favoritos" size={17} /> Favoritos
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
          <button
            className="btn small danger"
            onClick={() => {
              const prev = slotOf(t);
              saveSlot(t, undefined);
              onToast('Comida quitada', () => saveSlot(t, prev));
            }}
          >
            Quitar
          </button>
        </div>
      </>
    ) : (
      <>
        <div className="meal-title-row">
          <div className="meal-title">
            {slot.meal.nombre} {slot.meal.ajustadoReal && <span className="badge ok">✍️ real</span>}
          </div>
          <button className="iconbtn" aria-label="Más opciones" title="Más opciones" onClick={() => setMenuFor(t)}>
            ⋯
          </button>
        </div>
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
      {new Date().getHours() >= 20 && !day?.confirmado && dayMeals(day).length > 0 && !!data.stock.config.desde && (
        <div className="card tight row between">
          <span className="small">🍽️ ¿Habéis comido lo planificado hoy?</span>
          <span className="row" style={{ gap: 6 }}>
            <button
              className="btn small primary"
              onClick={() => {
                confirmDay(fecha, true);
                onToast('✅ Día confirmado: despensa al día');
              }}
            >
              Sí
            </button>
            <span className="tiny muted">o corrige abajo</span>
          </span>
        </div>
      )}
      <header className="page-head">
        <div>
          <h2>Hoy</h2>
          <div className="sub">{dateText}</div>
        </div>
        <button className="btn small" onClick={onProgress}>
          <Icon name="trend" size={17} /> Progreso
        </button>
      </header>

      <section className="card day-hero" aria-label="Resumen del día">
        <div className="day-people">
          {PROFILE_IDS.map((pid) => {
            const p = data.profiles[pid];
            const g = dayGoals(p, fecha, day);
            const t = totals[pid];
            return (
              <div key={pid} className="person">
                <div className="person-name">
                  <span className={pid}>{p.nombre}</span>
                  {p.entreno?.activo && (
                    <button
                      className={`badge ${g.entreno ? 'ok' : 'info'}`}
                      title="Toca para cambiar el tipo de día"
                      onClick={() => setDayTraining(pid, !g.entreno, fecha)}
                    >
                      {g.entreno ? '🏋️ entreno' : '😴 descanso'}
                    </button>
                  )}
                </div>
                <KcalRing pid={pid} value={t.kcal} max={g.kcalDia} />
                <div className="person-stats">
                  <div className="stat-line">
                    <span>Proteína</span>
                    <span>
                      <b>{round(t.proteina)}</b> / {g.proteinaDia} g
                    </span>
                  </div>
                  <Progress value={t.proteina} max={g.proteinaDia} />
                  <div className="stat-line">
                    <span>HC {round(t.carbohidratos)} g</span>
                    <span>G {round(t.grasas)} g</span>
                  </div>
                  {data.settings.mostrarFibraSal && (
                    <div className="stat-line">
                      <span>Fibra {round(t.fibra, 1)} g</span>
                      <span>Sal {round(t.sal, 1)} g</span>
                    </div>
                  )}
                  {t.kcal > 0 && <MacroBar n={t} height={5} />}
                </div>
              </div>
            );
          })}
        </div>
        {(cost.total > 0 || hasFree) && (
          <div className="day-foot">
            {cost.total > 0 && (
              <div className="tiny muted">
                💶 Hoy ≈ {eur(cost.total)} ({PROFILE_IDS.map((p) => `${data.profiles[p].nombre} ${eur(cost.porPersona[p])}`).join(' · ')})
              </div>
            )}
            {hasFree && (
              <label className="check small">
                <input type="checkbox" checked={!!day?.compensar} onChange={(e) => setCompensar(e.target.checked)} />
                Compensar la comida libre en el resto de bloques de hoy
              </label>
            )}
          </div>
        )}
      </section>

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
          <section key={b} className="card block-card" aria-label={`Bloque ${b}: ${BLOCK_NAMES[b]}`}>
            <div className="block-head">
              <div className="block-letter" aria-hidden="true">
                {b}
              </div>
              <div className="grow">
                <div className="block-name">
                  {BLOCK_NAMES[b]}
                  {faltasHoy.some((x) => x.t.b === b) && (
                    <button className="warn-dot" title="Puede faltar algo en casa" onClick={() => setWarnB(b)}>
                      ⚠️ falta algo
                    </button>
                  )}
                </div>
                <div className="tiny muted">
                  Objetivo <span className="dani">{targets.dani.kcal}</span> · <span className="alba">{targets.alba.kcal}</span> kcal
                </div>
              </div>
            </div>
            <div className="block-body">
              {!split && !shared && (
                <>
                  <EmptyActions t={{ b }} />
                  <button className="btn small link" style={{ alignSelf: 'flex-start' }} onClick={() => splitBlock(b, fecha)}>
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
                    className="btn small link"
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
          </section>
        );
      })}

      <div className="card">
        <div className="row between">
          <h3 className="block-name">🍌 Extras de hoy</h3>
          <button className="btn small" onClick={() => setExtra(true)}>
            <Icon name="plus" size={16} /> Añadir
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
              <button className="iconbtn" aria-label="Quitar extra" onClick={() => {
                removeExtra(e.id, fecha);
                onToast('Extra quitado', () => addExtra(e, fecha));
              }}>
                <Icon name="close" size={16} />
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
                const t = menuFor;
                const prev = slotOf(t);
                saveSlot(t, undefined);
                setMenuFor(null);
                onToast('Comida quitada', () => saveSlot(t, prev));
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
      {warnB && (
        <ShortageSheet
          items={faltasHoy.filter((x) => x.t.b === warnB).map((x) => x.s)}
          onClose={() => setWarnB(null)}
          onToast={onToast}
          onCambiar={(foodId) => {
            const x = faltasHoy.find((y) => y.t.b === warnB && y.s.foodId === foodId);
            if (x) setVariantFor({ ...x.t, index: x.index });
          }}
        />
      )}
      {variantFor &&
        (() => {
          const s = slotOf(variantFor);
          if (!s || isFree(s)) return null;
          const t = variantFor;
          const prev = s;
          return (
            <VariantSheet
              meal={s.meal}
              initial={t.index !== undefined ? { index: t.index } : undefined}
              objetivos={targetsForDay(fecha, t.b, data.profiles, day, fm)}
              onClose={() => setVariantFor(null)}
              actions={[
                {
                  label: '✓ Cambiar en esta comida',
                  primary: true,
                  run: (m) => {
                    saveSlot(t, { meal: { ...m, ajustadoReal: s.meal.ajustadoReal } });
                    setVariantFor(null);
                    onToast(`Ahora: ${m.nombre}`, () => saveSlot(t, prev));
                  },
                },
                {
                  label: 'Cambiar y guardar como favorito',
                  run: (m) => {
                    saveSlot(t, { meal: m });
                    addFavorite({ ...m, origen: 'favorito' });
                    setVariantFor(null);
                    onToast(`Ahora: ${m.nombre} (y en favoritos)`, () => saveSlot(t, prev));
                  },
                },
              ]}
            />
          );
        })()}
    </div>
  );
}

/** Anillo de kcal del día de una persona */
function KcalRing({ pid, value, max }: { pid: ProfileId; value: number; max: number }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  const over = value > max * 1.05;
  const left = Math.round(max - value);
  return (
    <div className={`ring ${pid} ${over ? 'over' : ''}`} role="img" aria-label={`${round(value)} de ${max} kcal`}>
      <svg viewBox="0 0 108 108">
        <circle className="track" cx="54" cy="54" r={r} fill="none" strokeWidth="8" />
        <circle
          className="bar"
          cx="54"
          cy="54"
          r={r}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          opacity={pct > 0 ? 1 : 0}
        />
      </svg>
      <div className="ring-center">
        <span className="big">{round(value)}</span>
        <span className="of">de {max} kcal</span>
      </div>
      <div className="ring-left">{left >= 0 ? `quedan ${left}` : `+${-left} de más`}</div>
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
  const sorting = useFavSorting();
  const [q, setQ] = useState('');
  const favs = sorting.apply(
    filterFavorites(
      data.favorites.filter((f) => f.bloque === block && (!para || !f.para || f.para === para)),
      normalize(q),
      {},
      data.foods,
    ),
  );
  return (
    <Sheet title={`Favoritos ${block}${para ? ` · solo ${data.profiles[para].nombre}` : ''}`} onClose={onClose}>
      <div className="row" style={{ gap: 6 }}>
        <input type="search" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
        <SortSelect value={sorting.sort} onChange={sorting.setSort} />
      </div>
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
