import { useState } from 'react';
import type { ProfileId } from '../types';
import type { DayStat } from '../lib/progress';
import { formatDay, parseDate } from '../lib/planning';

const W = 340;
const H = 170;
const PAD = { l: 34, r: 10, t: 14, b: 22 };
const color = (pid: ProfileId) => `var(--chart-${pid})`;
const fmt = (n: number, d = 1) => n.toLocaleString('es-ES', { maximumFractionDigits: d });

/** Peso: puntos de cada registro, línea de tendencia (media 7 días) y objetivo discontinuo. Toca un punto para ver el dato. */
export function WeightChart({
  pid,
  series,
  trend,
  goal,
}: {
  pid: ProfileId;
  series: { fecha: string; kg: number }[];
  trend: { fecha: string; kg: number }[];
  goal: number;
}) {
  const [sel, setSel] = useState<number | null>(null);
  if (series.length === 0) return <div className="empty">Aún no hay registros de peso.</div>;
  const t = series.map((s) => parseDate(s.fecha).getTime());
  const t0 = Math.min(...t);
  const t1 = Math.max(...t, t0 + 86400000 * 6);
  const vals = [...series.map((s) => s.kg), goal];
  const lo = Math.floor(Math.min(...vals) - 0.5);
  const hi = Math.ceil(Math.max(...vals) + 0.5);
  const x = (fecha: string) => PAD.l + ((parseDate(fecha).getTime() - t0) / (t1 - t0)) * (W - PAD.l - PAD.r);
  const y = (kg: number) => PAD.t + ((hi - kg) / (hi - lo)) * (H - PAD.t - PAD.b);
  const ticks = Array.from({ length: 4 }, (_, i) => lo + ((hi - lo) * i) / 3);
  const s = sel !== null ? series[sel] : series[series.length - 1];
  return (
    <div className="col" style={{ gap: 4 }}>
      <div className="small">
        <b>{fmt(s.kg)} kg</b> <span className="muted">· {formatDay(s.fecha, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Evolución del peso">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
            <text x={PAD.l - 4} y={y(v) + 3} textAnchor="end">
              {fmt(v, 0)}
            </text>
          </g>
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={y(goal)} y2={y(goal)} stroke="var(--muted)" strokeWidth={1.5} strokeDasharray="5 4" />
        <text x={W - PAD.r} y={y(goal) - 4} textAnchor="end">
          objetivo {fmt(goal)}
        </text>
        {trend.length > 1 && (
          <polyline
            fill="none"
            stroke={color(pid)}
            strokeWidth={2}
            strokeLinejoin="round"
            points={trend.map((p) => `${x(p.fecha)},${y(p.kg)}`).join(' ')}
          />
        )}
        {series.map((p, i) => (
          <g key={p.fecha} onClick={() => setSel(i)} style={{ cursor: 'pointer' }}>
            <circle cx={x(p.fecha)} cy={y(p.kg)} r={12} fill="transparent" />
            <circle
              cx={x(p.fecha)}
              cy={y(p.kg)}
              r={sel === i ? 5.5 : 4}
              fill={color(pid)}
              fillOpacity={0.55}
              stroke="var(--card)"
              strokeWidth={2}
            />
            <title>
              {formatDay(p.fecha)}: {fmt(p.kg)} kg
            </title>
          </g>
        ))}
        <text x={PAD.l} y={H - 6}>
          {formatDay(series[0].fecha, { day: 'numeric', month: 'short' })}
        </text>
        <text x={W - PAD.r} y={H - 6} textAnchor="end">
          {formatDay(series[series.length - 1].fecha, { day: 'numeric', month: 'short' })}
        </text>
      </svg>
      <div className="tiny muted">Puntos: registros · línea: tendencia (media de 7 días) · discontinua: objetivo</div>
    </div>
  );
}

/** Barras diarias de kcal o proteína con la marca del objetivo de cada día. Toca una barra para ver el detalle. */
export function DailyBars({ pid, stats, metric }: { pid: ProfileId; stats: DayStat[]; metric: 'kcal' | 'proteina' }) {
  const [sel, setSel] = useState<number | null>(null);
  const val = (s: DayStat) => (metric === 'kcal' ? s.kcal : s.proteina);
  const goal = (s: DayStat) => (metric === 'kcal' ? s.kcalObjetivo : s.proteinaObjetivo);
  const max = Math.max(...stats.map((s) => Math.max(val(s), goal(s))), 1) * 1.1;
  const n = stats.length;
  const slot = (W - PAD.l - PAD.r) / n;
  const bw = Math.max(4, Math.min(26, slot - 4));
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const base = y(0);
  const unit = metric === 'kcal' ? 'kcal' : 'g';
  const ticks = [0, max / 2 / 1.1, max / 1.1].map((v) => Math.round(v / (metric === 'kcal' ? 100 : 10)) * (metric === 'kcal' ? 100 : 10));
  const s = sel !== null ? stats[sel] : null;
  const labelEvery = n > 14 ? 7 : n > 7 ? 2 : 1;
  return (
    <div className="col" style={{ gap: 4 }}>
      <div className="small" style={{ minHeight: 18 }}>
        {s ? (
          <>
            <b>{formatDay(s.fecha, { weekday: 'short', day: 'numeric' })}</b>:{' '}
            {s.registrado ? `${fmt(val(s), 0)} ${unit}` : 'sin registrar'} / objetivo {fmt(goal(s), 0)} {unit}
            {s.entreno && ' · 🏋️'}
            {s.incompleto && ' · comida libre sin estimar'}
          </>
        ) : (
          <span className="muted">Toca una barra para ver el día</span>
        )}
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={metric === 'kcal' ? 'Kcal por día' : 'Proteína por día'}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
            <text x={PAD.l - 4} y={y(v) + 3} textAnchor="end">
              {fmt(v, 0)}
            </text>
          </g>
        ))}
        {stats.map((st, i) => {
          const cx = PAD.l + slot * i + slot / 2;
          const v = val(st);
          const top = y(v);
          const h = Math.max(0, base - top);
          const r = Math.min(4, bw / 2, h);
          return (
            <g key={st.fecha} onClick={() => setSel(i)} style={{ cursor: 'pointer' }}>
              <rect x={cx - slot / 2} y={PAD.t} width={slot} height={base - PAD.t} fill="transparent" />
              {st.registrado && h > 0 && (
                <path
                  d={`M${cx - bw / 2},${base} V${top + r} Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top} H${cx + bw / 2 - r} Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r} V${base} Z`}
                  fill={color(pid)}
                  fillOpacity={sel === i ? 1 : st.incompleto ? 0.35 : 0.8}
                />
              )}
              <line
                x1={cx - bw / 2 - 2}
                x2={cx + bw / 2 + 2}
                y1={y(goal(st))}
                y2={y(goal(st))}
                stroke="var(--text)"
                strokeWidth={2}
                strokeLinecap="round"
              />
              {i % labelEvery === 0 && (
                <text x={cx} y={H - 6} textAnchor="middle">
                  {formatDay(st.fecha, n > 7 ? { day: 'numeric' } : { weekday: 'narrow' })}
                </text>
              )}
              <title>
                {formatDay(st.fecha)}: {st.registrado ? `${fmt(v, 0)} ${unit}` : 'sin registrar'} (objetivo {fmt(goal(st), 0)})
              </title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
