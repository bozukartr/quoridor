export const SETTINGS_KEY = 'quoridor.settings.v1';
export const DEFAULT_SETTINGS = Object.freeze({ volume: 0.5, vibration: true, reducedMotion: false });
export function normalizeSettings(value = {}) {
    return {
        volume: typeof value?.volume === 'number' && Number.isFinite(value.volume) ? Math.max(0, Math.min(1, value.volume)) : 0.5,
        vibration: typeof value?.vibration === 'boolean' ? value.vibration : true,
        reducedMotion: value?.reducedMotion === true,
    };
}
export function createSettings(storage) {
    let value;
    try { value = normalizeSettings(JSON.parse(storage.getItem(SETTINGS_KEY))); } catch { value = { ...DEFAULT_SETTINGS }; }
    const listeners = new Set();
    return {
        get: () => ({ ...value }),
        update(patch) {
            value = normalizeSettings({ ...value, ...patch });
            try { storage.setItem(SETTINGS_KEY, JSON.stringify(value)); } catch { /* Keep working in memory. */ }
            listeners.forEach(fn => fn({ ...value }));
            return { ...value };
        },
        subscribe(fn) { listeners.add(fn); fn({ ...value }); return () => listeners.delete(fn); },
    };
}
let storage;
try { storage = globalThis.localStorage; } catch { /* Private browsing. */ }
export const settings = createSettings(storage);
