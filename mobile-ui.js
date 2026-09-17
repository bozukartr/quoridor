import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { settings } from './settings.js';
import { store, openAdPrivacy } from './monetization.js';
import { onAppResume } from './native-lifecycle.js';
import './mobile-ui.css';
import { handleBack } from './back-navigation.js';

const native = Capacitor.isNativePlatform();
const hasLobby = !!document.getElementById('start-screen');
const hasProfile = document.body.classList.contains('profile-page');
const sheets = document.createElement('div');
sheets.innerHTML = `
<dialog id="settings-panel" class="mobile-panel" aria-labelledby="settings-title">
 <header><button class="panel-back" data-panel-close aria-label="Geri"><i class="fa-solid fa-arrow-left"></i></button><h2 id="settings-title">Ayarlar</h2></header>
 <div class="settings-group"><p class="panel-eyebrow">OYUN DENEYİMİ</p>
  <label class="setting-row" for="setting-volume"><span><i class="fa-solid fa-volume-high"></i> Ses efektleri</span><output id="setting-volume-value">50%</output></label>
  <input id="setting-volume" class="setting-range" type="range" min="0" max="1" step="0.05" aria-label="Ses efektleri seviyesi">
  <label class="setting-row" for="setting-vibration"><span><i class="fa-solid fa-mobile-screen-button"></i> Titreşim<small>Dokunma geri bildirimi</small></span><input id="setting-vibration" class="setting-toggle" type="checkbox" role="switch"></label>
  <label class="setting-row" for="setting-motion"><span><i class="fa-solid fa-wand-magic-sparkles"></i> Hareketi azalt<small>Menü ve açılış animasyonları</small></span><input id="setting-motion" class="setting-toggle" type="checkbox" role="switch"></label>
 </div>
 <div class="settings-group"><p class="panel-eyebrow">REKLAM VE MAĞAZA</p>
  <button class="setting-row setting-link" data-show-store><span><i class="fa-solid fa-store"></i> Reklamları kaldır</span><i class="fa-solid fa-chevron-right"></i></button>
  <button id="ad-privacy" class="setting-row setting-link"><span><i class="fa-solid fa-shield-halved"></i> Reklam tercihleri</span><i class="fa-solid fa-chevron-right"></i></button>
 </div>
 <p id="settings-feedback" class="panel-feedback" role="status" aria-live="polite"></p>
 <p class="panel-footnote">Tercihlerin bu cihazda saklanır.</p>
</dialog>
<dialog id="store-panel" class="mobile-panel" aria-labelledby="store-title">
 <header><button class="panel-back" data-panel-close aria-label="Geri"><i class="fa-solid fa-arrow-left"></i></button><h2 id="store-title">Mağaza</h2></header>
 <p class="panel-eyebrow">DAHA FAZLA OYUN. DAHA AZ ARA.</p>
 <article class="remove-ads-product"><div class="store-emblem" aria-hidden="true"><i class="fa-solid fa-shield-heart"></i><span>✦</span></div>
  <span class="product-tag">TEK SEFERLİK</span><h3>Reklamları kaldır</h3>
  <p>Maç arası reklamlarına veda et.<br>Stratejine odaklan, oynamaya devam et.</p>
  <ul><li><i class="fa-solid fa-check"></i> Zorunlu reklamlar kapanır</li><li><i class="fa-solid fa-check"></i> Abonelik yok</li></ul>
  <button id="purchase-remove-ads" class="panel-primary" disabled>Yükleniyor…</button>
  <p id="store-availability" class="panel-footnote"></p>
 </article>
 <button id="restore-purchases" class="panel-secondary" disabled>Satın alımları geri yükle</button>
 <button id="retry-store" class="panel-secondary" hidden>Tekrar dene</button>
 <p id="store-feedback" class="panel-feedback" role="status" aria-live="polite"></p>
 <p class="panel-footnote">Geri yükleme için satın aldığın mağaza hesabını kullan. Satın alma, kullandığın platformun mağaza hesabına bağlıdır.</p>
</dialog>
<dialog id="exit-panel" class="mobile-panel compact-panel" aria-labelledby="exit-title"><h2 id="exit-title">Oyundan çıkılsın mı?</h2><p>Yeni bir stratejiyle tekrar bekleriz.</p><button class="panel-primary" data-panel-close>Oynamaya devam et</button><button id="exit-app" class="panel-secondary">Uygulamayı kapat</button></dialog>
<dialog id="transition-panel" class="mobile-panel compact-panel" aria-labelledby="transition-title"><h2 id="transition-title">Ana menüye dönülüyor…</h2><p>Lütfen bekle.</p></dialog>`;
document.body.append(sheets);
const get = id => document.getElementById(id);
export const mobileTransition = {
    open() { if (!get('transition-panel').open) get('transition-panel').showModal(); },
    close() { get('transition-panel').close(); },
};
get('transition-panel').addEventListener('cancel', event => event.preventDefault());
function openPanel(id) {
    const panel = get(id);
    if (!panel.open) panel.showModal();
    if (id === 'store-panel') {
        get('store-feedback').textContent = '';
        void store.init();
    }
}
document.querySelectorAll('[data-show-settings]').forEach(button => button.addEventListener('click', () => openPanel('settings-panel')));
document.querySelectorAll('[data-show-store]').forEach(button => button.addEventListener('click', () => openPanel('store-panel')));
sheets.querySelectorAll('[data-panel-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
sheets.querySelectorAll('dialog:not(#transition-panel)').forEach(panel => {
    panel.addEventListener('click', event => {
        const r = panel.getBoundingClientRect();
        if (event.target === panel && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)) panel.close();
    });
});
const volume = get('setting-volume');
volume.addEventListener('input', () => settings.update({ volume: Number(volume.value) }));
get('setting-vibration').addEventListener('change', event => settings.update({ vibration: event.target.checked }));
get('setting-motion').addEventListener('change', event => settings.update({ reducedMotion: event.target.checked }));
settings.subscribe(value => {
    volume.value = value.volume;
    get('setting-volume-value').value = `${Math.round(value.volume * 100)}%`;
    get('setting-vibration').checked = value.vibration;
    get('setting-motion').checked = value.reducedMotion;
    document.documentElement.classList.toggle('reduce-motion', value.reducedMotion);
});
if (!native) {
    get('setting-vibration').disabled = true;
    get('setting-vibration').previousElementSibling.querySelector('small').textContent = 'Mobil uygulamada kullanılabilir';
}
document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (native && settings.get().vibration && button && !button.disabled) Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
});
get('ad-privacy').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    get('settings-feedback').textContent = 'Reklam tercihleri yükleniyor…';
    try { get('settings-feedback').textContent = await openAdPrivacy(); } finally { button.disabled = false; }
});
const feedback = {
    owned: 'Reklamlar kaldırıldı. İyi oyunlar!', empty: 'Bu mağaza hesabında geri yüklenecek satın alma bulunamadı.',
    pending: 'Satın alma onay bekliyor. Mağaza onayladığında reklamlar kaldırılacak.',
    cancelled: 'Satın alma iptal edildi.', error: 'İşlem tamamlanamadı. Bağlantını kontrol edip tekrar dene.',
    unavailable: 'Bu ürün şu anda satın alınamıyor.', busy: 'İşlemin tamamlanması bekleniyor.',
};
store.subscribe(state => {
    const buy = get('purchase-remove-ads');
    buy.disabled = state.busy || state.owned || !state.product || state.status !== 'ready';
    buy.textContent = state.busy ? 'İşlem sürüyor…' : state.owned ? 'Reklamlar kaldırıldı ✓' : state.product ? `${state.product.priceString} · Satın al` : state.status === 'loading' ? 'Mağaza yükleniyor…' : 'Şu anda kullanılamıyor';
    get('restore-purchases').disabled = state.busy || !native || !['ready', 'error'].includes(state.status);
    get('retry-store').hidden = !['error', 'ready'].includes(state.status) || !!state.product || state.owned;
    get('retry-store').disabled = state.busy;
    get('store-availability').textContent = state.owned ? 'Bu mağaza hesabında reklamsız oyun etkin.'
        : state.status === 'web' ? 'Satın alma, App Store veya Google Play sürümünde kullanılabilir.'
        : state.status === 'unconfigured' ? 'Satın alma henüz kullanıma açılmadı.'
        : state.status === 'error' ? 'Mağazaya ulaşılamadı. Tekrar deneyebilirsin.'
        : state.status === 'ready' && !state.product ? 'Ürün şu anda mağazada bulunamıyor.' : '';
});
get('purchase-remove-ads').addEventListener('click', async () => {
    get('store-feedback').textContent = 'Mağaza onayı bekleniyor…';
    get('store-feedback').textContent = feedback[await store.purchase()];
});
get('restore-purchases').addEventListener('click', async () => {
    get('store-feedback').textContent = 'Satın alımlar kontrol ediliyor…';
    get('store-feedback').textContent = feedback[await store.restore()];
});
get('retry-store').addEventListener('click', () => { void store.init(); });
onAppResume(() => { void store.refresh(); });

