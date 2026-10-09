import { useMemo, useState } from 'react';
import type { Block, Meal, ProfileId } from '../types';
import { BLOCKS, PROFILE_IDS } from '../types';
import { useStore } from '../store/AppStore';
import { generateMeals, STYLE_LABELS, type GeneratedOption, type GeneratorRequest, type Style } from '../lib/mealGenerator';
import { dayGoals, targetsForDay, todayKey } from '../lib/day';
import { formatDay } from '../lib/planning';
import { recentMeals } from '../lib/recent';
import { FoodSelector } from '../components/FoodPicker';
import { OptionCard } from '../components/OptionCard';
import { Segmented, Warnings } from '../components/ui';

const BLOCK_DESC: Record<Block, string> = {
  A: 'Desayuno Dani / preentreno Alba',
  B: 'Almuerzo Dani / 1ª comida Alba',
  C: 'Cena de ambos',
};

export interface GeneratorPreset {
  bloque?: Block;
  modo?: 'generador' | 'casa';
  /** día del plan al que se añadirá la comida (por defecto hoy) */
  fecha?: string;
  /** para quién generar (al venir de un bloque concreto); si no, según el ajuste de bloques separados */
  para?: Para;
}

type Para = 'ambos' | ProfileId;

export function GeneratorScreen({
  preset,
  onToast,
  onUsed,
}: {
  preset?: GeneratorPreset;
  onToast: (t: string) => void;
  onUsed: () => void;
}) {
  const { data, genCtx, fm, placeMeal, setPantry, getDay } = useStore();
  const [modo, setModo] = useState<'generador' | 'casa'>(preset?.modo ?? 'generador');
  const [bloque, setBloque] = useState<Block>(preset?.bloque ?? 'B');
  const [obligatorios, setObligatorios] = useState<string[]>([]);
  const [opcionales, setOpcionales] = useState<string[]>([]);
  const [prohibidos, setProhibidos] = useState<string[]>([]);
  const [estilo, setEstilo] = useState<Style>('equilibrada');
  const [sinLacteos, setSinLacteos] = useState(false);
  const [soloSeleccionados, setSoloSeleccionados] = useState(false);
  const [usarLoQueTengo, setUsarLoQueTengo] = useState(false);
  /** para quién: por defecto ambos; en los bloques que coméis por separado, el dueño de este móvil */
  const defaultPara = (b: Block): Para =>
    preset?.para ?? (data.settings.bloquesSeparados?.includes(b) ? data.settings.yoSoy ?? 'dani' : 'ambos');
  const [para, setPara] = useState<Para>(defaultPara(preset?.bloque ?? 'B'));
  const [opciones, setOpciones] = useState<GeneratedOption[] | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [shown, setShown] = useState<string[]>([]);

  const fecha = preset?.fecha ?? todayKey();
  const isToday = fecha === todayKey();
  const fechaText = isToday ? 'hoy' : formatDay(fecha, { weekday: 'long', day: 'numeric' });
  const today = getDay(fecha);
  const objetivos = useMemo(() => targetsForDay(fecha, bloque, data.profiles, today, fm), [fecha, bloque, data.profiles, today, fm]);
  const targets = objetivos;
  const entrenos = PROFILE_IDS.filter((p) => dayGoals(data.profiles[p], fecha, today).entreno).map((p) => data.profiles[p].nombre);

  const buildReq = (extraExcl: string[] = []): GeneratorRequest => {
    const casa = modo === 'casa';
    return {
      bloque,
      obligatorios: casa ? [] : obligatorios,
      opcionales: casa ? [] : opcionales,
      prohibidos,
      disponibles: data.pantry,
      estilo,
      filtros: {
        sinLacteos,
        soloSeleccionados: casa ? false : soloSeleccionados,
        usarLoQueTengo: casa ? true : usarLoQueTengo,
      },
      maxOpciones: casa ? 5 : 4,
      excluirFirmas: extraExcl,
      objetivos,
      para: para === 'ambos' ? undefined : para,
    };
  };

  const run = (excl: string[] = []) => {
    const res = generateMeals(buildReq(excl), genCtx);
    setOpciones(res.opciones);
    setAvisos(res.avisos);
    setShown([...excl, ...res.opciones.map((o) => o.firma)]);
    setTimeout(() => document.getElementById('results')?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  const regenerateOne = (idx: number) => {
    const res = generateMeals({ ...buildReq(shown), maxOpciones: 3 }, genCtx);
    const fresh = res.opciones[0];
    if (!fresh) {
      onToast('No quedan más combinaciones distintas');
      return;
    }
    setOpciones((prev) => prev && prev.map((o, i) => (i === idx ? { ...fresh, etiqueta: `${o.etiqueta} (nueva)` } : o)));
    setShown((s) => [...s, fresh.firma]);
  };

  const use = (meal: Meal) => {
    placeMeal({ ...meal, origen: 'generador' }, fecha);
    onToast(`Añadida como ${meal.bloque} de ${fechaText}${meal.para ? ` (solo ${data.profiles[meal.para].nombre})` : ''}`);
    onUsed();
  };

  const togglePantry = (ids: string[]) => setPantry(ids);
  const recientes = useMemo(
    () => recentMeals(data.history, bloque, 6, todayKey(), para === 'ambos' ? undefined : para),
    [data.history, bloque, para],
  );
  const casa = modo === 'casa';

  return (
    <div className="screen">
      <Segmented
        full
        value={modo}
        options={[
          { value: 'generador', label: '⚙️ Generador' },
          { value: 'casa', label: '🏠 Tengo esto en casa' },
        ]}
        onChange={(v) => {
          setModo(v);
          setOpciones(null);
        }}
      />

      <div className="card steps">
        <div className="step-title">
          <span className="step-num">1</span> Elige bloque
        </div>
        <Segmented
          full
          value={bloque}
          options={BLOCKS.map((b) => ({ value: b, label: b }))}
          onChange={(b) => {
            setBloque(b);
            setPara(defaultPara(b));
            setOpciones(null);
          }}
        />
        <Segmented
          full
          value={para}
          options={[
            { value: 'ambos', label: '👥 Ambos' },
            ...PROFILE_IDS.map((p) => ({ value: p as Para, label: `Solo ${data.profiles[p].nombre}` })),
          ]}
          onChange={(v) => {
            setPara(v);
            setOpciones(null);
          }}
        />
        {!isToday && (
          <div className="badge warn" style={{ alignSelf: 'flex-start' }}>
            📅 Planificando para el {fechaText}
          </div>
        )}
        <div className="sub">
          {BLOCK_DESC[bloque]} · Objetivo:{' '}
          {(para === 'ambos' ? PROFILE_IDS : [para]).map((p, k) => (
            <span key={p} className={p}>
              {k > 0 && ' · '}
              {data.profiles[p].nombre} {targets[p].kcal}±{targets[p].tolerancia}
            </span>
          ))}{' '}
          kcal
          {today?.compensar && <span className="badge warn"> compensando comida libre</span>}
          {entrenos.length > 0 && <span className="badge ok"> 🏋️ día de entreno: {entrenos.join(' y ')}</span>}
        </div>

        {casa ? (
          <>
            <div className="step-title">
              <span className="step-num">2</span> ¿Qué tienes en casa?
            </div>
            <div className="sub">Se guarda para la próxima vez.</div>
            <FoodSelector title="Tengo en casa" selected={data.pantry} onChange={togglePantry} chipClass="have" emptyText="Marca lo que tienes disponible" />
          </>
        ) : (
          <>
            <div className="step-title">
              <span className="step-num">2</span> Ingredientes obligatorios
            </div>
            <FoodSelector
              title="Quiero sí o sí"
              selected={obligatorios}
              onChange={setObligatorios}
              chipClass="must"
              disabledIds={prohibidos}
              emptyText="Ej.: arroz, albóndigas"
            />
            <div className="step-title">
              <span className="step-num">3</span> Quiero incluir <span className="sub">(opcional)</span>
            </div>
            <FoodSelector title="Quiero incluir" selected={opcionales} onChange={setOpcionales} chipClass="want" disabledIds={prohibidos} emptyText="Ej.: ratatouille" />
          </>
        )}
        <div className="step-title">
          <span className="step-num">{casa ? 3 : 4}</span> Quiero evitar <span className="sub">(opcional)</span>
        </div>
        <FoodSelector title="Quiero evitar" selected={prohibidos} onChange={setProhibidos} chipClass="avoid" disabledIds={obligatorios} emptyText="Ej.: cottage" />

        <div className="step-title">
          <span className="step-num">{casa ? 4 : 5}</span> Estilo
        </div>
        <div className="chips">
          {(Object.keys(STYLE_LABELS) as Style[]).map((s) => (
            <button key={s} className={`chip ${estilo === s ? 'on' : ''}`} onClick={() => setEstilo(s)}>
              {STYLE_LABELS[s]}
            </button>
          ))}
        </div>
        <div className="col" style={{ gap: 0 }}>
          <label className="check">
            <input type="checkbox" checked={sinLacteos} onChange={(e) => setSinLacteos(e.target.checked)} /> Sin lácteos
          </label>
          {!casa && (
            <>
              <label className="check">
                <input type="checkbox" checked={soloSeleccionados} onChange={(e) => setSoloSeleccionados(e.target.checked)} /> Usar solo
                ingredientes seleccionados
              </label>
              <label className="check">
                <input type="checkbox" checked={usarLoQueTengo} onChange={(e) => setUsarLoQueTengo(e.target.checked)} /> Usar lo que tengo en
                casa ({data.pantry.length})
              </label>
            </>
          )}
        </div>
        {!casa && recientes.length > 0 && (
          <details className="recent">
            <summary className="step-title" style={{ cursor: 'pointer' }}>
              🕘 Comidas recientes en {bloque} ({recientes.length})
            </summary>
            <div className="list" style={{ marginTop: 6 }}>
              {recientes.map((r) => (
                <div key={r.firma} className="list-item" style={{ cursor: 'default' }}>
                  <div className="grow col" style={{ gap: 1 }}>
                    <span className="ttl small">{r.meal.nombre}</span>
                    <span className="tiny muted">
                      {formatDay(r.fecha)} · {r.veces} {r.veces === 1 ? 'vez' : 'veces'}
                    </span>
                  </div>
                  <button className="btn small soft" onClick={() => use({ ...r.meal, id: `${r.meal.id}_${Date.now().toString(36)}` })}>
                    ✓ Usar
                  </button>
                </div>
              ))}
            </div>
          </details>
        )}
        {!data.settings.mismaRecetaParaAmbos && <Warnings items={['“Misma receta para ambos” está desactivado: cada uno recibirá su propio plato.']} />}
        <button className="btn primary block" onClick={() => run([])} disabled={casa && data.pantry.length === 0}>
          {casa ? '🍳 Crear comida' : '⚙️ Generar opciones'}
        </button>
      </div>

      {opciones && (
        <div id="results" className="col">
          <div className="row between">
            <h3>
              {opciones.length} opciones para {bloque}
            </h3>
            <button className="btn small" onClick={() => run(shown)}>
              ↻ Regenerar todas
            </button>
          </div>
          <Warnings items={avisos} />
          {opciones.map((o, i) => (
            <OptionCard
              key={o.id}
              option={o}
              index={i}
              targets={targets}
              prohibidos={prohibidos}
              onChange={(n) => setOpciones((prev) => prev && prev.map((x, j) => (j === i ? n : x)))}
              onRegenerate={() => regenerateOne(i)}
              onUse={use}
              useLabel={isToday ? `Usar hoy (${bloque})` : `Poner el ${formatDay(fecha, { weekday: 'short', day: 'numeric' })} (${bloque})`}
              onToast={onToast}
            />
          ))}
          {opciones.length === 0 && <div className="empty">Sin resultados. Quita alguna restricción.</div>}
        </div>
      )}
    </div>
  );
}
