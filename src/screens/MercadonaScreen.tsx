import { useState } from 'react';
import { useStore } from '../store/AppStore';
import { DEFAULT_ALGOLIA, DEFAULT_X_VERSION, MercaError } from '../integrations/mercadona/client';
import { diagnose, makeClient, type DiagStep } from '../integrations/mercadona/service';
import { isNative } from '../integrations/mercadona/http';
import { clearSession, decodeLinkCode, loadSession, saveSession, type MercaSession } from '../integrations/mercadona/session';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { NumberInput, Warnings } from '../components/ui';

const fecha = (iso?: string) => (iso ? new Date(iso).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

export function MercadonaScreen({ onToast }: { onToast: (t: string) => void }) {
  const { data, setMercaConfig, setMercaLink } = useStore();
  const cfg = data.mercadona.config;
  const native = isNative();
  const [session, setSession] = useState<MercaSession | undefined>(loadSession());
  const [cp, setCp] = useState(cfg.cp ?? '');
  const [code, setCode] = useState('');
  const [scan, setScan] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diag, setDiag] = useState<DiagStep[] | null>(null);
  const [adv, setAdv] = useState(false);
  const [links, setLinks] = useState(false);
  const linked = Object.values(data.mercadona.links);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof MercaError ? `${e.message}${e.status ? ` (HTTP ${e.status})` : ''}` : (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  /** Vincular con el código del PC: se prueba renovando la sesión antes de guardarla */
  const vincular = (text: string) =>
    run('Comprobando la cuenta…', async () => {
      const s = decodeLinkCode(text);
      if (!s) throw new Error('Código no válido. Debe empezar por MERCA1: (o ser el token de renovación).');
      const c = makeClient(cfg);
      c.session = s;
      // en el APK se comprueba de verdad: renovando (o leyendo el carrito si solo hay token de acceso)
      let ok = s;
      if (native) {
        if (s.refreshToken) ok = await c.refresh();
        else await c.getCart();
      }
      saveSession(ok);
      setSession(ok);
      setCode('');
      onToast('Cuenta de Mercadona vinculada ✔');
    });

  return (
    <div className="screen">
      <div className="card">
        <h3>🛒 Compra en Mercadona</h3>
        <div className="sub">
          Convierte la lista de la compra del plan en productos de Mercadona y la carga en tu carrito. <b>Nunca hace el pedido ni paga</b>: eso lo
          haces tú en Mercadona.
        </div>
        <Warnings
          items={[
            {
              level: 'info',
              text: 'Usa la API no oficial de la tienda online de Mercadona: puede cambiar o dejar de funcionar sin aviso. Si falla, tienes la lista para copiar y el diagnóstico de abajo.',
            },
          ]}
        />
        {!native && <Warnings items={['Estás en la versión web: aquí funciona la búsqueda y la cesta con precios, pero vincular la cuenta y cargar el carrito solo funcionan en la app instalada (APK).']} />}
      </div>

      <div className="card">
        <b>1 · Entrega</b>
        <div className="row">
          <label className="field grow">
            Código postal
            <input type="text" inputMode="numeric" value={cp} onChange={(e) => setCp(e.target.value.replace(/\D/g, '').slice(0, 5))} />
          </label>
          <button
            className="btn"
            style={{ alignSelf: 'flex-end' }}
            disabled={!native || cp.length !== 5 || !!busy}
            onClick={() =>
              run('Comprobando reparto…', async () => {
                const wh = await makeClient(cfg).resolveWarehouse(cp);
                setMercaConfig({ cp, wh });
                onToast(`Hay reparto en ${cp} (almacén ${wh})`);
              })
            }
          >
            Comprobar
          </button>
        </div>
        <div className="tiny muted">
          Almacén: <b>{cfg.wh ?? '—'}</b> (los productos y precios dependen de él). CP {cfg.cp}.
        </div>
        <label className="field">
          Tope de gasto al cargar el carrito (€)
          <NumberInput value={cfg.maxEur} allowEmpty step={10} onChange={(v) => setMercaConfig({ maxEur: v })} />
        </label>
      </div>

      <div className="card">
        <b>2 · Tu cuenta (una sola vez)</b>
        {session ? (
          <>
            <div className="small">
              ✅ Vinculada el {fecha(session.vinculado)} · última renovación {fecha(session.renovado)}
            </div>
            <div className="tiny muted">
              La app renueva la sesión sola cada vez que la usa. Solo tendrás que repetir la vinculación si Mercadona cierra tu sesión (por
              ejemplo, si cambias la contraseña o cierras sesión en todos los dispositivos). El acceso se guarda solo en este móvil.
            </div>
            <div className="btn-row">
              <button
                className="btn small"
                disabled={!native || !!busy}
                onClick={() =>
                  run('Probando…', async () => {
                    const c = makeClient(cfg);
                    const cart = await c.getCart();
                    setSession(loadSession());
                    onToast(`Cuenta OK · ${cart.lines.length} productos en tu carrito`);
                  })
                }
              >
                Probar conexión
              </button>
              <button
                className="btn small danger"
                onClick={() => {
                  clearSession();
                  setSession(undefined);
                  onToast('Cuenta desvinculada de este móvil');
                }}
              >
                Desvincular
              </button>
            </div>
          </>
        ) : (
          <>
            <ol className="small" style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <li>
                En el <b>PC</b>, abre Chrome en <b>tienda.mercadona.es</b>, pulsa <b>F12</b> → pestaña <b>Network</b> (Red) y luego inicia sesión
                normalmente.
              </li>
              <li>
                Con la sesión iniciada, en Network: clic derecho → <b>“Save all as HAR”</b> (Guardar todo como HAR).
              </li>
              <li>
                En la carpeta del proyecto ejecuta <code>npm run mercadona:vincular -- ruta\al\archivo.har</code>. Se abre una página con un QR.
              </li>
              <li>Aquí pulsa “Escanear QR” (o pega el código que también te muestra).</li>
            </ol>
            <div className="btn-row">
              <button className="btn primary" disabled={!native || !!busy} onClick={() => setScan(true)}>
                📷 Escanear QR del PC
              </button>
            </div>
            <label className="field">
              …o pega el código de vinculación
              <textarea rows={3} value={code} onChange={(e) => setCode(e.target.value)} placeholder="MERCA1:…" />
            </label>
            <button className="btn" disabled={!code.trim() || !!busy || !native} onClick={() => vincular(code)}>
              Vincular
            </button>
            <div className="tiny muted">
              El código equivale a tu sesión de Mercadona: no lo compartas. Borra el archivo HAR del PC después; contiene tu sesión.
            </div>
          </>
        )}
      </div>

      {busy && <div className="sub">⏳ {busy}</div>}
      {error && <Warnings items={[{ level: 'error', text: error }]} />}

      <div className="card">
        <div className="row between">
          <b>3 · Productos vinculados ({linked.length})</b>
          <button className="btn small" onClick={() => setLinks(!links)}>
            {links ? 'Ocultar' : 'Ver'}
          </button>
        </div>
        <div className="tiny muted">Se eligen la primera vez desde Plan → Compra → 🛒 Mercadona y se reutilizan siempre.</div>
        {links &&
          linked
            .sort((a, b) => a.product.nombre.localeCompare(b.product.nombre))
            .map((l) => (
              <div key={l.foodId} className="row between small" style={{ borderTop: '1px solid var(--line)', paddingTop: 6 }}>
                <span className="grow">
                  <b>{data.foods.find((f) => f.id === l.foodId)?.nombre.split(' (')[0] ?? l.foodId}</b> → {l.product.nombre}{' '}
                  {!l.confirmado && <span className="badge warn">sugerido</span>}
                </span>
                <button className="iconbtn" aria-label="Desvincular" onClick={() => setMercaLink(l.foodId, undefined)}>
                  ✕
                </button>
              </div>
            ))}
      </div>

      <div className="card">
        <div className="row between">
          <b>🩺 Diagnóstico</b>
          <button className="btn small" disabled={!!busy} onClick={() => run('Probando cada paso…', async () => setDiag(await diagnose(cfg)))}>
            Ejecutar
          </button>
        </div>
        <div className="tiny muted">Prueba cada parte sin modificar nada (no toca el carrito). Si algo falla, aquí verás dónde.</div>
        {diag?.map((s) => (
          <div key={s.paso} className="small" style={{ borderTop: '1px solid var(--line)', paddingTop: 6 }}>
            {s.ok === true ? '✅' : s.ok === false ? '❌' : '➖'} <b>{s.paso}</b>
            <div className="tiny muted">{s.detalle}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <button className="btn small" onClick={() => setAdv(!adv)}>
          {adv ? '▲' : '▼'} Ajustes avanzados (si Mercadona cambia su web)
        </button>
        {adv && (
          <>
            <div className="tiny muted">
              Solo si el diagnóstico dice que la búsqueda ha cambiado. “Redescubrir” lee las claves actuales de la web de Mercadona.
            </div>
            <button
              className="btn small"
              disabled={!native || !!busy}
              onClick={() =>
                run('Leyendo la web de Mercadona…', async () => {
                  const a = await makeClient(cfg).discoverAlgolia();
                  setMercaConfig({ algolia: { appId: a.appId, apiKey: a.apiKey, indexBase: a.indexBase }, ...(a.version ? { xVersion: a.version } : {}) });
                  onToast(`Buscador actualizado (${a.appId})`);
                })
              }
            >
              🔎 Redescubrir buscador
            </button>
            <label className="field">
              Algolia App ID
              <input
                type="text"
                value={cfg.algolia?.appId ?? DEFAULT_ALGOLIA.appId}
                onChange={(e) => setMercaConfig({ algolia: { ...(cfg.algolia ?? DEFAULT_ALGOLIA), appId: e.target.value.trim() } })}
              />
            </label>
            <label className="field">
              Algolia API key (pública)
              <input
                type="text"
                value={cfg.algolia?.apiKey ?? DEFAULT_ALGOLIA.apiKey}
                onChange={(e) => setMercaConfig({ algolia: { ...(cfg.algolia ?? DEFAULT_ALGOLIA), apiKey: e.target.value.trim() } })}
              />
            </label>
            <label className="field">
              Índice base
              <input
                type="text"
                value={cfg.algolia?.indexBase ?? DEFAULT_ALGOLIA.indexBase}
                onChange={(e) => setMercaConfig({ algolia: { ...(cfg.algolia ?? DEFAULT_ALGOLIA), indexBase: e.target.value.trim() } })}
              />
            </label>
            <label className="field">
              Versión de la web (x-version)
              <input type="text" value={cfg.xVersion ?? DEFAULT_X_VERSION} onChange={(e) => setMercaConfig({ xVersion: e.target.value.trim() })} />
            </label>
            <button
              className="btn small"
              onClick={() => {
                setMercaConfig({ algolia: undefined, xVersion: undefined });
                onToast('Valores por defecto restaurados');
              }}
            >
              Restaurar valores por defecto
            </button>
          </>
        )}
      </div>

      {scan && (
        <BarcodeScanner
          mode="qr"
          onClose={() => setScan(false)}
          onDetected={(t) => {
            setScan(false);
            vincular(t);
          }}
        />
      )}
    </div>
  );
}
