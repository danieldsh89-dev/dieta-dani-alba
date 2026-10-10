/**
 * Cliente de la API NO OFICIAL de la tienda online de Mercadona.
 * Basado en lo documentado por el proyecto open source mercadona-cli (github.com/ivorpad/mercadona-cli).
 *
 * Todo lo que puede cambiar si Mercadona toca su web está aquí (URLs, cabeceras, formato de datos),
 * para poder arreglarlo en un único sitio. Errores con código claro (MercaError) para la pantalla de diagnóstico.
 *
 * NUNCA confirma pedidos ni paga: solo lee catálogo, lee/escribe el carrito y renueva la sesión.
 */
import type { MercaConfig, MercaProduct } from '../../types';
import { defaultTransport, type HttpRequest, type Transport } from './http';
import type { MercaSession } from './session';

export const BASE_URL = 'https://tienda.mercadona.es';
export const DEFAULT_ALGOLIA = { appId: '7UZJKL1DJ0', apiKey: '9d8f2e39e90df472b4f2e559a116fe17', indexBase: 'products_prod' };
export const DEFAULT_X_VERSION = 'v9200';
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

export type MercaErrorCode =
  | 'sin_red' // no hay conexión / tiempo agotado
  | 'solo_apk' // la API de la tienda no admite peticiones desde el navegador (CORS)
  | 'sin_sesion' // no hay cuenta vinculada
  | 'sesion_caducada' // el token de renovación ya no vale → volver a vincular
  | 'bloqueado' // 403 / desafío anti-bots
  | 'limite' // 429/503 tras reintentos
  | 'no_encontrado' // 404
  | 'sin_reparto' // el código postal no tiene almacén
  | 'tope' // superaría el tope de gasto
  | 'cambio_api' // respuesta con formato inesperado: Mercadona ha cambiado algo
  | 'desconocido';

export class MercaError extends Error {
  constructor(
    public code: MercaErrorCode,
    message: string,
    public status?: number,
    public detail?: string,
  ) {
    super(message);
  }
}

export const ERROR_HELP: Record<MercaErrorCode, string> = {
  sin_red: 'Sin conexión o Mercadona no responde. Prueba de nuevo en un rato.',
  solo_apk: 'Esta parte solo funciona en la app instalada (APK), no en la versión web.',
  sin_sesion: 'Vincula tu cuenta de Mercadona en Más → Mercadona (una sola vez).',
  sesion_caducada: 'La sesión de Mercadona ha caducado. Vuelve a vincular la cuenta (Más → Mercadona).',
  bloqueado: 'Mercadona ha bloqueado la petición (protección anti-bots). Espera un rato o abre la web de Mercadona en el móvil y vuelve a intentarlo.',
  limite: 'Demasiadas peticiones seguidas. Espera un minuto.',
  no_encontrado: 'Producto o recurso no encontrado (quizá ya no está a la venta en tu almacén).',
  sin_reparto: 'Mercadona no reparte en ese código postal.',
  tope: 'La cesta supera el tope de gasto configurado.',
  cambio_api: 'Mercadona parece haber cambiado su web. Revisa el diagnóstico y los ajustes avanzados.',
  desconocido: 'Error inesperado.',
};

export interface SearchHit {
  product: MercaProduct;
  categoria?: string;
}

export interface CartLine {
  productId: string;
  quantity: number;
  nombre?: string;
  unitPrice?: number;
}

export interface Cart {
  id: string;
  lines: CartLine[];
  total?: number;
  /** cuerpo original, por si hay campos que debemos conservar */
  raw: unknown;
}

const num = (v: unknown, def = 0): number => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : def;
};

/** Convierte un producto de Algolia o de /api/products en nuestro formato. Lanza 'cambio_api' si no encaja. */
export function toMercaProduct(raw: Record<string, unknown>): MercaProduct {
  const p = (raw.price_instructions ?? {}) as Record<string, unknown>;
  const id = raw.id !== undefined ? String(raw.id) : '';
  const nombre = typeof raw.display_name === 'string' ? raw.display_name : '';
  if (!id || !nombre || p.unit_price === undefined) throw new MercaError('cambio_api', 'Formato de producto inesperado');
  return {
    id,
    nombre,
    formato: typeof raw.packaging === 'string' ? raw.packaging : undefined,
    unitSize: num(p.unit_size),
    sizeFormat: String(p.size_format ?? ''),
    unitPrice: num(p.unit_price),
    refPrice: p.reference_price !== undefined ? num(p.reference_price) : undefined,
    refFormat: p.reference_format ? String(p.reference_format) : undefined,
    approx: !!p.approx_size,
    sellingMethod: num(p.selling_method),
    minBunch: num(p.min_bunch_amount, 1) || 1,
    incBunch: num(p.increment_bunch_amount, 1) || 1,
    thumbnail: typeof raw.thumbnail === 'string' ? raw.thumbnail : undefined,
    actualizado: new Date().toISOString(),
  };
}

