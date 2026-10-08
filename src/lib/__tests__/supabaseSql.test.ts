import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Ejecuta supabase/setup.sql en un Postgres real (PGlite) y prueba las funciones.
describe('supabase/setup.sql en Postgres', () => {
  it('push con LWW, pull por cursor y aislamiento por hogar', async () => {
    const db = new PGlite();
    await db.exec(`create role anon; create role authenticated;`);
    const sql = readFileSync(new URL('../../../supabase/setup.sql', import.meta.url), 'utf8');
    await db.exec(sql);
    await db.exec(sql); // idempotente

    const H = 'HOGARDEPRUEBA2345ABCDEFGH';
    const push = (rows: unknown[], h = H) =>
      db.query<{ dieta_push: number }>('select dieta_push($1, $2::jsonb)', [h, JSON.stringify(rows)]);
    const pull = (since: string | null, h = H) =>
      db.query<{ kind: string; id: string; data: unknown; deleted: boolean; client_ts: string; server_ts: string }>(
        'select * from dieta_pull($1, $2)',
        [h, since],
      );

    expect((await push([{ kind: 'pantry', id: 'all', data: ['arroz'], deleted: false, ts: 100 }])).rows[0].dieta_push).toBe(1);
    // más viejo: se ignora
    expect((await push([{ kind: 'pantry', id: 'all', data: ['viejo'], deleted: false, ts: 50 }])).rows[0].dieta_push).toBe(0);
    let r = await pull(null);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].data).toEqual(['arroz']);
    const cursor = new Date(r.rows[0].server_ts).toISOString();

    // más nuevo: se aplica y aparece después del cursor
    await push([
      { kind: 'pantry', id: 'all', data: ['pollo'], deleted: false, ts: 200 },
      { kind: 'fav', id: 'f1', data: null, deleted: true, ts: 210 },
    ]);
    r = await pull(cursor);
    expect(r.rows.map((x) => x.id).sort()).toEqual(['all', 'f1']);
    expect(r.rows.find((x) => x.id === 'f1')!.deleted).toBe(true);
    expect(Number(r.rows.find((x) => x.id === 'all')!.client_ts)).toBe(200);

    // otro hogar no ve nada; clave corta rechazada
    expect((await pull(null, 'OTROHOGAR0000000000000000')).rows).toHaveLength(0);
    await expect(push([], 'CORTA')).rejects.toThrow(/no válida/);
    expect((await pull(null, 'CORTA')).rows).toHaveLength(0);

    // RLS activado y sin acceso directo para anon
    const rls = await db.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where relname = 'dieta_sync'");
    expect(rls.rows[0].relrowsecurity).toBe(true);
    const priv = await db.query<{ has: boolean }>("select has_table_privilege('anon', 'public.dieta_sync', 'select') as has");
    expect(priv.rows[0].has).toBe(false);
    const fn = await db.query<{ has: boolean }>("select has_function_privilege('anon', 'public.dieta_pull(text, timestamptz)', 'execute') as has");
    expect(fn.rows[0].has).toBe(true);
    await db.close();
  }, 60000);
});
