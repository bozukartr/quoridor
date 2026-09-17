import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettings, DEFAULT_SETTINGS } from '../settings.js';
import { createStore, adEligible } from '../commerce-core.js';
import { handleBack } from '../back-navigation.js';

function storage(initial) {
    let data = initial;
    return { getItem: () => data, setItem: (_, next) => { data = next; } };
}
test('settings survive reload and malformed/blocked storage uses safe defaults', () => {
    const disk = storage('{');
    const settings = createSettings(disk);
    assert.deepEqual(settings.get(), DEFAULT_SETTINGS);
    settings.update({ volume: 0, vibration: false, reducedMotion: true });
    assert.deepEqual(createSettings(disk).get(), { volume: 0, vibration: false, reducedMotion: true });
    settings.update({ volume: 4 }); assert.equal(settings.get().volume, 1);
    const blocked = createSettings({ getItem() { throw Error(); }, setItem() { throw Error(); } });
    blocked.update({ volume: 0.2 }); assert.equal(blocked.get().volume, 0.2);
});
const info = owned => ({ entitlements: { active: owned ? { remove_ads: { isActive: true } } : {} } });
function fixture() {
    let listener;
    const sdk = {
        isConfigured: async () => ({ isConfigured: false }), configure: async () => {},
        addCustomerInfoUpdateListener: async fn => { listener = fn; },
        getCustomerInfo: async () => ({ customerInfo: info(false) }),
        getProducts: async options => {
            assert.equal(options.type, 'NON_SUBSCRIPTION');
            return { products: [{ identifier: 'remove-ads', priceString: '₺99,99' }] };
        },
        purchaseStoreProduct: async () => ({ customerInfo: info(true) }),
        restorePurchases: async () => ({ customerInfo: info(true) }),
    };
    const store = createStore({ sdk, native: true, apiKey: 'public-key', productId: 'remove-ads', entitlementId: 'remove_ads' });
    return { sdk, store, update: owned => listener(info(owned)) };
}
test('purchase grants only verified entitlement and SDK updates can revoke it', async () => {
    const { store, update } = fixture();
    await store.init();
    assert.equal(store.get().owned, false);
    assert.equal(await store.purchase(), 'owned');
    assert.equal(store.get().owned, true);
    update(false); assert.equal(store.get().owned, false);
});
test('cancelled, pending and failed purchases never grant remove-ads', async () => {
    const { store, sdk } = fixture(); await store.init();
    for (const [code, expected] of [['1', 'cancelled'], ['20', 'pending'], ['10', 'error']]) {
        sdk.purchaseStoreProduct = async () => { throw { code }; };
        assert.equal(await store.purchase(), expected);
        assert.equal(store.get().owned, false);
        assert.equal(store.get().busy, false);
    }
    sdk.purchaseStoreProduct = async () => ({ customerInfo: info(false) });
    assert.equal(await store.purchase(), 'pending');
    assert.equal(store.get().owned, false);
});
test('restore works without a listed product and an empty restore grants nothing', async () => {
    const { store, sdk } = fixture();
    sdk.getProducts = async () => ({ products: [] }); await store.init();
    assert.equal(await store.purchase(), 'unavailable');
    assert.equal(await store.restore(), 'owned');
    sdk.restorePurchases = async () => ({ customerInfo: info(false) });
    assert.equal(await store.restore(), 'empty');
    assert.equal(store.get().owned, false);
});
test('double taps cannot create two purchase requests', async () => {
    const { store, sdk } = fixture(); await store.init();
    let complete; let calls = 0;
    sdk.purchaseStoreProduct = () => { calls++; return new Promise(resolve => { complete = resolve; }); };
    const first = store.purchase();
    assert.equal(await store.purchase(), 'busy');
    assert.equal(await store.restore(), 'busy');
    complete({ customerInfo: info(true) }); await first;
    assert.equal(calls, 1);
});
test('unconfigured and browser stores never call native purchase APIs', async () => {
    for (const native of [true, false]) {
        const store = createStore({ sdk: {}, native, apiKey: '', productId: 'x', entitlementId: 'remove_ads' });
        await store.init(); assert.equal(await store.purchase(), 'unavailable');
        assert.equal(await store.restore(), 'unavailable');
    }
});
test('live ads require consent and verified purchase state with match/cooldown limits', () => {
    const options = { native: true, testMode: false, store: { owned: false, verified: true, busy: false }, consent: true, count: 3, elapsed: 180000 };
    assert.equal(adEligible(options), true);
    for (const patch of [{ native: false }, { consent: false }, { count: 2 }, { elapsed: 179999 }, { store: { owned: true, verified: true } }, { store: { owned: false, verified: false } }, { store: { owned: false, verified: true, busy: true } }]) assert.equal(adEligible({ ...options, ...patch }), false);
});
test('back closes the top modal before asking to leave a game or application', () => {
    const calls = [];
    const context = { blocked: () => false, intro: () => null, dialog: () => ({ close: () => calls.push('dialog') }), modal: () => null,
        game: () => { calls.push('game'); return true; }, home: () => false, exit: () => calls.push('exit') };
    handleBack(context); assert.deepEqual(calls, ['dialog']);
    calls.length = 0; context.dialog = () => null;
    context.modal = () => ({ querySelector: () => ({ click: () => calls.push('cancel') }) });
    handleBack(context); assert.deepEqual(calls, ['cancel']);
    calls.length = 0; context.modal = () => null;
    handleBack(context); assert.deepEqual(calls, ['game']);
    calls.length = 0; context.game = () => false;
    context.home = () => { calls.push('home'); return true; };
    handleBack(context); assert.deepEqual(calls, ['home']);
    calls.length = 0; context.home = () => false;
    handleBack(context); assert.deepEqual(calls, ['exit']);
    calls.length = 0; context.blocked = () => true;
    handleBack(context); assert.deepEqual(calls, []);
});

test('late ad load after timeout cannot trigger display', async t => {
    const { within } = await import('../ad-break.js');
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let loaded; let shown = false;
    const sdkLoad = new Promise(resolve => { loaded = resolve; });
    const task = (async () => { if (await within(sdkLoad.then(() => true), 5000)) shown = true; })();
    t.mock.timers.tick(5001); await task;
    assert.equal(shown, false);
    loaded(); await Promise.resolve(); await Promise.resolve();
    assert.equal(shown, false);
});
