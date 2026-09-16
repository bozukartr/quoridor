import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { GoogleAuthProvider, signInWithPopup, signInWithCredential, signOut } from 'firebase/auth';
import { auth, provider } from './firebase-config.js';
import { createAuthActions } from './auth-actions.js';

const actions = createAuthActions({
    isNative: () => Capacitor.isNativePlatform(),
    nativeAvailable: () => Capacitor.isPluginAvailable('FirebaseAuthentication'),
    nativeAuth: FirebaseAuthentication, webAuth: auth, provider,
    popup: signInWithPopup, credential: GoogleAuthProvider.credential,
    exchange: signInWithCredential, webSignOut: signOut
});
export const signInWithGoogle = actions.signIn;
export const signOutUser = actions.signOut;
