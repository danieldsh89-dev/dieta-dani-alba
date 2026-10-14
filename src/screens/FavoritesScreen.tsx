import { useMemo, useState } from 'react';
import type { Block, Favorite, ProfileId } from '../types';
import { BLOCKS, PROFILE_IDS } from '../types';
import { useStore } from '../store/AppStore';
import { round } from '../lib/nutrition';
import { targetsForDay, todayKey } from '../lib/day';
import { favoriteToMeal, filterFavorites, type FavFilter } from '../lib/favorites';
import { resizeImage } from '../lib/image';
import { formatDay } from '../lib/planning';
import { MealEditor } from '../components/MealEditor';
import { NameSheet } from '../components/NameSheet';
import { DateSheet } from '../components/DateSheet';
import { Segmented, Sheet } from '../components/ui';
import { normalize } from '../components/FoodPicker';
import { BLOCK_TINT, eur, FAV_SORTS, ICON_CHOICES, mealCost, mealEmojis, sortFavoritesBy, type FavSort } from '../lib/mealInfo';
import { computeStock } from '../lib/stock';
import { VariantSheet } from '../components/VariantSheet';

/** Foto del plato; si no, el icono elegido; si no, los iconos de sus ingredientes principales (🍗🥔). */
export function FavThumb({ fav, size = 52 }: { fav: Pick<Favorite, 'foto' | 'icono' | 'items' | 'bloque'>; size?: number }) {
  const { fm } = useStore();
  if (fav.foto) return <img className="thumb" src={fav.foto} alt="" style={{ width: size, height: size }} />;
  const icons = fav.icono ? [fav.icono] : mealEmojis(fav, fm);
  const one = icons.length === 1;
  return (
    <div
      className="thumb"
      aria-hidden
      style={{
        width: size,
        height: size,
        background: BLOCK_TINT[fav.bloque],
        display: 'flex',
        flexWrap: 'wrap',
        alignContent: 'center',
        justifyContent: 'center',
        gap: 0,
        lineHeight: 1,
        fontSize: one ? size * 0.55 : icons.length === 2 ? size * 0.36 : size * 0.3,
        padding: 2,
      }}
    >
      {icons.map((e, i) => (
        <span key={i} style={icons.length === 3 && i === 2 ? { width: '100%', textAlign: 'center' } : undefined}>
          {e}
        </span>
      ))}
    </div>
  );
}

/** Orden de favoritos elegido (se recuerda en este móvil) + lo que necesita cada orden. */
export function useFavSorting() {
  const { data, fm, cm, updateSettings } = useStore();
  const sort: FavSort = data.settings.ordenFavoritos ?? 'usados';
  const enCasa = useMemo(() => {
    if (sort !== 'casa') return new Set<string>();
    const st = computeStock(data, fm, cm);
    return new Set(
      Object.values(data.stock.items)
        .filter((it) => it.foodId && st[it.id] && st[it.id].fuente !== 'desconocido' && st[it.id].nivel !== 'agotado')
        .map((it) => it.foodId!),
    );
  }, [sort, data, fm, cm]);
  const cost = (f: Favorite) => {
    const c = mealCost(f, fm, cm, data.mercadona.links);
    return c.total > 0 ? c.total : undefined;
  };
  const apply = (favs: Favorite[]) => sortFavoritesBy(favs, sort, fm, { ratings: data.ratings, enCasa, cost });
  return { sort, setSort: (s: FavSort) => updateSettings({ ordenFavoritos: s }), apply, cost };
}

export function SortSelect({ value, onChange }: { value: FavSort; onChange: (s: FavSort) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as FavSort)} aria-label="Ordenar favoritos" style={{ maxWidth: 210 }}>
      {FAV_SORTS.map((s) => (
        <option key={s.id} value={s.id}>
          ↕ {s.label}
        </option>
      ))}
    </select>
  );
}

