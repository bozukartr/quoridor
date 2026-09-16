import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthActions } from '../auth-actions.js';
function setup(native, available = true) {
    const calls = [];
    const actions = createAuthActions({
        isNative: () => native, nativeAvailable: () => available,
        nativeAuth: { signInWithGoogle: async () => { calls.push('native'); return { credential: { idToken: 'id' } }; }, signOut: async () => { calls.push('native-out'); } },
        webAuth: {}, provider: {}, popup: async () => calls.push('popup'),
        credential: (id, access) => ({ id, access }), exchange: async (_, c) => calls.push(c),
        webSignOut: async () => calls.push('web-out')
    });
    return { actions, calls };
}
test('web login retains popup flow', async () => {
    const { actions, calls } = setup(false); await actions.signIn(); assert.deepEqual(calls, ['popup']);
});
test('native token is exchanged into the Firebase JS session', async () => {
    const { actions, calls } = setup(true); await actions.signIn();
    assert.deepEqual(calls, ['native', { id: 'id', access: null }]);
    await actions.signOut(); assert.deepEqual(calls.slice(-2), ['native-out', 'web-out']);
});
test('unconfigured native plugin does not fall back to a WebView popup', async () => {
    const { actions, calls } = setup(true, false);
    await assert.rejects(actions.signIn(), /henüz etkin değil/); assert.deepEqual(calls, []);
});
