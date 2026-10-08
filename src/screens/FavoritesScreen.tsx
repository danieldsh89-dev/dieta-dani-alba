import { useState } from 'react';
import type { Block, Favorite } from '../types';
import { BLOCKS } from '../types';
import { useStore } from '../store/AppStore';
import { round } from '../lib/nutrition';
import { targetsFor, reoptimizeMeal } from '../lib/mealGenerator';
import { MealEditor } from '../components/MealEditor';
import { NameSheet } from '../components/NameSheet';
import { Segmented, Sheet } from '../components/ui';
import { DateSheet } from '../components/DateSheet';
import { formatDay } from '../lib/planning';

export function FavoritesScreen({ onToast }: { onToast: (t: string) => void }) {
  const { data } = useStore();
  const [block, setBlock] = useState<Block>('B');
  const [open, setOpen] = useState<Favorite | null>(null);
  const favs = data.favorites.filter((f) => f.bloque === block);

  return (
    <div className="screen">
      <Segmented
        full
        value={block}
        options={BLOCKS.map((b) => ({ value: b, label: `Favoritos ${b} (${data.favorites.filter((f) => f.bloque === b).length})` }))}
        onChange={setBlock}
      />
      <div className="list">
        {favs.map((f) => (
          <button key={f.id} className="list-item" onClick={() => setOpen(f)}>
            <div className="thumb">★</div>
            <div className="grow col" style={{ gap: 2 }}>
              <div className="ttl">{f.nombre}</div>
              <div className="tiny">
                <span className="dani">
                  Dani {round(f.totales.dani.kcal)} kcal · P {round(f.totales.dani.proteina)} · HC {round(f.totales.dani.carbohidratos)} · G{' '}
                  {round(f.totales.dani.grasas)}
                </span>
              </div>
              <div className="tiny">
                <span className="alba">
                  Alba {round(f.totales.alba.kcal)} kcal · P {round(f.totales.alba.proteina)} · HC {round(f.totales.alba.carbohidratos)} · G{' '}
                  {round(f.totales.alba.grasas)}
                </span>
              </div>
            </div>
          </button>
        ))}
        {favs.length === 0 && <div className="empty">No hay favoritos en {block}. Genera una comida y pulsa “★ Guardar”.</div>}
      </div>
      {open && <FavoriteDetail key={open.id} fav={open} onClose={() => setOpen(null)} onToast={onToast} />}
    </div>
  );
}

function FavoriteDetail({ fav, onClose, onToast }: { fav: Favorite; onClose: () => void; onToast: (t: string) => void }) {
  const { data, genCtx, updateFavorite, removeFavorite, setDaySlot } = useStore();
  const [meal, setMeal] = useState<Favorite>(fav);
  const [renaming, setRenaming] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [planning, setPlanning] = useState(false);
  const targets = targetsFor(meal.bloque, data.profiles);
  const dirty = JSON.stringify(meal) !== JSON.stringify(fav);

  return (
    <Sheet
      title={meal.nombre}
      onClose={onClose}
      actions={
        dirty ? (
          <button
            className="btn primary small"
            onClick={() => {
              updateFavorite(meal);
              onToast('Favorito actualizado');
              onClose();
            }}
          >
            Guardar
          </button>
        ) : undefined
      }
    >
      <MealEditor meal={meal} targets={targets} onChange={(m) => setMeal({ ...meal, ...m })} onToast={onToast} />
      {meal.notas && <div className="sub">📝 {meal.notas}</div>}
      <div className="btn-row">
        <button
          className="btn soft small"
          onClick={() => {
            setDaySlot(meal.bloque, { meal: { ...meal, id: `${meal.id}_${Date.now().toString(36)}`, origen: 'favorito' } });
            onToast(`Usada como ${meal.bloque} de hoy`);
            onClose();
          }}
        >
          ✓ Usar hoy ({meal.bloque})
        </button>
        <button className="btn small" onClick={() => setPlanning(true)}>
          📅 Al plan…
        </button>
        <button
          className="btn small"
          onClick={() => {
            const r = reoptimizeMeal(meal, 'equilibrada', genCtx);
            setMeal({ ...meal, items: r.meal.items });
            onToast('Cantidades ajustadas a los objetivos actuales');
          }}
        >
          ⚖️ Ajustar a objetivos
        </button>
        <button className="btn small" onClick={() => setRenaming(true)}>
          ✎ Renombrar
        </button>
        <button className="btn small danger" onClick={() => setConfirmDel(true)}>
          Eliminar
        </button>
      </div>
      {confirmDel && (
        <div className="card">
          <b>¿Eliminar “{fav.nombre}”?</b>
          <div className="btn-row">
            <button
              className="btn danger small"
              onClick={() => {
                removeFavorite(fav.id);
                onToast('Favorito eliminado');
                onClose();
              }}
            >
              Sí, eliminar
            </button>
            <button className="btn small" onClick={() => setConfirmDel(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
      {planning && (
        <DateSheet
          title={`Añadir al plan (${meal.bloque})`}
          onClose={() => setPlanning(false)}
          onPick={(d) => {
            setDaySlot(meal.bloque, { meal: { ...meal, id: `${meal.id}_${Date.now().toString(36)}`, origen: 'favorito' } }, d);
            setPlanning(false);
            onToast(`Planificada: ${formatDay(d)} · ${meal.bloque}`);
          }}
        />
      )}
      {renaming && (
        <NameSheet
          title="Renombrar"
          initial={meal.nombre}
          onClose={() => setRenaming(false)}
          onSave={(n) => {
            setMeal({ ...meal, nombre: n });
            setRenaming(false);
          }}
        />
      )}
    </Sheet>
  );
}
