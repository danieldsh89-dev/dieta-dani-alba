/**
 * Configuración de Supabase incorporada en la app.
 * La "anon/publishable key" está pensada para ir en apps públicas: la tabla no es accesible
 * directamente (RLS sin políticas) y solo se puede usar con la clave secreta del hogar.
 * Si se dejan vacías, se pueden introducir desde la app (Más → Sincronizar).
 */
export const SUPABASE_URL = 'https://lgpdhfniwhmfmqwcnnpp.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_6fcYJvfGh75Qq73BlVmkFg_1t8ibxNm';
