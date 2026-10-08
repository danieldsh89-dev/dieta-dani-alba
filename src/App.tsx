import { useCallback, useState } from 'react';
import type { Block } from './types';
import { WeightToggle, Toast } from './components/ui';
import { HomeScreen } from './screens/HomeScreen';
import { GeneratorScreen, type GeneratorPreset } from './screens/GeneratorScreen';
import { FoodsScreen } from './screens/FoodsScreen';
import { FavoritesScreen } from './screens/FavoritesScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { BatchScreen, ConversionsScreen, DataScreen, HistoryScreen } from './screens/ToolsScreens';
import { PlanScreen } from './screens/PlanScreen';
import { SyncScreen } from './screens/SyncScreen';
import { useStore } from './store/AppStore';

type Tab = 'inicio' | 'plan' | 'generar' | 'alimentos' | 'favoritos' | 'mas';
type MoreView = 'menu' | 'sync' | 'config' | 'conversiones' | 'tanda' | 'historial' | 'datos';

const TABS: { id: Tab; label: string; ico: string }[] = [
  { id: 'inicio', label: 'Hoy', ico: '🏠' },
  { id: 'plan', label: 'Plan', ico: '📅' },
  { id: 'generar', label: 'Generar', ico: '⚙️' },
  { id: 'alimentos', label: 'Alimentos', ico: '🥕' },
  { id: 'favoritos', label: 'Favoritos', ico: '★' },
  { id: 'mas', label: 'Más', ico: '☰' },
];

const MORE_ITEMS: { id: Exclude<MoreView, 'menu'>; ico: string; title: string; sub: string }[] = [
  { id: 'sync', ico: '☁️', title: 'Sincronizar', sub: 'Compartir datos entre los móviles de Dani y Alba' },
  { id: 'config', ico: '👥', title: 'Configuración', sub: 'Perfiles, objetivos A/B/C, misma receta' },
  { id: 'conversiones', ico: '⚖️', title: 'Crudo / cocinado', sub: 'Factores de cocción y calibrar' },
  { id: 'tanda', ico: '🍲', title: 'Repartir tanda manual', sub: 'Rendimiento y raciones de una tanda suelta (desde el plan: Plan → Cocinar)' },
  { id: 'historial', ico: '📅', title: 'Historial', sub: 'Días registrados y totales' },
  { id: 'datos', ico: '💾', title: 'Datos', sub: 'Exportar, importar, restablecer' },
];

const SYNC_ICON = { off: '', idle: '☁️', syncing: '🔄', error: '⚠️', offline: '📴' } as const;

export default function App() {
  const { syncStatus } = useStore();
  const [tab, setTab] = useState<Tab>('inicio');
  const [returnTo, setReturnTo] = useState<Tab>('inicio');
  const [more, setMore] = useState<MoreView>('menu');
  const [preset, setPreset] = useState<GeneratorPreset | undefined>();
  const [genKey, setGenKey] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const showToast = useCallback((t: string) => setToast(t), []);
  const clearToast = useCallback(() => setToast(null), []);

  const goGenerate = (b: Block, fecha?: string) => {
    setReturnTo(tab);
    setPreset({ bloque: b, fecha });
    setGenKey((k) => k + 1);
    setTab('generar');
    window.scrollTo(0, 0);
  };

  const moreItem = MORE_ITEMS.find((m) => m.id === more);
  const title =
    tab === 'inicio'
      ? 'Dieta Dani & Alba'
      : tab === 'plan'
        ? 'Plan semanal'
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
        <div className="row" style={{ gap: 6 }}>
          {syncStatus !== 'off' && (
            <button
              className="iconbtn"
              style={{ border: 'none', background: 'none' }}
              title="Sincronización"
              onClick={() => {
                setTab('mas');
                setMore('sync');
              }}
            >
              {SYNC_ICON[syncStatus]}
            </button>
          )}
          <WeightToggle />
        </div>
      </header>

      {tab === 'inicio' && <HomeScreen onGenerate={(b) => goGenerate(b)} onToast={showToast} />}
      {tab === 'plan' && <PlanScreen onGenerate={goGenerate} onToast={showToast} />}
      {tab === 'generar' && (
        <GeneratorScreen key={genKey} preset={preset} onToast={showToast} onUsed={() => setTab(returnTo === 'plan' ? 'plan' : 'inicio')} />
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
      {tab === 'mas' && more === 'sync' && <SyncScreen onToast={showToast} />}
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
                  setReturnTo('inicio');
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
