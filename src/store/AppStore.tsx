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
  Settings,
} from '../types';
import { PROFILE_IDS } from '../types';
import { toConversionMap, type ConversionMap } from '../lib/conversions';
import { mealNutrients, toFoodMap, type FoodMap } from '../lib/nutrition';
import type { GeneratorContext } from '../lib/mealGenerator';
import { todayKey } from '../lib/day';
import { LocalStorageRepository, type DataRepository } from './repository';
import { createSeedData, mergeWithSeed } from './seed';

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
  getDay: (fecha?: string) => DayLog | undefined;
  setDaySlot: (block: Block, slot: DaySlot | undefined, fecha?: string) => void;
  setCompensar: (value: boolean, fecha?: string) => void;
  setPantry: (ids: string[]) => void;
  importData: (json: string) => void;
  resetData: () => void;
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

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(initialData);
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
    () => ({ foods: data.foods, conversions: data.conversions, profiles: data.profiles, settings: data.settings }),
    [data.foods, data.conversions, data.profiles, data.settings],
  );

  const saveFood = useCallback((food: Food) => {
    setData((d) => {
      const exists = d.foods.some((f) => f.id === food.id);
      return { ...d, foods: exists ? d.foods.map((f) => (f.id === food.id ? food : f)) : [...d.foods, food] };
    });
  }, []);

  const duplicateFood = useCallback(
    (id: string) => {
      const src = data.foods.find((f) => f.id === id);
      if (!src) return undefined;
      const copy: Food = { ...structuredClone(src), id: newId('food'), nombre: `${src.nombre} (copia)`, personalizado: true, archivado: false };
      setData((d) => ({ ...d, foods: [...d.foods, copy] }));
      return copy;
    },
    [data.foods],
  );

  const setArchived = useCallback((id: string, archivado: boolean) => {
    setData((d) => ({ ...d, foods: d.foods.map((f) => (f.id === id ? { ...f, archivado } : f)) }));
  }, []);

  const saveConversion = useCallback((c: CookingConversion) => {
    setData((d) => {
      const exists = d.conversions.some((x) => x.id === c.id);
      return { ...d, conversions: exists ? d.conversions.map((x) => (x.id === c.id ? c : x)) : [...d.conversions, c] };
    });
  }, []);

  const saveProfile = useCallback((p: Profile) => {
    setData((d) => ({ ...d, profiles: { ...d.profiles, [p.id]: p } }));
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setData((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
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
      setData((d) => ({ ...d, favorites: [fav, ...d.favorites] }));
      return fav;
    },
    [fm],
  );

  const updateFavorite = useCallback(
    (fav: Favorite) => {
      const totales = Object.fromEntries(PROFILE_IDS.map((p) => [p, mealNutrients(fav, p, fm)])) as Favorite['totales'];
      setData((d) => ({ ...d, favorites: d.favorites.map((f) => (f.id === fav.id ? { ...fav, totales } : f)) }));
    },
    [fm],
  );

  const removeFavorite = useCallback((id: string) => {
    setData((d) => ({ ...d, favorites: d.favorites.filter((f) => f.id !== id) }));
  }, []);

  const getDay = useCallback(
    (fecha = todayKey()) => data.history.find((h) => h.fecha === fecha),
    [data.history],
  );

  const updateDay = (d: AppData, fecha: string, fn: (day: DayLog) => DayLog): AppData => {
    const existing = d.history.find((h) => h.fecha === fecha) ?? { fecha, bloques: {} };
    const updated = fn(structuredClone(existing));
    const others = d.history.filter((h) => h.fecha !== fecha);
    const keep = Object.keys(updated.bloques).length > 0 || updated.compensar;
    const history = keep ? [...others, updated] : others;
    history.sort((a, b) => b.fecha.localeCompare(a.fecha));
    return { ...d, history };
  };

  const setDaySlot = useCallback((block: Block, slot: DaySlot | undefined, fecha = todayKey()) => {
    setData((d) =>
      updateDay(d, fecha, (day) => {
        if (slot) day.bloques[block] = structuredClone(slot);
        else delete day.bloques[block];
        return day;
      }),
    );
  }, []);

  const setCompensar = useCallback((value: boolean, fecha = todayKey()) => {
    setData((d) => updateDay(d, fecha, (day) => ({ ...day, compensar: value })));
  }, []);

  const setPantry = useCallback((ids: string[]) => setData((d) => ({ ...d, pantry: ids })), []);

  const importData = useCallback((json: string) => {
    const parsed = JSON.parse(json) as AppData;
    if (!parsed || !Array.isArray(parsed.foods) || !parsed.profiles) throw new Error('Archivo no válido');
    setData(mergeWithSeed(parsed));
  }, []);

  const resetData = useCallback(() => {
    repo.clear();
    setData(createSeedData());
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
    getDay,
    setDaySlot,
    setCompensar,
    setPantry,
    importData,
    resetData,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore fuera de AppStoreProvider');
  return s;
}

export type { ProfileId };
