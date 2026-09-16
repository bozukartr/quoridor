// Dependency injection keeps provider selection and credential exchange testable.
export function createAuthActions({ isNative, nativeAvailable, nativeAuth, webAuth, provider, popup, credential, exchange, webSignOut }) {
    return {
        async signIn() {
            if (!isNative()) return popup(webAuth, provider);
            if (!nativeAvailable()) throw new Error('Google girişi bu sürümde henüz etkin değil.');
            const result = await nativeAuth.signInWithGoogle({ skipNativeAuth: true });
            const idToken = result.credential?.idToken;
            const accessToken = result.credential?.accessToken;
            if (!idToken && !accessToken) throw new Error('Google giriş bilgisi alınamadı. Tekrar dene.');
            return exchange(webAuth, credential(idToken ?? null, accessToken ?? null));
        },
        async signOut() {
            try {
                if (isNative() && nativeAvailable()) await nativeAuth.signOut();
            } finally {
                await webSignOut(webAuth);
            }
        }
    };
}
