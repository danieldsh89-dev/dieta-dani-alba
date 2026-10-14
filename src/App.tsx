import { useCallback, useEffect, useRef, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import type { Block, ProfileId } from './types';
import { WeightToggle, Toast } from './components/ui';
import { HomeScreen } from './screens/HomeScreen';
import { GeneratorScreen, type GeneratorPreset } from './screens/GeneratorScreen';
import { FoodsScreen } from './screens/FoodsScreen';
import { FavoritesScreen } from './screens/FavoritesScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { BatchScreen, ConversionsScreen, DataScreen, HistoryScreen } from './screens/ToolsScreens';
import { PlanScreen } from './screens/PlanScreen';
import { SyncScreen } from './screens/SyncScreen';
import { ProgressScreen } from './screens/ProgressScreen';
import { MercadonaScreen } from './screens/MercadonaScreen';
import { CasaScreen, type CasaView } from './screens/CasaScreen';
import { ConfirmDaySheet } from './components/ConfirmDaySheet';
import { GlobalSearch, type SearchTarget } from './components/GlobalSearch';
import { AsistenteSheet } from './components/AsistenteSheet';
import { PlanVozSheet } from './components/PlanVozSheet';
import { GlobalTimer } from './components/GlobalTimer';
import type { Destino } from './lib/asistente';
import { onReminderTap, scheduleReminders } from './lib/notify';
import { todayKey } from './lib/day';
import { isNative } from './integrations/mercadona/http';
import { loadSession } from './integrations/mercadona/session';
import { makeClient } from './integrations/mercadona/service';
import { syncOrders } from './integrations/mercadona/orders';
import { useStore } from './store/AppStore';
import { useBackHandler } from './lib/back';

type Tab = 'inicio' | 'plan' | 'generar' | 'casa' | 'favoritos' | 'mas';
type MoreView = 'menu' | 'alimentos' | 'progreso' | 'mercadona' | 'sync' | 'config' | 'conversiones' | 'tanda' | 'historial' | 'datos';

const TABS: { id: Tab; label: string; ico: string }[] = [
  { id: 'inicio', label: 'Hoy', ico: '🏠' },
  { id: 'plan', label: 'Plan', ico: '📅' },
  { id: 'generar', label: 'Generar', ico: '⚙️' },
  { id: 'casa', label: 'Casa', ico: '🧺' },
  { id: 'favoritos', label: 'Favoritos', ico: '★' },
  { id: 'mas', label: 'Más', ico: '☰' },
];

const MORE_ITEMS: { id: Exclude<MoreView, 'menu'>; ico: string; title: string; sub: string }[] = [
  { id: 'alimentos', ico: '🥕', title: 'Alimentos', sub: 'Base de alimentos: valores, raciones, escáner de códigos' },
  { id: 'progreso', ico: '📈', title: 'Progreso', sub: 'Peso, tendencia y gráficas semanales de kcal y proteína' },
  { id: 'mercadona', ico: '🛒', title: 'Mercadona', sub: 'Cuenta, entrega, productos vinculados y diagnóstico' },
  { id: 'sync', ico: '☁️', title: 'Sincronizar', sub: 'Compartir datos entre los móviles de Dani y Alba' },
  { id: 'config', ico: '👥', title: 'Configuración', sub: 'Perfiles, objetivos A/B/C, misma receta' },
  { id: 'conversiones', ico: '⚖️', title: 'Crudo / cocinado', sub: 'Factores de cocción y calibrar' },
  { id: 'tanda', ico: '🍲', title: 'Repartir tanda manual', sub: 'Rendimiento y raciones de una tanda suelta (desde el plan: Plan → Cocinar)' },
  { id: 'historial', ico: '📅', title: 'Historial', sub: 'Días registrados y totales' },
  { id: 'datos', ico: '💾', title: 'Datos', sub: 'Exportar, importar, restablecer' },
];

const SYNC_ICON = { off: '', idle: '☁️', syncing: '🔄', error: '⚠️', offline: '📴' } as const;

export default function App() {
  const { syncStatus, data, fm, stockApply } = useStore();
  const [casaView, setCasaView] = useState<CasaView | undefined>();
  const [casaKey, setCasaKey] = useState(0);
  const [confirmFecha, setConfirmFecha] = useState<string | null>(null);
  const [search, setSearch] = useState<string | false>(false);
  const [asistente, setAsistente] = useState<{ listen: boolean } | null>(null);
  const [planVoz, setPlanVoz] = useState<string | null>(null);
  const [timerEnd, setTimerEnd] = useState<number | null>(null);
  const [planView, setPlanView] = useState<{ v: 'semana' | 'lista' | 'mercadona'; n: number } | undefined>();
  const goDestino = (dst: Destino) => {
    window.scrollTo(0, 0);
    if (dst === 'hoy') return setTab('inicio');
    if (dst === 'plan' || dst === 'compra' || dst === 'mercadona') {
      setPlanView({ v: dst === 'plan' ? 'semana' : dst === 'compra' ? 'lista' : 'mercadona', n: Date.now() });
      return setTab('plan');
    }
    if (dst === 'casa' || dst === 'revision') return openCasa(dst === 'casa' ? 'stock' : 'revisar');
    if (dst === 'favoritos') return setTab('favoritos');
    if (dst === 'generar') return setTab('generar');
    setTab('mas');
    setMore(dst === 'progreso' ? 'progreso' : 'alimentos');
  };
  const [jump, setJump] = useState<{ fav?: string; food?: string; item?: string; fecha?: string; n: number }>({ n: 0 });
  const goSearch = (t: SearchTarget) => {
    const n = jump.n + 1;
    if (t.kind === 'favorito') {
      setJump({ fav: t.id, n });
      setTab('favoritos');
    } else if (t.kind === 'alimento') {
      setJump({ food: t.id, n });
      setTab('mas');
      setMore('alimentos');
    } else if (t.kind === 'casa') {
      setJump({ item: t.id, n });
      setCasaView('stock');
      setCasaKey((k) => k + 1);
      setTab('casa');
    } else {
      setJump({ fecha: t.fecha, n });
      setTab('plan');
    }
    window.scrollTo(0, 0);
  };
  const dataRef = useRef(data);
  dataRef.current = data;
  const [tab, setTab] = useState<Tab>('inicio');
  const [returnTo, setReturnTo] = useState<Tab>('inicio');
  const [more, setMore] = useState<MoreView>('menu');
  const [preset, setPreset] = useState<GeneratorPreset | undefined>();
  const [genKey, setGenKey] = useState(0);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const showToast = useCallback<Toaster>((text, undo) => setToast({ text, undo }), []);
  const clearToast = useCallback(() => setToast(null), []);

  // botón atrás a nivel de pantallas: submenú de Más → menú; otra pestaña → Hoy; en Hoy → salir
  useBackHandler(() => {
    if (tab === 'mas' && more !== 'menu') {
      setMore('menu');
      return true;
    }
    if (tab === 'generar' && returnTo !== 'inicio') {
      setTab(returnTo);
      return true;
    }
    if (tab !== 'inicio') {
      setTab('inicio');
      window.scrollTo(0, 0);
      return true;
    }
    return false;
  });

  const openCasa = (v?: CasaView) => {
    setCasaView(v);
    setCasaKey((k) => k + 1);
    setTab('casa');
    window.scrollTo(0, 0);
  };

  // avisos del móvil: se reprograman al abrir y cuando cambia el plan / la configuración
  const histKey = data.history.map((h) => `${h.fecha}${h.confirmado ? '✓' : ''}`).join(',');
  useEffect(() => {
    const t = setTimeout(() => scheduleReminders(dataRef.current, todayKey()), 2000);
    return () => clearTimeout(t);
  }, [histKey, data.stock.config.avisoNoche, data.stock.config.avisoRevision, data.stock.config.horaNoche, data.stock.config.ultimaRevision]);

  // tocar un aviso / el acceso directo "🎤 Apuntar"
  useEffect(() => {
    const off = onReminderTap((route, fecha) => {
      if (route === 'confirmar') setConfirmFecha(fecha ?? todayKey());
      else openCasa(route === 'revision' ? 'revisar' : 'stock');
    });
    let h: { remove: () => void } | undefined;
    if (isNative()) {
      CapApp.addListener('appUrlOpen', ({ url }) => {
        if (url.includes('voz') || url.includes('apuntar')) setAsistente({ listen: true });
        else if (url.includes('casa')) openCasa('stock');
      }).then((x) => (h = x));
    }
    return () => {
      off();
      h?.remove();
    };
  }, []);

  // pedidos de Mercadona entregados → despensa (al abrir la app, como mucho cada 3 h)
  useEffect(() => {
    const check = async () => {
      const d = dataRef.current;
      if (!isNative() || !loadSession() || !d.stock.config.desde) return;
      const last = d.stock.config.pedidosVisto ? new Date(d.stock.config.pedidosVisto).getTime() : 0;
      if (Date.now() - last < 3 * 3600000) return;
      try {
        const r = await syncOrders(makeClient(d.mercadona.config), d, fm);
        stockApply(r.change);
        if (r.nuevos.length) showToast(`📦 Pedido de Mercadona sumado a la despensa (${r.nuevos.map((p) => (p.resumen ? p.resumen.alimentos + p.resumen.casa + p.resumen.nuevos : 0)).reduce((a, b) => a + b, 0)} productos)`);
      } catch {
        /* sin conexión o sesión: se reintenta luego */
      }
    };
    const t = setTimeout(check, 4000);
    const onVis = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearTimeout(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [fm, stockApply, showToast]);

  const goGenerate = (b: Block, fecha?: string, para?: ProfileId | 'ambos') => {
    setReturnTo(tab);
    setPreset({ bloque: b, fecha, para });
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
        : tab === 'casa'
          ? 'Casa'
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
          <button className="iconbtn" style={{ border: 'none', background: 'none' }} title="Asistente de voz" aria-label="Asistente de voz" onClick={() => setAsistente({ listen: true })}>
            🎤
          </button>
          <button className="iconbtn" style={{ border: 'none', background: 'none' }} title="Buscar" aria-label="Buscar" onClick={() => setSearch('')}>
            🔎
          </button>
          <WeightToggle />
        </div>
      </header>

      {tab === 'inicio' && (
        <HomeScreen
          onGenerate={(b, para) => goGenerate(b, undefined, para)}
          onProgress={() => {
            setTab('mas');
            setMore('progreso');
          }}
          onToast={showToast}
        />
      )}
      {tab === 'plan' && <PlanScreen
          focusDate={jump.fecha}
          focusView={planView}
          onGenerate={goGenerate}
          onOpenMercadona={() => {
            setTab('mas');
            setMore('mercadona');
          }} onToast={showToast} />}
      {tab === 'generar' && (
        <GeneratorScreen key={genKey} preset={preset} onToast={showToast} onUsed={() => setTab(returnTo === 'plan' ? 'plan' : 'inicio')} />
      )}
      {tab === 'casa' && <CasaScreen key={casaKey} initialView={casaView} initialItem={jump.item} onToast={showToast} />}
      {tab === 'favoritos' && <FavoritesScreen key={`f${jump.n}`} initialOpen={jump.fav} onToast={showToast} />}
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
      {tab === 'mas' && more === 'alimentos' && <FoodsScreen key={`a${jump.n}`} initialFood={jump.food} onToast={showToast} />}
      {tab === 'mas' && more === 'progreso' && <ProgressScreen onToast={showToast} />}
      {tab === 'mas' && more === 'mercadona' && <MercadonaScreen onToast={showToast} />}
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
      {confirmFecha && (
        <ConfirmDaySheet
          fecha={confirmFecha}
          onClose={() => setConfirmFecha(null)}
          onEdit={() => {
            setTab('inicio');
            window.scrollTo(0, 0);
          }}
          onToast={showToast}
        />
      )}
      {search !== false && <GlobalSearch initial={search} onClose={() => setSearch(false)} onGo={goSearch} />}
      {asistente && (
        <AsistenteSheet
          autoListen={asistente.listen}
          onClose={() => setAsistente(null)}
          onToast={showToast}
          onGo={goDestino}
          onSearch={(q) => setSearch(q)}
          onPlan={(t) => setPlanVoz(t)}
          onTimer={(m) => setTimerEnd(Date.now() + m * 60000)}
        />
      )}
      {planVoz !== null && (
        <PlanVozSheet
          inicial={planVoz}
          onClose={() => setPlanVoz(null)}
          onToast={showToast}
          onAdded={(f) => {
            if (f[0]) setJump({ fecha: f[0], n: jump.n + 1 });
            setPlanView({ v: 'semana', n: Date.now() });
            setTab('plan');
          }}
        />
      )}
      {timerEnd && <GlobalTimer end={timerEnd} onDone={() => setTimerEnd(null)} />}
      {toast && <Toast text={toast.text} undo={toast.undo} onDone={clearToast} />}
    </div>
  );
}
