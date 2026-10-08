import { useEffect, useRef, useState } from 'react';
import { isValidBarcode } from '../lib/openFoodFacts';
import { Sheet, Warnings } from './ui';

interface DetectorLike {
  detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]>;
}

/**
 * Escáner de códigos de barras con la cámara trasera.
 * Usa BarcodeDetector nativo si existe (Chrome Android) y si no, ZXing (cargado bajo demanda).
 * Siempre permite escribir el código a mano.
 */
export function BarcodeScanner({ onDetected, onClose }: { onDetected: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const done = useRef(false);
  const cb = useRef(onDetected);
  cb.current = onDetected;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopZxing: (() => void) | null = null;
    let raf = 0;
    let cancelled = false;

    const finish = (code: string) => {
      if (done.current || cancelled) return;
      done.current = true;
      navigator.vibrate?.(60);
      cb.current(code);
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Este dispositivo no permite usar la cámara aquí. Escribe el código a mano.');
        return;
      }
      const Native = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => DetectorLike }).BarcodeDetector;
      try {
        if (Native) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
          if (cancelled) return;
          const video = videoRef.current!;
          video.srcObject = stream;
          await video.play();
          const detector = new Native({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
          const loop = async () => {
            if (cancelled || done.current) return;
            try {
              const codes = await detector.detect(video);
              const ok = codes.map((c) => c.rawValue).find((c) => isValidBarcode(c) || /^\d{6,14}$/.test(c));
              if (ok) return finish(ok);
            } catch {
              /* frame no listo */
            }
            raf = requestAnimationFrame(loop);
          };
          loop();
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser');
          const reader = new BrowserMultiFormatReader();
          const controls = await reader.decodeFromConstraints(
            { video: { facingMode: { ideal: 'environment' } }, audio: false },
            videoRef.current!,
            (result) => {
              const text = result?.getText();
              if (text && /^\d{6,14}$/.test(text)) finish(text);
            },
          );
          stopZxing = () => controls.stop();
          if (cancelled) stopZxing();
        }
      } catch (e) {
        const name = (e as Error).name;
        setError(
          name === 'NotAllowedError'
            ? 'Permiso de cámara denegado. Actívalo en los ajustes del navegador/app, o escribe el código a mano.'
            : 'No se pudo abrir la cámara. Escribe el código a mano.',
        );
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stopZxing?.();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const code = manual.replace(/\D/g, '');
  return (
    <Sheet title="Escanear código de barras" onClose={onClose}>
      <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', background: '#000', aspectRatio: '4 / 3' }}>
        <video ref={videoRef} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        <div
          style={{
            position: 'absolute',
            left: '10%',
            right: '10%',
            top: '38%',
            height: '24%',
            border: '2px solid rgba(255,255,255,0.85)',
            borderRadius: 10,
            boxShadow: '0 0 0 999px rgba(0,0,0,0.25)',
          }}
        />
      </div>
      <div className="sub">Enfoca el código de barras del envase dentro del recuadro.</div>
      {error && <Warnings items={[error]} />}
      <div className="row">
        <input
          type="text"
          inputMode="numeric"
          placeholder="…o escribe el código (EAN)"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
        />
        <button className="btn primary" disabled={code.length < 6} onClick={() => onDetected(code)}>
          Buscar
        </button>
      </div>
      {code.length >= 8 && !isValidBarcode(code) && <div className="tiny muted">Ese código no parece un EAN válido; se buscará igualmente.</div>}
    </Sheet>
  );
}
