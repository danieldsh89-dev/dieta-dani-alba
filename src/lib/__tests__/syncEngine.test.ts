import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppData } from '../../types';
import { createSeedData } from '../../store/seed';
import { key, touch, tombstone } from '../../sync/docs';
import { syncOnce } from '../../sync/engine';
import { applyBaseline, BASELINE_CREATOR, BASELINE_JOINER, unstampedChanges } from '../../sync/baseline';

/** Servidor falso que imita las funciones SQL dieta_push / dieta_pull de supabase/setup.sql */
function fakeSupabase() {
  type Row = { household: string; kind: string; id: string; data: unknown; deleted: boolean; client_ts: number; server_ts: string };
  const rows: Row[] = [];
  let clock = Date.parse('2026-10-08T10:00:00Z');
  const fetchMock = vi.fn(async (url: string, init: { body: string; headers: Record<string, string> }) => {
    const body = JSON.parse(init.body);
    if (init.headers.apikey !== 'anon-key-de-prueba-123456') return new Response('unauthorized', { status: 401 });
    if (url.endsWith('/rpc/dieta_push')) {
      let n = 0;
      for (const r of body.p_rows) {
        const i = rows.findIndex((x) => x.household === body.p_household && x.kind === r.kind && x.id === r.id);
        const row = { household: body.p_household, kind: r.kind, id: r.id, data: r.data, deleted: r.deleted, client_ts: r.ts, server_ts: new Date(clock++).toISOString() };
        if (i < 0) rows.push(row), n++;
        else if (r.ts > rows[i].client_ts) (rows[i] = row), n++;
      }
      return new Response(JSON.stringify(n), { status: 200 });
    }
    if (url.endsWith('/rpc/dieta_pull')) {
      const since = body.p_since ?? '1970-01-01T00:00:00.000Z';
      const out = rows
        .filter((r) => r.household === body.p_household && r.server_ts > since)
        .map(({ household: _h, ...r }) => r);
      return new Response(JSON.stringify(out), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  });
  return { rows, fetchMock };
}

function device(household: string): { get: () => AppData; update: (fn: (d: AppData) => AppData) => void; set: (d: AppData) => void } {
  let d: AppData = createSeedData();
  d = { ...d, sync: { ...d.sync, household, url: 'https://fake.supabase.co', anonKey: 'anon-key-de-prueba-123456' } };
  return { get: () => d, update: (fn) => (d = fn(d)), set: (n) => (d = n) };
}

afterEach(() => vi.unstubAllGlobals());

describe('motor de sincronización contra servidor simulado', () => {
  it('dos móviles comparten favoritos, plan y despensa', async () => {
    const { fetchMock, rows } = fakeSupabase();
    vi.stubGlobal('fetch', fetchMock);
    const H = 'HOGARDEPRUEBA2345ABCDEFGH';
    const dani = device(H);
    const alba = device(H);

    // Dani guarda un favorito y planifica el lunes; Alba marca la despensa
    const fav = { ...dani.get().favorites[0], id: 'fav_nuevo', nombre: 'Nuevo de Dani' };
    dani.set(touch({ ...dani.get(), favorites: [fav, ...dani.get().favorites] }, [key('fav', 'fav_nuevo')]));
    dani.set(
      touch(
        { ...dani.get(), history: [{ fecha: '2026-10-12', bloques: { B: { meal: { ...fav, origen: 'favorito' } } } }] },
        [key('day', '2026-10-12')],
      ),
    );
    alba.set(touch({ ...alba.get(), pantry: ['arroz', 'albondigas'] }, [key('pantry', 'all')]));

    await syncOnce(dani.get, dani.update);
    await syncOnce(alba.get, alba.update);
    await syncOnce(dani.get, dani.update);

    for (const d of [dani.get(), alba.get()]) {
      expect(d.favorites.some((f) => f.id === 'fav_nuevo')).toBe(true);
      expect(d.history.find((h) => h.fecha === '2026-10-12')?.bloques.B).toBeTruthy();
      expect(d.pantry).toEqual(['arroz', 'albondigas']);
      expect(d.sync.pending).toEqual([]);
      expect(d.sync.lastSync).toBeGreaterThan(0);
    }
    expect(rows).toHaveLength(3);

    // Alba borra el favorito → desaparece también en el móvil de Dani
    alba.set(tombstone({ ...alba.get(), favorites: alba.get().favorites.filter((f) => f.id !== 'fav_nuevo') }, [key('fav', 'fav_nuevo')]));
    await syncOnce(alba.get, alba.update);
    await syncOnce(dani.get, dani.update);
    expect(dani.get().favorites.some((f) => f.id === 'fav_nuevo')).toBe(false);
  });

  it('otro hogar no ve nada', async () => {
    const { fetchMock } = fakeSupabase();
    vi.stubGlobal('fetch', fetchMock);
    const a = device('HOGARAAAAAAAAAAAAAAAAAAAAA');
    const b = device('HOGARBBBBBBBBBBBBBBBBBBBBB');
    a.set(touch({ ...a.get(), pantry: ['secreto'] }, [key('pantry', 'all')]));
    await syncOnce(a.get, a.update);
    await syncOnce(b.get, b.update);
    expect(b.get().pantry).toEqual([]);
  });

  it('errores del servidor se propagan y no pierden los cambios pendientes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    const a = device('HOGARCCCCCCCCCCCCCCCCCCCCC');
    a.set(touch({ ...a.get(), pantry: ['x'] }, [key('pantry', 'all')]));
    await expect(syncOnce(a.get, a.update)).rejects.toThrow(/500/);
    expect(a.get().sync.pending).toEqual(['pantry:all']);
  });

  it('activar la sincronización con datos de la v1.0 (sin marcas): gana el creador, se suma lo de ambos', async () => {
    const { fetchMock } = fakeSupabase();
    vi.stubGlobal('fetch', fetchMock);
    const H = 'HOGARDDDDDDDDDDDDDDDDDDDDD';
    const dani = device(H);
    const alba = device(H);
    const base = dani.get();
    const meal = (nombre: string) => ({ ...base.favorites[0], id: `m_${nombre}`, nombre, origen: 'manual' as const });
    // Datos "de la v1.0": sin stamps
    dani.set({
      ...dani.get(),
      favorites: [{ ...meal('Fav de Dani'), id: 'fav_dani' }, ...base.favorites.filter((f) => f.id !== 'fav_hamburguesa')],
      history: [
        { fecha: '2026-10-08', bloques: { A: { meal: meal('Tostadas Dani') } } },
        { fecha: '2026-10-09', bloques: { B: { meal: meal('Albondigas') } } },
      ],
      pantry: ['arroz', 'albondigas'],
      profiles: { ...base.profiles, dani: { ...base.profiles.dani, pesoActualKg: 95 } },
    });
    alba.set({
      ...alba.get(),
      favorites: [{ ...meal('Fav de Alba'), id: 'fav_alba' }, ...base.favorites],
      history: [
        { fecha: '2026-10-08', bloques: { A: { meal: meal('Yogur Alba') } } },
        { fecha: '2026-10-07', bloques: { C: { meal: meal('Cena Alba') } } },
      ],
      pantry: ['gazpacho'],
    });
    expect(unstampedChanges(alba.get()).changed).toContain('fav:fav_alba');
    expect(unstampedChanges(dani.get()).deleted).toContain('fav:fav_hamburguesa');

    dani.set(applyBaseline(dani.get(), BASELINE_CREATOR));
    await syncOnce(dani.get, dani.update);
    alba.set(applyBaseline(alba.get(), BASELINE_JOINER));
    await syncOnce(alba.get, alba.update);
    await syncOnce(dani.get, dani.update);

    for (const d of [dani.get(), alba.get()]) {
      const favIds = d.favorites.map((f) => f.id);
      expect(favIds).toContain('fav_dani');
      expect(favIds).toContain('fav_alba');
      expect(favIds).not.toContain('fav_hamburguesa');
      const day8 = d.history.find((h) => h.fecha === '2026-10-08')!;
      expect((day8.bloques.A as { meal: { nombre: string } }).meal.nombre).toBe('Tostadas Dani'); // conflicto → gana el creador
      expect(d.history.some((h) => h.fecha === '2026-10-07')).toBe(true); // lo de Alba se suma
      expect(d.history.some((h) => h.fecha === '2026-10-09')).toBe(true);
      expect(d.pantry).toEqual(['arroz', 'albondigas']);
      expect(d.profiles.dani.pesoActualKg).toBe(95);
      expect(d.sync.pending).toEqual([]);
    }

    // y después, un cambio nuevo de Alba gana a los datos antiguos de Dani
    alba.set(touch({ ...alba.get(), pantry: ['pollo_pechuga'] }, [key('pantry', 'all')]));
    await syncOnce(alba.get, alba.update);
    await syncOnce(dani.get, dani.update);
    expect(dani.get().pantry).toEqual(['pollo_pechuga']);
  });
});
