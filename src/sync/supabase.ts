import type { DocKind, SyncRow } from './docs';

export interface CloudConfig {
  url: string;
  anonKey: string;
}

export interface PulledRow extends SyncRow {
  serverTs: string;
}

async function rpc<T>(cfg: CloudConfig, fn: string, body: unknown, timeoutMs = 15000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const base = cfg.url.trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
    const res = await fetch(`${base}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: cfg.anonKey,
        Authorization: `Bearer ${cfg.anonKey}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Servidor ${res.status}: ${text.slice(0, 160)}`);
    }
    return (await res.json()) as T;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('Tiempo de espera agotado');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export async function pushRows(cfg: CloudConfig, household: string, rows: SyncRow[]): Promise<number> {
  if (!rows.length) return 0;
  return rpc<number>(cfg, 'dieta_push', {
    p_household: household,
    p_rows: rows.map((r) => ({ kind: r.kind, id: r.id, data: r.data, deleted: r.deleted, ts: r.ts })),
  });
}

export async function pullRows(cfg: CloudConfig, household: string, since?: string): Promise<PulledRow[]> {
  const rows = await rpc<
    { kind: DocKind; id: string; data: unknown; deleted: boolean; client_ts: number | string; server_ts: string }[]
  >(cfg, 'dieta_pull', { p_household: household, p_since: since ?? null });
  return rows.map((r) => ({
    kind: r.kind,
    id: r.id,
    data: r.data,
    deleted: r.deleted,
    ts: Number(r.client_ts),
    serverTs: r.server_ts,
  }));
}

/** Comprueba que la configuración y la clave del hogar funcionan. */
export async function testConnection(cfg: CloudConfig, household: string): Promise<void> {
  await pullRows(cfg, household, new Date().toISOString());
}
