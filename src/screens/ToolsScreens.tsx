import { useMemo, useRef, useState } from 'react';
import type { CookingConversion } from '../types';
import { BLOCKS, PROFILE_IDS } from '../types';
import { useStore } from '../store/AppStore';
import { calibrateFactor, formatNumber } from '../lib/conversions';
import { splitBatch } from '../lib/batch';
import { dayTotals, isFree, isSplit, personSlot, todayKey } from '../lib/day';
import type { DaySlot } from '../types';
import { round } from '../lib/nutrition';
import { NumberInput, Sheet, Warnings } from '../components/ui';

// ───────────────── Conversiones y calibrar cocción ─────────────────

export function ConversionsScreen({ onToast }: { onToast: (t: string) => void }) {
  const { data, saveConversion } = useStore();
  const [calib, setCalib] = useState<{ conv: CookingConversion; methodId: string } | null>(null);
  return (
    <div className="screen">
      <div className="sub">
        Factor = peso final / peso inicial. Cambiar el factor cambia el peso mostrado, <b>nunca</b> las calorías totales.
      </div>
      {data.conversions.map((c) => (
        <div key={c.id} className="card tight">
          <div className="row between">
            <b>{c.nombre}</b>
            <span className="tiny muted">desde {c.estadoInicial}</span>
          </div>
          {c.nota && <div className="tiny muted">{c.nota}</div>}
          {c.metodos.map((m) => (
            <div key={m.id} className="row">
              <span className="grow small">
                {m.nombre} {m.personalizado && <span className="badge ok">calibrado</span>}
                {c.metodoPorDefecto === m.id && <span className="badge info">por defecto</span>}
              </span>
              <span className="small">×</span>
              <div style={{ width: 80 }}>
                <NumberInput
                  value={m.factor}
                  step={0.01}
                  min={0.01}
                  onChange={(v) => {
                    if (!v || v <= 0) return;
                    saveConversion({ ...c, metodos: c.metodos.map((x) => (x.id === m.id ? { ...x, factor: v, personalizado: true } : x)) });
                  }}
                />
              </div>
              <button className="btn small" onClick={() => setCalib({ conv: c, methodId: m.id })}>
                ⚖️ Calibrar
              </button>
            </div>
          ))}
          {c.metodos.length > 1 && (
            <label className="field">
              Método por defecto
              <select value={c.metodoPorDefecto} onChange={(e) => saveConversion({ ...c, metodoPorDefecto: e.target.value })}>
                {c.metodos.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nombre}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      ))}
      {calib && (
        <CalibrateSheet
          conv={calib.conv}
          methodId={calib.methodId}
          onClose={() => setCalib(null)}
          onSave={(factor) => {
            saveConversion({
              ...calib.conv,
              metodos: calib.conv.metodos.map((x) => (x.id === calib.methodId ? { ...x, factor, personalizado: true } : x)),
            });
            onToast(`Factor guardado: ×${formatNumber(factor, 3)}`);
            setCalib(null);
          }}
        />
      )}
    </div>
  );
}

function CalibrateSheet({
  conv,
  methodId,
  onClose,
  onSave,
}: {
  conv: CookingConversion;
  methodId: string;
  onClose: () => void;
  onSave: (f: number) => void;
}) {
  const m = conv.metodos.find((x) => x.id === methodId)!;
  const [raw, setRaw] = useState<number | undefined>();
  const [cooked, setCooked] = useState<number | undefined>();
  const factor = raw && cooked ? calibrateFactor(raw, cooked) : undefined;
  return (
    <Sheet title={`Calibrar: ${conv.nombre} · ${m.nombre}`} onClose={onClose}>
      <div className="sub">Pesa antes y después de cocinar. Ej.: 500 g de arroz seco → 1.350 g cocido = ×2,7.</div>
      <div className="grid2">
        <label className="field">
          Peso {conv.estadoInicial} (g)
          <NumberInput value={raw} allowEmpty onChange={setRaw} />
        </label>
        <label className="field">
          Peso {m.nombre.toLowerCase()} (g)
          <NumberInput value={cooked} allowEmpty onChange={setCooked} />
        </label>
      </div>
      <div className="card tight">
        <div>
          Factor actual: <b>×{formatNumber(m.factor, 3)}</b>
        </div>
        <div>
          Factor medido: <b>{factor ? `×${formatNumber(factor, 3)}` : '—'}</b>
        </div>
      </div>
      <button className="btn primary block" disabled={!factor} onClick={() => factor && onSave(factor)}>
        Guardar como factor personalizado
      </button>
    </Sheet>
  );
}

// ───────────────── Repartir tanda (batch cooking) ─────────────────

export function BatchScreen() {
  const { data, fm, activeFoods } = useStore();
  const candidates = activeFoods.filter((f) => f.conversionId || f.estadoNutricionalBase === 'crudo');
  const [foodId, setFoodId] = useState(candidates.find((f) => f.id === 'pollo_pechuga')?.id ?? candidates[0]?.id ?? '');
  const [ini, setIni] = useState<number | undefined>(1000);
  const [fin, setFin] = useState<number | undefined>(760);
  const [nD, setND] = useState<number | undefined>(3);
  const [nA, setNA] = useState<number | undefined>(3);
  const [wA, setWA] = useState<number | undefined>(data.profiles.alba.escalaRaciones);
  const food = fm[foodId];

  const res = useMemo(() => {
    if (!ini || !fin) return null;
    try {
      return splitBatch(food, {
        pesoInicial: ini,
        pesoFinal: fin,
        raciones: [
          { nombre: data.profiles.dani.nombre, cantidad: nD ?? 0, peso: 1 },
          { nombre: data.profiles.alba.nombre, cantidad: nA ?? 0, peso: wA ?? 0.7 },
        ],
      });
    } catch {
      return null;
    }
  }, [food, ini, fin, nD, nA, wA, data.profiles]);

  return (
    <div className="screen">
      <div className="card">
        <label className="field">
          Alimento
          <select value={foodId} onChange={(e) => setFoodId(e.target.value)}>
            {candidates.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nombre}
              </option>
            ))}
          </select>
        </label>
        <div className="grid2">
          <label className="field">
            Peso inicial (crudo/seco) g
            <NumberInput value={ini} allowEmpty onChange={setIni} />
          </label>
          <label className="field">
            Peso final cocinado g
            <NumberInput value={fin} allowEmpty onChange={setFin} />
          </label>
          <label className="field">
            <span className="dani">Raciones Dani</span>
            <NumberInput value={nD} allowEmpty onChange={setND} />
          </label>
          <label className="field">
            <span className="alba">Raciones Alba</span>
            <NumberInput value={nA} allowEmpty onChange={setNA} />
          </label>
        </div>
        <label className="field">
          Tamaño ración Alba respecto a Dani (1 = igual)
          <NumberInput value={wA} step={0.05} allowEmpty onChange={setWA} />
        </label>
      </div>
      {res && (
        <div className="card">
          <div>
            Rendimiento real: <b>×{formatNumber(res.rendimiento, 3)}</b>
            {food?.conversionId && (
              <span className="sub">
                {' '}
                (configurado ×{data.conversions.find((c) => c.id === food.conversionId)?.metodos[0].factor})
              </span>
            )}
          </div>
          {res.porciones.map((p, i) => (
            <div key={p.nombre} className={`total-box ${PROFILE_IDS[i]}`}>
              <span className="who">
                {p.nombre} × {i === 0 ? nD : nA}
              </span>
              <div className="kcal">{p.cocinado} g cocinado / ración</div>
              <div className="small">
                ≈ {Math.round(p.crudo)} g en crudo · {round(p.nutrientes.kcal)} kcal · P {round(p.nutrientes.proteina)} g
              </div>
            </div>
          ))}
          <div className="sub">
            {Math.abs(res.sobrante) < 1
              ? 'Reparto exacto.'
              : res.sobrante > 0
                ? `Sobran ~${Math.round(res.sobrante)} g por el redondeo a 5 g.`
                : `Faltan ~${Math.round(-res.sobrante)} g por el redondeo: quita un poco de alguna ración.`}
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────── Historial ─────────────────

export function HistoryScreen() {
  const { data, fm } = useStore();
  const days = data.history.filter((d) => d.fecha <= todayKey());
  return (
    <div className="screen">
      {days.length === 0 && <div className="empty">Aún no hay días registrados. Elige comidas en Inicio.</div>}
      {days.map((d) => {
        const t = dayTotals(d, fm);
        return (
          <div key={d.fecha} className="card tight">
            <div className="row between">
              <b>
                {new Date(d.fecha + 'T12:00').toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })}
                {d.fecha === todayKey() && ' · hoy'}
              </b>
              {d.compensar && <span className="badge warn">compensado</span>}
            </div>
            {BLOCKS.map((b) => {
              const txt = (s: DaySlot | undefined) =>
                !s ? '—' : isFree(s) ? `🍕 Comida libre${s.descripcion ? `: ${s.descripcion}` : ''}` : `${s.meal.nombre}${s.meal.ajustadoReal ? ' ✍️' : ''}`;
              return (
                <div key={b} className="small">
                  <b style={{ color: 'var(--primary)' }}>{b}</b>{' '}
                  {isSplit(d, b)
                    ? PROFILE_IDS.map((p) => (
                        <span key={p} className={p} style={{ marginRight: 8 }}>
                          {data.profiles[p].nombre}: {txt(personSlot(d, b, p))}
                        </span>
                      ))
                    : txt(d.bloques[b])}
                </div>
              );
            })}
            {(d.extras ?? []).length > 0 && <div className="tiny muted">🍌 {d.extras!.length} extra(s)</div>}
            <div className="grid2">
              {PROFILE_IDS.map((p) => (
                <div key={p} className="tiny">
                  <b className={p}>{data.profiles[p].nombre}</b> {round(t[p].kcal)} kcal · P {round(t[p].proteina)} · HC {round(t[p].carbohidratos)} · G{' '}
                  {round(t[p].grasas)}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ───────────────── Datos: exportar / importar / reset ─────────────────

export function DataScreen({ onToast }: { onToast: (t: string) => void }) {
  const { data, importData, resetData } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dieta-dani-alba-${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="screen">
      <div className="card">
        <h3>Copia de seguridad</h3>
        <div className="sub">Los datos se guardan solo en este dispositivo. Exporta una copia de vez en cuando.</div>
        <button className="btn soft" onClick={exportJson}>
          ⬇ Exportar datos (JSON)
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          ⬆ Importar datos
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              importData(await file.text());
              setError(null);
              onToast('Datos importados');
            } catch (err) {
              setError(`No se pudo importar: ${(err as Error).message}`);
            }
            e.target.value = '';
          }}
        />
        {error && <Warnings items={[{ level: 'error', text: error }]} />}
      </div>
      <div className="card">
        <h3>Restablecer</h3>
        <div className="sub">Vuelve a la base de alimentos, perfiles y favoritos iniciales. Se perderán tus cambios.</div>
        {!confirmReset ? (
          <button className="btn danger" onClick={() => setConfirmReset(true)}>
            Restablecer todo
          </button>
        ) : (
          <div className="btn-row">
            <button
              className="btn danger"
              onClick={() => {
                resetData();
                setConfirmReset(false);
                onToast('Datos restablecidos');
              }}
            >
              Sí, borrar mis cambios
            </button>
            <button className="btn" onClick={() => setConfirmReset(false)}>
              Cancelar
            </button>
          </div>
        )}
      </div>
      <div className="card">
        <h3>Acerca de</h3>
        <div className="sub">
          Cálculos 100% deterministas a partir de la base de alimentos (sin IA). Especias (ajo, cebolla en polvo, pimentón, pimienta, curry,
          orégano, chile…) no se contabilizan. Aceite, quesos, salsas, aguacate, chocolate y frutos secos sí.
        </div>
        <div className="tiny muted">
          {data.foods.length} alimentos · {data.favorites.length} favoritos · {data.history.length} días
        </div>
      </div>
    </div>
  );
}
