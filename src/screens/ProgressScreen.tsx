import { useMemo, useState } from 'react';
import type { ProfileId } from '../types';
import { PROFILE_IDS } from '../types';
import { useStore } from '../store/AppStore';
import { todayKey } from '../lib/day';
import { formatDay } from '../lib/planning';
import { dayStats, lastDays, movingAverage, summarize, weeklyRate, weeksToGoal, weightSeries } from '../lib/progress';
import { DailyBars, WeightChart } from '../components/Charts';
import { NumberInput, Segmented } from '../components/ui';
import { adherence } from '../lib/adherence';

type View = 'peso' | 'semana' | 'plan';

export function ProgressScreen({ onToast }: { onToast: Toaster }) {
  const [view, setView] = useState<View>('peso');
  const [pid, setPid] = useState<ProfileId>('dani');
  const { data } = useStore();
  return (
    <div className="screen">
      <Segmented
        full
        value={view}
        options={[
          { value: 'peso', label: '⚖️ Peso' },
          { value: 'semana', label: '📊 Kcal y proteína' },
          { value: 'plan', label: '✅ Plan' },
        ]}
        onChange={setView}
      />
      {view !== 'plan' && (
        <Segmented full value={pid} options={PROFILE_IDS.map((p) => ({ value: p, label: data.profiles[p].nombre }))} onChange={setPid} />
      )}
      {view === 'peso' && <WeightView key={pid} pid={pid} onToast={onToast} />}
      {view === 'semana' && <WeekView pid={pid} />}
      {view === 'plan' && <AdherenceView />}
    </div>
  );
}

