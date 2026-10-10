import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  AppData,
  Block,
  CookingConversion,
  DayLog,
  DaySlot,
  Favorite,
  Food,
  Meal,
  Profile,
  ProfileId,
  Rating,
  Settings,
  ExtraItem,
  MercaConfig,
  MercaHabitual,
  MercaLink,
} from '../types';
import { PROFILE_IDS } from '../types';
import { toConversionMap, type ConversionMap } from '../lib/conversions';
import { mealNutrients, toFoodMap, type FoodMap } from '../lib/nutrition';
import type { GeneratorContext } from '../lib/mealGenerator';
import { todayKey } from '../lib/day';
import * as DE from '../lib/dayEdit';
import { addDays } from '../lib/planning';
import { key, tombstone, touch, weightId } from '../sync/docs';
import { applyBaseline, BASELINE_CREATOR, BASELINE_JOINER } from '../sync/baseline';
import { isSyncEnabled, syncOnce } from '../sync/engine';
import type { CloudConfig } from '../sync/supabase';
import { LocalStorageRepository, type DataRepository } from './repository';
import { createSeedData, mergeWithSeed } from './seed';

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'error' | 'offline';

interface Store {
  data: AppData;
  fm: FoodMap;
  cm: ConversionMap;
  genCtx: GeneratorContext;
  activeFoods: Food[];
  saveFood: (food: Food) => void;
  duplicateFood: (id: string) => Food | undefined;
  setArchived: (id: string, archived: boolean) => void;
  saveConversion: (c: CookingConversion) => void;
  saveProfile: (p: Profile) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  addFavorite: (meal: Meal) => Favorite;
  updateFavorite: (fav: Favorite) => void;
  removeFavorite: (id: string) => void;
  /** registra que se ha usado un favorito (para ordenar por más usados) */
  markFavoriteUsed: (id: string) => void;
  setDayTraining: (pid: ProfileId, value: boolean | undefined, fecha?: string) => void;
  addWeight: (pid: ProfileId, kg: number, fecha?: string) => void;
  removeWeight: (pid: ProfileId, fecha: string) => void;
  /** 👍 (1) / 👎 (-1) / quitar (0) una combinación de ingredientes */
  rateMeal: (firma: string, voto: 1 | -1 | 0, foods: string[], bloque: Block) => void;
  getDay: (fecha?: string) => DayLog | undefined;
  setDaySlot: (block: Block, slot: DaySlot | undefined, fecha?: string) => void;
  setCompensar: (value: boolean, fecha?: string) => void;
  copyDay: (from: string, to: string) => void;
  /** comida solo para una persona en un bloque (separa el bloque si hacía falta) */
  setPersonSlot: (block: Block, pid: ProfileId, slot: DaySlot | undefined, fecha?: string) => void;
  splitBlock: (block: Block, fecha?: string) => void;
  joinBlock: (block: Block, fecha?: string) => void;
  /** pone una comida en el día: en la parte de una persona si `meal.para`, si no compartida */
  placeMeal: (meal: Meal, fecha?: string) => void;
  /** copia un bloque (compartido o separado) de un día a otro, solo si el destino está vacío o `force` */
  copyBlockTo: (block: Block, from: string, to: string) => void;
  addExtra: (extra: ExtraItem, fecha?: string) => void;
  removeExtra: (id: string, fecha?: string) => void;
  saveWeekTemplate: (nombre: string, weekStart: string) => void;
  applyWeekTemplate: (id: string, weekStart: string, mode: 'huecos' | 'reemplazar') => void;
  removeWeekTemplate: (id: string) => void;
  setMercaConfig: (patch: Partial<MercaConfig>) => void;
  setMercaLink: (foodId: string, link: MercaLink | undefined) => void;
  setMercaHabitual: (id: string, h: MercaHabitual | undefined) => void;
  setPantry: (ids: string[]) => void;
  setShoppingChecked: (ids: string[]) => void;
  importData: (json: string) => void;
  resetData: () => void;
  // sincronización
  syncStatus: SyncStatus;
  syncNow: () => Promise<void>;
  configureCloud: (cfg: CloudConfig | null) => void;
  joinHousehold: (household: string, cfg?: CloudConfig, role?: 'creator' | 'joiner') => void;
  leaveHousehold: () => void;
}

const Ctx = createContext<Store | null>(null);

const repo: DataRepository = new LocalStorageRepository();

