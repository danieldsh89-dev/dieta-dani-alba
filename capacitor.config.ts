import type { CapacitorConfig } from '@capacitor/cli';

// App Android nativa (APK) que empaqueta la web compilada en dist/.
const config: CapacitorConfig = {
  appId: 'com.danieldsh.dietadanialba',
  appName: 'Dieta D&A',
  webDir: 'dist',
  android: {
    backgroundColor: '#f4f5f0',
  },
};

export default config;
