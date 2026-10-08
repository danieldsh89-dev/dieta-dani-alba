/**
 * Configuración de Supabase incorporada en la app.
 * La "anon/publishable key" está pensada para ir en apps públicas: la tabla no es accesible
 * directamente (RLS sin políticas) y solo se puede usar con la clave secreta del hogar.
 * Si se dejan vacías, se pueden introducir desde la app (Más → Sincronizar).
 */
export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';
