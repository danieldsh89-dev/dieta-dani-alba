import { useState } from 'react';
import type { MercaHabitual } from '../types';
import { useStore } from '../store/AppStore';
import { todayKey } from '../lib/day';
import { formatDay } from '../lib/planning';
import { sizeText } from '../integrations/mercadona/basket';
import {
  apuntar,
  daysBetween,
  enEstaCompra,
  estado,
  frecuencia,
  frecuenciaText,
  gastoMes,
  nuevoHabitual,
  posponer,
  precioHabitual,
  proxima,
  registrarCompra,
} from '../integrations/mercadona/habituales';
import { MercaProductPicker, ProductRow } from '../components/MercaLinkSheet';
import { Sheet } from '../components/ui';

const eur = (n: number) => n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
const FRECUENCIAS = [7, 14, 21, 30, 45, 60, 90];

/** Otros productos (limpieza, higiene, casa…) que no salen del plan. */
export function OtrosCard({ hasta, onToast }: { hasta: string; onToast: (t: string) => void }) {
  const { data, setMercaHabitual } = useStore();
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [verTodos, setVerTodos] = useState(false);
  const habs = Object.values(data.mercadona.habituales).sort((a, b) => a.product.nombre.localeCompare(b.product.nombre));
  const enCompra = habs.filter((h) => enEstaCompra(h, hasta));
  const resto = habs.filter((h) => !enEstaCompra(h, hasta));
  const pronto = resto.filter((h) => estado(h, hasta) === 'pronto');
  const mes = habs.reduce((t, h) => t + (gastoMes(h) ?? 0), 0);
  const edit = editId ? data.mercadona.habituales[editId] : undefined;

  const toggle = (h: MercaHabitual) => setMercaHabitual(h.id, enEstaCompra(h, hasta) ? posponer(h, hasta) : apuntar(h));
  const step = (h: MercaHabitual) => (h.product.sellingMethod !== 0 ? h.product.incBunch || 0.1 : 1);
  const setQty = (h: MercaHabitual, q: number) => setMercaHabitual(h.id, { ...h, qty: Math.max(step(h), Math.round(q * 1000) / 1000) });

  const row = (h: MercaHabitual, on: boolean) => {
    const e = estado(h, hasta);
    const due = proxima(h);
    return (
      <div key={h.id} className="list-item" style={{ alignItems: 'center', opacity: on ? 1 : 0.75 }}>
        <input type="checkbox" checked={on} onChange={() => toggle(h)} aria-label="En esta compra" />
        <button className="food-name grow" style={{ minWidth: 0 }} onClick={() => setEditId(h.id)}>
          <span className="n small">
            {h.product.nombre} {e === 'apuntado' && <span className="badge info">apuntado</span>}
            {e === 'toca' && <span className="badge warn">toca</span>}
          </span>
          <span className="tiny muted">
            {sizeText(h.product)} · {frecuenciaText(h)}
            {!on && due ? ` · próxima ${formatDay(due, { day: 'numeric', month: 'short' })}` : ''}
          </span>
        </button>
        {on && (
          <div className="qty">
            <b>{h.product.sellingMethod !== 0 ? `${h.qty.toLocaleString('es-ES')} kg` : `× ${h.qty}`}</b>
            <div className="stepper">
              <button onClick={() => setQty(h, h.qty - step(h))} aria-label="Menos">
                −
              </button>
              <button onClick={() => setQty(h, h.qty + step(h))} aria-label="Más">
                +
              </button>
            </div>
            <span className="tiny">{eur(precioHabitual(h))}</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="card">
      <div className="row between">
        <b>🧴 Otros productos</b>
        <button className="btn small soft" onClick={() => setAdding(true)}>
          ➕ Añadir
        </button>
      </div>
      <div className="tiny muted">
        Limpieza, higiene, casa… Lo que toca según su frecuencia o está apuntado entra solo en esta compra.
        {mes > 0 ? ` Gasto habitual ≈ ${eur(mes)}/mes.` : ''}
      </div>
      {enCompra.length > 0 && <div className="list">{enCompra.map((h) => row(h, true))}</div>}
      {habs.length === 0 && <div className="tiny muted">Aún no hay ninguno. Pulsa “➕ Añadir” y busca, p. ej., “lavavajillas”.</div>}
      {resto.length > 0 && (
        <button className="btn small" onClick={() => setVerTodos(!verTodos)}>
          {verTodos ? '▲' : '▼'} Habituales que no tocan ahora ({resto.length}){pronto.length ? ` · ${pronto.length} pronto` : ''}
        </button>
      )}
      {verTodos && <div className="list">{resto.map((h) => row(h, false))}</div>}

      {adding && (
        <MercaProductPicker
          title="➕ Añadir otro producto"
          onClose={() => setAdding(false)}
          onPick={(p) => {
            const prev = data.mercadona.habituales[p.id];
            setMercaHabitual(p.id, prev ? { ...apuntar(prev), product: p } : nuevoHabitual(p, todayKey()));
            setAdding(false);
            onToast(prev ? `${p.nombre}: apuntado` : `${p.nombre} añadido a esta compra`);
            if (!prev) setEditId(p.id);
          }}
        />
      )}
      {edit && <HabitualSheet h={edit} onClose={() => setEditId(null)} onToast={onToast} />}
    </div>
  );
}

function HabitualSheet({ h, onClose, onToast }: { h: MercaHabitual; onClose: () => void; onToast: (t: string) => void }) {
  const { setMercaHabitual } = useStore();
  const save = (patch: Partial<MercaHabitual>) => setMercaHabitual(h.id, { ...h, ...patch });
  const f = frecuencia(h);
  const mes = gastoMes(h);
  const hoy = todayKey();
  const ultimas = [...h.compras].sort().reverse().slice(0, 6);
  return (
    <Sheet title="Producto habitual" onClose={onClose}>
      <ProductRow p={h.product} />
      <div>
        <b className="small">¿Cada cuánto lo compráis?</b>
        <div className="chips">
          <button className={`chip ${!h.cadaDias ? 'on' : ''}`} onClick={() => save({ cadaDias: undefined })}>
            Cuando lo apunte
          </button>
          {FRECUENCIAS.map((d) => (
            <button key={d} className={`chip ${h.cadaDias === d ? 'on' : ''}`} onClick={() => save({ cadaDias: d })}>
              {d % 7 === 0 && d <= 21 ? (d === 7 ? '1 semana' : `${d / 7} semanas`) : d === 30 ? '1 mes' : d === 60 ? '2 meses' : d === 90 ? '3 meses' : `${d} días`}
            </button>
          ))}
        </div>
      </div>
      <label className="check small">
        <input type="checkbox" checked={h.aprender} onChange={(e) => save({ aprender: e.target.checked })} />
        Aprender la frecuencia de lo que compramos de verdad
      </label>
      <div className="tiny muted">
        {f.aprendida
          ? `Ahora usa ${frecuenciaText(h)}.`
          : h.aprender
            ? 'Con 3 compras empezará a usar vuestro ritmo real (y se ajusta solo si lo compráis antes o lo vais quitando).'
            : 'Usa solo la frecuencia que elijas.'}
        {mes !== undefined ? ` Gasto ≈ ${eur(mes)}/mes.` : ''}
      </div>
      <div className="small">
        Compras: {ultimas.length ? ultimas.map((d) => formatDay(d, { day: 'numeric', month: 'short' })).join(' · ') : 'ninguna todavía'}
        {ultimas[0] ? ` (hace ${daysBetween(ultimas[0], hoy)} días)` : ''}
      </div>
      <div className="btn-row">
        <button
          className="btn small"
          onClick={() => {
            setMercaHabitual(h.id, registrarCompra(h, hoy));
            onToast('Anotado: comprado hoy');
          }}
        >
          ✓ Lo compré hoy (fuera de la app)
        </button>
        <button
          className="btn small danger"
          onClick={() => {
            setMercaHabitual(h.id, undefined);
            onToast('Quitado de habituales');
            onClose();
          }}
        >
          Quitar de habituales
        </button>
      </div>
    </Sheet>
  );
}
