import { useMemo, useRef, useState } from 'react';
import type { StockItem, StockZone } from '../types';
import { useStore } from '../store/AppStore';
import { todayKey } from '../lib/day';
import { addDays, datesBetween, formatDay, plannedMeals } from '../lib/planning';
import {
  amountText,
  caducanPronto,
  computeStock,
  daysLeft,
  ev,
  foodItem,
  itemProduct,
  reviewCandidates,
  stepFor,
  ZONES,
  type ItemState,
} from '../lib/stock';
import { isNative } from '../integrations/mercadona/http';
import { loadSession } from '../integrations/mercadona/session';
import { makeClient } from '../integrations/mercadona/service';
import { manualReceipt, syncOrders } from '../integrations/mercadona/orders';
import { MercaError } from '../integrations/mercadona/client';
import { scheduleReminders } from '../lib/notify';
import { VoiceBar } from '../components/VoiceBar';
import { StockItemSheet } from '../components/StockItemSheet';
import { MercaProductPicker } from '../components/MercaLinkSheet';
import { Segmented, Sheet, Warnings } from '../components/ui';

type View = 'stock' | 'revisar' | 'gasto' | 'ajustes';
const memo: { view: View; zona?: StockZone } = { view: 'stock' };
const eur = (n: number) => n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });

const NIVEL_BADGE = { ok: '', poco: 'warn', agotado: 'bad' } as const;

export function CasaScreen({ onToast, initialView }: { onToast: (t: string) => void; initialView?: CasaView }) {
  const { data, fm, cm } = useStore();
  const [view, setView] = useState<View>(initialView === 'voz' ? 'stock' : (initialView ?? memo.view));
  memo.view = view;
  const [open, setOpen] = useState<StockItem | null>(null);
  const hoy = todayKey();
  const states = useMemo(() => computeStock(data, fm, cm), [data, fm, cm]);
  const items = Object.values(data.stock.items);
  const started = !!data.stock.config.desde || items.length > 0;

  const counts = useMemo(() => {
    let agotado = 0;
    let poco = 0;
    for (const it of items) {
      const s = states[it.id];
      if (!s || s.fuente === 'desconocido') continue;
      if (s.nivel === 'agotado') agotado++;
      else if (s.nivel === 'poco') poco++;
    }
    return { agotado, poco, caducan: caducanPronto(data, states, hoy).length };
  }, [items, states, data, hoy]);

  return (
    <div className="screen">
      <div className="card">
        <div className="row between">
          <b>🏠 Despensa</b>
          <span className="tiny">
            {counts.agotado > 0 && <span className="badge bad">{counts.agotado} agotado</span>}{' '}
            {counts.poco > 0 && <span className="badge warn">{counts.poco} poco</span>}{' '}
            {counts.caducan > 0 && <span className="badge info">⏳ {counts.caducan}</span>}
          </span>
        </div>
        <VoiceBar big autoStart={initialView === 'voz'} />
      </div>
      <Segmented
        full
        value={view}
        options={[
          { value: 'stock', label: '📦 Hay' },
          { value: 'revisar', label: '🔎 Revisar' },
          { value: 'gasto', label: '💶 Compras' },
          { value: 'ajustes', label: '⚙️' },
        ]}
        onChange={setView}
      />
      {!started && view === 'stock' && <Onboarding onToast={onToast} onCount={() => setView('revisar')} />}
      {view === 'stock' && started && <StockView states={states} onOpen={setOpen} onToast={onToast} />}
      {view === 'revisar' && <ReviewView states={states} onOpen={setOpen} onToast={onToast} />}
      {view === 'gasto' && <ComprasView onToast={onToast} />}
      {view === 'ajustes' && <AjustesView onToast={onToast} />}
      {open && <StockItemSheet item={data.stock.items[open.id] ?? open} state={states[open.id]} onClose={() => setOpen(null)} onToast={onToast} />}
    </div>
  );
}

// ───────── primeros pasos ─────────

