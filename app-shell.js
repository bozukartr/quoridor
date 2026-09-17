import './mobile-ui.js';
import { Capacitor } from '@capacitor/core';
import '@fortawesome/fontawesome-free/css/all.min.css';
import '@fontsource/outfit/300.css';
import '@fontsource/outfit/500.css';
import '@fontsource/outfit/700.css';

// Native apps ship dist with the binary. Only browser production builds need SW.
if (import.meta.env.PROD && !Capacitor.isNativePlatform() && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(error => {
            console.warn('Offline cache could not be registered', error);
        });
    });
}
