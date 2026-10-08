import { useCallback, useState } from 'react';
import type { Block } from './types';
import { WeightToggle, Toast } from './components/ui';
import { HomeScreen } from './screens/HomeScreen';
import { GeneratorScreen, type GeneratorPreset } from './screens/GeneratorScreen';
import { FoodsScreen } from './screens/FoodsScreen';
import { FavoritesScreen } from './screens/FavoritesScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { BatchScreen, ConversionsScreen, DataScreen, HistoryScreen } from './screens/ToolsScreens';

type Tab = 'inicio' | 'generar' | 'alimentos' | 'favoritos' | 'mas';
type MoreView = 'menu' | 'config' | 'conversiones' | 'tanda' | 'historial' | 'datos';

const TABS: { id: Tab; label: string; ico: string }[] = [
  { id: 'inicio', label: 'Inicio', ico: '🏠' },
  { id: 'generar', label: 'Generar', ico: '⚙️' },
  { id: 'alimentos', label: 'Alimentos', ico: '🥕' },
  { id: 'favoritos', label: 'Favoritos', ico: '★' },
  { id: 'mas', label: 'Más', ico: '☰' },
];

const MORE_ITEMS: { id: Exclude<MoreView, 'menu'>; ico: string; title: string; sub: string }[] = [
  { id: 'config', ico: '👥', title: 'Configuración', sub: 'Perfiles, objetivos A/B/C, misma receta' },
  { id: 'conversiones', ico: '⚖️', title: 'Crudo / cocinado', sub: 'Factores de cocción y calibrar' },
  { id: 'tanda', ico: '🍲', title: 'Repartir tanda', sub: 'Batch cooking: rendimiento y raciones' },
  { id: 'historial', ico: '📅', title: 'Historial', sub: 'Días registrados y totales' },
  { id: 'datos', ico: '💾', title: 'Datos', sub: 'Exportar, importar, restablecer' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('inicio');
  const [more, setMore] = useState<MoreView>('menu');
  const [preset, setPreset] = useState<GeneratorPreset | undefined>();
  const [genKey, setGenKey] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const showToast = useCallback((t: string) => setToast(t), []);
  const clearToast = useCallback(() => setToast(null), []);

  const goGenerate = (b: Block) => {
    setPreset({ bloque: b });
    setGenKey((k) => k + 1);
    setTab('generar');
    window.scrollTo(0, 0);
  };

  const moreItem = MORE_ITEMS.find((m) => m.id === more);
  const title =
    tab === 'inicio'
      ? 'Dieta Dani & Alba'
      : tab === 'generar'
        ? 'Generador A/B/C'
        : tab === 'alimentos'
          ? 'Alimentos'
          : tab === 'favoritos'
            ? 'Favoritos'
            : moreItem?.title ?? 'Más';

  return (
    <div className="app">
      <header className="topbar">
        <div className="row" style={{ minWidth: 0 }}>
          {tab === 'mas' && more !== 'menu' && (
            <button className="back" onClick={() => setMore('menu')} aria-label="Volver">
              ‹
            </button>
          )}
          <h1>{title}</h1>
        </div>
        <WeightToggle />
      </header>

      {tab === 'inicio' && <HomeScreen onGenerate={goGenerate} onToast={showToast} />}
      {tab === 'generar' && (
        <GeneratorScreen key={genKey} preset={preset} onToast={showToast} onUsed={() => setTab('inicio')} />
      )}
      {tab === 'alimentos' && <FoodsScreen onToast={showToast} />}
      {tab === 'favoritos' && <FavoritesScreen onToast={showToast} />}
      {tab === 'mas' && more === 'menu' && (
        <div className="screen">
          <div className="list">
            {MORE_ITEMS.map((m) => (
              <button key={m.id} className="list-item" onClick={() => setMore(m.id)}>
                <div className="thumb">{m.ico}</div>
                <div className="grow">
                  <div className="ttl">{m.title}</div>
                  <div className="sub">{m.sub}</div>
                </div>
                <span className="muted">›</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {tab === 'mas' && more === 'config' && <SettingsScreen onToast={showToast} />}
      {tab === 'mas' && more === 'conversiones' && <ConversionsScreen onToast={showToast} />}
      {tab === 'mas' && more === 'tanda' && <BatchScreen />}
      {tab === 'mas' && more === 'historial' && <HistoryScreen />}
      {tab === 'mas' && more === 'datos' && <DataScreen onToast={showToast} />}

      <nav className="bottomnav">
        <div className="bottomnav-inner">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? 'active' : ''}
              onClick={() => {
                if (t.id === 'generar' && tab !== 'generar') {
                  setPreset(undefined);
                }
                if (t.id === 'mas' && tab === 'mas') setMore('menu');
                setTab(t.id);
                window.scrollTo(0, 0);
              }}
            >
              <span className="ico">{t.ico}</span>
              {t.label}
            </button>
          ))}
        </div>
      </nav>
      {toast && <Toast text={toast} onDone={clearToast} />}
    </div>
  );
}
