// Genera los iconos de la PWA (public/) y, si existe android/, los iconos y splash de la app Android.
// Sin dependencias: escribe PNG con zlib nativo.
import { deflateSync } from 'node:zlib';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** pixel(x, y) recibe coordenadas en píxeles y devuelve [r,g,b,a] */
function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5);
      const o = y * (w * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const pngSize = (file) => { const b = readFileSync(file); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

const GREEN = [47, 125, 91, 255], PLATE = [246, 247, 244, 255], DANI = [44, 111, 187, 255], ALBA = [176, 69, 123, 255], GOLD = [232, 170, 50, 255];
const BG_LIGHT = [244, 245, 240, 255], NONE = [0, 0, 0, 0];

/** Plato con los tres bloques A/B/C. (cx, cy) centro y r radio del plato en píxeles; null = fuera */
function plate(x, y, cx, cy, r) {
  const d = (ax, ay) => Math.hypot(x - ax, y - ay);
  if (d(cx, cy) >= r) return null;
  const k = r / 0.33; // dibujo original pensado para radio 0.33
  if (d(cx - 0.12 * k, cy - 0.06 * k) < 0.075 * k) return DANI;
  if (d(cx + 0.12 * k, cy - 0.06 * k) < 0.075 * k) return ALBA;
  if (d(cx, cy + 0.14 * k) < 0.075 * k) return GOLD;
  return PLATE;
}

// PWA
for (const s of [192, 512]) {
  writeFileSync(new URL(`../public/icon-${s}.png`, import.meta.url), png(s, s, (x, y) => plate(x, y, s / 2, s / 2, s * 0.33) ?? GREEN));
}

// Android
const res = new URL('../android/app/src/main/res/', import.meta.url);
if (existsSync(res)) {
  const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [dens, f] of Object.entries(densities)) {
    const dir = new URL(`mipmap-${dens}/`, res);
    const s = Math.round(48 * f);
    writeFileSync(new URL('ic_launcher.png', dir), png(s, s, (x, y) => plate(x, y, s / 2, s / 2, s * 0.36) ?? GREEN));
    writeFileSync(
      new URL('ic_launcher_round.png', dir),
      png(s, s, (x, y) => (Math.hypot(x - s / 2, y - s / 2) > s / 2 ? NONE : plate(x, y, s / 2, s / 2, s * 0.36) ?? GREEN)),
    );
    const fs = Math.round(108 * f); // icono adaptativo: zona segura 66/108
    writeFileSync(new URL('ic_launcher_foreground.png', dir), png(fs, fs, (x, y) => plate(x, y, fs / 2, fs / 2, fs * 0.28) ?? NONE));
  }
  // Splash: mismo tamaño que los que trae la plantilla
  for (const d of readdirSync(res).filter((d) => d.startsWith('drawable'))) {
    const file = new URL(`${d}/splash.png`, res);
    if (!existsSync(file)) continue;
    const [w, h] = pngSize(file);
    const r = Math.min(w, h) * 0.18;
    writeFileSync(file, png(w, h, (x, y) => plate(x, y, w / 2, h / 2, r) ?? (Math.hypot(x - w / 2, y - h / 2) < r * 1.18 ? GREEN : BG_LIGHT)));
  }
  const bg = new URL('values/ic_launcher_background.xml', res);
  writeFileSync(bg, '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#2F7D5B</color>\n</resources>\n');
}
console.log('iconos generados');
