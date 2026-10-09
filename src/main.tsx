import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { registerSW } from 'virtual:pwa-register';
import { installBackButton } from './lib/back';
import App from './App';
import { AppStoreProvider } from './store/AppStore';
import './styles.css';

// En la app Android (APK) los archivos ya van dentro: no hace falta Service Worker.
if (!Capacitor.isNativePlatform()) registerSW({ immediate: true });
// botón atrás de Android / navegador dentro de la app
installBackButton(Capacitor.isNativePlatform());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppStoreProvider>
      <App />
    </AppStoreProvider>
  </StrictMode>,
);
