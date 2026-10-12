import { useMemo, useState } from 'react';
import type { Food } from '../types';
import { useStore } from '../store/AppStore';
import { bestMatch, queryFor, sizeText } from '../integrations/mercadona/basket';
import { makeClient } from '../integrations/mercadona/service';
import { MercaError } from '../integrations/mercadona/client';
import { MercaLinkSheet } from '../components/MercaLinkSheet';
import { CATEGORY_ICONS, Warnings } from '../components/ui';

type Filtro = 'sin' | 'sugeridos' | 'vinculados' | 'otra' | 'todos';
const memo: { filtro: Filtro } = { filtro: 'sin' };
const eur = (n: number) => n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });

/** Todos los alimentos de la app con su producto de Mercadona: vincular, confirmar o cambiar uno a uno, o proponer todos. */
export function MercaLinksManager({ onToast }: { onToast: (t: string) => void }) {
  const { data, activeFoods, setMercaLink, setMercaConfig } = useStore();
  const [filtro, setFiltro] = useState<Filtro>(memo.filtro);
  memo.filtro = filtro;
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Food | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const links = data.mercadona.links;
  const otra = data.mercadona.config.otraTienda ?? [];

  const counts = useMemo(() => {
    let sin = 0;
    let sug = 0;
    let vin = 0;
    for (const f of activeFoods) {
      if (otra.includes(f.id)) continue;
      const l = links[f.id];
      if (!l) sin++;
      else if (!l.confirmado) sug++;
      else vin++;
    }
    return { sin, sug, vin, otra: otra.length };
  }, [activeFoods, links, otra]);

  const list = activeFoods
    .filter((f) => {
      if (q && !f.nombre.toLowerCase().includes(q.toLowerCase()) && !links[f.id]?.product.nombre.toLowerCase().includes(q.toLowerCase())) return false;
      const l = links[f.id];
      const o = otra.includes(f.id);
      if (filtro === 'otra') return o;
      if (o) return filtro === 'todos';
      if (filtro === 'sin') return !l;
      if (filtro === 'sugeridos') return !!l && !l.confirmado;
      if (filtro === 'vinculados') return !!l && l.confirmado;
      return true;
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  /** Propone producto a todos los que no tienen (en tandas, quedan "sugeridos" hasta confirmarlos) */
  const proponer = async () => {
    const foods = activeFoods.filter((f) => !links[f.id] && !otra.includes(f.id));
    if (!foods.length) return;
    setError(null);
    const client = makeClient(data.mercadona.config);
    let n = 0;
    try {
      for (let i = 0; i < foods.length; i += 15) {
        const chunk = foods.slice(i, i + 15);
        setBusy(`Buscando productos… ${Math.min(i + 15, foods.length)}/${foods.length}`);
        const res = await client.batchSearch(chunk.map(queryFor), 8);
        chunk.forEach((f, j) => {
          const p = bestMatch(f, (res[j] ?? []).map((h) => h.product));
          if (p) {
            setMercaLink(f.id, { foodId: f.id, product: p, confirmado: false });
            n++;
          }
        });
      }
      onToast(`${n} productos propuestos de ${foods.length}: revisa los “sugeridos”`);
      if (n) setFiltro('sugeridos');
    } catch (e) {
      setError(e instanceof MercaError ? e.message : (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const confirmarTodos = () => {
    const sug = activeFoods.filter((f) => links[f.id] && !links[f.id].confirmado);
    sug.forEach((f) => setMercaLink(f.id, { ...links[f.id], confirmado: true }));
    onToast(`${sug.length} productos confirmados`);
  };

  return (
    <div className="card">
      <b>3 · Alimentos ↔ productos de Mercadona</b>
      <div className="tiny muted">
        Cada alimento de la app con su producto de Mercadona: así la cesta calcula paquetes y precios, y la despensa cuenta por bolsas, bandejas… Se comparte
        con el otro móvil.
      </div>
      <div className="chips">
        {(
          [
            ['sin', `Sin vincular (${counts.sin})`],
            ['sugeridos', `Sugeridos (${counts.sug})`],
            ['vinculados', `Vinculados (${counts.vin})`],
            ['otra', `🏪 Otra tienda (${counts.otra})`],
            ['todos', 'Todos'],
          ] as [Filtro, string][]
        ).map(([v, l]) => (
          <button key={v} className={`chip ${filtro === v ? 'on' : ''}`} onClick={() => setFiltro(v)}>
            {l}
          </button>
        ))}
      </div>
      <div className="btn-row">
        {counts.sin > 0 && (
          <button className="btn small soft" disabled={!!busy} onClick={proponer}>
            ✨ Proponer para los {counts.sin} sin vincular
          </button>
        )}
        {counts.sug > 0 && filtro === 'sugeridos' && (
          <button className="btn small" onClick={confirmarTodos}>
            ✓ Confirmar los {counts.sug} sugeridos
          </button>
        )}
      </div>
      {busy && <div className="sub">⏳ {busy}</div>}
      {error && <Warnings items={[{ level: 'error', text: error }]} />}
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar alimento o producto…" />
      <div className="list">
        {list.map((f) => {
          const l = links[f.id];
          const o = otra.includes(f.id);
          return (
            <div key={f.id} className="list-item" style={{ alignItems: 'center' }}>
              <button className="food-name grow" style={{ minWidth: 0, textAlign: 'left' }} onClick={() => setOpen(f)}>
                <span className="n small">
                  {CATEGORY_ICONS[f.categoria]} {f.nombre.split(' (')[0]} {l && !l.confirmado && <span className="badge warn">sugerido</span>}
                </span>
                <span className="tiny muted">
                  {o ? (
                    '🏪 Se compra en otra tienda'
                  ) : l ? (
                    <>
                      → {l.product.nombre} · {l.product.formato ? `${l.product.formato.toLowerCase()} ` : ''}
                      {sizeText(l.product)} · {eur(l.product.unitPrice)}
                    </>
                  ) : (
                    <span style={{ color: 'var(--warn)' }}>Sin producto: toca para elegirlo</span>
                  )}
                </span>
              </button>
              <button
                className="iconbtn"
                title={o ? 'Comprar en Mercadona' : 'Se compra en otra tienda'}
                onClick={() => setMercaConfig({ otraTienda: o ? otra.filter((x) => x !== f.id) : [...otra, f.id] })}
              >
                {o ? '↺' : '🏪'}
              </button>
            </div>
          );
        })}
        {list.length === 0 && <div className="empty">Nada en este filtro.</div>}
      </div>
      {open && <MercaLinkSheet food={open} onClose={() => setOpen(null)} onToast={onToast} />}
    </div>
  );
}