export interface ClientOptions {
  config: MercaConfig;
  transport?: Transport;
  /** sesión de la cuenta (solo en el móvil); se actualiza al renovar */
  session?: MercaSession;
  onSessionChange?: (s: MercaSession) => void;
  sleep?: (ms: number) => Promise<void>;
}

export class MercadonaClient {
  private t: Transport;
  private sleep: (ms: number) => Promise<void>;
  session?: MercaSession;

  constructor(private opts: ClientOptions) {
    this.t = opts.transport ?? defaultTransport;
    this.session = opts.session;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get wh(): string {
    return this.opts.config.wh || '4418';
  }
  private get algolia() {
    return this.opts.config.algolia ?? DEFAULT_ALGOLIA;
  }

  private headers(auth: boolean): Record<string, string> {
    const h: Record<string, string> = {
      accept: 'application/json',
      'accept-language': 'es-ES,es;q=0.9',
      'content-type': 'application/json',
      'user-agent': UA,
      origin: BASE_URL,
      referer: BASE_URL + '/',
      'x-version': this.opts.config.xVersion || DEFAULT_X_VERSION,
    };
    if (auth && this.session?.accessToken) h.authorization = `Bearer ${this.session.accessToken}`;
    return h;
  }

  /** Una petición con reintentos ante 429/503 y traducción de errores. */
  private async send(req: HttpRequest): Promise<{ status: number; headers: Record<string, string>; data: unknown }> {
    let wait = 600;
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await this.t(req);
      } catch (e) {
        const msg = (e as Error).message || '';
        // en el navegador, un bloqueo CORS llega como TypeError "Failed to fetch"
        if (/failed to fetch|networkerror|load failed|cors/i.test(msg) && req.url.startsWith(BASE_URL)) {
          throw new MercaError('solo_apk', ERROR_HELP.solo_apk);
        }
        throw new MercaError('sin_red', ERROR_HELP.sin_red, undefined, msg);
      }
      if ((res.status === 429 || res.status === 503) && attempt < 3) {
        const ra = Number(res.headers['retry-after']);
        await this.sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 10000) : wait);
        wait *= 2;
        continue;
      }
      return res;
    }
  }

  private fail(status: number, data: unknown, ctx: string): never {
    const detail = typeof data === 'string' ? data.slice(0, 300) : JSON.stringify(data ?? '').slice(0, 300);
    if (status === 401) throw new MercaError('sesion_caducada', ERROR_HELP.sesion_caducada, status, detail);
    if (status === 403) throw new MercaError('bloqueado', ERROR_HELP.bloqueado, status, detail);
    if (status === 404) throw new MercaError('no_encontrado', ERROR_HELP.no_encontrado, status, detail);
    if (status === 429 || status === 503) throw new MercaError('limite', ERROR_HELP.limite, status, detail);
    throw new MercaError('desconocido', `${ctx}: HTTP ${status}`, status, detail);
  }

  // ───────── catálogo (sin cuenta) ─────────

  /** Almacén que corresponde a un código postal (cabecera x-customer-wh). Solo APK. */
  async resolveWarehouse(cp: string): Promise<string> {
    const r = await this.send({
      method: 'POST',
      url: `${BASE_URL}/api/postal-codes/actions/change-pc/`,
      headers: this.headers(false),
      body: { new_postal_code: cp },
    });
    if (r.status < 200 || r.status >= 300) this.fail(r.status, r.data, 'Código postal');
    const wh = (r.headers['x-customer-wh'] ?? '').trim();
    if (!wh) throw new MercaError('sin_reparto', ERROR_HELP.sin_reparto);
    return wh;
  }

  private indexName(): string {
    return `${this.algolia.indexBase}_${this.wh}_es`;
  }

  private async algoliaPost(path: string, body: unknown): Promise<unknown> {
    const a = this.algolia;
    const r = await this.send({
      method: 'POST',
      url: `https://${a.appId.toLowerCase()}-dsn.algolia.net${path}`,
      headers: { 'X-Algolia-Application-Id': a.appId, 'X-Algolia-API-Key': a.apiKey, 'content-type': 'application/json' },
      body,
    });
    if (r.status === 401 || r.status === 403 || r.status === 404) {
      throw new MercaError('cambio_api', 'El buscador de Mercadona ha cambiado sus claves. Pulsa "Redescubrir buscador" en el diagnóstico.', r.status);
    }
    if (r.status < 200 || r.status >= 300) this.fail(r.status, r.data, 'Búsqueda');
    return r.data;
  }

  private parseHits(res: unknown): SearchHit[] {
    const hits = (res as { hits?: unknown[] })?.hits;
    if (!Array.isArray(hits)) throw new MercaError('cambio_api', 'Respuesta de búsqueda inesperada');
    const out: SearchHit[] = [];
    for (const h of hits as Record<string, unknown>[]) {
      try {
        const cats = h.categories as { name?: string }[] | undefined;
        out.push({ product: toMercaProduct(h), categoria: cats?.[0]?.name });
      } catch {
        /* se ignoran hits raros */
      }
    }
    return out;
  }

  /** Busca productos en el almacén configurado (funciona también en la web). */
  async search(query: string, hits = 8): Promise<SearchHit[]> {
    const params = new URLSearchParams({ query, hitsPerPage: String(hits) }).toString();
    const res = await this.algoliaPost(`/1/indexes/${this.indexName()}/query`, { params });
    return this.parseHits(res);
  }

  /** Varias búsquedas en una sola petición. */
  async batchSearch(queries: string[], hits = 5): Promise<SearchHit[][]> {
    if (!queries.length) return [];
    const requests = queries.map((q) => ({
      indexName: this.indexName(),
      params: new URLSearchParams({ query: q, hitsPerPage: String(hits) }).toString(),
    }));
    const res = (await this.algoliaPost('/1/indexes/*/queries', { requests })) as { results?: unknown[] };
    if (!Array.isArray(res?.results)) throw new MercaError('cambio_api', 'Respuesta de búsqueda múltiple inesperada');
    return res.results.map((r) => this.parseHits(r));
  }

  /** Ficha de un producto (precio actualizado). */
  async product(id: string): Promise<MercaProduct> {
    const r = await this.send({
      method: 'GET',
      url: `${BASE_URL}/api/products/${encodeURIComponent(id)}/?lang=es&wh=${encodeURIComponent(this.wh)}`,
      headers: this.headers(false),
    });
    if (r.status !== 200) this.fail(r.status, r.data, 'Producto');
    return toMercaProduct(r.data as Record<string, unknown>);
  }

  /**
   * Redescubre las claves del buscador leyendo la web de Mercadona (como hace mercadona-cli).
   * Útil si un día la búsqueda deja de funcionar. Solo APK.
   */
  async discoverAlgolia(): Promise<{ appId: string; apiKey: string; indexBase: string; version?: string }> {
    const shell = await this.send({ method: 'GET', url: `${BASE_URL}/`, headers: { 'user-agent': UA, accept: '*/*' }, responseType: 'text' });
    const html = String(shell.data ?? '');
    const path = html.match(/\/v\d+\/index-[A-Za-z0-9_-]+\.js/)?.[0];
    if (!path) throw new MercaError('cambio_api', 'No se encuentra el código de la web de Mercadona');
    const js = String((await this.send({ method: 'GET', url: BASE_URL + path, headers: { 'user-agent': UA, accept: '*/*' }, responseType: 'text' })).data ?? '');
    const pair = js.match(/"([A-Z0-9]{10})",[A-Za-z0-9_$]+="([0-9a-f]{32})"/);
    if (!pair) throw new MercaError('cambio_api', 'No se encuentran las claves del buscador en la web');
    const ib = js.match(/"(products_prod[a-z_]*)"/)?.[1] ?? 'products_prod';
    const version = path.match(/^\/(v\d+)\//)?.[1];
    return { appId: pair[1], apiKey: pair[2], indexBase: ib, version };
  }

  // ───────── cuenta (token) ─────────

  /** Renueva la sesión con el refresh token (sin captcha). Guarda el token nuevo (rota). */
  async refresh(): Promise<MercaSession> {
    const s = this.session;
    if (!s?.refreshToken) throw new MercaError('sin_sesion', ERROR_HELP.sin_sesion);
    const r = await this.send({
      method: 'POST',
      url: `${BASE_URL}/api/auth/tokens/`,
      headers: this.headers(false),
      body: { refresh_token: s.refreshToken },
    });
    if (r.status === 400 || r.status === 401) throw new MercaError('sesion_caducada', ERROR_HELP.sesion_caducada, r.status);
    if (r.status < 200 || r.status >= 300) this.fail(r.status, r.data, 'Renovar sesión');
    const d = r.data as { access_token?: string; refresh_token?: string; customer_id?: unknown };
    if (!d?.access_token) throw new MercaError('cambio_api', 'Respuesta de sesión inesperada');
    const next: MercaSession = {
      ...s,
      accessToken: d.access_token,
      refreshToken: d.refresh_token || s.refreshToken,
      customerId: customerFromJwt(d.access_token) || (d.customer_id ? String(d.customer_id) : s.customerId),
      renovado: new Date().toISOString(),
    };
    this.session = next;
    this.opts.onSessionChange?.(next);
    return next;
  }

  /** Petición autenticada: si el token ha caducado, renueva una vez y repite. */
  private async authed(req: Omit<HttpRequest, 'headers'>, ctx: string): Promise<unknown> {
    if (!this.session?.refreshToken && !this.session?.accessToken) throw new MercaError('sin_sesion', ERROR_HELP.sin_sesion);
    if (!this.session.accessToken) await this.refresh();
    let r = await this.send({ ...req, headers: this.headers(true) });
    if (r.status === 401 && this.session?.refreshToken) {
      await this.refresh();
      r = await this.send({ ...req, headers: this.headers(true) });
    }
    if (r.status < 200 || r.status >= 300) this.fail(r.status, r.data, ctx);
    return r.data;
  }

  private customer(): string {
    const id = this.session?.customerId || (this.session?.accessToken ? customerFromJwt(this.session.accessToken) : '');
    if (!id) throw new MercaError('sin_sesion', 'No se sabe qué cliente eres: vuelve a vincular la cuenta.');
    return id;
  }

  private cartUrl(): string {
    return `${BASE_URL}/api/customers/${this.customer()}/cart/?lang=es&wh=${encodeURIComponent(this.wh)}`;
  }

  async getCart(): Promise<Cart> {
    if (!this.session?.accessToken && this.session?.refreshToken) await this.refresh();
    const data = (await this.authed({ method: 'GET', url: this.cartUrl() }, 'Leer carrito')) as Record<string, unknown>;
    return parseCart(data);
  }

  /** Sustituye las líneas del carrito (una sola escritura, sin carreras). */
  async putCart(cart: Cart, lines: CartLine[]): Promise<Cart> {
    const body = {
      id: cart.id,
      lines: lines.filter((l) => l.quantity > 0).map((l) => ({ quantity: l.quantity, product_id: l.productId, sources: [] })),
    };
    const data = (await this.authed({ method: 'PUT', url: this.cartUrl(), body }, 'Guardar carrito')) as Record<string, unknown>;
    try {
      return parseCart(data);
    } catch {
      return { ...cart, lines };
    }
  }
}

