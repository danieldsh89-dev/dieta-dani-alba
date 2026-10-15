import { useMemo, useState } from 'react';
import type { StockItem } from '../types';
import { useStore } from '../store/AppStore';
import { todayKey } from '../lib/day';
import { addDays, formatDay, weekStart } from '../lib/planning';
import { caducanPronto, casaItem, computeStock, foodItem, matchByName, reviewCandidates, zoneFor, type ItemState } from '../lib/stock';
import { comprados, listaCompra, listaTexto, ORIGEN_TEXTO, porPasillo, type Entrada, type Origen } from '../lib/compra';
import { apuntar, posponer } from '../integrations/mercadona/habituales';
import { isNative } from '../integrations/mercadona/http';
import { loadSession } from '../integrations/mercadona/session';
import { VoiceBar } from '../components/VoiceBar';
import { Icon } from '../components/icons';
import { shareText } from './SyncScreen';
import { calcCesta } from './MercaBasket';

const eur = (n: number) => n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });

// ───────── fechas que cubre la compra (compartidas por Lista y Carrito) ─────────

const rango: { from?: string; to?: string } = {};

/** Para cuándo es la compra: por defecto, de hoy al domingo. Se recuerda mientras la app está abierta. */
export function useRangoCompra(): { from: string; to: string; set: (f: string, t: string) => void } {
  const hoy = todayKey();
  const [r, setR] = useState(() => {
    const from = rango.from && rango.from >= hoy ? rango.from : hoy;
    const to = rango.to && rango.to >= from ? rango.to : addDays(weekStart(hoy), 6);
    return { from, to };
  });
  return {
    ...r,
    set: (from, to) => {
      rango.from = from;
      rango.to = to;
      setR({ from, to });
    },
  };
}

export function RangoCompra({ from, to, set }: { from: string; to: string; set: (f: string, t: string) => void }) {
  const hoy = todayKey();
  const [fechas, setFechas] = useState(false);
  const presets = [
    { label: 'Hasta el domingo', f: hoy, t: addDays(weekStart(hoy), 6) },
    { label: '7 días', f: hoy, t: addDays(hoy, 6) },
    { label: '14 días', f: hoy, t: addDays(hoy, 13) },
    { label: 'Semana que viene', f: addDays(weekStart(hoy), 7), t: addDays(weekStart(hoy), 13) },
  ];
  const corto = { day: 'numeric', month: 'short' } as const;
  return (
    <div className="rango">
      <div className="rango-head">
        <span className="eyebrow">Compra para</span>
        <button className="btn link small" onClick={() => setFechas(!fechas)}>
          {formatDay(from, { weekday: 'short', ...corto })} – {formatDay(to, { weekday: 'short', ...corto })}
        </button>
      </div>
      <div className="chips scroll-x">
        {presets.map((p) => (
          <button key={p.label} className={`chip ${from === p.f && to === p.t ? 'on' : ''}`} onClick={() => set(p.f, p.t)}>
            {p.label}
          </button>
        ))}
        <button className={`chip ${fechas ? 'on' : ''}`} onClick={() => setFechas(!fechas)}>
          Fechas…
        </button>
      </div>
      {fechas && (
        <div className="grid2">
          <label className="field">
            Desde
            <input type="date" value={from} onChange={(e) => e.target.value && set(e.target.value, to < e.target.value ? e.target.value : to)} />
          </label>
          <label className="field">
            Hasta
            <input type="date" value={to} onChange={(e) => e.target.value && set(from, e.target.value)} />
          </label>
        </div>
      )}
    </div>
  );
}

// ───────── portada de Casa ─────────

export type CasaDestino = 'stock' | 'falta' | 'lista' | 'carrito' | 'gasto' | 'revisar' | 'ajustes' | 'mercadona';