function Onboarding({ onToast, onCount }: { onToast: (t: string) => void; onCount: () => void }) {
  const { stockApply } = useStore();
  return (
    <div className="card">
      <b>Empieza a llevar la despensa</b>
      <ol className="small" style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <li>
          Pulsa <b>Empezar</b>. Desde ese momento, las comidas registradas descuentan lo que gastan y los pedidos de Mercadona entregados suman solos.
        </li>
        <li>
          Haz un <b>recuento por zonas</b> (nevera, despensa…) hablando: “hay 6 huevos, 2 leches, medio paquete de arroz, no queda pan, el resto bien”.
        </li>
        <li>Lo que no cuentes se irá conociendo con los pedidos y las correcciones.</li>
      </ol>
      <div className="btn-row">
        <button
          className="btn primary"
          onClick={() => {
            stockApply({ config: { desde: new Date().toISOString() } });
            onToast('Despensa en marcha');
            onCount();
          }}
        >
          Empezar y hacer el recuento
        </button>
      </div>
      <div className="tiny muted">¿Tenías el inventario en “Despensa” (bot de Telegram)? Impórtalo en ⚙️.</div>
    </div>
  );
}

// ───────── lo que hay ─────────

type Filtro = 'todo' | 'falta' | 'hay' | 'sin';

function StockView({ states, onOpen, onToast }: { states: Record<string, ItemState>; onOpen: (it: StockItem) => void; onToast: (t: string) => void }) {
  const { data, fm, stockApply } = useStore();
  const [filtro, setFiltro] = useState<Filtro>('todo');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const hoy = todayKey();
  const caducan = caducanPronto(data, states, hoy);

  // alimentos del plan de los próximos 7 días sin dato todavía
  const sinDato = useMemo(() => {
    const ids = new Set<string>();
    for (const m of plannedMeals(data.history, datesBetween(hoy, addDays(hoy, 6)))) for (const it of m.meal.items) ids.add(it.foodId);
    return [...ids].filter((id) => fm[id] && (!data.stock.items[id] || states[id]?.fuente === 'desconocido')).map((id) => fm[id]);
  }, [data, fm, states, hoy]);

  const match = (it: StockItem) => {
    const s = states[it.id];
    if (q && !it.nombre.toLowerCase().includes(q.toLowerCase())) return false;
    if (filtro === 'falta') return s && s.fuente !== 'desconocido' && s.nivel !== 'ok';
    if (filtro === 'hay') return s && s.fuente !== 'desconocido' && s.nivel !== 'agotado';
    if (filtro === 'sin') return !s || s.fuente === 'desconocido';
    return true;
  };
  const list = Object.values(data.stock.items).filter(match);
  const zonas = ZONES.map((z) => ({ ...z, items: list.filter((it) => (it.zona ?? 'otros') === z.id).sort((a, b) => a.nombre.localeCompare(b.nombre)) })).filter((z) => z.items.length);

  return (
    <>
      {caducan.length > 0 && (
        <div className="card tight">
          <b className="small">⏳ Caducan pronto</b>
          {caducan.map((it) => {
            const n = daysLeft(it.caduca!, hoy);
            return (
              <button key={it.id} className="row between small" style={{ background: 'none', border: 'none', padding: '4px 0', color: 'inherit', textAlign: 'left' }} onClick={() => onOpen(it)}>
                <span>{it.nombre}</span>
                <span className={`badge ${n < 0 ? 'bad' : n <= 1 ? 'warn' : 'info'}`}>{n < 0 ? 'caducado' : n === 0 ? 'hoy' : n === 1 ? 'mañana' : `en ${n} días`}</span>
              </button>
            );
          })}
          <div className="tiny muted">El generador de comidas los prioriza para que no se tiren.</div>
        </div>
      )}
      {sinDato.length > 0 && (
        <div className="card tight">
          <div className="small">
            <b>{sinDato.length} alimentos del plan de esta semana sin dato</b>
          </div>
          <div className="tiny muted">
            {sinDato
              .slice(0, 8)
              .map((f) => f.nombre.split(' (')[0])
              .join(', ')}
            {sinDato.length > 8 ? '…' : ''}. Dilo por voz (“hay 2 bandejas de pollo”) o tócalos en el recuento. Si no, la compra los pide enteros.
          </div>
        </div>
      )}
      <div className="row" style={{ gap: 6 }}>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…" />
        <button className="btn small soft" onClick={() => setAdding(true)}>
          ➕
        </button>
      </div>
      <div className="chips">
        {(
          [
            ['todo', 'Todo'],
            ['falta', '🟡🔴 Falta'],
            ['hay', '🟢 Hay'],
            ['sin', 'Sin dato'],
          ] as [Filtro, string][]
        ).map(([v, l]) => (
          <button key={v} className={`chip ${filtro === v ? 'on' : ''}`} onClick={() => setFiltro(v)}>
            {l}
          </button>
        ))}
      </div>
      {zonas.length === 0 && <div className="empty">Nada por aquí. Di lo que hay con 🎤 o haz un recuento en 🔎 Revisar.</div>}
      {zonas.map((z) => (
        <div key={z.id} className="card tight">
          <b className="small">
            {z.ico} {z.label} <span className="muted">({z.items.length})</span>
          </b>
          {z.items.map((it) => (
            <ItemRow key={it.id} it={it} s={states[it.id]} onOpen={() => onOpen(it)} />
          ))}
        </div>
      ))}
      {adding && (
        <Sheet title="➕ Añadir a la despensa" onClose={() => setAdding(false)}>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              const n = newName.trim();
              if (!n) return;
              const it: StockItem = { id: `c${Date.now().toString(36)}`, nombre: n, tipo: 'estado', unidad: 'ud', zona: 'otros', qty: 1, aprender: true, compras: [], creado: hoy };
              stockApply({ items: [it], events: [ev(it.id, 'nivel', { nivel: 'ok' }, 'manual')] });
              setNewName('');
              setAdding(false);
              onToast(`${n} añadido`);
              onOpen(it);
            }}
          >
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nombre (p. ej. velas)" />
            <button className="btn primary" type="submit">
              Añadir
            </button>
          </form>
          <div className="tiny muted">O busca el producto en Mercadona (así se puede cargar en el carrito):</div>
          <AddFromMercadona
            onAdded={(it) => {
              setAdding(false);
              onOpen(it);
            }}
          />
        </Sheet>
      )}
    </>
  );
}

