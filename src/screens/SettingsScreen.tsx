import { useState } from 'react';
import type { Profile, ProfileId } from '../types';
import { BLOCKS, PROFILE_IDS } from '../types';
import { useStore } from '../store/AppStore';
import { NumberInput, Segmented } from '../components/ui';

export function SettingsScreen({ onToast }: { onToast: (t: string) => void }) {
  const { data, updateSettings } = useStore();
  const s = data.settings;
  const [pid, setPid] = useState<ProfileId>('dani');
  return (
    <div className="screen">
      <div className="card">
        <h3>Ajustes generales</h3>
        <label className="check">
          <input type="checkbox" checked={s.mismaRecetaParaAmbos} onChange={(e) => updateSettings({ mismaRecetaParaAmbos: e.target.checked })} />
          <span>
            <b>Misma receta para ambos</b>
            <div className="sub">Mismos ingredientes, distintas cantidades.</div>
          </span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={s.permitirComplementosDistintos}
            onChange={(e) => updateSettings({ permitirComplementosDistintos: e.target.checked })}
          />
          <span>
            <b>Permitir postre/complemento distinto</b>
            <div className="sub">Si a uno le faltan kcal, el generador puede añadirle un postre o fruta solo a él.</div>
          </span>
        </label>
        <label className="check">
          <input type="checkbox" checked={s.mostrarFibraSal} onChange={(e) => updateSettings({ mostrarFibraSal: e.target.checked })} />
          <b>Mostrar fibra y sal</b>
        </label>
        <div className="row between">
          <b className="small">Pesos por defecto</b>
          <Segmented
            value={s.mostrarPesos}
            options={[
              { value: 'crudo', label: 'Crudos' },
              { value: 'cocinado', label: 'Cocinados' },
            ]}
            onChange={(v) => updateSettings({ mostrarPesos: v })}
          />
        </div>
      </div>
      <Segmented full value={pid} options={PROFILE_IDS.map((p) => ({ value: p, label: data.profiles[p].nombre }))} onChange={setPid} />
      <ProfileForm key={pid} profile={data.profiles[pid]} onToast={onToast} />
    </div>
  );
}

function ProfileForm({ profile, onToast }: { profile: Profile; onToast: (t: string) => void }) {
  const { saveProfile } = useStore();
  const [p, setP] = useState<Profile>(structuredClone(profile));
  const dirty = JSON.stringify(p) !== JSON.stringify(profile);
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setP((x) => ({ ...x, [k]: v }));
  const sumBlocks = BLOCKS.reduce((s, b) => s + p.bloques[b].kcal, 0);
  const sumProt = BLOCKS.reduce((s, b) => s + p.bloques[b].proteina, 0);

  return (
    <div className="card">
      <div className="row between">
        <h3 className={p.id}>{p.nombre}</h3>
        <button
          className="btn primary small"
          disabled={!dirty}
          onClick={() => {
            saveProfile(p);
            onToast('Perfil guardado');
          }}
        >
          Guardar
        </button>
      </div>
      <div className="grid3">
        <label className="field">
          Nombre
          <input type="text" value={p.nombre} onChange={(e) => set('nombre', e.target.value)} />
        </label>
        <label className="field">
          Edad
          <NumberInput value={p.edad} onChange={(v) => set('edad', v ?? 0)} />
        </label>
        <label className="field">
          Altura cm
          <NumberInput value={p.alturaCm} onChange={(v) => set('alturaCm', v ?? 0)} />
        </label>
        <label className="field">
          Peso kg
          <NumberInput value={p.pesoActualKg} step={0.1} onChange={(v) => set('pesoActualKg', v ?? 0)} />
        </label>
        <label className="field">
          Objetivo kg
          <NumberInput value={p.pesoObjetivoKg} step={0.1} onChange={(v) => set('pesoObjetivoKg', v ?? 0)} />
        </label>
        <label className="field">
          Escala raciones
          <NumberInput value={p.escalaRaciones} step={0.05} onChange={(v) => set('escalaRaciones', v ?? 1)} />
        </label>
        <label className="field">
          kcal / día{p.entreno?.activo ? ' (descanso)' : ''}
          <NumberInput value={p.kcalDia} step={10} onChange={(v) => set('kcalDia', v ?? 0)} />
        </label>
        <label className="field">
          Proteína g/día
          <NumberInput value={p.proteinaDia} onChange={(v) => set('proteinaDia', v ?? 0)} />
        </label>
      </div>
      <hr />
      <b className="small">Objetivos por bloque {p.entreno?.activo ? '(días de descanso)' : ''}</b>
      <div className="grid3 tiny muted" style={{ gridTemplateColumns: '28px 1fr 1fr 1fr' }}>
        <span />
        <span>kcal</span>
        <span>± tolerancia</span>
        <span>proteína g</span>
        {BLOCKS.map((b) => (
          <BlockRow key={b} b={b} p={p} setP={setP} />
        ))}
      </div>
      <div className="tiny muted">
        Suma bloques: {sumBlocks} kcal ({p.kcalDia - sumBlocks >= 0 ? `${p.kcalDia - sumBlocks} libres` : `${sumBlocks - p.kcalDia} por encima`} del
        objetivo diario) · Proteína {sumProt} g
      </div>
      <hr />
      <TrainingSection p={p} setP={setP} />
      <hr />
      <b className="small">Restricciones y preferencias</b>
      <label className="check">
        <input
          type="checkbox"
          checked={p.restricciones.permitePescado}
          onChange={(e) => set('restricciones', { ...p.restricciones, permitePescado: e.target.checked })}
        />
        Come pescado
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={p.restricciones.permiteLecheVaca}
          onChange={(e) => set('restricciones', { ...p.restricciones, permiteLecheVaca: e.target.checked })}
        />
        Toma leche de vaca
      </label>
      <div className="grid2">
        <label className="field">
          Máx. legumbres por comida (g, vacío = sin límite)
          <NumberInput
            value={p.restricciones.maxLegumbresPorComida ?? undefined}
            allowEmpty
            onChange={(v) => set('restricciones', { ...p.restricciones, maxLegumbresPorComida: v ?? null })}
          />
        </label>
        <label className="field">
          Sabor preferido en A
          <select value={p.saborPreferidoA} onChange={(e) => set('saborPreferidoA', e.target.value as Profile['saborPreferidoA'])}>
            <option value="salado">Salado</option>
            <option value="dulce">Dulce</option>
            <option value="ambos">Ambos</option>
          </select>
        </label>
      </div>
      <label className="field">
        Notas
        <textarea rows={3} value={p.notas} onChange={(e) => set('notas', e.target.value)} />
      </label>
    </div>
  );
}

