// Import Firebase functions from CDN
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// --- FIREBASE CONFIGURATION ---
const firebaseConfig = {
    apiKey: "AIzaSyBWZaETz4YMYyBUz2HFxYYMhmTTwFklw0I",
    authDomain: "quoridor-7a872.firebaseapp.com",
    projectId: "quoridor-7a872",
    databaseURL: "https://quoridor-7a872-default-rtdb.firebaseio.com",
    storageBucket: "quoridor-7a872.firebasestorage.app",
    messagingSenderId: "464912639404",
    appId: "1:464912639404:web:b463c13968c6d4c17fc609",
    measurementId: "G-K3PHH67DT7"
};

// Initialize Firebase
let app;
let db;
let auth;
let provider;

try {
    app = initializeApp(firebaseConfig);
    db = getDatabase(app);
    auth = getAuth(app);
    provider = new GoogleAuthProvider();
    console.log("Firebase Initialized Successfully (Shared Config)");
} catch (e) {
    console.error("Firebase Init Error: ", e);
    alert("Firebase Config Error! Check firebase-config.js");
}

export { app, db, auth, provider };
