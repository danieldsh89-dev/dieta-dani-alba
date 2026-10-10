# Dieta Dani & Alba — Generador de comidas A/B/C

App web móvil (PWA instalable en Android) para generar comidas para **Dani y Alba** con el sistema **A / B / C**:
misma receta para los dos, distintas cantidades, calculadas con matemáticas deterministas a partir de una base de
alimentos editable. **No usa IA** para calorías, macros ni cantidades. Funciona sin internet y sin servidor.

---

## 1. Requisitos

- [Node.js](https://nodejs.org) 18 o superior (probado con Node 24).

## 2. Instalar

Abre una terminal en esta carpeta y ejecuta:

```bash
npm install
```

## 3. Usar en el ordenador (modo desarrollo)

```bash
npm run dev
```

Abre la dirección que aparece (normalmente http://localhost:5173). Para verla como en el móvil, usa el modo
"dispositivo móvil" de las herramientas de desarrollador del navegador (F12).

## 4. Tests

```bash
npm test
```

## 5. Compilar para producción

```bash
npm run build
```

Se genera la carpeta `dist/` con la app lista (incluye el Service Worker para funcionar offline).
Para probar el resultado compilado:

```bash
npm run preview
```

## 6. Instalar en Android

**La app ya está publicada en: https://danieldsh89-dev.github.io/dieta-dani-alba/**

1. Abre ese enlace en **Chrome** en el móvil.
2. Menú ⋮ → **"Instalar aplicación"** (o "Añadir a pantalla de inicio" → Instalar).
3. Aparece el icono en el móvil: se abre a pantalla completa y funciona sin internet.

**Actualizar la app publicada:** cada `git push` a la rama `main` vuelve a compilar, ejecuta los tests y publica
automáticamente (GitHub Actions, `.github/workflows/deploy.yml`). En el móvil la versión nueva se carga sola al abrir la app
con conexión (puede hacer falta cerrarla y abrirla una segunda vez).

### Alternativa: publicar en otro sitio

Para que Android permita **instalar** la app y usarla **sin conexión**, tiene que servirse por **HTTPS**.
La forma más sencilla y gratuita:

1. Ejecuta `npm run build`.
2. Entra en https://app.netlify.com/drop y **arrastra la carpeta `dist/`**. Te da una dirección `https://...netlify.app`.
   (También vale GitHub Pages, Vercel, Cloudflare Pages… cualquier hosting estático.)
3. Abre esa dirección en **Chrome** del móvil → menú ⋮ → **"Instalar aplicación"** / "Añadir a pantalla de inicio".
4. A partir de ahí funciona offline.

> Los datos (alimentos editados, favoritos, historial) se guardan **en el propio móvil** (localStorage).
> Dani y Alba comparten la app en el mismo dispositivo. Usa *Más → Datos → Exportar* para hacer copias de seguridad.

---

## Qué hace

| Pantalla | Función |
|---|---|
| **Inicio** | Hoy: bloques A, B, C (generar, favoritos o comida libre) + kcal/proteína de Dani y Alba. Compensación opcional de comida libre. |
| **Generar** | Paso a paso: bloque → obligatorios → quiero incluir → quiero evitar → estilo → 3-5 opciones con cantidades de Dani y Alba. Botones: Guardar, Usar hoy, Cambiar hidrato, Cambiar salsa, Más volumen, Más proteína, Regenerar. |
| **Generar → Tengo esto en casa** | Marcas lo que hay en casa (se recuerda), eliges bloque y "Crear comida" → 3-5 opciones. |
| **Alimentos** | Base de alimentos editable: crear producto (con foto), editar, duplicar, archivar. Distingue ✓ verificado / ≈ aproximado. |
| **Favoritos** | Favoritos A, B, C con cantidades de ambos, editar, ajustar a objetivos, usar hoy. |
| **Más** | Configuración (perfiles, objetivos A/B/C, misma receta), Crudo/cocinado (factores + calibrar cocción), Repartir tanda, Historial, Exportar/Importar. |

Toggle global arriba: **Pesos [Crudos] [Cocinados]**.
Toca cualquier ingrediente de una receta → **Sustituir** (comparador por calorías equivalentes con diferencia ±kcal),
método de cocción, cantidad exacta o quitar.

## Cómo calcula (motor matemático)

1. **Pool de ingredientes**: aplica restricciones de perfil (Dani sin pescado, Alba sin leche de vaca, legumbres de Alba ≤ 100 g),
   prohibidos, "sin lácteos", "solo seleccionados" o "lo que tengo en casa".
2. **Conjuntos candidatos**: plantillas de recetas conocidas (`src/data/seedMeals.ts`) adaptadas a los obligatorios +
   combinaciones por huecos (proteína, hidrato, verdura, salsa, complemento).
3. **Optimización de cantidades** por perfil: búsqueda por coordenadas sobre la rejilla de raciones (mín/máx/incremento de cada
   alimento) minimizando: desviación de kcal del bloque » falta de proteína » objetivo del estilo » raciones naturales.
4. **Selección** de 3-5 opciones diversas: mejor según estilo, máximo volumen, más proteína, con postre…

Las raciones se generan en múltiplos de 5 g/ml (o unidades enteras: huevos, rebanadas). Los cálculos internos mantienen
precisión. Las conversiones crudo/cocinado **no cambian las calorías**, solo el peso.

## Estructura

```
src/
  types.ts                 Tipos de dominio
  data/                    Datos iniciales (sin lógica)
    foods.ts               Base de alimentos
    profiles.ts            Perfiles Dani/Alba + ajustes por defecto
    conversions.ts         Factores crudo→cocinado
    seedMeals.ts           Plantillas de recetas + favoritos iniciales
  lib/                     Lógica pura (testeada, sin React)
    nutrition.ts           kcal/macros
    conversions.ts         crudo/cocinado, redondeos, calibración
    portions.ts            rangos de ración por perfil
    mealGenerator.ts       generador / optimizador A/B/C
    substitutions.ts       equivalencias y comparador
    validation.ts          restricciones y avisos
    batch.ts               repartir tanda
    day.ts                 totales del día y compensación
    __tests__/core.test.ts tests unitarios
  store/                   Persistencia (repository.ts = punto de enganche para un backend futuro)
  components/              UI reutilizable
  screens/                 Pantallas
scripts/make-icons.mjs     Genera los iconos PNG
```

## Valores aproximados

Los alimentos marcados **≈ Aproximado – revisar etiqueta** o **≈ Parcial** tienen valores estándar de referencia
(o solo las kcal verificadas). Revisa la etiqueta y edita la ficha; cambia "Verificación" a ✓ cuando estén comprobados.
Especialmente: **pan de molde 100% integral** (pan principal, 220 kcal/100 g provisional) y **contramuslo** (confirmar si los
212 kcal son en crudo o cocinado).

---

## APK de Android (para instalar sin Chrome / pasar por WhatsApp)

```bash
npm run apk
```

Genera `APK/Dieta-Dani-Alba-<versión>.apk` (app nativa con Capacitor; todo va dentro del APK, funciona sin internet).
Requisitos (ya instalados en este PC): JDK 17 en `C:\Users\Usuario\.jdks`, Android SDK.

- **Instalar**: pasa el `.apk` al móvil, ábrelo y permite "Instalar apps de origen desconocido" cuando lo pida.
- **Nueva versión**: sube `versionCode` (+1) y `versionName` en `android/app/build.gradle`, ejecuta `npm run apk` e instala
  el nuevo APK encima: se conservan los datos.
- **Firma — IMPORTANTE**: `android/app/dieta-release.jks` + `android/keystore.properties` (no se suben a git).
  Guarda una copia: sin ellos no se pueden instalar actualizaciones encima (habría que desinstalar y se perderían los datos).
- Los datos del APK y los de la versión web instalada desde Chrome están separados.


---

## Novedades v1.1

### 📅 Plan semanal, 🛒 lista de la compra y 🍲 cocinar en tanda (pestaña **Plan**)
- **Semana**: planifica A/B/C de cada día (generar, favorito, comida libre), copia días o la semana anterior.
  Desde el generador y los favoritos: botón **📅 Al plan…**.
- **Compra**: suma las cantidades de Dani y Alba de las comidas planificadas en el rango elegido, en peso de compra
  (crudo/seco/congelado; huevos y pan en unidades). Marca lo comprado, compártelo por WhatsApp o pásalo a la despensa.
- **Cocinar**: qué cocinar de una vez (p. ej. "1.050 g de pollo crudo → ≈790 g") y en cuántos tápers. Al pesar la tanda
  cocinada reparte el peso real en cada táper y ofrece guardar el rendimiento real como factor.

### 📷 Escáner de códigos de barras (Alimentos → 📷)
Lee el EAN con la cámara (o escríbelo) y busca el producto en [Open Food Facts](https://world.openfoodfacts.org).
Rellena nombre, marca, kcal, macros, fibra, sal y foto, marcado como **"Aproximado – revisar etiqueta"**.
Si ya lo tenías, abre su ficha. Necesita internet solo para la búsqueda.

### ☁️ Sincronización entre móviles (Más → Sincronizar)
Comparte automáticamente favoritos, alimentos, plan, despensa, lista de la compra, perfiles y factores de cocción.
Si los dos cambian lo mismo, gana el cambio más reciente. Funciona sin conexión y sincroniza al volver.

**Puesta en marcha (una sola vez, ~10 min):**
1. Crea una cuenta gratuita en https://supabase.com y un proyecto nuevo (región: Europa).
2. En el proyecto: **SQL Editor → New query**, pega el contenido de [`supabase/setup.sql`](supabase/setup.sql) y pulsa **Run**.
3. **Project Settings → API**: copia la **Project URL** y la **anon / publishable key**.
4. En el primer móvil: Más → Sincronizar → pega los dos datos → **Guardar servidor** → **Crear hogar**.
   (O pásamelos y los dejo incorporados en la app: la anon key está pensada para ir en apps públicas.)
5. **Compartir código** → en el otro móvil: Más → Sincronizar → pegar → **Unirme a este hogar**.

Seguridad: la tabla no es accesible directamente (RLS activado, sin políticas); solo mediante dos funciones que exigen
la clave secreta del hogar (24 caracteres aleatorios). Quien tenga el código del hogar puede ver y cambiar los datos.


---

## Novedades v1.2

**Comodidad**
- **↻ Repetir ayer** (Hoy): copia las comidas de ayer en los bloques vacíos de hoy. En cada bloque vacío, **↻ Como ayer**.
- **⧉ Copiar hoy a mañana** en un toque (rellena solo los bloques vacíos de mañana).
- **Favoritos más usados arriba** (cuentan los usos al elegirlos en Hoy, Plan o Favoritos).
- **🕘 Comidas recientes** en el generador: las últimas combinaciones del bloque, para reutilizarlas con un toque.
- **🔒 Bloquear ingredientes**: toca un ingrediente → "Bloquear esta cantidad" (o escribe una cantidad exacta: se bloquea sola).
  **⚖️ Ajustar el resto** recalcula los demás para cumplir el objetivo sin tocar lo bloqueado. Ideal si ya has cocinado una cantidad fija.

**Dieta**
- **🏋️ Días de entreno / 😴 descanso** por persona, con objetivos distintos (más kcal en el bloque B, para hidratos).
  Días por defecto en Configuración (L, X, V al principio); en Hoy se cambia cualquier día con un toque.
- **⚖️ Registro de peso** (Más → Progreso o botón 📈 en Hoy): gráfica, tendencia (media 7 días), ritmo en kg/semana y
  semanas estimadas hasta el objetivo. El último peso actualiza el perfil.
- **👍/👎** en cada opción del generador: aprende qué combinaciones e ingredientes os gustan (se comparten al sincronizar).

**Visualización**
- **📊 Gráficas** de 7/14/28 días: kcal y proteína por día frente al objetivo de ese día y % de días cumplidos
  (kcal ±10 % y proteína ≥ 90 %), con tabla por días.
- **📷 Fotos en favoritos** para reconocerlos de un vistazo.
- **Vista plato**: barra de reparto de kcal (proteína / hidratos / grasa) en cada comida y en el total del día.
- **👨‍🍳 Modo cocinar**: pantalla completa con letra grande, cantidades de Dani, Alba y **total a pesar**,
  crudo/cocinado, marcar lo ya pesado y pantalla siempre encendida.


---

## Novedades v1.3

- **Días de entreno sin diferencias por defecto** (se puede activar en Configuración). Al actualizar se desactiva en los móviles que ya lo tenían.
- **Comidas solo para una persona**: en el generador, selector **👥 Ambos | Solo Dani | Solo Alba**. En Hoy y en el Plan, un bloque puede
  ir **partido** (cada uno su comida) con **✂️ Cada uno lo suyo** / **🔗 Juntar**. Favoritos de una sola persona con etiqueta "solo …".
  En **Configuración → Bloques que coméis por separado** (p. ej. A) esos bloques aparecen ya partidos, y **Este móvil es de** preselecciona tu parte.
- **✍️ Apuntar lo que comí de verdad** (menú ⋯ de cada comida): opcional; ajustas cantidades y queda marcado "✍️ real".
- **🍌 Extras de hoy**: apunta en 2 toques algo fuera del plan; cuenta en los totales y gráficas (no en la lista de la compra).
- **🔎 Buscar favoritos** por nombre o ingrediente y filtrar (para los dos / solo uno, sin lácteos, sin pescado, con foto). **⧉ Duplicar** favorito.
- **📋 Semanas tipo** (Plan → Semana): guarda una semana y aplícala a otra (rellenar huecos o reemplazar).
- **✕ Quitar ingrediente** directamente en cada fila al editar o generar.
- **Botón atrás de Android** dentro de la app: cierra la ventana abierta, vuelve de pantalla y, en Hoy, sale.

## Novedades v1.4 — Compra en Mercadona

Plan → Compra → **🛒 Mercadona** convierte la lista de la compra en productos de Mercadona y (en la app instalada) los **carga en tu carrito**. Nunca hace el pedido ni paga: eso lo haces tú en la app/web de Mercadona.

### Configurar una sola vez (desde el PC)

1. Chrome → `tienda.mercadona.es` → **F12** → pestaña **Network** → inicia sesión normalmente.
2. Con la sesión iniciada: clic derecho en la lista de Network → **Save all as HAR**.
3. En la carpeta del proyecto: `npm run mercadona:vincular -- "C:\ruta\archivo.har"` → se abre una página con un QR (se borra sola en 10 min).
4. En el móvil: **Más → Mercadona → 📷 Escanear QR del PC**. Borra el archivo HAR.

La sesión se guarda **solo en ese móvil** (no se sincroniza, no se exporta, no va a GitHub) y se renueva sola. Solo hay que repetirlo si Mercadona cierra la sesión (cambio de contraseña, "cerrar sesión en todos los dispositivos").

### Uso semanal

Plan → Compra → 🛒 Mercadona → **✨ Proponer productos** (la primera vez; luego se recuerdan) → revisa cantidades/quitar/"en casa" → **🛒 Cargar en mi carrito** (sumar o reemplazar, respeta el tope de gasto) → **Abrir Mercadona** y paga allí.

### Si algo falla

- **📋 Copiar lista con productos** / **💻 Exportar para el PC**: funcionan siempre, sin cuenta.
- **Más → Mercadona → 🩺 Diagnóstico**: prueba buscador, código postal, sesión y lectura del carrito sin modificar nada.
- **Ajustes avanzados**: "Redescubrir buscador" (si Mercadona cambia sus claves de búsqueda), x-version, restaurar valores.
- El código vive en `src/integrations/mercadona/` (cliente, cesta, sesión) con tests en `src/lib/__tests__/mercadona.test.ts`.
- Es una API no oficial: puede cambiar sin aviso. En la web (GitHub Pages) solo funciona la búsqueda; carrito y cuenta requieren el APK.
