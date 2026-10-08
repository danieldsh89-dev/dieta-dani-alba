import { useMemo, useState } from 'react';
import type { Block, Category, Food, FoodTag, NutritionState, Unit, Verification } from '../types';
import { BLOCKS } from '../types';
import { newId, useStore } from '../store/AppStore';
import { validateFood } from '../lib/validation';
import { kcalFromMacros } from '../lib/nutrition';
import { normalize } from '../components/FoodPicker';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { lookupBarcode } from '../lib/openFoodFacts';
import { CATEGORY_ICONS, CATEGORY_LABELS, NumberInput, Sheet, VerificationBadge, Warnings } from '../components/ui';

const CATS = Object.keys(CATEGORY_LABELS) as Category[];

const TAG_LABELS: Partial<Record<FoodTag, string>> = {
  pescado: 'Pescado',
  leche_vaca: 'Leche de vaca',
  lacteo: 'Lácteo',
  legumbre: 'Legumbre',
  picante: 'Picante',
  dulce: 'Dulce',
  salado: 'Salado',
  acompanante: 'Acompañante (gazpacho…)',
  sustituto_ligero: 'Sustituto ligero (no equivalente)',
  solo_si_se_incluye: 'Solo si lo incluyo',
  solo_en_receta: 'Solo dentro de recetas',
  sal_alta: 'Sal alta',
  provisional: 'Provisional',
};

export function newFood(): Food {
  return {
    id: newId('food'),
    nombre: '',
    marca: '',
    categoria: 'proteina',
    kcalPor100: 0,
    proteinaPor100: 0,
    carbohidratosPor100: 0,
    grasasPor100: 0,
    unidadBase: 'g',
    estadoNutricionalBase: 'listo_para_consumir',
    porcionMinima: 10,
    porcionMaxima: 300,
    incremento: 5,
    porcionHabitual: 100,
    bloques: ['A', 'B', 'C'],
    tags: [],
    verificacion: 'verificado',
    personalizado: true,
  };
}