const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

function TrainingSection({ p, setP }: { p: Profile; setP: (fn: (x: Profile) => Profile) => void }) {
  const e = p.entreno;
  const upd = (patch: Partial<Profile['entreno']>) => setP((x) => ({ ...x, entreno: { ...x.entreno, ...patch } }));
  const sum = BLOCKS.reduce((s, b) => s + e.bloques[b].kcal, 0);
  return (
    <>
      <label className="check">
        <input type="checkbox" checked={e.activo} onChange={(ev) => upd({ activo: ev.target.checked })} />
        <b className="small">🏋️ Objetivos distintos los días de entreno</b>
      </label>
      {e.activo && (
        <>
          <div className="sub">Días de entreno por defecto (en Hoy puedes cambiar cualquier día con un toque):</div>
          <div className="chips">
            {WEEKDAYS.map((d, i) => (
              <button
                key={d}
                className={`chip ${e.dias.includes(i) ? 'on' : ''}`}
                onClick={() => upd({ dias: e.dias.includes(i) ? e.dias.filter((x) => x !== i) : [...e.dias, i].sort() })}
              >
                {d}
              </button>
            ))}
          </div>
          <div className="grid2">
            <label className="field">
              kcal / día de entreno
              <NumberInput value={e.kcalDia} step={10} onChange={(v) => upd({ kcalDia: v ?? 0 })} />
            </label>
            <label className="field">
              Proteína g / día de entreno
              <NumberInput value={e.proteinaDia} onChange={(v) => upd({ proteinaDia: v ?? 0 })} />
            </label>
          </div>
          <div className="grid3 tiny muted" style={{ gridTemplateColumns: '28px 1fr 1fr 1fr' }}>
            <span />
            <span>kcal</span>
            <span>± tolerancia</span>
            <span>proteína g</span>
            {BLOCKS.map((b) => (
              <TrainingBlockRow key={b} b={b} p={p} setP={setP} />
            ))}
          </div>
          <div className="tiny muted">
            Suma bloques en día de entreno: {sum} kcal (+{sum - BLOCKS.reduce((s, b) => s + p.bloques[b].kcal, 0)} respecto a descanso). Las kcal
            extra van sobre todo al bloque B: el generador sube el hidrato para cuadrarlas.
          </div>
        </>
      )}
    </>
  );
}

function TrainingBlockRow({ b, p, setP }: { b: 'A' | 'B' | 'C'; p: Profile; setP: (fn: (x: Profile) => Profile) => void }) {
  const t = p.entreno.bloques[b];
  const upd = (k: keyof typeof t, v: number | undefined) =>
    setP((x) => ({
      ...x,
      entreno: { ...x.entreno, bloques: { ...x.entreno.bloques, [b]: { ...x.entreno.bloques[b], [k]: v ?? 0 } } },
    }));
  return (
    <>
      <b style={{ alignSelf: 'center', color: 'var(--primary)' }}>{b}</b>
      <NumberInput value={t.kcal} step={10} onChange={(v) => upd('kcal', v)} />
      <NumberInput value={t.tolerancia} step={5} onChange={(v) => upd('tolerancia', v)} />
      <NumberInput value={t.proteina} onChange={(v) => upd('proteina', v)} />
    </>
  );
}

function BlockRow({ b, p, setP }: { b: 'A' | 'B' | 'C'; p: Profile; setP: (fn: (x: Profile) => Profile) => void }) {
  const t = p.bloques[b];
  const upd = (k: keyof typeof t, v: number | undefined) =>
    setP((x) => ({ ...x, bloques: { ...x.bloques, [b]: { ...x.bloques[b], [k]: v ?? 0 } } }));
  return (
    <>
      <b style={{ alignSelf: 'center', color: 'var(--primary)' }}>{b}</b>
      <NumberInput value={t.kcal} step={10} onChange={(v) => upd('kcal', v)} />
      <NumberInput value={t.tolerancia} step={5} onChange={(v) => upd('tolerancia', v)} />
      <NumberInput value={t.proteina} onChange={(v) => upd('proteina', v)} />
    </>
  );
}
