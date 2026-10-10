#!/usr/bin/env node
/**
 * Vincular la app con tu cuenta de Mercadona (se hace UNA vez, en el PC).
 *
 * 1. En Chrome: tienda.mercadona.es → F12 → pestaña Network → inicia sesión.
 * 2. Con la sesión iniciada: clic derecho en la lista de Network → "Save all as HAR".
 * 3. npm run mercadona:vincular -- "C:\ruta\al\archivo.har"
 *    (o sin argumento, si usas mercadona-cli: lee ~/.mercadona/token.json)
 *
 * Genera un código "MERCA1:…" y una página con un QR para escanearlo desde la app
 * (Más → Mercadona → Escanear QR del PC). Después la app renueva la sesión sola.
 *
 * Seguridad: el código equivale a tu sesión. La página se guarda en la carpeta temporal
 * y se borra sola a los 10 minutos. Borra también el archivo HAR cuando termines.
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { exec } from 'node:child_process';
import QRCode from 'qrcode';

function fromJwt(token) {
  try {
    const part = token.split('.')[1];
    const json = JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return json.customer_uuid ? String(json.customer_uuid) : '';
  } catch {
    return '';
  }
}

/** Extrae los tokens del HAR (misma lógica que mercadona-cli: respuesta de /api/auth/ y cabecera Bearer). */
function parseHar(text) {
  const har = JSON.parse(text);
  const s = { a: '', r: '', c: '' };
  for (const e of har?.log?.entries ?? []) {
    const url = e?.request?.url ?? '';
    if (e?.response?.status === 200 && url.includes('/api/auth/')) {
      let body = e.response.content?.text ?? '';
      if (e.response.content?.encoding === 'base64') body = Buffer.from(body, 'base64').toString('utf8');
      try {
        const r = JSON.parse(body);
        if (r.access_token) s.a = r.access_token;
        if (r.refresh_token) s.r = r.refresh_token;
        if (r.customer_id || r.customer_uuid) s.c = String(r.customer_uuid ?? r.customer_id);
      } catch {
        /* no es JSON */
      }
    }
    if (url.includes('mercadona.es/api/')) {
      for (const h of e?.request?.headers ?? []) {
        if (String(h.name).toLowerCase() === 'authorization' && /^bearer /i.test(h.value ?? '')) s.a = h.value.slice(7).trim();
      }
    }
  }
  if (!s.c && s.a) s.c = fromJwt(s.a);
  return s;
}

function fromCli() {
  const p = join(homedir(), '.mercadona', 'token.json');
  if (!existsSync(p)) return null;
  const t = JSON.parse(readFileSync(p, 'utf8'));
  return { a: t.access_token ?? '', r: t.refresh_token ?? '', c: String(t.customer_id ?? '') || fromJwt(t.access_token ?? '') };
}

const file = process.argv[2];
let s;
try {
  s = file ? parseHar(readFileSync(file, 'utf8')) : fromCli();
} catch (e) {
  console.error('No se pudo leer el archivo:', e.message);
  process.exit(1);
}
if (!s || (!s.r && !s.a)) {
  console.error(
    file
      ? '\n✗ El HAR no contiene la sesión de Mercadona.\n  Asegúrate de abrir F12 → Network ANTES de iniciar sesión, y de guardar el HAR con la sesión ya iniciada.\n'
      : '\n✗ Indica la ruta del archivo HAR:  npm run mercadona:vincular -- "C:\\ruta\\archivo.har"\n',
  );
  process.exit(1);
}
if (!s.r) {
  console.warn(
    '\n⚠ No se encontró el token de renovación (solo el de acceso, que caduca en unas semanas).\n  Para que la app se renueve sola, cierra sesión en la web, abre F12 → Network y vuelve a iniciar sesión antes de guardar el HAR.\n',
  );
}

const code = 'MERCA1:' + Buffer.from(JSON.stringify({ r: s.r || undefined, a: s.a || undefined, c: s.c || undefined }), 'utf8').toString('base64');
const qr = await QRCode.toDataURL(code, { errorCorrectionLevel: 'L', margin: 2, width: 420 });
const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Vincular Mercadona</title>
<style>body{font-family:system-ui;max-width:640px;margin:32px auto;padding:0 16px;color:#1d2420}textarea{width:100%;height:110px;font-size:12px}
.qr{text-align:center;margin:20px 0}.warn{background:#fff3dc;color:#8a5a00;padding:10px;border-radius:8px}</style></head><body>
<h2>🛒 Vincular la app con Mercadona</h2>
<p>En el móvil: <b>Más → Mercadona → 📷 Escanear QR del PC</b>.</p>
<div class="qr"><img src="${qr}" alt="QR de vinculación"></div>
<p>¿No puedes escanear? Copia este código, envíatelo al móvil y pégalo en “…o pega el código”:</p>
<textarea readonly onclick="this.select()">${code}</textarea>
<p class="warn">⚠ Este código da acceso a tu cuenta de Mercadona: no lo compartas. Esta página se borrará en 10 minutos.
Borra también el archivo HAR.</p>
${s.r ? '' : '<p class="warn">Sin token de renovación: la vinculación caducará en unas semanas.</p>'}
</body></html>`;
const out = join(tmpdir(), `mercadona-vinculo-${Date.now()}.html`);
writeFileSync(out, html, { encoding: 'utf8', mode: 0o600 });
console.log(`\n✓ Sesión encontrada (cliente ${s.c ? s.c.slice(0, 8) + '…' : '?'}${s.r ? ', con renovación automática' : ''}).`);
console.log(`  Abriendo la página con el QR: ${out}\n`);
const opener = process.platform === 'win32' ? `start "" "${out}"` : process.platform === 'darwin' ? `open "${out}"` : `xdg-open "${out}"`;
if (process.env.MERCA_NO_OPEN) {
  // modo prueba: no abre el navegador ni espera
  console.log('CODE=' + code);
  unlinkSync(out);
  process.exit(0);
}
exec(opener);
setTimeout(() => {
  try {
    unlinkSync(out);
    console.log('  Página del QR borrada.');
  } catch {
    /* ya no estaba */
  }
  process.exit(0);
}, 10 * 60 * 1000);
console.log('  (Deja esta ventana abierta hasta escanear; la página se borra sola en 10 minutos. Ctrl+C para salir antes.)');
