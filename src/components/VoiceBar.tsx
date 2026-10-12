import { useEffect, useState } from 'react';
import type { StockEvent } from '../types';
import { useStore, type StockChange } from '../store/AppStore';
import { todayKey } from '../lib/day';
import { applyVoz, parseVoz, vozCatalog, vozRestoOk, type VozChanges } from '../lib/voz';
import { listen, speechAvailable } from '../lib/speech';
import { Sheet } from './ui';

/** Resultado de una frase ya aplicada, con lo necesario para deshacerla */
export interface VoiceOutcome {
  texto: string;
  changes: VozChanges;
  dudas: string[];
  restoOk: boolean;
  undo: StockChange;
}

/**
 * Hablar (o escribir) qué ha pasado en casa: se interpreta y se aplica al momento,
 * con resumen y "Deshacer".
 */
export function VoiceBar({
  placeholder = 'p. ej. “se acabó la leche, quedan 4 huevos y apunta papel higiénico”',
  origen = 'voz',
  onDone,
  big,
  autoStart,
}: {
  placeholder?: string;
  origen?: StockEvent['origen'];
  /** tras aplicar (p. ej., el recuento marca "el resto bien") */
  onDone?: (o: VoiceOutcome) => void;
  big?: boolean;
  /** empezar a escuchar al abrir (acceso directo "🎤 Apuntar") */
  autoStart?: boolean;
}) {
  const { data, activeFoods, stockApply } = useStore();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VoiceOutcome | null>(null);

  const run = (frase: string) => {
    const t = frase.trim();
    if (!t) return;
    const hoy = todayKey();
    const r = parseVoz(t, vozCatalog(data, activeFoods), hoy);
    const changes = applyVoz(r.acciones, hoy, origen);
    const undo: StockChange = {
      removeEvents: changes.events.map((e) => e.id),
      items: changes.items.map((i) => data.stock.items[i.id]).filter(Boolean),
      removeItems: changes.items.filter((i) => !data.stock.items[i.id]).map((i) => i.id),
    };
    if (changes.items.length || changes.events.length) stockApply({ items: changes.items, events: changes.events });
    const out = { texto: t, changes, dudas: r.dudas, restoOk: vozRestoOk(r.acciones), undo };
    setResult(out);
    setText('');
    onDone?.(out);
  };

  const hablar = async () => {
    setError(null);
    setBusy(true);
    try {
      const t = await listen();
      if (t) run(t);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (autoStart && speechAvailable()) hablar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 8 }}>
        {speechAvailable() && (
          <button className={`btn primary ${big ? '' : 'small'}`} style={big ? { fontSize: '1.05rem', padding: '12px 16px' } : undefined} disabled={busy} onClick={hablar}>
            {busy ? '👂…' : '🎤 Hablar'}
          </button>
        )}
        <form
          className="row grow"
          style={{ gap: 6 }}
          onSubmit={(e) => {
            e.preventDefault();
            run(text);
          }}
        >
          <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder={speechAvailable() ? 'o escribe…' : 'Escribe o usa el 🎤 del teclado'} />
          {text.trim() && (
            <button className="btn small" type="submit">
              OK
            </button>
          )}
        </form>
      </div>
      {!result && <div className="tiny muted">{placeholder}</div>}
      {error && <div className="tiny" style={{ color: 'var(--bad)' }}>{error}</div>}
      {result && (
        <Sheet title="🎤 Entendido" onClose={() => setResult(null)}>
          <div className="tiny muted">“{result.texto}”</div>
          {result.changes.resumen.length > 0 ? (
            <div className="col" style={{ gap: 4 }}>
              {result.changes.resumen.map((r, i) => (
                <div key={i} className="small">
                  {r}
                </div>
              ))}
              {result.restoOk && <div className="small">✅ El resto, bien</div>}
            </div>
          ) : (
            !result.restoOk && <div className="small">No he registrado nada.</div>
          )}
          {result.dudas.map((q, i) => (
            <div key={i} className="small" style={{ color: 'var(--warn)' }}>
              ❓ {q}
            </div>
          ))}
          <div className="btn-row">
            <button className="btn primary" onClick={() => setResult(null)}>
              Vale
            </button>
            {result.changes.events.length + result.changes.items.length > 0 && (
              <button
                className="btn"
                onClick={() => {
                  stockApply(result.undo);
                  setResult(null);
                }}
              >
                ↺ Deshacer
              </button>
            )}
            {speechAvailable() && (
              <button
                className="btn"
                onClick={() => {
                  setResult(null);
                  hablar();
                }}
              >
                🎤 Decir más
              </button>
            )}
          </div>
        </Sheet>
      )}
    </div>
  );
}
