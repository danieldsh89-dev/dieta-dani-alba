// Compila el APK de Android: build web → sincroniza con Capacitor → iconos → Gradle (release firmado).
// Uso: npm run apk   → deja el archivo en APK/Dieta-Dani-Alba-<versión>.apk
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const run = (cmd, cwd = root, env = process.env) => execSync(cmd, { cwd, stdio: 'inherit', env });

// JDK 17 (descargado en ~/.jdks) si JAVA_HOME no apunta ya a uno válido
const env = { ...process.env };
const jdks = join(homedir(), '.jdks');
const jdk = existsSync(jdks) && readdirSync(jdks).find((d) => d.startsWith('jdk-17'));
if (jdk) env.JAVA_HOME = join(jdks, jdk);

const gradle = readFileSync(join(root, 'android/app/build.gradle'), 'utf8');
const version = gradle.match(/versionName "([^"]+)"/)?.[1] ?? 'dev';

run('npm run build');
run('npx cap sync android');
run('node scripts/make-icons.mjs');
const gradlew = join(root, 'android', process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
run(`"${gradlew}" assembleRelease`, join(root, 'android'), env);

const out = join(root, 'APK');
mkdirSync(out, { recursive: true });
const dest = join(out, `Dieta-Dani-Alba-${version}.apk`);
copyFileSync(join(root, 'android/app/build/outputs/apk/release/app-release.apk'), dest);
console.log(`\n✅ APK listo: ${dest}`);
