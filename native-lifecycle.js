import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

export function onAppResume(callback) {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') callback();
    });
    if (Capacitor.isNativePlatform()) {
        App.addListener('appStateChange', ({ isActive }) => {
            if (isActive) callback();
        }).catch(error => console.warn('App lifecycle listener failed', error));
    }
}
