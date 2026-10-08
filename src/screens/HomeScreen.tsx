import { useMemo, useState } from 'react';
import type { Block, FreeMeal, Meal, ProfileId } from '../types';
import { BLOCKS, PROFILE_IDS } from '../types';
import { useStore } from '../store/AppStore';
import { dayGoals, dayTotals, isFree, slotNutrients, targetsForDay, todayKey } from '../lib/day';
import { addDays } from '../lib/planning';
import { round } from '../lib/nutrition';
import { favoriteToMeal, sortFavorites } from '../lib/favorites';
import { MealEditor } from '../components/MealEditor';
import { CookMode } from '../components/CookMode';
import { MacroBar, NumberInput, Progress, Sheet } from '../components/ui';
import { FavThumb } from './FavoritesScreen';

const BLOCK_NAMES: Record<Block, string> = {
  A: 'Desayuno / preentreno',
  B: 'Almuerzo / 1ª comida',
  C: 'Cena',
};

export function HomeScreen({
  onGenerate,
  onProgress,
  onToast,
}: {
  onGenerate: (b: Block) => void;
  onProgress: () => void;
  onToast: (t: string) => void;
}) {
  const { data, fm, getDay, setDaySlot, setCompensar, setDayTraining } = useStore();
  const fecha = todayKey();
  const ayer = addDays(fecha, -1);
  const manana = addDays(fecha, 1);
  const day = getDay(fecha);
  const dayAyer = getDay(ayer);
  const dayManana = getDay(manana);
  const totals = useMemo(() => dayTotals(day, fm), [day, fm]);
  const [favFor, setFavFor] = useState<Block | null>(null);
  const [freeFor, setFreeFor] = useState<Block | null>(null);
  const [editFor, setEditFor] = useState<Block | null>(null);
  const [cookFor, setCookFor] = useState<Block | null>(null);
  const hasFree = BLOCKS.some((b) => isFree(day?.bloques[b]));

  const rawDate = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  const dateText = rawDate.charAt(0).toUpperCase() + rawDate.slice(1);

  /** copia los bloques de `from` a los bloques VACÍOS de `to` (no pisa nada) */
  const fillFrom = (fromDay: typeof day, to: string, toDay: typeof day) => {
    let n = 0;
    for (const b of BLOCKS) {
      const s = fromDay?.bloques[b];
      if (s && !toDay?.bloques[b]) {
        setDaySlot(b, structuredClone(s), to);
        n++;
      }
    }
    return n;
  };
  const ayerParaHoy = BLOCKS.filter((b) => dayAyer?.bloques[b] && !day?.bloques[b]).length;
  const hoyParaManana = BLOCKS.filter((b) => day?.bloques[b] && !dayManana?.bloques[b]).length;

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
                  <button
                    className={`badge ${g.entreno ? 'ok' : 'info'}`}
                    style={{ border: 'none', cursor: 'pointer' }}
                    title="Toca para cambiar el tipo de día"
                    onClick={() => setDayTraining(pid, !g.entreno, fecha)}
                  >
                    {g.entreno ? '🏋️ entreno' : '😴 descanso'}
                  </button>
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

      {(ayerParaHoy > 0 || hoyParaManana > 0) && (
        <div className="btn-row">
          {ayerParaHoy > 0 && (
            <button
              className="btn small soft"
              onClick={() => onToast(`Repetidas ${fillFrom(dayAyer, fecha, day)} comidas de ayer`)}
              title="Copia las comidas de ayer en los bloques vacíos de hoy"
            >
              ↻ Repetir ayer ({ayerParaHoy})
            </button>
          )}
          {hoyParaManana > 0 && (
            <button
              className="btn small"
              onClick={() => onToast(`Copiadas ${fillFrom(day, manana, dayManana)} comidas a mañana`)}
              title="Copia las comidas de hoy en los bloques vacíos de mañana"
            >
              ⧉ Copiar hoy a mañana ({hoyParaManana})
            </button>
          )}
        </div>
      )}

      {BLOCKS.map((b) => {
        const slot = day?.bloques[b];
        const targets = targetsForDay(fecha, b, data.profiles, day, fm);
        const slotAyer = dayAyer?.bloques[b];
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
              {!slot && (
                <div className="btn-row">
                  <button className="btn primary small" onClick={() => onGenerate(b)}>
                    ⚙️ Generar
                  </button>
                  <button className="btn small" onClick={() => setFavFor(b)}>
                    ★ Favoritos
                  </button>
                  {slotAyer && (
                    <button
                      className="btn small"
                      title={isFree(slotAyer) ? 'Comida libre' : slotAyer.meal.nombre}
                      onClick={() => {
                        setDaySlot(b, structuredClone(slotAyer), fecha);
                        onToast('Igual que ayer');
                      }}
                    >
                      ↻ Como ayer
                    </button>
                  )}
                  <button className="btn small" onClick={() => setFreeFor(b)}>
                    🍕 Comida libre
                  </button>
                </div>
              )}
              {slot && isFree(slot) && (
                <>
                  <b>🍕 Comida libre{slot.descripcion ? `: ${slot.descripcion}` : ''}</b>
                  <div className="small">
                    {PROFILE_IDS.map((p) => (
                      <span key={p} className={p} style={{ marginRight: 10 }}>
                        {data.profiles[p].nombre}: {slot.kcalEstimadas[p] ? `~${slot.kcalEstimadas[p]} kcal` : 'sin estimar'}
                      </span>
                    ))}
                  </div>
                  <div className="btn-row">
                    <button className="btn small" onClick={() => setFreeFor(b)}>
                      Editar
                    </button>
                    <button className="btn small danger" onClick={() => setDaySlot(b, undefined)}>
                      Quitar
                    </button>
                  </div>
                </>
              )}
              {slot && !isFree(slot) && (
                <>
                  <b style={{ fontSize: '0.95rem' }}>{slot.meal.nombre}</b>
                  <div className="small">
                    {PROFILE_IDS.map((p) => {
                      const n = slotNutrients(slot, p, fm);
                      return (
                        <span key={p} className={p} style={{ marginRight: 10 }}>
                          {data.profiles[p].nombre}: <b>{round(n.kcal)}</b> kcal · P {round(n.proteina)}
                        </span>
                      );
                    })}
                  </div>
                  <MacroBar n={slotNutrients(slot, 'dani', fm)} height={5} />
                  <div className="btn-row">
                    <button className="btn small soft" onClick={() => setEditFor(b)}>
                      Ver / editar
                    </button>
                    <button className="btn small" onClick={() => setCookFor(b)}>
                      👨‍🍳 Cocinar
                    </button>
                    <button className="btn small" onClick={() => onGenerate(b)}>
                      Cambiar
                    </button>
                    <button className="btn small danger" onClick={() => setDaySlot(b, undefined)}>
                      Quitar
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })}

      {favFor && (
        <FavoritePickSheet
          block={favFor}
          onClose={() => setFavFor(null)}
          onPick={(m) => {
            setDaySlot(favFor, { meal: m });
            onToast(`${m.nombre} → ${favFor}`);
            setFavFor(null);
          }}
        />
      )}
      {freeFor && (
        <FreeMealSheet
          initial={(() => {
            const s = day?.bloques[freeFor];
            return isFree(s) ? s : undefined;
          })()}
          onClose={() => setFreeFor(null)}
          onSave={(f) => {
            setDaySlot(freeFor, f);
            setFreeFor(null);
          }}
        />
      )}
      {editFor &&
        (() => {
          const s = day?.bloques[editFor];
          if (!s || isFree(s)) return null;
          const targets = targetsForDay(fecha, editFor, data.profiles, day, fm);
          return (
            <Sheet title={`${editFor} · ${s.meal.nombre}`} onClose={() => setEditFor(null)}>
              <MealEditor meal={s.meal} targets={targets} onChange={(m) => setDaySlot(editFor, { meal: m })} onToast={onToast} />
              {s.meal.notas && <div className="sub">{s.meal.notas}</div>}
            </Sheet>
          );
        })()}
      {cookFor &&
        (() => {
          const s = day?.bloques[cookFor];
          if (!s || isFree(s)) return null;
          return <CookMode meal={s.meal} onClose={() => setCookFor(null)} />;
        })()}
    </div>
  );
}

/** Elegir un favorito del bloque: más usados primero, con foto. Cuenta el uso. */
export function FavoritePickSheet({ block, onPick, onClose }: { block: Block; onPick: (m: Meal) => void; onClose: () => void }) {
  const { data, markFavoriteUsed } = useStore();
  const favs = sortFavorites(data.favorites.filter((f) => f.bloque === block));
  return (
    <Sheet title={`Favoritos ${block}`} onClose={onClose}>
      <div className="sub">Los más usados, arriba.</div>
      <div className="list">
        {favs.map((f) => (
          <button
            key={f.id}
            className="list-item"
            onClick={() => {
              markFavoriteUsed(f.id);
              onPick(favoriteToMeal(f));
            }}
          >
            <FavThumb fav={f} size={44} />
            <div className="grow">
              <div className="ttl">{f.nombre}</div>
              <div className="tiny">
                <span className="dani">
                  Dani {round(f.totales.dani.kcal)} kcal · P {round(f.totales.dani.proteina)}
                </span>{' '}
                ·{' '}
                <span className="alba">
                  Alba {round(f.totales.alba.kcal)} kcal · P {round(f.totales.alba.proteina)}
                </span>
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

export function FreeMealSheet({ initial, onSave, onClose }: { initial?: FreeMeal; onSave: (f: FreeMeal) => void; onClose: () => void }) {
  const { data } = useStore();
  const [desc, setDesc] = useState(initial?.descripcion ?? '');
  const [kcal, setKcal] = useState<Partial<Record<ProfileId, number>>>(initial?.kcalEstimadas ?? {});
  return (
    <Sheet title="Comida libre" onClose={onClose}>
      <div className="sub">
        Se registra como comida libre. Las calorías del resto del día NO se compensan automáticamente (puedes activarlo en Hoy).
      </div>
      <label className="field">
        Descripción (opcional)
        <input type="text" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Ej.: pizza con amigos" />
      </label>
      <div className="grid2">
        {PROFILE_IDS.map((p) => (
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