function WeightView({ pid, onToast }: { pid: ProfileId; onToast: Toaster }) {
  const { data, addWeight, removeWeight } = useStore();
  const p = data.profiles[pid];
  const series = useMemo(() => weightSeries(data.pesos, pid), [data.pesos, pid]);
  const trend = useMemo(() => movingAverage(series), [series]);
  const rate = weeklyRate(series);
  const last = series[series.length - 1];
  const current = trend.length ? trend[trend.length - 1].kg : p.pesoActualKg;
  const eta = weeksToGoal(current, p.pesoObjetivoKg, rate);
  const [kg, setKg] = useState<number | undefined>(last?.kg ?? p.pesoActualKg);
  const [fecha, setFecha] = useState(todayKey());
  const [table, setTable] = useState(false);
  const fmt = (n: number, d = 1) => n.toLocaleString('es-ES', { maximumFractionDigits: d, minimumFractionDigits: d });

  return (
    <>
      <div className="card">
        <div className="row">
          <label className="field grow">
            Peso (kg)
            <NumberInput value={kg} step={0.1} allowEmpty onChange={setKg} />
          </label>
          <label className="field grow">
            Fecha
            <input type="date" value={fecha} max={todayKey()} onChange={(e) => e.target.value && setFecha(e.target.value)} />
          </label>
        </div>
        <button
          className="btn primary"
          disabled={!kg || kg < 30 || kg > 250}
          onClick={() => {
            addWeight(pid, kg!, fecha);
            onToast(`Peso de ${p.nombre} guardado: ${fmt(kg!)} kg`);
          }}
        >
          Guardar peso de {p.nombre}
        </button>
        <div className="tiny muted">Consejo: pésate en las mismas condiciones (por la mañana, en ayunas). Lo importante es la tendencia, no un día suelto.</div>
      </div>

      <div className="grid3">
        <div className="card tight">
          <span className="tiny muted">Tendencia</span>
          <b>{fmt(current)} kg</b>
        </div>
        <div className="card tight">
          <span className="tiny muted">Ritmo</span>
          <b>{rate === null ? '—' : `${rate > 0 ? '+' : ''}${fmt(rate, 2)} kg/sem`}</b>
        </div>
        <div className="card tight">
          <span className="tiny muted">Objetivo {fmt(p.pesoObjetivoKg)}</span>
          <b>
            {eta === null ? (rate === null ? '—' : 'no se acerca') : eta === 0 ? '¡Conseguido!' : `≈ ${Math.ceil(eta)} sem`}
          </b>
        </div>
      </div>
      {rate === null && series.length > 0 && <div className="tiny muted">El ritmo semanal aparece con registros de al menos 4 días distintos.</div>}

      <div className="card">
        <h3>Evolución · {p.nombre}</h3>
        <WeightChart pid={pid} series={series} trend={trend} goal={p.pesoObjetivoKg} />
        {series.length > 0 && (
          <button className="btn small" onClick={() => setTable(!table)}>
            {table ? 'Ocultar tabla' : 'Ver tabla'}
          </button>
        )}
        {table && (
          <div className="col" style={{ gap: 0 }}>
            {[...series].reverse().map((w) => (
              <div key={w.fecha} className="row between small" style={{ borderBottom: '1px solid var(--line)', padding: '4px 0' }}>
                <span>{formatDay(w.fecha, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
                <span className="row">
                  <b>{fmt(w.kg)} kg</b>
                  <button className="iconbtn" aria-label="Borrar registro" onClick={() => removeWeight(pid, w.fecha)}>
                    ✕
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function WeekView({ pid }: { pid: ProfileId }) {
  const { data, fm } = useStore();
  const [days, setDays] = useState<'7' | '14' | '28'>('7');
  const p = data.profiles[pid];
  const dates = lastDays(todayKey(), Number(days));
  const stats = useMemo(() => dayStats(data.history, p, fm, dates), [data.history, p, fm, dates.join()]);
  const sum = summarize(stats);
  const [table, setTable] = useState(false);
  const r = (n: number | null) => (n === null ? '—' : Math.round(n).toLocaleString('es-ES'));

  return (
    <>
      <Segmented
        full
        value={days}
        options={[
          { value: '7', label: '7 días' },
          { value: '14', label: '14 días' },
          { value: '28', label: '28 días' },
        ]}
        onChange={setDays}
      />
      <div className="grid3">
        <div className="card tight">
          <span className="tiny muted">Cumplimiento</span>
          <b>{sum.cumplimiento === null ? '—' : `${Math.round(sum.cumplimiento)} %`}</b>
          <span className="tiny muted">
            {sum.diasCumplidos}/{sum.diasRegistrados} días
          </span>
        </div>
        <div className="card tight">
          <span className="tiny muted">Kcal media</span>
          <b>{r(sum.kcalMedia)}</b>
          <span className="tiny muted">obj. {r(sum.kcalObjetivoMedio)}</span>
        </div>
        <div className="card tight">
          <span className="tiny muted">Proteína media</span>
          <b>{r(sum.proteinaMedia)} g</b>
          <span className="tiny muted">obj. {r(sum.proteinaObjetivoMedia)} g</span>
        </div>
      </div>
      <div className="tiny muted">
        Un día cuenta como cumplido si las kcal quedan a ±10 % del objetivo del día (entreno o descanso) y la proteína llega al 90 %. Las medias solo
        cuentan días registrados completos.
      </div>
      <div className="card">
        <h3>Kcal por día · {p.nombre}</h3>
        <DailyBars pid={pid} stats={stats} metric="kcal" />
        <div className="tiny muted">Barra: consumido · raya: objetivo del día</div>
      </div>
      <div className="card">
        <h3>Proteína por día · {p.nombre}</h3>
        <DailyBars pid={pid} stats={stats} metric="proteina" />
      </div>
      <button className="btn small" onClick={() => setTable(!table)}>
        {table ? 'Ocultar tabla' : 'Ver tabla por días'}
      </button>
      {table && (
        <div className="card tight">
          {[...stats].reverse().map((s) => (
            <div key={s.fecha} className="row between small" style={{ borderBottom: '1px solid var(--line)', padding: '4px 0' }}>
              <span>
                {formatDay(s.fecha, { weekday: 'short', day: 'numeric' })} {s.entreno && '🏋️'}
              </span>
              <span>
                {s.registrado ? (
                  <>
                    {r(s.kcal)}/{r(s.kcalObjetivo)} kcal · P {r(s.proteina)}/{r(s.proteinaObjetivo)} {s.cumplido ? '✅' : s.incompleto ? '❔' : '❌'}
                  </>
                ) : (
                  <span className="muted">sin registrar</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** Cumplimiento del plan en las últimas 4 semanas */
function AdherenceView() {
  const { data } = useStore();
  const a = adherence(data.history, todayKey(), 4);
  const peor = (['A', 'B', 'C'] as const)
    .filter((b) => a.comidasPorBloque[b] > 0)
    .sort((x, y) => a.libresPorBloque[y] / a.comidasPorBloque[y] - a.libresPorBloque[x] / a.comidasPorBloque[x])[0];
  const NAMES = { A: 'el desayuno', B: 'el almuerzo', C: 'la cena' } as const;
  return (
    <div className="card">
      <b>✅ Cumplimiento del plan</b>
      <div className="small">
        {a.semanas.every((w) => w.comidas === 0) ? (
          'Aún no hay comidas registradas en las últimas 4 semanas.'
        ) : (
          <>
            En las últimas 4 semanas, <b>{a.seguidas}%</b> de las comidas se hicieron tal cual el plan.
          </>
        )}
        {peor && a.libresPorBloque[peor] > 0 ? ` Donde más se sale del plan: ${NAMES[peor]} (${a.libresPorBloque[peor]} comidas libres).` : ''}
      </div>
      <table className="small" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr className="tiny muted" style={{ textAlign: 'right' }}>
            <th style={{ textAlign: 'left' }}>Semana</th>
            <th>Días</th>
            <th>Confirm.</th>
            <th>Libres</th>
            <th>Corregidas</th>
            <th>Extras</th>
          </tr>
        </thead>
        <tbody>
          {[...a.semanas].reverse().map((w) => (
            <tr key={w.semana} style={{ textAlign: 'right', borderTop: '1px solid var(--line)' }}>
              <td style={{ textAlign: 'left' }}>{formatDay(w.semana, { day: 'numeric', month: 'short' })}</td>
              <td>{w.dias}/7</td>
              <td>{w.confirmados}</td>
              <td>{w.libres}</td>
              <td>{w.corregidas}</td>
              <td>{w.extras}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="tiny muted">
        Libres = comidas fuera del plan; corregidas = “lo que comí de verdad” con otras cantidades; confirmados = días con el ✅ de la noche.
      </div>
    </div>
  );
}
