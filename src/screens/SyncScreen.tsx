import { useState } from 'react';
import { useStore } from '../store/AppStore';
import { cloudConfig } from '../sync/engine';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../sync/config';
import { decodeLink, encodeLink, formatKey, generateHouseholdKey } from '../sync/link';
import { testConnection } from '../sync/supabase';
import { Warnings } from '../components/ui';

function timeAgo(ts?: number): string {
  if (!ts) return 'nunca';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'hace unos segundos';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  return new Date(ts).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export async function shareText(text: string, title: string): Promise<'shared' | 'copied' | 'failed'> {
  try {
    if (navigator.share) {
      await navigator.share({ title, text });
      return 'shared';
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return 'failed';
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}

export function SyncScreen({ onToast }: { onToast: (t: string) => void }) {
  const { data, syncStatus, syncNow, configureCloud, joinHousehold, leaveHousehold } = useStore();
  const cfg = cloudConfig(data);
  const builtIn = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
  const [url, setUrl] = useState(data.sync.url ?? '');
  const [anonKey, setAnonKey] = useState(data.sync.anonKey ?? '');
  const [code, setCode] = useState('');
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const household = data.sync.household;

  const statusText = {
    off: 'Desactivada',
    idle: 'Sincronizado',
    syncing: 'Sincronizando…',
    error: 'Error',
    offline: 'Sin conexión (se sincronizará al volver)',
  }[syncStatus];

  const create = async () => {
    if (!cfg) return;
    const h = generateHouseholdKey();
    setTesting(true);
    setError(null);
    try {
      await testConnection(cfg, h);
      joinHousehold(h);
      onToast('Hogar creado. Comparte el código con el otro móvil.');
    } catch (e) {
      setError(`No se pudo conectar: ${(e as Error).message}. ¿Ejecutaste supabase/setup.sql?`);
    } finally {
      setTesting(false);
    }
  };

  const join = async () => {
    const parsed = decodeLink(code);
    if (!parsed) {
      setError('Código no válido. Pega el código completo que empieza por DIETA1:');
      return;
    }
    const c = parsed.cfg ?? cfg;
    if (!c) {
      setError('Este código no incluye la configuración del servidor. Pega el código completo del otro móvil.');
      return;
    }
    setTesting(true);
    setError(null);
    try {
      await testConnection(c, parsed.household);
      joinHousehold(parsed.household, parsed.cfg);
      setCode('');
      onToast('Unido al hogar. Fusionando datos…');
    } catch (e) {
      setError(`No se pudo conectar: ${(e as Error).message}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="screen">
      <div className="card">
        <div className="row between">
          <h3>☁️ Sincronización</h3>
          <span className={`badge ${syncStatus === 'idle' ? 'ok' : syncStatus === 'error' ? 'bad' : syncStatus === 'off' ? 'info' : 'warn'}`}>
            {statusText}
          </span>
        </div>
        <div className="sub">
          Favoritos, alimentos, plan semanal, despensa, lista de la compra, perfiles y factores de cocción se comparten entre los móviles
          del hogar automáticamente. Si los dos cambian lo mismo, gana el cambio más reciente.
        </div>
        {household && (
          <>
            <div className="small">
              Última sincronización: <b>{timeAgo(data.sync.lastSync)}</b>
              {data.sync.pending.length > 0 && <span className="muted"> · {data.sync.pending.length} cambios por subir</span>}
            </div>
            {data.sync.lastError && syncStatus === 'error' && <Warnings items={[{ level: 'error', text: data.sync.lastError }]} />}
            <button className="btn soft" onClick={() => syncNow()} disabled={syncStatus === 'syncing'}>
              ↻ Sincronizar ahora
            </button>
          </>
        )}
      </div>

      {!cfg && (
        <div className="card">
          <h3>1 · Servidor (Supabase)</h3>
          <div className="sub">
            Pega la <b>Project URL</b> y la <b>anon / publishable key</b> de tu proyecto de Supabase (Project Settings → API). Solo hace falta en
            el primer móvil: el otro la recibe dentro del código de enlace.
          </div>
          <label className="field">
            Project URL
            <input type="text" value={url} onChange={(e) => setUrl(e.target.value.trim())} placeholder="https://xxxx.supabase.co" />
          </label>
          <label className="field">
            anon / publishable key
            <input type="text" value={anonKey} onChange={(e) => setAnonKey(e.target.value.trim())} placeholder="eyJ… o sb_publishable_…" />
          </label>
          <button
            className="btn primary"
            disabled={!/^https:\/\/.+/.test(url) || anonKey.length < 20}
            onClick={() => configureCloud({ url, anonKey })}
          >
            Guardar servidor
          </button>
          <div className="tiny muted">¿Vas a unirte al hogar de otro móvil? No necesitas esto: pega directamente su código abajo.</div>
        </div>
      )}

      {!household && (
        <div className="card">
          <h3>{cfg ? '2 · ' : ''}Hogar</h3>
          {cfg && (
            <>
              <div className="sub">
                <b>Primer móvil:</b> crea el hogar y comparte el código. <b>Segundo móvil:</b> pega ese código.
              </div>
              <button className="btn primary" onClick={create} disabled={testing}>
                {testing ? 'Conectando…' : '🏠 Crear hogar (primer móvil)'}
              </button>
              <hr />
            </>
          )}
          <label className="field">
            Código del otro móvil
            <textarea rows={3} value={code} onChange={(e) => setCode(e.target.value)} placeholder="DIETA1:…" />
          </label>
          <button className="btn soft" onClick={join} disabled={testing || !code.trim()}>
            {testing ? 'Conectando…' : '🔗 Unirme a este hogar'}
          </button>
          <div className="tiny muted">Al unirte se fusionan los datos de los dos móviles; no se pierde nada de ninguno.</div>
        </div>
      )}

      {error && <Warnings items={[{ level: 'error', text: error }]} />}

      {household && cfg && (
        <div className="card">
          <h3>Añadir otro móvil</h3>
          <div className="sub">
            En el otro móvil: Más → Sincronizar → pega este código → “Unirme a este hogar”. Trátalo como una contraseña: quien lo tenga puede
            ver y cambiar vuestros datos.
          </div>
          <div className="small">
            Clave del hogar: <code>{formatKey(household)}</code>
          </div>
          <div className="btn-row">
            <button
              className="btn primary small"
              onClick={async () => {
                const r = await shareText(encodeLink(cfg, household), 'Código de la app de dieta');
                onToast(r === 'copied' ? 'Código copiado' : r === 'shared' ? 'Código compartido' : 'No se pudo compartir');
              }}
            >
              📤 Compartir código
            </button>
            <button
              className="btn small"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(encodeLink(cfg, household));
                  onToast('Código copiado');
                } catch {
                  onToast('No se pudo copiar');
                }
              }}
            >
              📋 Copiar
            </button>
          </div>
          <hr />
          {!confirmLeave ? (
            <button className="btn small danger" onClick={() => setConfirmLeave(true)}>
              Dejar de sincronizar este móvil
            </button>
          ) : (
            <div className="btn-row">
              <button
                className="btn small danger"
                onClick={() => {
                  leaveHousehold();
                  setConfirmLeave(false);
                  onToast('Sincronización desactivada (tus datos siguen en el móvil)');
                }}
              >
                Sí, desconectar
              </button>
              <button className="btn small" onClick={() => setConfirmLeave(false)}>
                Cancelar
              </button>
            </div>
          )}
        </div>
      )}

      {cfg && !builtIn && !household && (
        <button
          className="btn small"
          onClick={() => {
            configureCloud(null);
            setUrl('');
            setAnonKey('');
          }}
        >
          Cambiar servidor
        </button>
      )}
    </div>
  );
}
