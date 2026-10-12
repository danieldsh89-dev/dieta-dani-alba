import { useState } from 'react';
import type { StockItem, StockLevel } from '../types';
import { useStore } from '../store/AppStore';
import { todayKey } from '../lib/day';
import { formatDay } from '../lib/planning';
import { amountText, ev, itemProduct, stepFor, ZONES, type ItemState } from '../lib/stock';
import { frecuencia, frecuenciaText, gastoMes, registrarCompra } from '../integrations/mercadona/habituales';
import { MercaProductPicker, ProductRow } from './MercaLinkSheet';
import { Sheet } from './ui';

const eur = (n: number) => n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
const FRECUENCIAS = [7, 14, 21, 30, 45, 60, 90];
const freqLabel = (d: number) => (d === 7 ? '1 semana' : d <= 21 && d % 7 === 0 ? `${d / 7} semanas` : d === 30 ? '1 mes' : d === 60 ? '2 meses' : d === 90 ? '3 meses' : `${d} días`);

const ORIGEN: Record<string, string> = { voz: '🎤', pedido: '📦', compra: '🛍️', revision: '🔎', manual: '✋', tirado: '🗑️', importado: '📥' };

/** Ficha de un artículo de la despensa: corregir cantidad, nivel, caducidad, zona, producto y frecuencia. */
export function StockItemSheet({ item, state, onClose, onToast }: { item: StockItem; state?: ItemState; onClose: () => void; onToast: (t: string) => void }) {
  const { data, fm, stockApply } = useStore();
  const food = item.foodId ? fm[item.foodId] : undefined;
  const product = itemProduct(data, item);
  const step = stepFor(item, food, product);
  const [exact, setExact] = useState<string>(state?.cantidad !== undefined ? String(Math.round(state.cantidad * 10) / 10) : '');
  const [picking, setPicking] = useState(false);
  const [more, setMore] = useState(false);
  const save = (patch: Partial<StockItem>) => stockApply({ items: [{ ...item, ...patch }] });
  const emit = (tipo: 'set' | 'delta' | 'nivel', data2: { valor?: number; nivel?: StockLevel }, msg: string) => {
    stockApply({ items: [item], events: [ev(item.id, tipo, data2, 'manual')] });
    onToast(msg);
  };
  const history = data.stock.events.filter((e) => e.item === item.id).slice(-8).reverse();
  const unidad = item.unidad === 'ud' ? 'ud' : item.unidad;
  const mes = gastoMes(item);

  return (
    <Sheet title={item.nombre} onClose={onClose}>
      <div className="small">
        {state?.cantidad !== undefined ? (
          <>
            Ahora: <b>{amountText(item, state.cantidad, product)}</b>{' '}
            <span className="tiny muted">
              ({state.fuente === 'medido' ? 'contado hace poco' : state.fuente === 'estimado' ? 'estimado' : state.fuente})
              {state.gastado ? ` · gastado en comidas desde la última corrección: ${amountText(item, state.gastado)}` : ''}
            </span>
          </>
        ) : item.tipo === 'estado' && state ? (
          <>
            Ahora: <b>{state.nivel === 'ok' ? '🟢 Hay' : state.nivel === 'poco' ? '🟡 Queda poco' : '🔴 No queda'}</b>{' '}
            {state.fuente === 'previsto' && <span className="tiny muted">(por su frecuencia de compra)</span>}
          </>
        ) : (
          <span className="muted">Aún no se sabe cuánto hay.</span>
        )}
      </div>

      {item.tipo === 'contado' && (
        <>
          <form
            className="row"
            style={{ gap: 6 }}
            onSubmit={(e) => {
              e.preventDefault();
              const v = Number(exact.replace(',', '.'));
              if (!Number.isFinite(v) || v < 0) return;
              emit('set', { valor: v }, `${item.nombre}: hay ${v} ${unidad}`);
            }}
          >
            <label className="field grow">
              Hay exactamente ({unidad})
              <input type="text" inputMode="decimal" value={exact} onChange={(e) => setExact(e.target.value)} />
            </label>
            <button className="btn primary" style={{ alignSelf: 'flex-end' }} type="submit">
              Guardar
            </button>
          </form>
          <div className="btn-row">
            <button className="btn small" onClick={() => emit('delta', { valor: -step }, `−${step} ${unidad}`)}>
              − {step} {unidad}
            </button>
            <button className="btn small" onClick={() => emit('delta', { valor: step }, `+${step} ${unidad}`)}>
              + {step} {unidad}
            </button>
            <button className="btn small" onClick={() => emit('nivel', { nivel: 'poco' }, 'Marcado: queda poco')}>
              🟡 Poco
            </button>
            <button className="btn small" onClick={() => emit('set', { valor: 0 }, 'Marcado: no queda')}>
              🔴 No queda
            </button>
          </div>
        </>
      )}
      {item.tipo === 'estado' && (
        <div className="btn-row">
          <button className="btn small" onClick={() => emit('nivel', { nivel: 'ok' }, 'Marcado: hay')}>
            🟢 Hay
          </button>
          <button className="btn small" onClick={() => (emit('nivel', { nivel: 'poco' }, 'Marcado: queda poco'), !item.foodId && save({ apuntado: true }))}>
            🟡 Queda poco
          </button>
          <button className="btn small" onClick={() => (emit('nivel', { nivel: 'agotado' }, 'Marcado: no queda'), !item.foodId && save({ apuntado: true }))}>
            🔴 No queda
          </button>
        </div>
      )}

      <div className="row" style={{ gap: 8 }}>
        <label className="field grow">
          ⏳ Caduca
          <input type="date" value={item.caduca ?? ''} onChange={(e) => save({ caduca: e.target.value || undefined })} />
        </label>
        <label className="field grow">
          Zona
          <select value={item.zona ?? 'otros'} onChange={(e) => save({ zona: e.target.value as StockItem['zona'] })}>
            {ZONES.map((z) => (
              <option key={z.id} value={z.id}>
                {z.ico} {z.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!item.foodId && (
        <div className="card tight">
          <b className="small">🛒 Producto de Mercadona</b>
          {product ? <ProductRow p={product} /> : <div className="tiny muted">Sin producto: no se puede cargar en el carrito.</div>}
          <button className="btn small" onClick={() => setPicking(true)}>
            {product ? 'Cambiar producto' : 'Elegir producto'}
          </button>
          <div>
            <b className="small">¿Cada cuánto lo compráis?</b>
            <div className="chips">
              <button className={`chip ${!item.cadaDias ? 'on' : ''}`} onClick={() => save({ cadaDias: undefined })}>
                Cuando se acabe
              </button>
              {FRECUENCIAS.map((d) => (
                <button key={d} className={`chip ${item.cadaDias === d ? 'on' : ''}`} onClick={() => save({ cadaDias: d })}>
                  {freqLabel(d)}
                </button>
              ))}
            </div>
          </div>
          <label className="check small">
            <input type="checkbox" checked={item.aprender} onChange={(e) => save({ aprender: e.target.checked })} />
            Aprender la frecuencia de lo que compramos de verdad
          </label>
          <div className="tiny muted">
            {frecuencia(item).aprendida ? `Ahora: ${frecuenciaText(item)}.` : item.aprender ? 'Con 3 compras usa vuestro ritmo real.' : ''}
            {mes !== undefined ? ` Gasto ≈ ${eur(mes)}/mes.` : ''}
            {item.compras.length ? ` Compras: ${item.compras.slice(-5).reverse().map((d) => formatDay(d, { day: 'numeric', month: 'short' })).join(' · ')}.` : ''}
          </div>
          <div className="btn-row">
            <button className={`btn small ${item.apuntado ? 'primary' : ''}`} onClick={() => save({ apuntado: !item.apuntado, pospuesto: undefined })}>
              {item.apuntado ? '✓ Apuntado para comprar' : '📝 Apuntar para comprar'}
            </button>
            <button
              className="btn small"
              onClick={() => {
                stockApply({ items: [registrarCompra(item, todayKey())], events: [item.tipo === 'contado' ? ev(item.id, 'delta', { valor: item.unidad === 'ud' ? item.qty : step }, 'compra') : ev(item.id, 'nivel', { nivel: 'ok' }, 'compra')] });
                onToast('Anotado: comprado hoy');
              }}
            >
              ✓ Lo compré hoy
            </button>
          </div>
        </div>
      )}
      {item.foodId && (
        <div className="tiny muted">
          Alimento de la dieta: se descuenta solo con las comidas registradas.{' '}
          {product ? `Producto: ${product.nombre}.` : 'Sin producto de Mercadona vinculado (Plan → Compra → 🛒 Mercadona).'}
        </div>
      )}

      <button className="btn small" onClick={() => setMore(!more)}>
        {more ? '▲' : '▼'} Más opciones e historial
      </button>
      {more && (
        <>
          <label className="field">
            Nombre
            <input type="text" defaultValue={item.nombre} onBlur={(e) => e.target.value.trim() && save({ nombre: e.target.value.trim() })} />
          </label>
          {!item.foodId && (
            <div className="row" style={{ gap: 8 }}>
              <label className="field grow">
                Se sigue por
                <select value={item.tipo} onChange={(e) => save({ tipo: e.target.value as StockItem['tipo'] })}>
                  <option value="estado">Estado (hay / poco / no queda)</option>
                  <option value="contado">Cantidad (se cuentan unidades)</option>
                </select>
              </label>
            </div>
          )}
          {item.tipo === 'contado' && (
            <label className="field">
              Avisar cuando quede menos de ({unidad})
              <input
                type="text"
                inputMode="decimal"
                defaultValue={item.minimo ?? ''}
                onBlur={(e) => {
                  const v = Number(e.target.value.replace(',', '.'));
                  save({ minimo: e.target.value.trim() && Number.isFinite(v) ? v : undefined });
                }}
              />
            </label>
          )}
          <div className="small">
            <b>Últimos movimientos</b>
            {history.length === 0 && <div className="tiny muted">Ninguno.</div>}
            {history.map((e) => (
              <div key={e.id} className="tiny">
                {ORIGEN[e.origen] ?? '•'} {new Date(e.at).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} ·{' '}
                {e.tipo === 'set' ? `hay ${e.valor}` : e.tipo === 'delta' ? `${(e.valor ?? 0) > 0 ? '+' : ''}${e.valor}` : e.nivel}
              </div>
            ))}
          </div>
          {!item.foodId && (
            <button
              className="btn small danger"
              onClick={() => {
                stockApply({ removeItems: [item.id] });
                onToast('Quitado de la despensa');
                onClose();
              }}
            >
              Quitar de la despensa
            </button>
          )}
        </>
      )}
      {picking && (
        <MercaProductPicker
          title={`🛒 ${item.nombre}`}
          onClose={() => setPicking(false)}
          onPick={(p) => {
            save({ product: p });
            setPicking(false);
            onToast(`${item.nombre} → ${p.nombre}`);
          }}
        />
      )}
    </Sheet>
  );
}