function AddFromMercadona({ onAdded }: { onAdded: (it: StockItem) => void }) {
  const { stockApply } = useStore();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn small" onClick={() => setOpen(true)}>
        🔎 Buscar en Mercadona
      </button>
      {open && (
        <MercaProductPicker
          title="Producto de Mercadona"
          onClose={() => setOpen(false)}
          onPick={(p) => {
            const it: StockItem = { id: `m${p.id}`, nombre: p.nombre, product: p, tipo: 'estado', unidad: 'ud', zona: 'otros', qty: 1, aprender: true, compras: [], creado: todayKey() };
            stockApply({ items: [it], events: [ev(it.id, 'nivel', { nivel: 'ok' }, 'manual')] });
            setOpen(false);
            onAdded(it);
          }}
        />
      )}
    </>
  );
}

function ItemRow({ it, s, onOpen }: { it: StockItem; s?: ItemState; onOpen: () => void }) {
  const { data } = useStore();
  const p = itemProduct(data, it);
  const label =
    !s || s.fuente === 'desconocido'
      ? 'sin dato'
      : s.cantidad !== undefined && s.cantidad > 0
        ? amountText(it, s.cantidad, p)
        : s.nivel === 'ok'
          ? 'hay'
          : s.nivel === 'poco'
            ? 'queda poco'
            : 'no queda';
  return (
    <button className="row between small" style={{ background: 'none', border: 'none', borderTop: '1px solid var(--line)', padding: '6px 0', color: 'inherit', textAlign: 'left', width: '100%' }} onClick={onOpen}>
      <span className="grow" style={{ minWidth: 0 }}>
        {it.nombre}
        {it.apuntado && <span className="badge info"> 📝</span>}
        {it.reponer === 'nunca' && <span className="tiny muted"> 🚫</span>}
        {it.reponer === 'preguntar' && <span className="tiny muted"> ❓</span>}
      </span>
      <span className={`badge ${s && s.fuente !== 'desconocido' ? NIVEL_BADGE[s.nivel] : ''}`} style={{ whiteSpace: 'nowrap' }}>
        {label}
        {s?.fuente === 'estimado' && s.cantidad !== undefined ? ' ≈' : s?.fuente === 'previsto' ? ' ⏱' : ''}
      </span>
    </button>
  );
}