function initialData(): AppData {
  const saved = repo.load();
  return saved ? mergeWithSeed(saved) : createSeedData();
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const SHARED_SETTINGS: (keyof Settings)[] = ['mismaRecetaParaAmbos', 'permitirComplementosDistintos', 'bloquesSeparados'];

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(initialData);
  const dataRef = useRef(data);
  dataRef.current = data;
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    repo.save(data);
  }, [data]);

  const fm = useMemo(() => toFoodMap(data.foods), [data.foods]);
  const cm = useMemo(() => toConversionMap(data.conversions), [data.conversions]);
  const activeFoods = useMemo(() => data.foods.filter((f) => !f.archivado), [data.foods]);
  const genCtx = useMemo<GeneratorContext>(
    () => ({ foods: data.foods, conversions: data.conversions, profiles: data.profiles, settings: data.settings, ratings: data.ratings }),
    [data.foods, data.conversions, data.profiles, data.settings, data.ratings],
  );

  const saveFood = useCallback((food: Food) => {
    setData((d) => {
      const exists = d.foods.some((f) => f.id === food.id);
      const foods = exists ? d.foods.map((f) => (f.id === food.id ? food : f)) : [...d.foods, food];
      return touch({ ...d, foods }, [key('food', food.id)]);
    });
  }, []);

  const duplicateFood = useCallback((id: string) => {
    const src = dataRef.current.foods.find((f) => f.id === id);
    if (!src) return undefined;
    const copy: Food = {
      ...structuredClone(src),
      id: newId('food'),
      nombre: `${src.nombre} (copia)`,
      codigoBarras: undefined,
      personalizado: true,
      archivado: false,
    };
    setData((d) => touch({ ...d, foods: [...d.foods, copy] }, [key('food', copy.id)]));
    return copy;
  }, []);

  const setArchived = useCallback((id: string, archivado: boolean) => {
    setData((d) => touch({ ...d, foods: d.foods.map((f) => (f.id === id ? { ...f, archivado } : f)) }, [key('food', id)]));
  }, []);

  const saveConversion = useCallback((c: CookingConversion) => {
    setData((d) => {
      const exists = d.conversions.some((x) => x.id === c.id);
      const conversions = exists ? d.conversions.map((x) => (x.id === c.id ? c : x)) : [...d.conversions, c];
      return touch({ ...d, conversions }, [key('conv', c.id)]);
    });
  }, []);

  const saveProfile = useCallback((p: Profile) => {
    setData((d) => touch({ ...d, profiles: { ...d.profiles, [p.id]: p } }, [key('profile', p.id)]));
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setData((d) => {
      const next = { ...d, settings: { ...d.settings, ...patch } };
      const shared = (Object.keys(patch) as (keyof Settings)[]).some((k) => SHARED_SETTINGS.includes(k));
      return shared ? touch(next, [key('shared', 'all')]) : next;
    });
  }, []);

  const addFavorite = useCallback(
    (meal: Meal) => {
      const totales = Object.fromEntries(PROFILE_IDS.map((p) => [p, mealNutrients(meal, p, fm)])) as Favorite['totales'];
      const fav: Favorite = {
        ...structuredClone(meal),
        id: newId('fav'),
        origen: 'favorito',
        creado: new Date().toISOString(),
        totales,
      };
      setData((d) => touch({ ...d, favorites: [fav, ...d.favorites] }, [key('fav', fav.id)]));
      return fav;
    },
    [fm],
  );

  const updateFavorite = useCallback(
    (fav: Favorite) => {
      const totales = Object.fromEntries(PROFILE_IDS.map((p) => [p, mealNutrients(fav, p, fm)])) as Favorite['totales'];
      setData((d) =>
        touch({ ...d, favorites: d.favorites.map((f) => (f.id === fav.id ? { ...fav, totales } : f)) }, [key('fav', fav.id)]),
      );
    },
    [fm],
  );

  const removeFavorite = useCallback((id: string) => {
    setData((d) => tombstone({ ...d, favorites: d.favorites.filter((f) => f.id !== id) }, [key('fav', id)]));
  }, []);

  const markFavoriteUsed = useCallback((id: string) => {
    setData((d) => {
      const base = d.favorites.find((f) => f.id === id);
      if (!base) return d;
      const fav = { ...base, usos: (base.usos ?? 0) + 1, ultimoUso: new Date().toISOString() };
      return touch({ ...d, favorites: d.favorites.map((f) => (f.id === id ? fav : f)) }, [key('fav', id)]);
    });
  }, []);

  const addWeight = useCallback((pid: ProfileId, kg: number, fecha = todayKey()) => {
    setData((d) => {
      const entry = { profile: pid, fecha, kg: Math.round(kg * 10) / 10 };
      const pesos = [...d.pesos.filter((w) => weightId(w) !== weightId(entry)), entry].sort((a, b) => a.fecha.localeCompare(b.fecha));
      let next: AppData = { ...d, pesos };
      const keys = [key('weight', weightId(entry))];
      // el último registro actualiza el peso actual del perfil
      const latest = pesos.filter((w) => w.profile === pid).pop();
      if (latest && latest.kg !== d.profiles[pid].pesoActualKg) {
        next = { ...next, profiles: { ...next.profiles, [pid]: { ...next.profiles[pid], pesoActualKg: latest.kg } } };
        keys.push(key('profile', pid));
      }
      return touch(next, keys);
    });
  }, []);

  const removeWeight = useCallback((pid: ProfileId, fecha: string) => {
    setData((d) => {
      const id = weightId({ profile: pid, fecha });
      return tombstone({ ...d, pesos: d.pesos.filter((w) => weightId(w) !== id) }, [key('weight', id)]);
    });
  }, []);

  const rateMeal = useCallback((firma: string, voto: 1 | -1 | 0, foods: string[], bloque: Block) => {
    setData((d) => {
      const ratings = { ...d.ratings };
      if (voto === 0) {
        delete ratings[firma];
        return tombstone({ ...d, ratings }, [key('rating', firma)]);
      }
      const r: Rating = { voto, foods: [...new Set(foods)].sort(), bloque, fecha: todayKey() };
      ratings[firma] = r;
      return touch({ ...d, ratings }, [key('rating', firma)]);
    });
  }, []);

  const getDay = useCallback(
    (fecha = todayKey()) => data.history.find((h) => h.fecha === fecha),
    [data.history],
  );

  const updateDay = (d: AppData, fecha: string, fn: (day: DayLog) => DayLog): AppData => {
    const existing = d.history.find((h) => h.fecha === fecha) ?? { fecha, bloques: {} };
    const updated = fn(structuredClone(existing));
    const others = d.history.filter((h) => h.fecha !== fecha);
    const keep = DE.dayHasData(updated);
    const history = keep ? [...others, updated] : others;
    history.sort((a, b) => b.fecha.localeCompare(a.fecha));
    const next = { ...d, history };
    return keep ? touch(next, [key('day', fecha)]) : tombstone(next, [key('day', fecha)]);
  };

  const setDaySlot = useCallback((block: Block, slot: DaySlot | undefined, fecha = todayKey()) => {
    setData((d) =>
      // comida para ambos: si el bloque estaba separado, vuelve a ser compartido
      updateDay(d, fecha, (day) => DE.setSharedSlot(day, block, slot)),
    );
  }, []);

  const setCompensar = useCallback((value: boolean, fecha = todayKey()) => {
    setData((d) => updateDay(d, fecha, (day) => ({ ...day, compensar: value })));
  }, []);

  const setDayTraining = useCallback((pid: ProfileId, value: boolean | undefined, fecha = todayKey()) => {
    setData((d) =>
      updateDay(d, fecha, (day) => {
        const entreno = { ...day.entreno };
        if (value === undefined) delete entreno[pid];
        else entreno[pid] = value;
        return { ...day, entreno: Object.keys(entreno).length ? entreno : undefined };
      }),
    );
  }, []);

  const setPersonSlot = useCallback((block: Block, pid: ProfileId, slot: DaySlot | undefined, fecha = todayKey()) => {
    setData((d) => updateDay(d, fecha, (day) => DE.setPersonSlot(day, block, pid, slot)));
  }, []);

  const splitBlock = useCallback((block: Block, fecha = todayKey()) => {
    setData((d) => updateDay(d, fecha, (day) => DE.splitBlock(day, block)));
  }, []);

  const joinBlock = useCallback((block: Block, fecha = todayKey()) => {
    setData((d) => updateDay(d, fecha, (day) => DE.joinBlock(day, block)));
  }, []);

  const placeMeal = useCallback((meal: Meal, fecha = todayKey()) => {
    setData((d) =>
      updateDay(d, fecha, (day) =>
        meal.para ? DE.setPersonSlot(day, meal.bloque, meal.para, { meal }) : DE.setSharedSlot(day, meal.bloque, { meal }),
      ),
    );
  }, []);

  const copyBlockTo = useCallback((block: Block, from: string, to: string) => {
    setData((d) => {
      const src = d.history.find((h) => h.fecha === from);
      if (!src) return d;
      return updateDay(d, to, (day) => DE.copyBlock(src, day, block));
    });
  }, []);

  const addExtra = useCallback((extra: ExtraItem, fecha = todayKey()) => {
    setData((d) => updateDay(d, fecha, (day) => DE.addExtra(day, extra)));
  }, []);

  const removeExtra = useCallback((id: string, fecha = todayKey()) => {
    setData((d) => updateDay(d, fecha, (day) => DE.removeExtra(day, id)));
  }, []);

  const saveWeekTemplate = useCallback((nombre: string, weekStart: string) => {
    setData((d) => {
      const days = Array.from({ length: 7 }, (_, i) => d.history.find((h) => h.fecha === addDays(weekStart, i)));
      const tpl = DE.makeWeekTemplate(nombre, days);
      return touch({ ...d, semanasTipo: [...d.semanasTipo, tpl] }, [key('week', tpl.id)]);
    });
  }, []);

  const applyWeekTemplate = useCallback((id: string, weekStart: string, mode: 'huecos' | 'reemplazar') => {
    setData((d) => {
      const tpl = d.semanasTipo.find((w) => w.id === id);
      if (!tpl) return d;
      let next = d;
      tpl.dias.forEach((td, i) => {
        next = updateDay(next, addDays(weekStart, i), (day) => DE.applyTemplateDay(day, td, mode));
      });
      return next;
    });
  }, []);

  const removeWeekTemplate = useCallback((id: string) => {
    setData((d) => tombstone({ ...d, semanasTipo: d.semanasTipo.filter((w) => w.id !== id) }, [key('week', id)]));
  }, []);

  const setMercaConfig = useCallback((patch: Partial<MercaConfig>) => {
    setData((d) => touch({ ...d, mercadona: { ...d.mercadona, config: { ...d.mercadona.config, ...patch } } }, [key('mconf', 'all')]));
  }, []);

  const setMercaLink = useCallback((foodId: string, link: MercaLink | undefined) => {
    setData((d) => {
      const links = { ...d.mercadona.links };
      if (link) links[foodId] = link;
      else delete links[foodId];
      const next = { ...d, mercadona: { ...d.mercadona, links } };
      return link ? touch(next, [key('mlink', foodId)]) : tombstone(next, [key('mlink', foodId)]);
    });
  }, []);

  const setMercaHabitual = useCallback((id: string, h: MercaHabitual | undefined) => {
    setData((d) => {
      const habituales = { ...d.mercadona.habituales };
      if (h) habituales[id] = h;
      else delete habituales[id];
      const next = { ...d, mercadona: { ...d.mercadona, habituales } };
      return h ? touch(next, [key('mhab', id)]) : tombstone(next, [key('mhab', id)]);
    });
  }, []);

  const copyDay = useCallback((from: string, to: string) => {
    setData((d) => {
      const src = d.history.find((h) => h.fecha === from);
      if (!src || from === to) return d;
      const target = d.history.find((h) => h.fecha === to);
      return updateDay(d, to, () => ({ ...structuredClone(src), fecha: to, compensar: false, entreno: target?.entreno, extras: target?.extras }));
    });
  }, []);

  const setPantry = useCallback(
    (ids: string[]) => setData((d) => touch({ ...d, pantry: ids }, [key('pantry', 'all')])),
    [],
  );

  const setShoppingChecked = useCallback(
    (ids: string[]) => setData((d) => touch({ ...d, shoppingChecked: ids }, [key('shopping', 'all')])),
    [],
  );

  const importData = useCallback((json: string) => {
    const parsed = JSON.parse(json) as AppData;
    if (!parsed || !Array.isArray(parsed.foods) || !parsed.profiles) throw new Error('Archivo no válido');
    setData((d) => {
      const merged = mergeWithSeed(parsed);
      // conservar la configuración de sincronización de este móvil y subir lo importado
      const next: AppData = { ...merged, sync: { ...d.sync, stamps: {}, tombstones: {}, pending: [] } };
      const keys = [
        ...next.foods.map((f) => key('food', f.id)),
        ...next.conversions.map((c) => key('conv', c.id)),
        ...PROFILE_IDS.map((p) => key('profile', p)),
        ...next.favorites.map((f) => key('fav', f.id)),
        ...next.history.map((h) => key('day', h.fecha)),
        ...next.pesos.map((w) => key('weight', weightId(w))),
        ...Object.keys(next.ratings).map((id) => key('rating', id)),
        ...next.semanasTipo.map((w) => key('week', w.id)),
        ...Object.keys(next.mercadona.links).map((id) => key('mlink', id)),
        key('mconf', 'all'),
        ...Object.keys(next.mercadona.habituales).map((id) => key('mhab', id)),
        key('pantry', 'all'),
        key('shared', 'all'),
      ];
      return touch(next, keys);
    });
  }, []);

  const resetData = useCallback(() => {
    repo.clear();
    setData((d) => {
      const seed = createSeedData();
      // si está sincronizado, vuelve a descargar todo lo compartido
      return { ...seed, sync: { ...seed.sync, household: d.sync.household, url: d.sync.url, anonKey: d.sync.anonKey } };
    });
  }, []);

  // ───────── sincronización automática ─────────
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(isSyncEnabled(data) ? 'idle' : 'off');
  const busy = useRef(false);
  const again = useRef(false);
  const enabled = isSyncEnabled(data);

  const syncNow = useCallback(async () => {
    if (!isSyncEnabled(dataRef.current)) {
      setSyncStatus('off');
      return;
    }
    if (busy.current) {
      again.current = true;
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setSyncStatus('offline');
      return;
    }
    busy.current = true;
    setSyncStatus('syncing');
    try {
      do {
        again.current = false;
        await syncOnce(
          () => dataRef.current,
          (fn) =>
            setData((d) => {
              const n = fn(d);
              dataRef.current = n;
              return n;
            }),
        );
      } while (again.current);
      setSyncStatus('idle');
    } catch (e) {
      const msg = (e as Error).message || 'Error de sincronización';
      setData((d) => ({ ...d, sync: { ...d.sync, lastError: msg } }));
      setSyncStatus(navigator.onLine === false ? 'offline' : 'error');
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setSyncStatus('off');
      return;
    }
    syncNow();
    const iv = setInterval(syncNow, 30000);
    const onVis = () => document.visibilityState === 'visible' && syncNow();
    window.addEventListener('online', syncNow);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(iv);
      window.removeEventListener('online', syncNow);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [enabled, data.sync.household, syncNow]);

  // subir cambios locales poco después de hacerlos
  const pendingCount = data.sync.pending.length;
  useEffect(() => {
    if (!enabled || pendingCount === 0) return;
    const t = setTimeout(syncNow, 1500);
    return () => clearTimeout(t);
  }, [enabled, pendingCount, data.sync.stamps, syncNow]);

  const configureCloud = useCallback((cfg: CloudConfig | null) => {
    setData((d) => ({ ...d, sync: { ...d.sync, url: cfg?.url || undefined, anonKey: cfg?.anonKey || undefined, lastError: undefined } }));
  }, []);

  const joinHousehold = useCallback((household: string, cfg?: CloudConfig, role: 'creator' | 'joiner' = 'joiner') => {
    setData((d) => {
      const next: AppData = {
        ...d,
        sync: {
          ...d.sync,
          household,
          url: cfg?.url ?? d.sync.url,
          anonKey: cfg?.anonKey ?? d.sync.anonKey,
          cursor: undefined,
          lastError: undefined,
        },
      };
      // sube todo lo que este móvil tiene distinto de los datos iniciales (incluido lo creado con la v1.0)
      return applyBaseline(next, role === 'creator' ? BASELINE_CREATOR : BASELINE_JOINER);
    });
  }, []);

  const leaveHousehold = useCallback(() => {
    setData((d) => ({ ...d, sync: { ...d.sync, household: undefined, cursor: undefined, lastSync: undefined, lastError: undefined } }));
  }, []);

  const value: Store = {
    data,
    fm,
    cm,
    genCtx,
    activeFoods,
    saveFood,
    duplicateFood,
    setArchived,
    saveConversion,
    saveProfile,
    updateSettings,
    addFavorite,
    updateFavorite,
    removeFavorite,
    markFavoriteUsed,
    setDayTraining,
    addWeight,
    removeWeight,
    rateMeal,
    getDay,
    setDaySlot,
    setCompensar,
    copyDay,
    setPersonSlot,
    splitBlock,
    joinBlock,
    placeMeal,
    copyBlockTo,
    addExtra,
    removeExtra,
    saveWeekTemplate,
    applyWeekTemplate,
    removeWeekTemplate,
    setMercaConfig,
    setMercaLink,
    setMercaHabitual,
    setPantry,
    setShoppingChecked,
    importData,
    resetData,
    syncStatus,
    syncNow,
    configureCloud,
    joinHousehold,
    leaveHousehold,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore fuera de AppStoreProvider');
  return s;
}

export type { ProfileId };
