import { useMemo, useState } from 'react';
import type { Food } from '../types';
import { useStore } from '../store/AppStore';
import { datesBetween, formatDay, plannedMeals, shoppingList } from '../lib/planning';
import {
  basketText,
  basketTotal,
  bestMatch,
  buildBasket,
  cliText,
  qtyText,
  queryFor,
  sizeText,
  type BasketLine,
} from '../integrations/mercadona/basket';
import { MercaError } from '../integrations/mercadona/client';
import { loadIntoCart, makeClient, type LoadResult } from '../integrations/mercadona/service';
import { isNative } from '../integrations/mercadona/http';
import { loadSession } from '../integrations/mercadona/session';
import { MercaLinkSheet } from '../components/MercaLinkSheet';
import { Sheet, Warnings } from '../components/ui';
import { shareText } from './SyncScreen';

const eur = (n: number) => n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });

/** Ajustes de la cesta que se recuerdan mientras la app está abierta */
const memo: { ajustes: Record<string, number>; quitados: string[]; incluirEnCasa: boolean } = { ajustes: {}, quitados: [], incluirEnCasa: false };

export function MercaBasketView({
  from,
  to,
  onToast,
  onOpenSettings,
}: {
  from: string;
  to: string;
  onToast: (t: string) => void;
  onOpenSettings: () => void;
}) {
  const { data, fm, cm, setMercaLink, setMercaConfig } = useStore();
  const [quitar, setQuitar] = useState<BasketLine | null>(null);
  const [verOtra, setVerOtra] = useState(false);
  const otraTienda = data.mercadona.config.otraTienda ?? [];
  const [ajustes, setAjustes] = useState(memo.ajustes);
  const [quitados, setQuitados] = useState(memo.quitados);
  const [incluirEnCasa, setIncluirEnCasa] = useState(memo.incluirEnCasa);
  const [linkFor, setLinkFor] = useState<Food | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState<LoadResult | null>(null);
  memo.ajustes = ajustes;
  memo.quitados = quitados;
  memo.incluirEnCasa = incluirEnCasa;

  const meals = useMemo(() => plannedMeals(data.history, datesBetween(from, to)), [data.history, from, to]);
  const items = useMemo(() => shoppingList(meals, fm, cm), [meals, fm, cm]);
  const lines = useMemo(
    () => buildBasket(items, data.mercadona.links, { pantry: data.pantry, incluirEnCasa, quitados, ajustes, otraTienda }),
    [items, data.mercadona.links, data.pantry, incluirEnCasa, quitados, ajustes, otraTienda],
  );
  const total = basketTotal(lines);
  const sinVincular = lines.filter((l) => l.status === 'sin_vincular');
  const sugeridos = lines.filter((l) => l.link && !l.link.confirmado);
  const native = isNative();
  const session = loadSession();
  const max = data.mercadona.config.maxEur;
  const title = `🛒 Mercadona ${formatDay(from, { day: 'numeric', month: 'short' })} – ${formatDay(to, { day: 'numeric', month: 'short' })}`;

  const fail = (e: unknown) => {
    const me = e instanceof MercaError ? e : new MercaError('desconocido', (e as Error).message);
    setError(me.message);
  };

  /** Busca y propone productos para lo que falta (quedan "sugeridos" hasta que los confirmes) */
  const proponer = async () => {
    setBusy('Buscando productos…');
    setError(null);
    try {
      const foods = sinVincular.map((l) => l.food);
      const res = await makeClient(data.mercadona.config).batchSearch(foods.map(queryFor), 8);
      let n = 0;
      foods.forEach((f, i) => {
        const p = bestMatch(f, res[i].map((h) => h.product));
        if (p) {
          setMercaLink(f.id, { foodId: f.id, product: p, confirmado: false });
          n++;
        }
      });
      onToast(n ? `${n} productos propuestos: revísalos (marcados "sugerido")` : 'No se encontraron productos claros: vincúlalos a mano');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  /** Actualiza el precio de los productos vinculados (ficha actual de cada uno). Solo APK. */
  const actualizarPrecios = async () => {
    setBusy('Actualizando precios…');
    setError(null);
    const c = makeClient(data.mercadona.config);
    let n = 0;
    try {
      for (const l of lines) {
        if (!l.link || l.status === 'quitado') continue;
        try {
          const p = await c.product(l.link.product.id);
          setMercaLink(l.food.id, { ...l.link, product: p });
          n++;
        } catch (e) {
          if (e instanceof MercaError && e.code === 'no_encontrado') {
            setError(`“${l.link.product.nombre}” ya no está a la venta: elige otro producto para ${l.food.nombre}.`);
          } else throw e;
        }
        await new Promise((r) => setTimeout(r, 250)); // ritmo bajo
      }
      onToast(`Precios actualizados (${n})`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const cargar = async (mode: 'sumar' | 'reemplazar') => {
    setConfirm(false);
    setBusy('Cargando en tu carrito de Mercadona…');
    setError(null);
    try {
      const r = await loadIntoCart(makeClient(data.mercadona.config), lines, mode, max);
      setDone(r);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  if (!meals.length) return <div className="empty">No hay comidas planificadas en esas fechas. Planifícalas en “Semana”.</div>;

  const visibles = lines.filter((l) => l.status !== 'otra_tienda' && (l.status !== 'en_casa' || incluirEnCasa));
  const otras = lines.filter((l) => l.status === 'otra_tienda');
  const setOtra = (foodId: string, on: boolean) => {
    setMercaConfig({ otraTienda: on ? [...otraTienda.filter((x) => x !== foodId), foodId] : otraTienda.filter((x) => x !== foodId) });
    const link = data.mercadona.links[foodId];
    if (on && link && !link.confirmado) setMercaLink(foodId, undefined); // la sugerencia ya no sirve
  };
  const enCasa = lines.filter((l) => l.status === 'en_casa');

  return (
    <>
      <div className="card tight">
        <div className="row between">
          <span>
            Total estimado <b style={{ fontSize: '1.15rem' }}>{eur(total)}</b>
          </span>
          {max ? (
            <span className={`badge ${total > max ? 'bad' : 'info'}`}>tope {eur(max)}</span>
          ) : null}
        </div>
        <div className="tiny muted">
          {lines.filter((l) => l.status === 'ok').length} productos · precios del almacén {data.mercadona.config.wh}. Las bandejas de carne y la fruta
          por piezas tienen peso aproximado: el precio final puede variar un poco.
        </div>
        {sinVincular.length > 0 && (
          <button className="btn soft small" disabled={!!busy} onClick={proponer}>
            ✨ Proponer productos para los {sinVincular.length} sin vincular
          </button>
        )}
        {sugeridos.length > 0 && (
          <div className="tiny" style={{ color: 'var(--warn)' }}>
            {sugeridos.length} producto(s) “sugerido”: tócalos para confirmar o cambiar. Solo hay que hacerlo una vez.
          </div>
        )}
      </div>

      {busy && <div className="sub">⏳ {busy}</div>}
      {error && (
        <Warnings
          items={[{ level: 'error', text: error }]}
        />
      )}
      {error && (
        <button className="btn small" onClick={onOpenSettings}>
          🩺 Abrir diagnóstico de Mercadona
        </button>
      )}

      <div className="list">
        {visibles.map((l) => (
          <BasketRow
            key={l.food.id}
            l={l}
            onLink={() => setLinkFor(l.food)}
            onQty={(q) => setAjustes({ ...ajustes, [l.food.id]: Math.max(0, q) })}
            onToggle={() => (quitados.includes(l.food.id) ? setQuitados(quitados.filter((x) => x !== l.food.id)) : setQuitar(l))}
          />
        ))}
      </div>
      {otras.length > 0 && (
        <div className="card tight">
          <div className="row between small">
            <span>
              🏪 En otra tienda ({otras.length}): {otras.map((l) => l.food.nombre.split(' (')[0]).join(', ')}
            </span>
            <button className="btn small" onClick={() => setVerOtra(!verOtra)}>
              {verOtra ? 'Ocultar' : 'Cambiar'}
            </button>
          </div>
          {verOtra &&
            otras.map((l) => (
              <div key={l.food.id} className="row between small" style={{ borderTop: '1px solid var(--line)', paddingTop: 6 }}>
                <span className="grow">{l.food.nombre}</span>
                <button className="btn small" onClick={() => setOtra(l.food.id, false)}>
                  ↺ Comprar en Mercadona
                </button>
              </div>
            ))}
        </div>
      )}
      {enCasa.length > 0 && (
        <label className="check small">
          <input type="checkbox" checked={incluirEnCasa} onChange={(e) => setIncluirEnCasa(e.target.checked)} />
          Incluir lo marcado “en casa” ({enCasa.length}): {enCasa.map((l) => l.food.nombre.split(' (')[0]).join(', ')}
        </label>
      )}
      {Object.keys(ajustes).length > 0 && (
        <button className="btn small" onClick={() => setAjustes({})}>
          ↺ Volver a las cantidades calculadas
        </button>
      )}

      <div className="card">
        <b>Hacer la compra</b>
        {native ? (
          session ? (
            <button className="btn primary" disabled={!!busy || total <= 0} onClick={() => setConfirm(true)}>
              🛒 Cargar en mi carrito de Mercadona
            </button>
          ) : (
            <button className="btn primary" onClick={onOpenSettings}>
              🔗 Vincular mi cuenta de Mercadona (una vez)
            </button>
          )
        ) : (
          <div className="tiny muted">Cargar el carrito automáticamente solo funciona en la app instalada (APK).</div>
        )}
        <div className="btn-row">
          <button
            className="btn small"
            onClick={async () => {
              const r = await shareText(basketText(lines, title), title);
              onToast(r === 'copied' ? 'Lista copiada' : r === 'shared' ? 'Lista compartida' : 'No se pudo compartir');
            }}
          >
            📋 Copiar lista con productos
          </button>
          <button
            className="btn small"
            onClick={async () => {
              const r = await shareText(cliText(lines), 'cesta.txt para mercadona-cli');
              onToast(r === 'copied' ? 'Cesta copiada (formato mercadona-cli)' : r === 'shared' ? 'Cesta compartida' : 'No se pudo compartir');
            }}
          >
            💻 Exportar para el PC
          </button>
          {native && (
            <button className="btn small" disabled={!!busy} onClick={actualizarPrecios}>
              🔄 Actualizar precios
            </button>
          )}
        </div>
        <div className="tiny muted">
          Si la carga automática falla, puedes copiar la lista y buscar los productos en la app de Mercadona, o exportarla y cargarla desde el PC
          con <code>mercadona cart set-many -f cesta.txt</code>.
        </div>
      </div>

      {quitar && (
        <Sheet title={quitar.food.nombre.split(' (')[0]} onClose={() => setQuitar(null)}>
          <div className="col">
            <button
              className="btn primary"
              onClick={() => {
                setOtra(quitar.food.id, true);
                onToast(`${quitar.food.nombre.split(' (')[0]}: no se comprará en Mercadona`);
                setQuitar(null);
              }}
            >
              🏪 No lo compro en Mercadona (siempre)
            </button>
            <button
              className="btn"
              onClick={() => {
                setQuitados([...quitados, quitar.food.id]);
                setQuitar(null);
              }}
            >
              ✕ Quitar solo de esta compra
            </button>
          </div>
          <div className="sub">“Siempre” se recuerda; lo puedes deshacer abajo en “🏪 En otra tienda” o en Más → Mercadona.</div>
        </Sheet>
      )}
      {linkFor && <MercaLinkSheet food={linkFor} onClose={() => setLinkFor(null)} onToast={onToast} />}
      {confirm && (
        <Sheet title="Cargar en tu carrito" onClose={() => setConfirm(false)}>
          <div>
            Se cargarán <b>{lines.filter((l) => l.status === 'ok').length} productos</b> por unos <b>{eur(total)}</b>
            {max ? ` (tope ${eur(max)})` : ''}.
          </div>
          {sugeridos.length > 0 && <Warnings items={[`Hay ${sugeridos.length} producto(s) sin confirmar. Revisa que sean los que quieres.`]} />}
          <div className="sub">No se hace el pedido ni se paga: después lo revisas en Mercadona, eliges franja y pagas tú.</div>
          <div className="col">
            <button className="btn primary" onClick={() => cargar('sumar')}>
              Añadir a lo que ya tengo en el carrito
            </button>
            <button className="btn" onClick={() => cargar('reemplazar')}>
              Vaciar el carrito y dejar solo esta cesta
            </button>
          </div>
        </Sheet>
      )}
      {done && (
        <Sheet title="✅ Carrito listo" onClose={() => setDone(null)}>
          <div>
            Cargados <b>{done.cargados}</b> productos. Tu carrito tiene ahora <b>{done.cart.lines.length}</b> productos
            {done.cart.total !== undefined ? (
              <>
                {' '}
                por <b>{eur(done.cart.total)}</b>
              </>
            ) : null}
            .
          </div>
          <div className="sub">Ábrelo en Mercadona para revisar, elegir la franja de entrega y pagar.</div>
          <button
            className="btn primary block"
            onClick={() => {
              window.open('https://tienda.mercadona.es/', '_blank');
              setDone(null);
            }}
          >
            Abrir Mercadona
          </button>
        </Sheet>
      )}
    </>
  );
}

function BasketRow({ l, onLink, onQty, onToggle }: { l: BasketLine; onLink: () => void; onQty: (q: number) => void; onToggle: () => void }) {
  const bulk = l.link && l.link.product.sellingMethod !== 0;
  const step = bulk ? l.link!.product.incBunch : 1;
  const off = l.status === 'quitado';
  const needText =
    l.item.unit === 'unidad' ? `${l.item.unidades} ud` : `${l.item.comprar.toLocaleString('es-ES')} ${l.item.unit}`;
  return (
    <div className="list-item" style={{ alignItems: 'flex-start', opacity: off ? 0.5 : 1 }}>
      <button className="rm" style={{ marginTop: 10 }} onClick={onToggle} title={off ? 'Volver a añadir' : 'Quitar de esta compra'}>
        {off ? '↺' : '✕'}
      </button>
      <div className="grow col" style={{ gap: 3, minWidth: 0 }}>
        <button className="food-name" onClick={onLink} style={{ width: '100%' }}>
          <span className="n small">
            {l.link ? l.link.product.nombre : l.food.nombre}{' '}
            {l.link && !l.link.confirmado && <span className="badge warn">sugerido</span>}
            {l.status === 'en_casa' && <span className="badge ok">en casa</span>}
          </span>
          <span className="tiny muted">
            {l.link ? (
              <>
                {l.food.nombre.split(' (')[0]}: necesitas {needText} · {l.link.product.formato ?? ''} {sizeText(l.link.product)}
                {l.sobrante > 0 && !bulk ? ` · sobran ≈${Math.round(l.sobrante)} ${l.needUnit}` : ''}
              </>
            ) : (
              <span style={{ color: 'var(--warn)' }}>Necesitas {needText} · toca para elegir producto</span>
            )}
          </span>
          {l.aviso && <span className="tiny muted">ℹ️ {l.aviso}</span>}
        </button>
      </div>
      {l.link && !off && (
        <div className="qty">
          <b>{qtyText(l)}</b>
          <div className="stepper">
            <button onClick={() => onQty(Math.round((l.qty - step) * 1000) / 1000)} aria-label="Menos">
              −
            </button>
            <button onClick={() => onQty(Math.round((l.qty + step) * 1000) / 1000)} aria-label="Más">
              +
            </button>
          </div>
          <span className="tiny">{eur(l.precio)}</span>
        </div>
      )}
    </div>
  );
}