// Use the actual top-layer modal order, including a store opened from settings.
const openDialogs = [];
sheets.addEventListener('close', event => {
    const index = openDialogs.indexOf(event.target);
    if (index >= 0) openDialogs.splice(index, 1);
}, true);
new MutationObserver(() => {
    document.querySelectorAll('dialog[open]').forEach(dialog => { if (!openDialogs.includes(dialog)) openDialogs.push(dialog); });
    for (let i = openDialogs.length - 1; i >= 0; i--) if (!openDialogs[i].open) openDialogs.splice(i, 1);
}).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
function goBack() {
    handleBack({
        blocked: () => get('transition-panel').open || store.get().busy,
        intro: () => document.querySelector('.launch-screen:not(.is-leaving) .launch-skip'),
        dialog: () => openDialogs.at(-1) || [...document.querySelectorAll('dialog[open]')].at(-1),
        modal: () => [...document.querySelectorAll('#modal-overlay:not(.hidden), #tutorial-modal:not(.hidden), .profile-page .modal:not(.hidden)')].at(-1),
        game: () => !document.dispatchEvent(new Event('quoridor:back', { cancelable: true })),
        home: () => {
            if (hasLobby && !hasProfile) return false;
            location.replace('index.html'); return true;
        },
        exit: () => { if (Capacitor.getPlatform() === 'android') openPanel('exit-panel'); },
    });
}
if (Capacitor.getPlatform() === 'android') App.addListener('backButton', goBack).catch(error => console.warn('Back handler unavailable', error));
// Escape mirrors Android navigation, except inside dialogs where the browser owns cancel.
document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open]')) return;
    event.preventDefault(); goBack();
});
get('exit-app').addEventListener('click', () => { if (Capacitor.getPlatform() === 'android') App.exitApp(); });

if (hasLobby) new MutationObserver(() => {
    if (!get('start-screen').classList.contains('active')) {
        ['settings-panel', 'store-panel', 'exit-panel'].forEach(id => get(id).close());
    }
}).observe(get('start-screen'), { attributes: true, attributeFilter: ['class'] });
