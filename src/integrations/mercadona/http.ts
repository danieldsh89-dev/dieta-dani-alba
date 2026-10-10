/**
 * Transporte HTTP para la integración con Mercadona.
 * - En el APK usa la pila HTTP nativa de Android (CapacitorHttp): no le afectan las restricciones CORS.
 * - En el navegador usa fetch: la búsqueda (Algolia) funciona, pero la API de la tienda
 *   rechaza peticiones de otros dominios (CORS) → carrito y almacén solo en el APK.
 * Se puede inyectar otro transporte en los tests.
 */
import { Capacitor, CapacitorHttp } from '@capacitor/core';

export interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  /** 'json' (por defecto) o 'text' (p. ej. para leer el HTML de la web) */
  responseType?: 'json' | 'text';
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  data: unknown;
}

export type Transport = (req: HttpRequest) => Promise<HttpResponse>;

/** ¿Estamos en el APK? (allí no hay CORS) */
export const isNative = (): boolean => Capacitor.isNativePlatform();

const lowerKeys = (h: Record<string, string> | Headers | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!h) return out;
  if (typeof Headers !== 'undefined' && h instanceof Headers) {
    h.forEach((v, k) => (out[k.toLowerCase()] = v));
    return out;
  }
  for (const [k, v] of Object.entries(h as Record<string, string>)) out[k.toLowerCase()] = String(v);
  return out;
};

export const nativeTransport: Transport = async (req) => {
  const r = await CapacitorHttp.request({
    method: req.method,
    url: req.url,
    headers: req.headers,
    data: req.body,
    responseType: req.responseType === 'text' ? 'text' : 'json',
    connectTimeout: 20000,
    readTimeout: 30000,
  });
  let data = r.data;
  if (req.responseType !== 'text' && typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      /* se deja como texto */
    }
  }
  return { status: r.status, headers: lowerKeys(r.headers), data };
};

export const fetchTransport: Transport = async (req) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    // en el navegador no se pueden fijar user-agent/origin/referer: se quitan
    const headers = Object.fromEntries(
      Object.entries(req.headers ?? {}).filter(([k]) => !['user-agent', 'origin', 'referer', 'cookie'].includes(k.toLowerCase())),
    );
    const res = await fetch(req.url, {
      method: req.method,
      headers,
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data: unknown = text;
    if (req.responseType !== 'text') {
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        /* texto */
      }
    }
    return { status: res.status, headers: lowerKeys(res.headers), data };
  } finally {
    clearTimeout(t);
  }
};

export const defaultTransport: Transport = (req) => (isNative() ? nativeTransport(req) : fetchTransport(req));