export function FavoritesScreen({ onToast, initialOpen }: { onToast: Toaster; initialOpen?: string }) {
  const { data } = useStore();
  const [block, setBlock] = useState<Block>(data.favorites.find((f) => f.id === initialOpen)?.bloque ?? 'B');
  const [openId, setOpenId] = useState<string | null>(initialOpen ?? null);
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState<FavFilter>({});
  const sorting = useFavSorting();
  const favs = useMemo(
    () => sorting.apply(filterFavorites(data.favorites.filter((f) => f.bloque === block), normalize(q), filtro, data.foods)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.favorites, data.foods, block, q, filtro, sorting.sort, data.stock, data.mercadona.links, data.ratings],
  );
  const toggle = (k: keyof FavFilter, v: FavFilter[keyof FavFilter]) => setFiltro((f) => ({ ...f, [k]: f[k] === v ? undefined : v }));
  const open = data.favorites.find((f) => f.id === openId);

  return (
    <div className="screen">
      <Segmented
        full
        value={block}
        options={BLOCKS.map((b) => ({ value: b, label: `Favoritos ${b} (${data.favorites.filter((f) => f.bloque === b).length})` }))}
        onChange={setBlock}
      />
      <input type="search" placeholder="Buscar por nombre o ingrediente (p. ej. albóndigas)…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chips">
        <button className={`chip ${filtro.para === 'ambos' ? 'on' : ''}`} onClick={() => toggle('para', 'ambos')}>
          👥 Para los dos
        </button>
        {PROFILE_IDS.map((p) => (
          <button key={p} className={`chip ${filtro.para === p ? 'on' : ''}`} onClick={() => toggle('para', p as ProfileId)}>
            Solo {data.profiles[p].nombre}
          </button>
        ))}
        <button className={`chip ${filtro.sinLacteos ? 'on' : ''}`} onClick={() => toggle('sinLacteos', true)}>
          Sin lácteos
        </button>
        <button className={`chip ${filtro.sinPescado ? 'on' : ''}`} onClick={() => toggle('sinPescado', true)}>
          Sin pescado
        </button>
        <button className={`chip ${filtro.conFoto ? 'on' : ''}`} onClick={() => toggle('conFoto', true)}>
          📷 Con foto
        </button>
      </div>
      <div className="row between">
        <span className="sub">
          {favs.length} {favs.length === 1 ? 'favorito' : 'favoritos'}
        </span>
        <SortSelect value={sorting.sort} onChange={sorting.setSort} />
      </div>
      <div className="list">
        {favs.map((f) => (
          <button key={f.id} className="list-item" onClick={() => setOpenId(f.id)}>
            <FavThumb fav={f} />
            <div className="grow col" style={{ gap: 2 }}>
              <div className="ttl">
                {f.para && <span className={`badge ${f.para}`}>solo {data.profiles[f.para].nombre}</span>} {f.nombre}
              </div>
              <div className="tiny">
                {(f.para ? [f.para] : PROFILE_IDS).map((p, i) => (
                  <span key={p} className={p}>
                    {i > 0 && ' · '}
                    {data.profiles[p].nombre} {round(f.totales[p].kcal)} kcal · P {round(f.totales[p].proteina)}
                  </span>
                ))}
              </div>
              <div className="tiny muted">
                {(f.usos ?? 0) > 0 ? `Usado ${f.usos} ${f.usos === 1 ? 'vez' : 'veces'}` : 'Sin usar'}
                {sorting.cost(f) !== undefined ? ` · ≈ ${eur(sorting.cost(f)!)}` : ''}
              </div>
            </div>
          </button>
        ))}
        {favs.length === 0 && (
          <div className="empty">
            {q || Object.values(filtro).some(Boolean)
              ? 'Ningún favorito con esa búsqueda o filtro.'
              : `No hay favoritos en ${block}. Genera una comida y pulsa “★ Guardar”.`}
          </div>
        )}
      </div>
      {open && <FavoriteDetail key={open.id} fav={open} onClose={() => setOpenId(null)} onOpen={setOpenId} onToast={onToast} />}
    </div>
  );
}