export function ResumenView({
  from,
  to,
  states,
  autoVoz,
  onGo,
}: {
  from: string;
  to: string;
  states: Record<string, ItemState>;
  autoVoz?: boolean;
  onGo: (d: CasaDestino) => void;
}) {
  const { data, fm, cm } = useStore();
  const hoy = todayKey();
  const lista = useMemo(() => listaCompra(data, fm, cm, states, from, to, hoy), [data, fm, cm, states, from, to, hoy]);
  const cesta = useMemo(() => calcCesta(data, fm, cm, states, from, to), [data, fm, cm, states, from, to]);
  const items = Object.values(data.stock.items);
  let agotado = 0;
  let poco = 0;
  for (const it of items) {
    const s = states[it.id];
    if (!s || s.fuente === 'desconocido') continue;
    if (s.nivel === 'agotado') agotado++;
    else if (s.nivel === 'poco') poco++;
  }
  const caducan = caducanPronto(data, states, hoy);
  const revisar = reviewCandidates(data, states).length;
  const marcados = lista.entradas.filter((e) => data.shoppingChecked.includes(e.key)).length;
  const ultimo = Object.values(data.stock.pedidos).sort((a, b) => b.entrega.localeCompare(a.entrega))[0];
  const vinculada = isNative() && !!loadSession();
  const corto = { day: 'numeric', month: 'short' } as const;

  return (
    <>
      <section className="card casa-hero">
        <h3 className="block-name">¿Qué hay en casa?</h3>
        <VoiceBar big autoStart={autoVoz} />
      </section>

      <div className="tiles">
        <button className="tile accent" onClick={() => onGo('lista')}>
          <span className="tile-k">Para comprar</span>
          <span className="tile-v">{lista.entradas.length}</span>
          <span className="tile-s">{marcados ? `${marcados} ya en el carro` : `hasta el ${formatDay(to, corto)}`}</span>
        </button>
        <button className="tile" onClick={() => onGo('carrito')}>
          <span className="tile-k">Carrito Mercadona</span>
          <span className="tile-v">{cesta.total > 0 ? eur(cesta.total) : '—'}</span>
          <span className="tile-s">{cesta.nProductos} productos</span>
        </button>
        <button className="tile" onClick={() => onGo('falta')}>
          <span className="tile-k">Se acaban</span>
          <span className="tile-v">{agotado + poco}</span>
          <span className="tile-s">{agotado + poco ? `${agotado} agotados · ${poco} poco` : 'todo bien'}</span>
        </button>
        <button className="tile" onClick={() => onGo('stock')}>
          <span className="tile-k">Caducan pronto</span>
          <span className="tile-v">{caducan.length}</span>
          <span className="tile-s">{caducan.length ? caducan.slice(0, 2).map((i) => i.nombre).join(', ') : 'nada en 3 días'}</span>
        </button>
      </div>

      <div className="list">
        <button className="list-item" onClick={() => onGo('revisar')}>
          <div className="thumb tint">🔎</div>
          <div className="grow">
            <div className="ttl">Revisar la despensa</div>
            <div className="sub">{revisar ? `${revisar} ${revisar === 1 ? 'cosa' : 'cosas'} por confirmar · 1 minuto` : 'Todo al día · recuento por zonas'}</div>
          </div>
          <span className="list-chev">
            <Icon name="chevron" size={18} />
          </span>
        </button>
        <button className="list-item" onClick={() => onGo('gasto')}>
          <div className="thumb tint">📦</div>
          <div className="grow">
            <div className="ttl">Pedidos y gasto</div>
            <div className="sub">{ultimo ? `Último: ${formatDay(ultimo.entrega.slice(0, 10), corto)}${ultimo.total ? ` · ${eur(ultimo.total)}` : ''}` : 'Pedidos de Mercadona, gasto por mes y lo tirado'}</div>
          </div>
          <span className="list-chev">
            <Icon name="chevron" size={18} />
          </span>
        </button>
        <button className="list-item" onClick={() => onGo('mercadona')}>
          <div className="thumb tint">
            <Icon name="cart" size={20} />
          </div>
          <div className="grow">
            <div className="ttl">Cuenta de Mercadona</div>
            <div className="sub">{vinculada ? 'Vinculada · entrega, productos y diagnóstico' : 'Vincular, entrega, productos y diagnóstico'}</div>
          </div>
          <span className="list-chev">
            <Icon name="chevron" size={18} />
          </span>
        </button>
        <button className="list-item" onClick={() => onGo('ajustes')}>
          <div className="thumb tint">⚙️</div>
          <div className="grow">
            <div className="ttl">Ajustes de la despensa</div>
            <div className="sub">Avisos, descontar comidas, importar o vaciar</div>
          </div>
          <span className="list-chev">
            <Icon name="chevron" size={18} />
          </span>
        </button>
      </div>
    </>
  );
}

