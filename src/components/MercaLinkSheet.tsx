import { useEffect, useState } from 'react';
import type { Food, MercaProduct } from '../types';
import { useStore } from '../store/AppStore';
import { makeClient } from '../integrations/mercadona/service';
import { MercaError, ERROR_HELP } from '../integrations/mercadona/client';
import { queryFor, scoreProduct, sizeText } from '../integrations/mercadona/basket';
import { Sheet, Warnings } from './ui';

const eur = (n: number) => n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });

/** Elegir (o cambiar) el producto de Mercadona de un alimento de la app. */
export function MercaLinkSheet({ food, onClose, onToast }: { food: Food; onClose: () => void; onToast: (t: string) => void }) {
  const { data, setMercaLink } = useStore();
  const current = data.mercadona.links[food.id];
  const [q, setQ] = useState(queryFor(food));
  const [hits, setHits] = useState<MercaProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const search = async (text: string) => {
    setLoading(true);
    setError(null);
    try {
      const r = await makeClient(data.mercadona.config).search(text, 12);
      const ps = r.map((h) => h.product).sort((a, b) => scoreProduct(food, b) - scoreProduct(food, a));
      setHits(ps);
    } catch (e) {
      setError(e instanceof MercaError ? e.message : ERROR_HELP.sin_red);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    search(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Sheet title={`🛒 ${food.nombre}`} onClose={onClose}>
      {current && (
        <div className="card tight">
          <div className="tiny muted">Vinculado ahora{current.confirmado ? '' : ' (sugerido, sin confirmar)'}:</div>
          <ProductRow p={current.product} />
          <div className="btn-row">
            {!current.confirmado && (
              <button
                className="btn small primary"
                onClick={() => {
                  setMercaLink(food.id, { ...current, confirmado: true });
                  onToast('Producto confirmado');
                  onClose();
                }}
              >
                ✓ Confirmar este
              </button>
            )}
            <button
              className="btn small danger"
              onClick={() => {
                setMercaLink(food.id, undefined);
                onToast('Desvinculado');
                onClose();
              }}
            >
              Desvincular
            </button>
          </div>
        </div>
      )}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          search(q);
        }}
      >
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en Mercadona…" />
        <button className="btn primary" type="submit" disabled={loading}>
          {loading ? '…' : 'Buscar'}
        </button>
      </form>
      {error && <Warnings items={[{ level: 'error', text: error }]} />}
      <div className="list">
        {(hits ?? []).map((p) => (
          <button
            key={p.id}
            className="list-item"
            onClick={() => {
              setMercaLink(food.id, { foodId: food.id, product: p, confirmado: true });
              onToast(`${food.nombre} → ${p.nombre}`);
              onClose();
            }}
          >
            <ProductRow p={p} />
          </button>
        ))}
        {hits && hits.length === 0 && <div className="empty">Sin resultados. Prueba con otras palabras (p. ej. sin la marca).</div>}
      </div>
      <div className="tiny muted">Se guarda para las próximas compras y se comparte con el otro móvil.</div>
    </Sheet>
  );
}

export function ProductRow({ p }: { p: MercaProduct }) {
  return (
    <span className="row grow" style={{ gap: 10, minWidth: 0 }}>
      {p.thumbnail ? <img className="thumb" src={p.thumbnail} alt="" loading="lazy" /> : <span className="thumb">🛒</span>}
      <span className="grow col" style={{ gap: 1, minWidth: 0 }}>
        <span className="ttl small">{p.nombre}</span>
        <span className="tiny muted">
          {p.formato ? `${p.formato} · ` : ''}
          {sizeText(p)}
          {p.approx ? ' aprox.' : ''}
          {p.refPrice ? ` · ${p.refPrice.toLocaleString('es-ES', { maximumFractionDigits: 2 })} €/${p.refFormat}` : ''}
        </span>
      </span>
      <b className="small">{eur(p.unitPrice)}</b>
    </span>
  );
}
