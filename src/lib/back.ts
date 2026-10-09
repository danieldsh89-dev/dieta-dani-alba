/**
 * Botón "atrás" (Android y navegador): pila de manejadores.
 * Lo último que se abre (una ventana, el modo cocinar…) se cierra primero; después la navegación
 * vuelve de pantalla; si nadie lo gestiona, la app sale (APK) o el navegador va atrás.
 */
import { useEffect, useRef } from 'react';

type Handler = () => boolean;
const stack: { id: number; fn: () => Handler }[] = [];
let seq = 0;

/** Ejecuta el "atrás": devuelve true si algo lo gestionó. */
export function handleBack(): boolean {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].fn()()) return true;
  }
  return false;
}

/** Registra un manejador mientras el componente está montado (y `active`). */
export function useBackHandler(handler: Handler, active = true): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    const id = ++seq;
    stack.push({ id, fn: () => ref.current });
    return () => {
      const i = stack.findIndex((h) => h.id === id);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [active]);
}

/** Conecta el botón físico/gesto de Android (APK) o el "atrás" del navegador (web/PWA). */
export async function installBackButton(isNative: boolean): Promise<void> {
  if (isNative) {
    const { App } = await import('@capacitor/app');
    App.addListener('backButton', () => {
      if (!handleBack()) App.exitApp();
    });
    return;
  }
  // web: una entrada "trampa" en el historial para interceptar el atrás
  history.pushState({ dieta: true }, '');
  window.addEventListener('popstate', () => {
    if (handleBack()) history.pushState({ dieta: true }, '');
  });
}
