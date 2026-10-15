# Dieta Dani & Alba

App (PWA + APK Android) para dos personas: dieta modular A/B/C con cálculo determinista, despensa con stock, compra en Mercadona y asistente de voz. Usuario: Dani (con Alba). Idioma: español (textos, comentarios y docs). README.md tiene el detalle por versión.

## Reglas de trabajo (acordadas con el usuario)
- **Pedir confirmación antes de publicar** (git push, GitHub Releases): el repo es público. Los commits locales sí se pueden hacer.
- **Proponer antes de implementar** cuando el usuario pide mejoras abiertas; implementar lo que él elige.
- Tras cada cambio: `npx tsc -b`, `npx vitest run` y probar en el navegador (preview en móvil: `npx vite build` + `npx vite preview --port 4173`; limpiar caches/localStorage al probar). Las pruebas de voz real solo se pueden hacer en el móvil.
- Cada versión: subir versionCode/versionName en `android/app/build.gradle` y `version` en `package.json`, `npm run apk`, zip del .apk (`APK/Dieta-Dani-Alba-X.Y.Z.zip`), commit y, si el usuario lo aprueba, push + `gh release create vX.Y.Z` con .apk y .zip (`--verify-tag`, crear antes el tag). El usuario instala el .zip si el navegador bloquea el .apk; se instala encima sin desinstalar.
- **Nunca** commitear: `android/app/dieta-release.jks`, `android/keystore.properties`, `local.properties`, tokens/HAR/códigos de vinculación de Mercadona, `APK/*.json` de inventario. El refresh token de Mercadona vive solo en el localStorage del móvil.
- Al escribir código con scripts Python/heredocs: cuidado con escapes (`\b`, `\s`) — se coló un carácter de control una vez. Comprobar con `grep -rlP "[\x00-\x08\x0B\x0C\x0E-\x1F]" src`.
- Otras carpetas hermanas de `E:\IA` (TikTok, Reddit, "Proyecto Lista de la compra" = Despensa antigua, ya retirada) **no se tocan**.

## Stack
React 18 + TypeScript + Vite 5, vite-plugin-pwa, vitest. Capacitor 6 (APK): `@capacitor/app`, `@capacitor-community/speech-recognition`, `@capacitor/local-notifications`, CapacitorHttp (salta CORS para Mercadona). JDK 17 en `~/.jdks`. Datos en localStorage + sincronización opcional con Supabase (LWW por documento `kind:id`).

## Despliegue
- Repo público: github.com/danieldsh89-dev/dieta-dani-alba. Web (GitHub Pages, se despliega con push a main): https://danieldsh89-dev.github.io/dieta-dani-alba/
- APK firmado: `npm run apk` (scripts/build-apk.mjs). Releases con .apk + .zip.
- Sync: proyecto Supabase con `supabase/setup.sql`; URL y clave pública ya embebidas en `src/sync/config.ts`.

## Estructura (src/)
- `lib/` lógica pura con tests en `lib/__tests__/`:
  `nutrition`, `conversions` (crudo↔cocinado), `portions`, `mealGenerator` (generador A/B/C), `coherence` (sentido común: no dulce/yogur con plato salado, sin dos proteínas/hidratos…), `substitutions`, `variants` (cambiar solo hidrato/proteína manteniendo objetivo), `favorites`, `planning` (lista del plan, tanda), `compra` (lista de la compra unificada de la casa), `day`/`dayEdit`, `stock` (motor de despensa por eventos), `voz` (intérprete de frases de despensa), `planVoz` (planes por voz: idea → huecos, repetir días, hidrato distinto entre comida y cena), `asistente` (órdenes de voz globales), `mealInfo` (iconos, coste, orden de favoritos, secciones de compra), `adherence`, `notify`, `speech`, `useStock`.
- `integrations/mercadona/`: `client` (API no oficial: búsqueda Algolia, producto, carrito, pedidos), `session`, `basket` (cesta con paquetes y precios), `habituales`, `orders` (pedidos entregados → stock), `service`, `http`.
- `store/AppStore.tsx` (estado, toasts con deshacer), `store/seed.ts`, `sync/`.
- `screens/`: Home (Hoy), Plan, Generator, Casa + CasaCompra (despensa y compra: Inicio, Despensa, Lista, Carrito, Gasto), Favorites, Foods, Progress, Settings, Sync, Mercadona*, Tools. `components/`: sheets (Sheet scrolla internamente), VoiceBar, AsistenteSheet, PlanVozSheet, VariantSheet, GlobalSearch, QtyEditor, etc.
- Datos base: `src/data/` (alimentos, conversiones, 41 comidas del PDF A1–A13/B1–B14/C1–C14 como favoritos semilla).

## Conceptos clave
- Cantidades siempre en **estado base (g/ml)**; se muestran en crudo o cocinado según el selector. Las matemáticas son deterministas (sin IA).
- Stock por **eventos inmutables** (`set`/`delta`/`nivel`): las comidas registradas descuentan solas (desayuno 9:00, comida 14:00, cena 21:00); los pedidos de Mercadona entregados suman lo realmente preparado. Artículos *contados* o *por estado*; modo de reposición `habitual | preguntar | nunca`.
- Mercadona: **nunca se hace el pedido ni se paga**, solo se carga el carrito. CP 35215 (almacén 4418). Vinculación de cuenta: HAR de Chrome → `npm run mercadona:vincular -- archivo.har` → QR escaneado en Más → Mercadona (una vez por móvil, sesiones independientes). API no oficial: puede cambiar; hay Diagnóstico y ajustes avanzados.
- Voz: reglas (gratis, sin IA, sin conexión). Lo que cambia plan/diario se confirma antes y tiene ↺ Deshacer.

## Estado y pendientes (2026-10-15)
- Última versión: 1.10.0: Casa es la sección de despensa y compra (Inicio, Despensa, Lista unificada en `lib/compra.ts`, Carrito, Gasto; la cuenta de Mercadona cuelga de Casa, ya no de Más; Plan solo Semana y Cocinar). 1.9.0 = rediseño premium (Geist + Fraunces en `src/assets/fonts`, iconos en `components/icons.tsx`, tokens en `styles.css`). **1.8.2 a 1.10.0 sin publicar en GitHub** (v1.8.1 es la última release).
- Versión de prueba instalable junto a la normal: `npm run apk:nuevo` (app "D&A Nuevo", applicationId `.nuevo`, datos separados). Útil para que el usuario pruebe cambios grandes sin tocar su app.
- Guía de uso (documento compartible): https://claude.ai/code/artifact/7e156ca0-6773-4a8a-8d33-cef32fc4da3d — actualizada hasta 1.8.1 (falta: repetir comidas varios días, hidrato distinto comida/cena).
- Despensa antigua (Telegram + Supabase aparte): bot desconectado; faltan por hacer al usuario pausar su proyecto Supabase, borrar el activador del script de Gmail y el conector de claude.ai.
- Ideas propuestas y pendientes de elegir: temporizadores con nombre que avisen con el móvil bloqueado, cocinar manos libres con lectura en voz alta, preguntas con respuesta hablada ("¿cuánto me queda hoy?"), calculadora crudo↔cocinado, recordatorios por voz, contador de agua, modo "en el súper", más accesos directos y botones en notificaciones.
- Hoja de ruta a producto vendible (no empezada): onboarding y plantillas de dieta, cuentas Google/email con Supabase RLS, login de Mercadona dentro de la app (WebView), RGPD/datos de salud, Google Play, otros supermercados (conector por cadena; Lidl solo lista/precios), widget Android (aparcado).
- Rechazado por el usuario: recordatorio de descongelar.
