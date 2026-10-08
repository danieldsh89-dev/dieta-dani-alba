import { useState } from 'react';
import type { Block, Favorite } from '../types';
import { BLOCKS } from '../types';
import { useStore } from '../store/AppStore';
import { round } from '../lib/nutrition';
import { targetsForDay, todayKey } from '../lib/day';
import { favoriteToMeal, sortFavorites } from '../lib/favorites';
import { resizeImage } from '../lib/image';
import { formatDay } from '../lib/planning';
import { MealEditor } from '../components/MealEditor';
import { NameSheet } from '../components/NameSheet';
import { DateSheet } from '../components/DateSheet';
import { Segmented, Sheet } from '../components/ui';

export function FavThumb({ fav, size = 52 }: { fav: Favorite; size?: number }) {
  return fav.foto ? (
    <img className="thumb" src={fav.foto} alt="" style={{ width: size, height: size }} />
  ) : (
    <div className="thumb" style={{ width: size, height: size }}>
      ★
    </div>
  );
}

export function FavoritesScreen({ onToast }: { onToast: (t: string) => void }) {
  const { data } = useStore();
  const [block, setBlock] = useState<Block>('B');
  const [openId, setOpenId] = useState<string | null>(null);
  const favs = sortFavorites(data.favorites.filter((f) => f.bloque === block));
  const open = data.favorites.find((f) => f.id === openId);

  return (
    <div className="screen">
      <Segmented
        full
        value={block}
        options={BLOCKS.map((b) => ({ value: b, label: `Favoritos ${b} (${data.favorites.filter((f) => f.bloque === b).length})` }))}
        onChange={setBlock}
      />
      <div className="sub">Ordenados por los más usados.</div>
      <div className="list">
        {favs.map((f) => (
          <button key={f.id} className="list-item" onClick={() => setOpenId(f.id)}>
            <FavThumb fav={f} />
            <div className="grow col" style={{ gap: 2 }}>
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
              {(f.usos ?? 0) > 0 && (
                <div className="tiny muted">
                  Usado {f.usos} {f.usos === 1 ? 'vez' : 'veces'}
                </div>
              )}
            </div>
          </button>
        ))}
        {favs.length === 0 && <div className="empty">No hay favoritos en {block}. Genera una comida y pulsa “★ Guardar”.</div>}
      </div>
      {open && <FavoriteDetail key={open.id} fav={open} onClose={() => setOpenId(null)} onToast={onToast} />}
    </div>
  );
}

function FavoriteDetail({ fav, onClose, onToast }: { fav: Favorite; onClose: () => void; onToast: (t: string) => void }) {
  const { data, fm, getDay, updateFavorite, removeFavorite, setDaySlot, markFavoriteUsed } = useStore();
  const [meal, setMeal] = useState<Favorite>(fav);
  const [renaming, setRenaming] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [planning, setPlanning] = useState(false);
  const targets = targetsForDay(todayKey(), meal.bloque, data.profiles, getDay(), fm);
  const dirty = JSON.stringify({ ...meal, foto: undefined }) !== JSON.stringify({ ...fav, foto: undefined });

  const setPhoto = async (file?: File) => {
    if (!file) return;
    const foto = await resizeImage(file, 360, 0.7);
    updateFavorite({ ...fav, foto });
    setMeal((m) => ({ ...m, foto }));
    onToast('Foto guardada');
  };

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
      {meal.foto && <img className="fav-photo" src={meal.foto} alt={meal.nombre} />}
      <div className="row">
        <label className="btn small">
          📷 {meal.foto ? 'Cambiar foto' : 'Añadir foto'}
          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => setPhoto(e.target.files?.[0])} />
        </label>
        {meal.foto && (
          <button
            className="btn small"
            onClick={() => {
              updateFavorite({ ...fav, foto: undefined });
              setMeal((m) => ({ ...m, foto: undefined }));
            }}
          >
            Quitar foto
          </button>
        )}
      </div>
      <MealEditor meal={meal} targets={targets} onChange={(m) => setMeal({ ...meal, ...m })} onToast={onToast} />
      {meal.notas && <div className="sub">📝 {meal.notas}</div>}
      <div className="btn-row">
        <button
          className="btn soft small"
          onClick={() => {
            setDaySlot(meal.bloque, { meal: favoriteToMeal(meal) });
            markFavoriteUsed(fav.id);
            onToast(`Usada como ${meal.bloque} de hoy`);
            onClose();
          }}
        >
          ✓ Usar hoy ({meal.bloque})
        </button>
        <button className="btn small" onClick={() => setPlanning(true)}>
          📅 Al plan…
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
            setDaySlot(meal.bloque, { meal: favoriteToMeal(meal) }, d);
            markFavoriteUsed(fav.id);
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
