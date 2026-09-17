import { Capacitor } from '@capacitor/core';
import { Purchases } from '@revenuecat/purchases-capacitor';
import { AdMob, AdmobConsentStatus, InterstitialAdPluginEvents } from '@capacitor-community/admob';
import { within } from './ad-break.js';
import { settings } from './settings.js';
import { createStore, adEligible } from './commerce-core.js';

const platform = Capacitor.getPlatform();
const native = Capacitor.isNativePlatform();
const testMode = import.meta.env.VITE_ADS_MODE !== 'live';
const apiKey = platform === 'ios' ? import.meta.env.VITE_REVENUECAT_IOS_KEY : import.meta.env.VITE_REVENUECAT_ANDROID_KEY;
export const store = createStore({ sdk: Purchases, apiKey, native,
    productId: import.meta.env.VITE_REMOVE_ADS_PRODUCT_ID || 'quoridor_remove_ads',
    entitlementId: 'remove_ads',
});
const adId = testMode
    ? (platform === 'ios' ? 'ca-app-pub-3940256099942544/4411468910' : 'ca-app-pub-3940256099942544/1033173712')
    : (platform === 'ios' ? import.meta.env.VITE_ADMOB_IOS_INTERSTITIAL : import.meta.env.VITE_ADMOB_ANDROID_INTERSTITIAL);
let initialized = false;
let consent = null;
let running = false;
function readNumber(key) { try { return Number(sessionStorage.getItem(key)) || 0; } catch { return 0; } }
function saveNumber(key, value) { try { sessionStorage.setItem(key, String(value)); } catch { /* Optional frequency cache. */ } }
let matches = readNumber('quoridor.ad.matches');
let lastAd = readNumber('quoridor.ad.last');
export function recordFinishedMatch(matchId) {
    if (!matchId) return;
    try {
        if (sessionStorage.getItem('quoridor.ad.match') === matchId) return;
        sessionStorage.setItem('quoridor.ad.match', matchId);
    } catch { /* Frequency cache is optional. */ }
    saveNumber('quoridor.ad.matches', ++matches);
}

async function initAds() {
    if (!native || !adId) return false;
    if (!initialized) {
        await AdMob.initialize({ initializeForTesting: testMode });
        initialized = true;
    }
    consent = await AdMob.requestConsentInfo();
    if (consent.isConsentFormAvailable && consent.status === AdmobConsentStatus.REQUIRED) consent = await AdMob.showConsentForm();
    return consent.canRequestAds === true;
}
export async function openAdPrivacy() {
    if (!native) return 'Reklam tercihleri mobil uygulamada kullanılabilir.';
    try {
        await initAds();
        if (consent?.privacyOptionsRequirementStatus !== 'REQUIRED') return 'Şu anda değiştirilecek ek reklam tercihi bulunmuyor.';
        await AdMob.showPrivacyOptionsForm();
        consent = await AdMob.requestConsentInfo();
        return 'Reklam tercihlerin güncellendi.';
    } catch { return 'Reklam tercihleri yüklenemedi. Bağlantını kontrol edip tekrar dene.'; }
}
// Called only by the explicit post-match "Ana menü" action, never during play.
export async function showPostMatchAd() {
    if (running || !native || !adId || store.get().owned || matches < 3 || Date.now() - lastAd < 180000) return;
    running = true;
    let handles = [];
    try {
        if (!await within(store.init().then(() => true), 8000)) return;
        if (!testMode && !store.get().verified) return;
        if (!await initAds()) return;
        const eligible = () => adEligible({ native, testMode, store: store.get(), consent: consent?.canRequestAds, count: matches, elapsed: Date.now() - lastAd });
        if (!eligible()) return;
        // A slow load is skipped, and its late resolution cannot open an ad over the next screen.
        const loaded = await within(AdMob.prepareInterstitial({ adId, isTesting: testMode, npa: true }).then(() => true), 5000);
        if (!loaded || !eligible() || document.visibilityState !== 'visible') return;
        let finish;
        const dismissed = new Promise(resolve => { finish = resolve; });
        handles = await Promise.all([
            AdMob.addListener(InterstitialAdPluginEvents.Dismissed, finish),
            AdMob.addListener(InterstitialAdPluginEvents.FailedToShow, finish),
        ]);
        await AdMob.setApplicationMuted({ muted: settings.get().volume === 0 });
        await AdMob.setApplicationVolume({ volume: settings.get().volume });
        if (!eligible() || document.visibilityState !== 'visible') return;
        await AdMob.showInterstitial();
        lastAd = Date.now(); matches = 0;
        saveNumber('quoridor.ad.last', lastAd); saveNumber('quoridor.ad.matches', 0);
        await dismissed;
    } catch (error) { console.warn('Post-match ad skipped', error?.code || 'unavailable'); }
    finally {
        await Promise.allSettled(handles.map(handle => handle.remove()));
        running = false;
    }
}
