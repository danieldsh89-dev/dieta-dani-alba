/**
 * Avisos del móvil (notificaciones locales: gratis, sin servidor).
 * - Por la noche: "¿Habéis comido lo planificado?" (solo días con comidas y sin confirmar).
 * - Revisión rápida del stock cada semana.
 * Se reprograman cada vez que se abre la app.
 */
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { AppData } from '../types';
import { addDays } from './planning';
import { dayMeals } from './day';

export type NotifyRoute = 'confirmar' | 'revision' | 'casa';

const NIGHT_BASE = 1000;
const REVIEW_ID = 2000;

export async function scheduleReminders(d: AppData, hoy: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const cfg = d.stock.config;
  try {
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
    // solo si la despensa está en marcha (así no pide permisos a quien no la usa)
    if (!cfg.desde || (!cfg.avisoNoche && !cfg.avisoRevision)) return;
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') {
      const r = await LocalNotifications.requestPermissions();
      if (r.display !== 'granted') return;
    }
    const now = Date.now();
    const notifications = [];
    if (cfg.avisoNoche) {
      for (let i = 0; i < 7; i++) {
        const fecha = addDays(hoy, i);
        const day = d.history.find((h) => h.fecha === fecha);
        if (!day || day.confirmado || !dayMeals(day).length) continue;
        const [y, m, dd] = fecha.split('-').map(Number);
        const when = new Date(y, m - 1, dd, cfg.horaNoche ?? 22, 0, 0);
        if (when.getTime() <= now) continue;
        notifications.push({
          id: NIGHT_BASE + i,
          title: '🍽️ ¿Habéis comido lo planificado hoy?',
          body: 'Un toque para confirmarlo (o corregir lo que cambió). Así la despensa se mantiene al día.',
          schedule: { at: when, allowWhileIdle: true },
          extra: { route: 'confirmar', fecha },
        });
      }
    }
    if (cfg.avisoRevision) {
      const last = cfg.ultimaRevision ? new Date(cfg.ultimaRevision).getTime() : 0;
      let when = new Date(Math.max(now + 3600000, last + 7 * 86400000));
      when.setHours(18, 0, 0, 0);
      if (when.getTime() <= now) when = new Date(when.getTime() + 86400000);
      notifications.push({
        id: REVIEW_ID,
        title: '🔎 Revisión rápida de la despensa',
        body: 'Un minuto: confirma unos pocos productos para que el stock siga cuadrando.',
        schedule: { at: when, allowWhileIdle: true },
        extra: { route: 'revision' },
      });
    }
    if (notifications.length) await LocalNotifications.schedule({ notifications });
  } catch {
    /* sin avisos: la app funciona igual */
  }
}

/** Avisa de algo ya mismo (p. ej., pedido sumado a la despensa). */
export async function notifyNow(title: string, body: string, route: NotifyRoute = 'casa'): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await LocalNotifications.schedule({ notifications: [{ id: 3000 + Math.floor(Math.random() * 1000), title, body, extra: { route } }] });
  } catch {
    /* nada */
  }
}

/** Al tocar un aviso: a qué pantalla ir. */
export function onReminderTap(fn: (route: NotifyRoute, fecha?: string) => void): () => void {
  if (!Capacitor.isNativePlatform()) return () => undefined;
  const h = LocalNotifications.addListener('localNotificationActionPerformed', (a) => {
    const extra = (a.notification.extra ?? {}) as { route?: NotifyRoute; fecha?: string };
    fn(extra.route ?? 'casa', extra.fecha);
  });
  return () => {
    h.then((x) => x.remove());
  };
}
