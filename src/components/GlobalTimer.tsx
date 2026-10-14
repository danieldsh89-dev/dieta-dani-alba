import { useEffect, useState } from 'react';

/** Temporizador global (pedido por voz): una pastilla flotante con la cuenta atrás. */
export function GlobalTimer({ end, onDone }: { end: number; onDone: () => void }) {
  const [now, setNow] = useState(Date.now());
  const left = Math.max(0, Math.round((end - now) / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (left > 0) return;
    try {
      navigator.vibrate?.([400, 200, 400, 200, 600]);
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      [0, 0.35, 0.7].forEach((t) => {
        const o = ctx.createOscillator();
        o.frequency.value = 880;
        o.connect(ctx.destination);
        o.start(ctx.currentTime + t);
        o.stop(ctx.currentTime + t + 0.2);
      });
    } catch {
      /* sin sonido */
    }
  }, [left]);
  return (
    <button className="timer-pill" onClick={onDone} title="Quitar temporizador">
      ⏱️ {left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : '¡Listo!'} ✕
    </button>
  );
}
