/**
 * Sesión de la cuenta de Mercadona.
 * Se guarda SOLO en este móvil (localStorage propio de la app), nunca en los datos
 * de la dieta: no se sincroniza con Supabase, no se exporta y no va a GitHub.
 */
export interface MercaSession {
  /** token de renovación: dura mucho y la app lo renueva sola (rota en cada renovación) */
  refreshToken: string;
  /** token de acceso (~6 semanas) */
  accessToken?: string;
  customerId?: string;
  vinculado: string;
  renovado?: string;
}

const KEY = 'dieta-merca-sesion';

export function loadSession(): MercaSession | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as MercaSession) : undefined;
  } catch {
    return undefined;
  }
}

export function saveSession(s: MercaSession): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* sin almacenamiento */
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nada */
  }
}

const PREFIX = 'MERCA1:';

/**
 * Código de vinculación generado en el PC (scripts/mercadona-vincular.mjs):
 * "MERCA1:" + base64(JSON {r: refresh_token, a?: access_token, c?: customer_id}).
 * También acepta pegar directamente un refresh token.
 */
export function decodeLinkCode(text: string): MercaSession | null {
  const t = text.trim();
  const now = new Date().toISOString();
  if (t.toUpperCase().startsWith(PREFIX)) {
    try {
      const json = JSON.parse(decodeURIComponent(escape(atob(t.slice(PREFIX.length).trim()))));
      if ((!json.r || typeof json.r !== 'string') && (!json.a || typeof json.a !== 'string')) return null;
      return {
        // sin token de renovación (solo acceso): funciona hasta que caduque (~6 semanas)
        refreshToken: typeof json.r === 'string' ? json.r : '',
        accessToken: typeof json.a === 'string' ? json.a : undefined,
        customerId: json.c ? String(json.c) : undefined,
        vinculado: now,
      };
    } catch {
      return null;
    }
  }
  // token suelto (sin espacios, longitud razonable)
  if (/^[A-Za-z0-9._\-~+/=]{20,}$/.test(t)) return { refreshToken: t, vinculado: now };
  return null;
}

export function encodeLinkCode(s: { refreshToken: string; accessToken?: string; customerId?: string }): string {
  const json = JSON.stringify({ r: s.refreshToken, a: s.accessToken, c: s.customerId });
  return PREFIX + btoa(unescape(encodeURIComponent(json)));
}