export function parseCart(data: Record<string, unknown>): Cart {
  if (!data || typeof data !== 'object' || !Array.isArray(data.lines)) throw new MercaError('cambio_api', 'Formato de carrito inesperado');
  const lines: CartLine[] = (data.lines as Record<string, unknown>[]).map((l) => {
    const prod = (l.product ?? {}) as Record<string, unknown>;
    const pi = (prod.price_instructions ?? {}) as Record<string, unknown>;
    return {
      productId: String(l.product_id ?? prod.id ?? ''),
      quantity: num(l.quantity),
      nombre: typeof prod.display_name === 'string' ? prod.display_name : undefined,
      unitPrice: pi.unit_price !== undefined ? num(pi.unit_price) : undefined,
    };
  });
  const summary = data.summary as { total?: unknown } | undefined;
  return { id: String(data.id ?? ''), lines, total: summary?.total !== undefined ? num(summary.total) : undefined, raw: data };
}

/** Lee el customer_uuid del JWT de acceso. */
export function customerFromJwt(token: string): string {
  try {
    const part = token.split('.')[1];
    if (!part) return '';
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const json = JSON.parse(decodeURIComponent(escape(atob(b64))));
    return json.customer_uuid ? String(json.customer_uuid) : '';
  } catch {
    return '';
  }
}
