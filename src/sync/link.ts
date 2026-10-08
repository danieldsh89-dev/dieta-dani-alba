/**
 * Clave del hogar y "código de enlace" para unir el segundo móvil.
 * El código lleva dentro la URL, la anon key y la clave del hogar, para pegarlo una sola vez.
 */
import type { CloudConfig } from './supabase';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateHouseholdKey(length = 24): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export function formatKey(k: string): string {
  return k.match(/.{1,4}/g)?.join('-') ?? k;
}

export function normalizeKey(k: string): string {
  return k.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const PREFIX = 'DIETA1:';

export function encodeLink(cfg: CloudConfig, household: string): string {
  const json = JSON.stringify({ u: cfg.url, k: cfg.anonKey, h: household });
  return PREFIX + btoa(unescape(encodeURIComponent(json)));
}

/** Acepta un código de enlace completo o solo la clave del hogar. */
export function decodeLink(text: string): { cfg?: CloudConfig; household: string } | null {
  const t = text.trim();
  if (t.toUpperCase().startsWith(PREFIX)) {
    try {
      const json = JSON.parse(decodeURIComponent(escape(atob(t.slice(PREFIX.length)))));
      if (!json.h) return null;
      return { cfg: json.u && json.k ? { url: json.u, anonKey: json.k } : undefined, household: normalizeKey(json.h) };
    } catch {
      return null;
    }
  }
  const k = normalizeKey(t);
  return k.length >= 20 ? { household: k } : null;
}
