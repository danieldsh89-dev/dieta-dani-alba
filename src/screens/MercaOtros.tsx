import { useMemo, useState } from 'react';
import type { StockItem } from '../types';
import { useStore } from '../store/AppStore';
import { todayKey } from '../lib/day';
import { formatDay } from '../lib/planning';
import { sizeText } from '../integrations/mercadona/basket';
import { apuntar, estado, frecuenciaText, gastoMes, nuevoHabitual, posponer, precioHabitual, proxima } from '../integrations/mercadona/habituales';
import { computeStock, otroEnCompra, type ItemState } from '../lib/stock';
import { MercaProductPicker } from '../components/MercaLinkSheet';
import { StockItemSheet } from '../components/StockItemSheet';

const eur = (n: number) => n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });

/** Lo de casa que no sale del plan (limpieza, higiene, bebidas…): lo que falta, toca o está apuntado entra en esta compra. */
export function OtrosCard({ hasta, onToast }: { hasta: string; onToast: (t: string) => void }) {
  const { data, fm, cm, stockApply } = useStore();
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [linkId, setLinkId] = useState<string | null>(null);
  const [verTodos, setVerTodos] = useState(false);
  const hoy = todayKey();
  const states = useMemo(() => computeStock(data, fm, cm), [data, fm, cm]);
  const otros = Object.values(data.stock.items)
    .filter((it) => !it.foodId)
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
  const enCompra = otros.filter((it) => otroEnCompra(it, states[it.id], hasta, hoy));
  const resto = otros.filter((it) => !otroEnCompra(it, states[it.id], hasta, hoy));
  const pronto = resto.filter((it) => estado(it, hasta) === 'pronto');
  const mes = otros.reduce((t, it) => t + (gastoMes(it) ?? 0), 0);
  const edit = editId ? data.stock.items[editId] : undefined;
  const linking = linkId ? data.stock.items[linkId] : undefined;

  const save = (it: StockItem) => stockApply({ items: [it] });
  const toggle = (it: StockItem) => save(otroEnCompra(it, states[it.id], hasta, hoy) ? posponer(it, hasta) : apuntar(it));
  const step = (it: StockItem) => (it.product && it.product.sellingMethod !== 0 ? it.product.incBunch || 0.1 : 1);
  const setQty = (it: StockItem, q: number) => save({ ...it, qty: Math.max(step(it), Math.round(q * 1000) / 1000) });

  const why = (it: StockItem, s?: ItemState) => {
    if (it.apuntado) return <span className="badge info">apuntado</span>;
    if (s && s.fuente !== 'desconocido' && s.fuente !== 'previsto' && s.nivel !== 'ok') return <span className={`badge ${s.nivel === 'agotado' ? 'bad' : 'warn'}`}>{s.nivel === 'agotado' ? 'no queda' : 'queda poco'}</span>;
    if (estado(it, hasta) === 'toca' || s?.fuente === 'previsto') return <span className="badge warn">toca</span>;
    return null;
  };

  const row = (it: StockItem, on: boolean) => {
    const due = proxima(it);
    return (
      <div key={it.id} className="list-item" style={{ alignItems: 'center', opacity: on ? 1 : 0.75 }}>
        <input type="checkbox" checked={on} onChange={() => toggle(it)} aria-label="En esta compra" />
        <button className="food-name grow" style={{ minWidth: 0 }} onClick={() => setEditId(it.id)}>
          <span className="n small">
            {it.product?.nombre ?? it.nombre} {on && why(it, states[it.id])}
          </span>
          <span className="tiny muted">
            {it.product ? sizeText(it.product) : <span style={{ color: 'var(--warn)' }}>sin producto de Mercadona</span>} · {frecuenciaText(it)}
            {!on && due ? ` · próxima ${formatDay(due, { day: 'numeric', month: 'short' })}` : ''}
          </span>
        </button>
        {on && it.product && (
          <div className="qty">
            <b>{it.product.sellingMethod !== 0 ? `${it.qty.toLocaleString('es-ES')} kg` : `× ${it.qty}`}</b>
            <div className="stepper">
              <button onClick={() => setQty(it, it.qty - step(it))} aria-label="Menos">
                −
              </button>
              <button onClick={() => setQty(it, it.qty + step(it))} aria-label="Más">
                +
              </button>
            </div>
            <span className="tiny">{eur(precioHabitual(it))}</span>
          </div>
        )}
        {on && !it.product && (
          <button className="btn small" onClick={() => setLinkId(it.id)}>
            Elegir
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="card">
      <div className="row between">
        <b>🧴 Otros productos de casa</b>
        <button className="btn small soft" onClick={() => setAdding(true)}>
          ➕ Añadir
        </button>
      </div>
      <div className="tiny muted">
        Lo que se ha acabado, lo apuntado (también por voz) y lo que toca por frecuencia entra solo.
        {mes > 0 ? ` Gasto habitual ≈ ${eur(mes)}/mes.` : ''}
      </div>
      {enCompra.length > 0 && <div className="list">{enCompra.map((it) => row(it, true))}</div>}
      {otros.length === 0 && <div className="tiny muted">Aún no hay ninguno. Pulsa “➕ Añadir” o di “apunta papel higiénico”.</div>}
      {resto.length > 0 && (
        <button className="btn small" onClick={() => setVerTodos(!verTodos)}>
          {verTodos ? '▲' : '▼'} Lo demás de casa ({resto.length}){pronto.length ? ` · ${pronto.length} pronto` : ''}
        </button>
      )}
      {verTodos && <div className="list">{resto.map((it) => row(it, false))}</div>}

      {adding && (
        <MercaProductPicker
          title="➕ Añadir a la compra"
          onClose={() => setAdding(false)}
          onPick={(p) => {
            const prev = Object.values(data.stock.items).find((i) => i.product?.id === p.id);
            save(prev ? { ...apuntar(prev), product: p } : { ...nuevoHabitual(p, hoy), nombre: p.nombre });
            setAdding(false);
            onToast(`${p.nombre}: en esta compra`);
            if (!prev) setEditId(`m${p.id}`);
          }}
        />
      )}
      {linking && (
        <MercaProductPicker
          title={`🛒 ${linking.nombre}`}
          onClose={() => setLinkId(null)}
          onPick={(p) => {
            save({ ...linking, product: p });
            setLinkId(null);
          }}
        />
      )}
      {edit && <StockItemSheet item={edit} state={states[edit.id]} onClose={() => setEditId(null)} onToast={onToast} />}
    </div>
  );
}

/** Productos de casa que van en esta compra (solo los que tienen producto de Mercadona). */
export function otrosParaCarrito(items: StockItem[], states: Record<string, ItemState>, hasta: string, hoy = todayKey()): StockItem[] {
  return items.filter((it) => !it.foodId && it.product && otroEnCompra(it, states[it.id], hasta, hoy));
}
