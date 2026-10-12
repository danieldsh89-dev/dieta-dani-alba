/**
 * Dictado por voz (gratis): en el APK usa el reconocimiento de voz de Android (el de Google,
 * el mismo del teclado); en el navegador, el de Chrome si existe. Si no hay, se escribe
 * o se usa el micrófono del teclado.
 */
import { Capacitor } from '@capacitor/core';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';

type WebRec = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: (e: { results: { 0: { transcript: string } }[] }) => void;
  onerror: (e: { error: string }) => void;
  onend: () => void;
  start: () => void;
};

function webRecognizer(): (new () => WebRec) | undefined {
  const w = window as unknown as { SpeechRecognition?: new () => WebRec; webkitSpeechRecognition?: new () => WebRec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function speechAvailable(): boolean {
  return Capacitor.isNativePlatform() || !!webRecognizer();
}

/** Escucha una frase. Devuelve el texto, o null si se cancela / no se entiende. */
export async function listen(prompt = 'Dime qué ha pasado en casa…'): Promise<string | null> {
  if (Capacitor.isNativePlatform()) {
    const { available } = await SpeechRecognition.available();
    if (!available) throw new Error('Este móvil no tiene reconocimiento de voz. Usa el micrófono del teclado.');
    const perm = await SpeechRecognition.checkPermissions();
    if (perm.speechRecognition !== 'granted') {
      const r = await SpeechRecognition.requestPermissions();
      if (r.speechRecognition !== 'granted') throw new Error('Sin permiso de micrófono. Puedes activarlo en Ajustes → Apps → Dieta.');
    }
    try {
      const r = await SpeechRecognition.start({ language: 'es-ES', maxResults: 1, prompt, partialResults: false, popup: true });
      return r.matches?.[0]?.trim() || null;
    } catch {
      return null; // cancelado o sin voz
    }
  }
  const Rec = webRecognizer();
  if (!Rec) throw new Error('Tu navegador no tiene dictado: usa el micrófono del teclado.');
  return new Promise((resolve) => {
    const rec = new Rec();
    let text: string | null = null;
    rec.lang = 'es-ES';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      text = e.results[0]?.[0]?.transcript ?? null;
    };
    rec.onerror = () => resolve(null);
    rec.onend = () => resolve(text);
    rec.start();
  });
}