// ───────── lista de la compra ─────────

const ORIGEN_BADGE: Record<Origen, string> = { plan: 'ok', apuntado: 'info', acaba: 'bad', toca: 'warn' };
const ORIGEN_ICO: Record<Origen, string> = { plan: '🍽️', apuntado: '✍️', acaba: '📉', toca: '🔁' };
const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export function ListaCompraView({
  from,
  to,
  onToast,
  onOpenItem,
  onCarrito,
}: {
  from: string;
  to: string;
  onToast: Toaster;
  onOpenItem: (it: StockItem) => void;
  onCarrito: () => void;
}) {
  const { data, fm, cm, stockApply, setShoppingChecked, setPantry } = useStore();
  const hoy = todayKey();
  const states = useMemo(() => computeStock(data, fm, cm), [data, fm, cm]);
  const l = useMemo(() => listaCompra(data, fm, cm, states, from, to, hoy), [data, fm, cm, states, from, to, hoy]);
  const [verCasa, setVerCasa] = useState(false);
  const [nuevo, setNuevo] = useState('');
  const checked = data.shoppingChecked;
  const marcadas = l.entradas.filter((e) => checked.includes(e.key));
  const pendientes = l.entradas.length - marcadas.length;
  const titulo = `🛒 Compra ${formatDay(from, { day: 'numeric', month: 'short' })} – ${formatDay(to, { day: 'numeric', month: 'short' })}`;

  const itemDe = (e: Entrada): StockItem | undefined => data.stock.items[e.key] ?? (e.foodId && fm[e.foodId] ? foodItem(fm[e.foodId], hoy) : undefined);
  const toggle = (k: string) => setShoppingChecked(checked.includes(k) ? checked.filter((x) => x !== k) : [...checked, k]);
  const save = (it: StockItem) => stockApply({ items: [it] });

  /** Quitar de esta compra: lo del plan → "lo tengo en casa"; lo de casa → hasta la próxima */
  const quitar = (e: Entrada) => {
    const it = data.stock.items[e.key];
    if (e.origen === 'plan') {
      const prev = data.pantry;
      setPantry([...new Set([...prev, e.key])]);
      onToast(`${e.nombre}: lo tienes en casa`, () => setPantry(prev));
    } else if (it) {
      save(e.foodId ? { ...it, apuntado: false } : posponer(it, to));
      onToast(`${e.nombre}: fuera de esta compra`, () => save(it));
    }
  };

  const apuntarTexto = (texto: string) => {
    const t = texto.trim();
    if (!t) return;
    const prev = matchByName(t, Object.values(data.stock.items));
    if (prev) {
      save(apuntar(prev));
      onToast(`📝 ${prev.nombre}: apuntado`);
    } else {
      // algo nuevo: si se acaba, se preguntará antes de volver a comprarlo
      save(casaItem(capitalize(t), hoy, { apuntado: true, reponer: 'preguntar', zona: zoneFor(t) }));
      onToast(`📝 ${capitalize(t)}: apuntado`);
    }
    setNuevo('');
  };

  const marcarComprado = () => {
    const prevChecked = checked;
    if (data.stock.config.desde) {
      const r = comprados(data, fm, marcadas, hoy);
      const nuevos = r.items.filter((i) => !data.stock.items[i.id]).map((i) => i.id);
      const antes = r.items.map((i) => data.stock.items[i.id]).filter(Boolean) as StockItem[];
      stockApply(r);
      setShoppingChecked(checked.filter((k) => !marcadas.some((e) => e.key === k)));
      onToast(`✓ ${marcadas.length} comprados: sumados a la despensa`, () => {
        stockApply({ items: antes, removeItems: nuevos, removeEvents: r.events.map((e) => e.id) });
        setShoppingChecked(prevChecked);
      });
    } else {
      // sin despensa en marcha: los alimentos pasan a "tengo en casa"
      const prevPantry = data.pantry;
      setPantry([...new Set([...data.pantry, ...marcadas.filter((e) => e.foodId).map((e) => e.key)])]);
      setShoppingChecked(checked.filter((k) => !marcadas.some((e) => e.key === k)));
      onToast('Marcados como "en casa"', () => {
        setPantry(prevPantry);
        setShoppingChecked(prevChecked);
      });
    }
  };

  return (
    <>
      <div className="card tight lista-head">
        <div className="row between">
          <span>
            <b className="lista-num">{pendientes}</b> <span className="muted small">por comprar</span>
          </span>
          {marcadas.length > 0 && <span className="badge ok">✓ {marcadas.length} en el carro</span>}
        </div>
        {l.entradas.length > 0 && (
          <div className="progress">
            <div style={{ width: `${(marcadas.length / l.entradas.length) * 100}%` }} />
          </div>
        )}
        <form
          className="row"
          style={{ gap: 6 }}
          onSubmit={(ev) => {
            ev.preventDefault();
            apuntarTexto(nuevo);
          }}
        >
          <input type="text" value={nuevo} onChange={(e) => setNuevo(e.target.value)} placeholder="Apuntar algo (p. ej. servilletas)" aria-label="Apuntar algo" />
          <button className="btn soft" type="submit" disabled={!nuevo.trim()} aria-label="Apuntar">
            <Icon name="plus" size={18} />
          </button>
        </form>
      </div>

      {l.entradas.length === 0 && (
        <div className="empty">
          No falta nada para estas fechas. Planifica comidas en Plan, o apunta lo que necesites arriba o por voz (“apunta detergente”).
        </div>
      )}

      {porPasillo(l.entradas).map((g) => (
        <section key={g.pasillo} className="list-section">
          <h3 className="eyebrow">
            {g.pasillo} <span className="muted">· {g.entradas.length}</span>
          </h3>
          <div className="list">
            {g.entradas.map((e) => {
              const on = checked.includes(e.key);
              const it = itemDe(e);
              return (
                <div key={e.key} className={`list-item compra-row ${on ? 'done' : ''}`}>
                  <input type="checkbox" className="compra-check" checked={on} onChange={() => toggle(e.key)} aria-label={`${e.nombre}: en el carro`} />
                  <button className="food-name grow" onClick={() => it && onOpenItem(it)}>
                    <span className="n">{e.nombre}</span>
                    <span className="tiny muted compra-meta">
                      <span className={`badge ${ORIGEN_BADGE[e.origen]}`}>
                        {ORIGEN_ICO[e.origen]} {ORIGEN_TEXTO[e.origen]}
                      </span>
                      {e.detalle && <span>{e.detalle}</span>}
                    </span>
                  </button>
                  {e.cantidad && <b className="small compra-qty">{e.cantidad}</b>}
                  <button className="rm" onClick={() => quitar(e)} title={e.origen === 'plan' ? 'Ya lo tengo en casa' : 'Quitar de esta compra'} aria-label="Quitar de esta compra">
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {l.preguntas.length > 0 && (
        <div className="card tight">
          <b className="small">❓ ¿Volver a comprar? ({l.preguntas.length})</b>
          <div className="tiny muted">Se han acabado, pero no son habituales (p. ej., los comprasteis para probar).</div>
          {l.preguntas.map((it) => (
            <div key={it.id} className="col" style={{ gap: 5, borderTop: '1px solid var(--line)', paddingTop: 7 }}>
              <span className="small">
                <b>{it.nombre}</b>
              </span>
              <div className="btn-row" style={{ gap: 5 }}>
                <button className="btn small primary" onClick={() => (save({ ...apuntar(it), reponer: 'habitual' }), onToast(`${it.nombre}: habitual`))}>
                  🔁 Sí, siempre
                </button>
                <button className="btn small" onClick={() => save({ ...apuntar(it), soloEstaVez: true })}>
                  Solo esta vez
                </button>
                <button className="btn small" onClick={() => (save({ ...it, reponer: 'nunca', apuntado: false }), onToast(`${it.nombre}: no se repondrá`))}>
                  🚫 No
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {l.sugerencias.length > 0 && (
        <div className="card tight">
          <b className="small">📉 Se acaban y no están en el plan ({l.sugerencias.length})</b>
          <div className="tiny muted">Alimentos de la dieta que se han acabado o quedan pocos. Añádelos si los queréis tener.</div>
          {l.sugerencias.map((it) => (
            <div key={it.id} className="row between small" style={{ borderTop: '1px solid var(--line)', paddingTop: 6 }}>
              <button className="food-name grow" onClick={() => onOpenItem(it)}>
                <span className="n">{it.nombre}</span>
                <span className="tiny muted">{states[it.id]?.nivel === 'agotado' ? 'no queda' : 'queda poco'}</span>
              </button>
              <button className="btn small soft" onClick={() => (save(apuntar(it)), onToast(`📝 ${it.nombre}: apuntado`))}>
                <Icon name="plus" size={15} /> Añadir
              </button>
              <button className="rm" title="Ahora no" aria-label="Ahora no" onClick={() => save(posponer(it, to))}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {l.enCasa.length > 0 && (
        <div className="card tight">
          <button className="row between small" style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', width: '100%', cursor: 'pointer' }} onClick={() => setVerCasa(!verCasa)}>
            <b>🏠 Para el plan, ya lo tenéis ({l.enCasa.length})</b>
            <span className="muted">{verCasa ? '▲' : '▼'}</span>
          </button>
          {verCasa &&
            l.enCasa.map((e) => (
              <div key={e.key} className="row between small" style={{ borderTop: '1px solid var(--line)', paddingTop: 6 }}>
                <span className="grow">
                  {e.nombre} <span className="tiny muted">· {e.cantidad}</span>
                </span>
                {data.pantry.includes(e.key) ? (
                  <button className="btn small" onClick={() => setPantry(data.pantry.filter((x) => x !== e.key))}>
                    ↺ Comprar
                  </button>
                ) : (
                  <span className="badge ok">en la despensa</span>
                )}
              </div>
            ))}
        </div>
      )}

      <div className="lista-actions">
        <button className="btn primary" disabled={!marcadas.length} onClick={marcarComprado}>
          ✓ Comprado → despensa{marcadas.length ? ` (${marcadas.length})` : ''}
        </button>
        <button className="btn" onClick={onCarrito}>
          <Icon name="cart" size={18} /> Pasar al carrito
        </button>
        <button
          className="btn"
          disabled={!l.entradas.length}
          onClick={async () => {
            const r = await shareText(listaTexto(l.entradas, titulo, checked), titulo);
            onToast(r === 'copied' ? 'Lista copiada' : r === 'shared' ? 'Lista compartida' : 'No se pudo compartir');
          }}
        >
          📤 Compartir
        </button>
        {marcadas.length > 0 && (
          <button className="btn link" onClick={() => setShoppingChecked(checked.filter((k) => !marcadas.some((e) => e.key === k)))}>
            Desmarcar todo
          </button>
        )}
      </div>
      <div className="tiny muted">
        Las cantidades son para los dos, tal como se compran (en crudo / seco / congelado). Las especias no aparecen. Toca un producto para ver su ficha.
      </div>
    </>
  );
}