function FavoriteDetail({
  fav,
  onClose,
  onOpen,
  onToast,
}: {
  fav: Favorite;
  onClose: () => void;
  onOpen: (id: string) => void;
  onToast: Toaster;
}) {
  const { data, fm, cm, getDay, updateFavorite, removeFavorite, restoreFavorite, placeMeal, markFavoriteUsed, addFavorite } = useStore();
  const [meal, setMeal] = useState<Favorite>(fav);
  const [renaming, setRenaming] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [iconos, setIconos] = useState(false);
  const [variant, setVariant] = useState(false);
  const cost = mealCost(meal, fm, cm, data.mercadona.links);
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
      <div className="row" style={{ alignItems: 'center' }}>
        {!meal.foto && <FavThumb fav={meal} size={48} />}
        <button className="btn small" onClick={() => setIconos(!iconos)}>
          {meal.icono ? 'Cambiar icono' : '🎨 Elegir icono'}
        </button>
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
      {iconos && (
        <div className="card tight">
          <div className="tiny muted">Sin foto se muestra este icono (o, si no eliges ninguno, los de sus ingredientes).</div>
          <div className="row wrap" style={{ gap: 4 }}>
            {ICON_CHOICES.map((e) => (
              <button
                key={e}
                className={`iconbtn ${meal.icono === e ? 'on' : ''}`}
                style={{ fontSize: '1.35rem', outline: meal.icono === e ? '2px solid var(--primary)' : undefined }}
                onClick={() => {
                  updateFavorite({ ...fav, icono: e });
                  setMeal((m) => ({ ...m, icono: e }));
                  setIconos(false);
                }}
              >
                {e}
              </button>
            ))}
          </div>
          {meal.icono && (
            <button
              className="btn small"
              onClick={() => {
                updateFavorite({ ...fav, icono: undefined });
                setMeal((m) => ({ ...m, icono: undefined }));
                setIconos(false);
              }}
            >
              Usar los de sus ingredientes
            </button>
          )}
        </div>
      )}
      <MealEditor meal={meal} targets={targets} onChange={(m) => setMeal({ ...meal, ...m })} onToast={onToast} />
      {cost.total > 0 && (
        <div className="tiny muted">
          💶 ≈ {eur(cost.total)}
          {(meal.para ? [meal.para] : PROFILE_IDS).length > 1
            ? ` (${PROFILE_IDS.map((p) => `${data.profiles[p].nombre} ${eur(cost.porPersona[p])}`).join(' · ')})`
            : ''}{' '}
          con precios de Mercadona{cost.sinPrecio ? ` · ${cost.sinPrecio} ingrediente(s) sin producto vinculado` : ''}
        </div>
      )}
      <label className="field">
        📝 Preparación (pasos, trucos, tiempo)
        <textarea rows={3} value={meal.notas ?? ''} placeholder="Ej.: papas al air fryer 18 min a 200 °C; pollo a la plancha 4 min por lado" onChange={(e) => setMeal({ ...meal, notas: e.target.value || undefined })} />
      </label>
      <div className="btn-row">
        <button
          className="btn soft small"
          onClick={() => {
            placeMeal(favoriteToMeal(meal));
            markFavoriteUsed(fav.id);
            onToast(`Usada como ${meal.bloque} de hoy${meal.para ? ` (solo ${data.profiles[meal.para].nombre})` : ''}`);
            onClose();
          }}
        >
          ✓ Usar hoy ({meal.bloque})
        </button>
        <button className="btn small" onClick={() => setPlanning(true)}>
          📅 Al plan…
        </button>
        <button className="btn small" onClick={() => setVariant(true)}>
          🔁 Variante
        </button>
        <button className="btn small" onClick={() => setRenaming(true)}>
          ✎ Renombrar
        </button>
        <button
          className="btn small"
          title="Crea una copia para hacer una variante"
          onClick={() => {
            const copy = addFavorite({ ...meal, nombre: `${meal.nombre} (copia)`, foto: undefined, usos: undefined, ultimoUso: undefined } as Favorite);
            onToast('Copia creada: cámbiala a tu gusto');
            onOpen(copy.id);
          }}
        >
          ⧉ Duplicar
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
                onToast('Favorito eliminado', () => restoreFavorite(fav));
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
      {variant && (
        <VariantSheet
          meal={meal}
          objetivos={targets}
          onClose={() => setVariant(false)}
          actions={[
            {
              label: '★ Guardar como favorito nuevo',
              primary: true,
              run: (m) => {
                const f = addFavorite({ ...m, foto: undefined, icono: undefined, usos: undefined, ultimoUso: undefined } as Favorite);
                setVariant(false);
                onToast(`“${m.nombre}” guardado`);
                onOpen(f.id);
              },
            },
            {
              label: `✓ Usar solo hoy (${meal.bloque})`,
              run: (m) => {
                placeMeal({ ...favoriteToMeal({ ...meal, ...m } as Favorite) });
                markFavoriteUsed(fav.id);
                setVariant(false);
                onToast(`“${m.nombre}” puesta hoy`);
                onClose();
              },
            },
            {
              label: 'Las dos cosas',
              run: (m) => {
                addFavorite({ ...m, foto: undefined, icono: undefined, usos: undefined, ultimoUso: undefined } as Favorite);
                placeMeal({ ...favoriteToMeal({ ...meal, ...m } as Favorite) });
                setVariant(false);
                onToast(`“${m.nombre}” guardado y puesto hoy`);
                onClose();
              },
            },
          ]}
        />
      )}
      {planning && (
        <DateSheet
          title={`Añadir al plan (${meal.bloque})`}
          onClose={() => setPlanning(false)}
          onPick={(d) => {
            placeMeal(favoriteToMeal(meal), d);
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