// ───────── revisar ─────────

function QuickRow({ it, s, onOpen, done }: { it: StockItem; s?: ItemState; onOpen: () => void; done?: boolean }) {
  const { data, fm, stockApply } = useStore();
  const p = itemProduct(data, it);
  const step = stepFor(it, it.foodId ? fm[it.foodId] : undefined, p);
  const put = (e: ReturnType<typeof ev>) => stockApply({ items: [it], events: [e] });
  const known = s && s.fuente !== 'desconocido';
  return (
    <div className="col" style={{ gap: 4, borderTop: '1px solid var(--line)', paddingTop: 6, opacity: done ? 0.55 : 1 }}>
      <button className="row between small" style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', textAlign: 'left' }} onClick={onOpen}>
        <span className="grow">
          {done ? '✓ ' : ''}
          <b>{it.nombre}</b>
        </span>
        <span className="tiny muted">
          {!known ? 'sin dato' : s!.cantidad !== undefined ? `¿${amountText(it, s!.cantidad, p)}?` : s!.nivel === 'ok' ? '¿hay?' : s!.nivel === 'poco' ? '¿queda poco?' : '¿no queda?'}
        </span>
      </button>
      <div className="btn-row" style={{ gap: 4 }}>
        {it.tipo === 'contado' ? (
          <>
            <button className="btn small" disabled={!known || s!.cantidad === undefined} onClick={() => put(ev(it.id, 'set', { valor: s!.cantidad }, 'revision'))}>
              ✅ Sí
            </button>
            <button className="btn small" disabled={!known || s!.cantidad === undefined} onClick={() => put(ev(it.id, 'set', { valor: Math.max(0, (s!.cantidad ?? 0) - step) }, 'revision'))}>
              −{it.unidad === 'ud' ? 1 : step}
            </button>
            <button className="btn small" onClick={() => put(ev(it.id, 'set', { valor: (known ? (s!.cantidad ?? 0) : 0) + step }, 'revision'))}>
              +{it.unidad === 'ud' ? 1 : step}
            </button>
            <button className="btn small" onClick={() => put(ev(it.id, 'nivel', { nivel: 'poco' }, 'revision'))}>
              🟡
            </button>
            <button className="btn small" onClick={() => put(ev(it.id, 'set', { valor: 0 }, 'revision'))}>
              🔴
            </button>
            <button className="btn small" onClick={onOpen}>
              ✏️
            </button>
          </>
        ) : (
          <>
            <button className="btn small" onClick={() => put(ev(it.id, 'nivel', { nivel: 'ok' }, 'revision'))}>
              🟢 Hay
            </button>
            <button className="btn small" onClick={() => put(ev(it.id, 'nivel', { nivel: 'poco' }, 'revision'))}>
              🟡 Poco
            </button>
            <button className="btn small" onClick={() => put(ev(it.id, 'nivel', { nivel: 'agotado' }, 'revision'))}>
              🔴 No
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ReviewView({ states, onOpen, onToast }: { states: Record<string, ItemState>; onOpen: (it: StockItem) => void; onToast: (t: string) => void }) {
  const { data, fm, stockApply } = useStore();
  const [mode, setMode] = useState<'rapida' | 'zona'>('rapida');
  const [zona, setZona] = useState<StockZone>(memo.zona ?? 'nevera');
  memo.zona = zona;
  // lo revisado en esta sesión (para marcarlo y para "el resto bien")
  const [vistos, setVistos] = useState<Set<string>>(new Set());
  const startRef = useRef(new Date().toISOString());
  const hoy = todayKey();
  const touchedNow = (id: string) => vistos.has(id) || data.stock.events.some((e) => e.item === id && e.at >= startRef.current);

  const candidates = useMemo(() => reviewCandidates(data, states), [data, states]);
  // en el recuento por zona entran también los alimentos del plan próximo sin artículo
  const zoneItems = useMemo(() => {
    const list = Object.values(data.stock.items).filter((it) => (it.zona ?? 'otros') === zona);
    const ids = new Set(list.map((i) => i.id));
    for (const m of plannedMeals(data.history, datesBetween(hoy, addDays(hoy, 6))))
      for (const x of m.meal.items) {
        const f = fm[x.foodId];
        if (f && !ids.has(f.id) && !data.stock.items[f.id]) {
          const it = foodItem(f, hoy);
          if (it.zona === zona) {
            ids.add(f.id);
            list.push(it);
          }
        }
      }
    return list.sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [data, fm, zona, hoy]);

  const restoBien = (list: StockItem[]) => {
    const pend = list.filter((it) => !touchedNow(it.id));
    const events = pend
      .map((it) => {
        const s = states[it.id];
        if (it.tipo === 'estado') return ev(it.id, 'nivel', { nivel: 'ok' }, 'revision');
        if (s && s.cantidad !== undefined) return ev(it.id, 'set', { valor: s.cantidad }, 'revision');
        return null;
      })
      .filter(Boolean) as ReturnType<typeof ev>[];
    stockApply({ events, config: { ultimaRevision: new Date().toISOString() } });
    setVistos(new Set([...vistos, ...pend.map((i) => i.id)]));
    onToast(`✅ ${events.length} confirmados${pend.length > events.length ? ` (${pend.length - events.length} sin dato: dilos con cantidad)` : ''}`);
  };

  return (
    <>
      <Segmented
        full
        value={mode}
        options={[
          { value: 'rapida', label: `⚡ Rápida (${candidates.length})` },
          { value: 'zona', label: '🗂️ Recuento por zona' },
        ]}
        onChange={setMode}
      />
      {mode === 'rapida' && (
        <div className="card">
          <div className="tiny muted">
            Lo que puede haberse desviado (estimado y sin contar desde hace días). Confirma o corrige con un toque; si todo cuadra, “Todo bien”.
          </div>
          {candidates.length === 0 && <div className="empty">✅ Nada que revisar ahora.</div>}
          {candidates.map((it) => (
            <QuickRow key={it.id} it={it} s={states[it.id]} onOpen={() => onOpen(it)} done={touchedNow(it.id)} />
          ))}
          {candidates.length > 0 && (
            <button className="btn primary" onClick={() => restoBien(candidates)}>
              ✅ El resto está bien
            </button>
          )}
        </div>
      )}
      {mode === 'zona' && (
        <div className="card">
          <div className="chips">
            {ZONES.map((z) => (
              <button key={z.id} className={`chip ${zona === z.id ? 'on' : ''}`} onClick={() => setZona(z.id)}>
                {z.ico} {z.label}
              </button>
            ))}
          </div>
          <div className="small">
            Mira en <b>{ZONES.find((z) => z.id === zona)!.label.toLowerCase()}</b> y dilo de una vez: <i>“hay 6 huevos, 2 leches, medio paquete de jamón, no queda queso, el resto bien”</i>.
          </div>
          <VoiceBar
            origen="revision"
            placeholder="Lo que no nombres se queda como está (o “el resto bien” para confirmarlo)."
            onDone={(o) => {
              setVistos(new Set([...vistos, ...o.changes.tocados]));
              if (o.restoOk) restoBien(zoneItems.filter((it) => !o.changes.tocados.includes(it.id)));
            }}
          />
          {zoneItems.length === 0 && <div className="empty">No hay nada en esta zona todavía. Dilo por voz y se irá llenando.</div>}
          {zoneItems.map((it) => (
            <QuickRow key={it.id} it={it} s={states[it.id]} onOpen={() => onOpen(it)} done={touchedNow(it.id)} />
          ))}
          {zoneItems.length > 0 && (
            <button className="btn primary" onClick={() => restoBien(zoneItems)}>
              ✅ El resto de {ZONES.find((z) => z.id === zona)!.label.toLowerCase()} está bien
            </button>
          )}
        </div>
      )}
    </>
  );
}

// ───────── compras y gasto ─────────

function ComprasView({ onToast }: { onToast: (t: string) => void }) {
  const { data, fm, stockApply } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pedidos = Object.values(data.stock.pedidos).sort((a, b) => b.entrega.localeCompare(a.entrega));
  const canRead = isNative() && !!loadSession();
  const carga = data.stock.config.ultimaCarga;
  const cargaRecibida = carga && pedidos.some((p) => p.aplicado && p.entrega >= carga.fecha);

  const meses = useMemo(() => {
    const by: Record<string, number> = {};
    for (const p of pedidos) if (p.total && !p.manual) by[p.entrega.slice(0, 7)] = (by[p.entrega.slice(0, 7)] ?? 0) + p.total;
    const keys = Object.keys(by).sort().slice(-6);
    return keys.map((k) => ({ mes: k, total: Math.round(by[k] * 100) / 100 }));
  }, [pedidos]);
  const max = Math.max(1, ...meses.map((m) => m.total));
  const tirados = data.stock.events.filter((e) => e.origen === 'tirado' && Date.now() - new Date(e.at).getTime() < 60 * 86400000);

  const comprobar = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await syncOrders(makeClient(data.mercadona.config), data, fm);
      stockApply(r.change);
      onToast(r.nuevos.length ? `📦 ${r.nuevos.length} pedido(s) sumados a la despensa` : 'No hay pedidos entregados nuevos');
    } catch (e) {
      setError(e instanceof MercaError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="card">
        <b>📦 Pedidos de Mercadona</b>
        <div className="tiny muted">
          Cuando un pedido se entrega, la app lee lo que se preparó de verdad (con faltas y sustituciones) y lo suma a la despensa sola, al abrirla.
        </div>
        {canRead ? (
          <button className="btn small" disabled={busy} onClick={comprobar}>
            {busy ? '⏳ Leyendo…' : '🔄 Comprobar ahora'}
          </button>
        ) : (
          <div className="tiny muted">Leer los pedidos necesita la app instalada con la cuenta de Mercadona vinculada.</div>
        )}
        {error && <Warnings items={[{ level: 'error', text: error }]} />}
        {carga && !cargaRecibida && (
          <div className="card tight">
            <div className="small">
              Última carga del carrito: {formatDay(carga.fecha.slice(0, 10))} ({carga.lineas.length} productos).
            </div>
            <button
              className="btn small"
              onClick={() => {
                const lines = carga.lineas.map((l) => ({
                  productId: l.productId,
                  quantity: l.quantity,
                  product: Object.values(data.stock.items).find((i) => i.product?.id === l.productId)?.product ?? Object.values(data.mercadona.links).find((x) => x.product.id === l.productId)?.product,
                }));
                stockApply(manualReceipt(data, fm, lines));
                onToast('Compra sumada a la despensa');
              }}
            >
              📥 Ya ha llegado (sumarla a mano)
            </button>
            <div className="tiny muted">Si luego se lee el pedido real, sustituye a esta suma.</div>
          </div>
        )}
        {pedidos.slice(0, 12).map((p) => (
          <div key={p.id} className="row between small" style={{ borderTop: '1px solid var(--line)', paddingTop: 6 }}>
            <span>
              {formatDay(p.entrega.slice(0, 10), { day: 'numeric', month: 'short', year: '2-digit' })}
              {p.manual ? ' · a mano' : ''}
              {p.resumen ? <span className="tiny muted"> · {p.resumen.alimentos + p.resumen.casa + p.resumen.nuevos} productos{p.resumen.faltas ? `, ${p.resumen.faltas} faltas` : ''}</span> : null}
            </span>
            <span>
              {p.total ? eur(p.total) : ''} {p.aplicado ? '✅' : <span className="tiny muted">historial</span>}
            </span>
          </div>
        ))}
      </div>
      {meses.length > 0 && (
        <div className="card">
          <b>💶 Gasto por mes</b>
          <div className="row" style={{ alignItems: 'flex-end', gap: 8, height: 120 }}>
            {meses.map((m) => (
              <div key={m.mes} className="col grow" style={{ alignItems: 'center', gap: 2 }}>
                <span className="tiny">{Math.round(m.total)} €</span>
                <div style={{ width: '100%', maxWidth: 40, height: Math.max(4, (m.total / max) * 80), background: 'var(--accent)', borderRadius: 4 }} />
                <span className="tiny muted">{new Date(m.mes + '-15').toLocaleDateString('es-ES', { month: 'short' })}</span>
              </div>
            ))}
          </div>
          <div className="tiny muted">Total de los pedidos de Mercadona (con envío).</div>
        </div>
      )}
      {tirados.length > 0 && (
        <div className="card tight">
          <b className="small">🗑️ Tirado en los últimos 2 meses ({tirados.length})</b>
          <div className="tiny muted">{[...new Set(tirados.map((e) => data.stock.items[e.item]?.nombre ?? e.item))].join(', ')}</div>
          <div className="tiny muted">Si algo se repite, compra menos o planifícalo antes en la semana.</div>
        </div>
      )}
    </>
  );
}

// ───────── ajustes ─────────

function AjustesView({ onToast }: { onToast: (t: string) => void }) {
  const { data, stockApply } = useStore();
  const cfg = data.stock.config;
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<typeof cfg>) => {
    stockApply({ config: patch });
    scheduleReminders({ ...data, stock: { ...data.stock, config: { ...cfg, ...patch } } }, todayKey());
  };
  return (
    <div className="card">
      <b>⚙️ Despensa</b>
      <label className="check small">
        <input type="checkbox" checked={cfg.autoPlan} onChange={(e) => set({ autoPlan: e.target.checked })} />
        Descontar las comidas registradas aunque no se confirmen (recomendado)
      </label>
      <div className="tiny muted">Si lo desactivas, solo descuentan los días que confirméis en el aviso de la noche.</div>
      <label className="check small">
        <input type="checkbox" checked={cfg.avisoNoche} onChange={(e) => set({ avisoNoche: e.target.checked })} />
        Aviso por la noche: “¿habéis comido lo planificado?”
      </label>
      {cfg.avisoNoche && (
        <label className="field">
          Hora del aviso
          <select value={cfg.horaNoche} onChange={(e) => set({ horaNoche: Number(e.target.value) })}>
            {[20, 21, 22, 23].map((h) => (
              <option key={h} value={h}>
                {h}:00
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="check small">
        <input type="checkbox" checked={cfg.avisoRevision} onChange={(e) => set({ avisoRevision: e.target.checked })} />
        Aviso semanal de revisión rápida (1 minuto)
      </label>
      <div className="tiny muted">
        Llevando la despensa desde: <b>{cfg.desde ? new Date(cfg.desde).toLocaleDateString('es-ES') : '—'}</b> · {Object.keys(data.stock.items).length} artículos ·{' '}
        {data.stock.events.length} movimientos
      </div>
      <div className="btn-row">
        <button className="btn small" onClick={() => fileRef.current?.click()}>
          📥 Importar inventario (Despensa)
        </button>
        <button
          className="btn small danger"
          onClick={() => {
            if (!confirm('¿Vaciar la despensa? Se borran los artículos y movimientos (también en el otro móvil).')) return;
            stockApply({ removeItems: Object.keys(data.stock.items), removeEvents: data.stock.events.map((e) => e.id), config: { desde: new Date().toISOString() } });
            onToast('Despensa vaciada');
          }}
        >
          Vaciar despensa
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            const json = JSON.parse(await f.text()) as { formato?: string; creado?: string; items?: StockItem[]; events?: ReturnType<typeof ev>[] };
            if (json.formato !== 'despensa-v1' || !Array.isArray(json.items)) throw new Error('Archivo no válido');
            // el inventario cuenta desde que se exportó (las comidas desde entonces lo descuentan)
            const desde = [cfg.desde, json.creado].filter(Boolean).sort()[0] ?? new Date().toISOString();
            stockApply({ items: json.items, events: json.events ?? [], config: { desde } });
            onToast(`📥 ${json.items.length} artículos importados`);
          } catch (err) {
            onToast(`No se pudo importar: ${(err as Error).message}`);
          }
        }}
      />
    </div>
  );
}

export type CasaView = View | 'voz';
