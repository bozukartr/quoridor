// SDK-independent purchase state. Only RevenueCat customer info can grant the entitlement.
export function createStore({ sdk, apiKey, productId, entitlementId, native }) {
    let state = { status: native ? 'unconfigured' : 'web', owned: false, verified: false, product: null, busy: false };
    let initializing;
    let configured = false;
    const listeners = new Set();
    const emit = patch => { state = { ...state, ...patch }; listeners.forEach(fn => fn({ ...state })); };
    const apply = info => emit({ owned: info?.entitlements?.active?.[entitlementId]?.isActive === true, verified: true });
    async function init() {
        if (!native || !apiKey) return;
        if (initializing) return initializing;
        initializing = (async () => {
            emit({ status: 'loading' });
            try {
                if (!configured) {
                    const result = await sdk.isConfigured();
                    if (!result.isConfigured) await sdk.configure({ apiKey });
                    await sdk.addCustomerInfoUpdateListener(apply);
                    configured = true;
                }
                apply((await sdk.getCustomerInfo()).customerInfo);
                const { products } = await sdk.getProducts({ productIdentifiers: [productId], type: 'NON_SUBSCRIPTION' });
                emit({ product: products.find(p => p.identifier === productId) || null, status: 'ready' });
            } catch { emit({ status: 'error' }); }
        })().finally(() => { initializing = null; });
        return initializing;
    }
    async function transact(restore) {
        if (state.busy) return 'busy';
        if (!configured || (!restore && !state.product)) return 'unavailable';
        if (!restore && state.owned) return 'owned';
        emit({ busy: true });
        try {
            const result = restore ? await sdk.restorePurchases() : await sdk.purchaseStoreProduct({ product: state.product });
            apply(result.customerInfo);
            return state.owned ? 'owned' : (restore ? 'empty' : 'pending');
        } catch (error) {
            if (error.userCancelled || String(error.code) === '1') return 'cancelled';
            if (String(error.code) === '20') return 'pending';
            return 'error';
        } finally { emit({ busy: false }); }
    }
    return {
        get: () => ({ ...state }), init,
        subscribe(fn) { listeners.add(fn); fn({ ...state }); return () => listeners.delete(fn); },
        purchase: () => transact(false), restore: () => transact(true),
        async refresh() {
            if (!configured || state.busy) return;
            try { apply((await sdk.getCustomerInfo()).customerInfo); } catch { /* SDK cache remains authoritative. */ }
        },
    };
}

export function adEligible({ native, testMode, store, consent, count, elapsed }) {
    return native && !store.owned && !store.busy && (testMode || store.verified)
        && consent === true && count >= 3 && elapsed >= 180000;
}