export function FoodsScreen({ onToast }: { onToast: (t: string) => void }) {
  const { data } = useStore();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<Category | 'todas'>('todas');
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<Food | null>(null);
  const [scanning, setScanning] = useState(false);
  const [looking, setLooking] = useState(false);

  const onCode = async (code: string) => {
    setScanning(false);
    const existing = data.foods.find((f) => f.codigoBarras === code);
    if (existing) {
      onToast('Ya está en tu base de alimentos');
      setEditing(existing);
      return;
    }
    setLooking(true);
    const r = await lookupBarcode(code);
    setLooking(false);
    if (r.status === 'found') {
      const food: Food = { ...newFood(), ...r.food, tags: r.food.tags ?? [] };
      if (r.imageUrl) {
        try {
          const blob = await (await fetch(r.imageUrl)).blob();
          food.foto = await resizeImage(blob);
        } catch {
          /* sin foto */
        }
      }
      onToast('Producto encontrado: revisa los valores y guarda');
      setEditing(food);
    } else {
      onToast(r.status === 'not_found' ? 'No está en Open Food Facts: rellénalo con la etiqueta' : `${r.message}: rellénalo a mano`);
      setEditing({ ...newFood(), codigoBarras: code });
    }
  };

  const list = useMemo(() => {
    const nq = normalize(q);
    return data.foods
      .filter((f) => !!f.archivado === archived)
      .filter((f) => cat === 'todas' || f.categoria === cat)
      .filter((f) => !nq || normalize(`${f.nombre} ${f.marca ?? ''} ${f.codigoBarras ?? ''}`).includes(nq))
      .sort((a, b) => CATS.indexOf(a.categoria) - CATS.indexOf(b.categoria) || a.nombre.localeCompare(b.nombre));
  }, [data.foods, q, cat, archived]);

  return (
    <div className="screen">
      <div className="row">
        <input type="search" placeholder="Buscar alimento o marca…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn" onClick={() => setScanning(true)} disabled={looking} aria-label="Escanear código de barras">
          {looking ? '⏳' : '📷'}
        </button>
        <button className="btn primary" onClick={() => setEditing(newFood())}>
          ＋ Nuevo
        </button>
      </div>
      {looking && <div className="sub">Buscando el producto en Open Food Facts…</div>}
      {scanning && <BarcodeScanner onDetected={onCode} onClose={() => setScanning(false)} />}
      <div className="chips">
        <button className={`chip ${cat === 'todas' ? 'on' : ''}`} onClick={() => setCat('todas')}>
          Todas
        </button>
        {CATS.map((c) => (
          <button key={c} className={`chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>
            {CATEGORY_ICONS[c]} {CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>
      <label className="check small">
        <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Ver archivados
      </label>
      <div className="list">
        {list.map((f) => (
          <button key={f.id} className="list-item" onClick={() => setEditing(f)}>
            {f.foto ? <img className="thumb" src={f.foto} alt="" /> : <div className="thumb">{CATEGORY_ICONS[f.categoria]}</div>}
            <div className="grow col" style={{ gap: 2 }}>
              <div className="ttl">{f.nombre}</div>
              <div className="row wrap tiny muted" style={{ gap: 6 }}>
                {f.marca && <span>{f.marca}</span>}
                <span>
                  {f.kcalPor100} kcal · P {f.proteinaPor100} /100{f.unidadBase === 'ml' ? 'ml' : 'g'}
                </span>
                <span>{f.estadoNutricionalBase === 'crudo' ? 'crudo' : f.estadoNutricionalBase === 'cocinado' ? 'cocinado' : 'listo'}</span>
              </div>
            </div>
            <VerificationBadge food={f} compact />
          </button>
        ))}
        {list.length === 0 && <div className="empty">Sin alimentos</div>}
      </div>
      {editing && <FoodForm key={editing.id} food={editing} onClose={() => setEditing(null)} onToast={onToast} onSwitch={setEditing} />}
    </div>
  );
}

async function resizeImage(file: Blob, size = 256): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const scale = Math.min(1, size / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.75);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function FoodForm({
  food,
  onClose,
  onToast,
  onSwitch,
}: {
  food: Food;
  onClose: () => void;
  onToast: (t: string) => void;
  onSwitch: (f: Food) => void;
}) {
  const { data, saveFood, duplicateFood, setArchived } = useStore();
  const [f, setF] = useState<Food>(structuredClone(food));
  const [advanced, setAdvanced] = useState(!data.foods.some((x) => x.id === food.id) ? false : true);
  const isNew = !data.foods.some((x) => x.id === food.id);
  const v = validateFood(f);
  const set = <K extends keyof Food>(k: K, val: Food[K]) => setF((p) => ({ ...p, [k]: val }));
  const num = (k: 'kcalPor100' | 'proteinaPor100' | 'carbohidratosPor100' | 'grasasPor100' | 'porcionMinima' | 'porcionMaxima' | 'incremento' | 'porcionHabitual') =>
    (val: number | undefined) => set(k, val ?? 0);
  const conv = f.conversionId ? data.conversions.find((c) => c.id === f.conversionId) : undefined;
  const rangeUnit = f.unidadBase === 'unidad' ? f.nombreUnidad ?? 'unidades' : `${f.unidadBase}${conv && f.estadoNutricionalBase !== 'listo_para_consumir' ? ' cocinados' : ''}`;

  const save = () => {
    if (v.errors.length) return;
    saveFood({ ...f, nombre: f.nombre.trim(), marca: f.marca?.trim() || undefined });
    onToast(isNew ? 'Producto creado' : 'Cambios guardados');
    onClose();
  };

  return (
    <Sheet
      title={isNew ? 'Crear producto' : 'Editar alimento'}
      onClose={onClose}
      actions={
        <button className="btn primary small" onClick={save} disabled={v.errors.length > 0}>
          Guardar
        </button>
      }
    >
      <div className="row">
        {f.foto ? <img className="thumb" src={f.foto} alt="" style={{ width: 56, height: 56 }} /> : <div className="thumb" style={{ width: 56, height: 56 }}>{CATEGORY_ICONS[f.categoria]}</div>}
        <label className="btn small">
          📷 Foto
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) set('foto', await resizeImage(file));
            }}
          />
        </label>
        {f.foto && (
          <button className="btn small" onClick={() => set('foto', undefined)}>
            Quitar foto
          </button>
        )}
      </div>
      {(!isNew || f.notaVerificacion) && (
        <div className="row wrap">
          <VerificationBadge food={f} />
          {f.notaVerificacion && <span className="tiny muted">{f.notaVerificacion}</span>}
        </div>
      )}
      <label className="field">
        Nombre
        <input type="text" value={f.nombre} onChange={(e) => set('nombre', e.target.value)} placeholder="Ej.: Pechuga de pavo" />
      </label>
      <div className="grid2">
        <label className="field">
          Marca
          <input type="text" value={f.marca ?? ''} onChange={(e) => set('marca', e.target.value)} placeholder="Opcional" />
        </label>
        <label className="field">
          Categoría
          <select value={f.categoria} onChange={(e) => set('categoria', e.target.value as Category)}>
            {CATS.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        Código de barras
        <input type="text" inputMode="numeric" value={f.codigoBarras ?? ''} onChange={(e) => set('codigoBarras', e.target.value.replace(/\D/g, '') || undefined)} placeholder="Opcional (se rellena al escanear)" />
      </label>
      <div className="sub">Valores por 100 {f.unidadBase === 'ml' ? 'ml' : 'g'}</div>
      <div className="grid3">
        <label className="field">
          kcal
          <NumberInput value={f.kcalPor100} onChange={num('kcalPor100')} step={1} />
        </label>
        <label className="field">
          Proteína g
          <NumberInput value={f.proteinaPor100} onChange={num('proteinaPor100')} step={0.1} />
        </label>
        <label className="field">
          Hidratos g
          <NumberInput value={f.carbohidratosPor100} onChange={num('carbohidratosPor100')} step={0.1} />
        </label>
        <label className="field">
          Grasa g
          <NumberInput value={f.grasasPor100} onChange={num('grasasPor100')} step={0.1} />
        </label>
        <label className="field">
          Fibra g
          <NumberInput value={f.fibraPor100} allowEmpty onChange={(x) => set('fibraPor100', x)} step={0.1} />
        </label>
        <label className="field">
          Sal g
          <NumberInput value={f.salPor100} allowEmpty onChange={(x) => set('salPor100', x)} step={0.01} />
        </label>
      </div>
      <div className="tiny muted">
        Kcal calculadas por macros: {Math.round(kcalFromMacros(f.proteinaPor100, f.carbohidratosPor100, f.grasasPor100))}
      </div>
      <div className="grid2">
        <label className="field">
          Estado del peso (valores)
          <select value={f.estadoNutricionalBase} onChange={(e) => set('estadoNutricionalBase', e.target.value as NutritionState)}>
            <option value="crudo">Crudo / seco / congelado</option>
            <option value="cocinado">Cocinado</option>
            <option value="listo_para_consumir">Listo para consumir</option>
          </select>
        </label>
        <label className="field">
          Verificación
          <select value={f.verificacion} onChange={(e) => set('verificacion', e.target.value as Verification)}>
            <option value="verificado">✓ Verificado (etiqueta)</option>
            <option value="parcial">≈ Parcial (kcal verificadas)</option>
            <option value="aproximado">≈ Aproximado – revisar</option>
          </select>
        </label>
      </div>
      <Warnings items={[...v.errors.map((t) => ({ level: 'error', text: t })), ...v.warnings.map((t) => ({ level: 'aviso', text: t }))]} />

      <button className="btn small" onClick={() => setAdvanced(!advanced)}>
        {advanced ? '▲ Ocultar opciones avanzadas' : '▼ Raciones, cocción y etiquetas'}
      </button>
      {advanced && (
        <div className="col">
          <div className="grid2">
            <label className="field">
              Unidad de ración
              <select value={f.unidadBase} onChange={(e) => set('unidadBase', e.target.value as Unit)}>
                <option value="g">Gramos</option>
                <option value="ml">Mililitros</option>
                <option value="unidad">Unidades (huevo, rebanada…)</option>
              </select>
            </label>
            <label className="field">
              Conversión de cocción
              <select value={f.conversionId ?? ''} onChange={(e) => set('conversionId', e.target.value || undefined)}>
                <option value="">Ninguna</option>
                {data.conversions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre} ({c.metodos.map((m) => `×${m.factor}`).join(', ')})
                  </option>
                ))}
              </select>
            </label>
          </div>
          {(f.unidadBase === 'unidad' || f.pesoUnidad) && (
            <div className="grid2">
              <label className="field">
                Peso de 1 unidad (g)
                <NumberInput value={f.pesoUnidad} allowEmpty onChange={(x) => set('pesoUnidad', x)} />
              </label>
              <label className="field">
                Nombre de unidad
                <input type="text" value={f.nombreUnidad ?? ''} onChange={(e) => set('nombreUnidad', e.target.value)} placeholder="rebanada" />
              </label>
            </div>
          )}
          <div className="sub">Ración para el generador (en {rangeUnit})</div>
          <div className="grid2">
            <label className="field">
              Mínima
              <NumberInput value={f.porcionMinima} onChange={num('porcionMinima')} />
            </label>
            <label className="field">
              Máxima
              <NumberInput value={f.porcionMaxima} onChange={num('porcionMaxima')} />
            </label>
            <label className="field">
              Incremento
              <NumberInput value={f.incremento} onChange={num('incremento')} />
            </label>
            <label className="field">
              Habitual (Dani)
              <NumberInput value={f.porcionHabitual} onChange={num('porcionHabitual')} />
            </label>
          </div>
          <div className="sub">Límites para Alba (vacío = automático)</div>
          <div className="grid3">
            {(['min', 'max', 'habitual'] as const).map((k) => (
              <label key={k} className="field">
                <span className="alba">{k === 'min' ? 'Mín.' : k === 'max' ? 'Máx.' : 'Habitual'}</span>
                <NumberInput
                  value={f.limitesPerfil?.alba?.[k]}
                  allowEmpty
                  onChange={(x) =>
                    set('limitesPerfil', { ...f.limitesPerfil, alba: { ...f.limitesPerfil?.alba, [k]: x } })
                  }
                />
              </label>
            ))}
          </div>
          <div className="sub">Bloques donde suele usarse</div>
          <div className="chips">
            {BLOCKS.map((b: Block) => (
              <button
                key={b}
                className={`chip ${f.bloques.includes(b) ? 'on' : ''}`}
                onClick={() => set('bloques', f.bloques.includes(b) ? f.bloques.filter((x) => x !== b) : [...f.bloques, b])}
              >
                {b}
              </button>
            ))}
          </div>
          <div className="sub">Etiquetas (restricciones y generador)</div>
          <div className="chips">
            {(Object.keys(TAG_LABELS) as FoodTag[]).map((t) => (
              <button
                key={t}
                className={`chip ${f.tags.includes(t) ? 'on' : ''}`}
                onClick={() => set('tags', f.tags.includes(t) ? f.tags.filter((x) => x !== t) : [...f.tags, t])}
              >
                {TAG_LABELS[t]}
              </button>
            ))}
          </div>
          <label className="field">
            Nota de verificación
            <textarea rows={2} value={f.notaVerificacion ?? ''} onChange={(e) => set('notaVerificacion', e.target.value || undefined)} />
          </label>
          <label className="field">
            Aviso al usarlo (p. ej. sal elevada)
            <input type="text" value={f.aviso ?? ''} onChange={(e) => set('aviso', e.target.value || undefined)} />
          </label>
        </div>
      )}
      {!isNew && (
        <div className="btn-row">
          <button
            className="btn small"
            onClick={() => {
              const copy = duplicateFood(food.id);
              if (copy) {
                onToast('Producto duplicado');
                onSwitch(copy);
              }
            }}
          >
            ⧉ Duplicar
          </button>
          <button
            className="btn small danger"
            onClick={() => {
              setArchived(food.id, !food.archivado);
              onToast(food.archivado ? 'Recuperado' : 'Archivado (no se usará en el generador)');
              onClose();
            }}
          >
            {food.archivado ? 'Desarchivar' : 'Archivar'}
          </button>
        </div>
      )}
    </Sheet>
  );
}
