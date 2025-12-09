import { auth, provider, db } from "./firebase-config.js";
import { signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { ref, onValue } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// DOM Elements
const authBtn = document.getElementById('auth-btn');
const userName = document.getElementById('user-name');
const userAvatar = document.getElementById('user-avatar');
const userRank = document.getElementById('user-rank'); // Added rank element
const statWins = document.getElementById('stat-wins');
const statLosses = document.getElementById('stat-losses');
const statRate = document.getElementById('stat-rate');
const historyList = document.getElementById('history-list');

// Auth State Listener
onAuthStateChanged(auth, (user) => {
    if (user) {
        console.log("User Logged In:", user.displayName);
        updateUI(user);
        loadStats(user.uid);
        loadHistory(user.uid);
    } else {
        console.log("User Logged Out");
        resetUI();
    }
});

// Login / Logout Handler
authBtn.addEventListener('click', () => {
    if (auth.currentUser) {
        signOut(auth).then(() => {
            alert("Çıkış yapıldı.");
        });
    } else {
        signInWithPopup(auth, provider)
            .then((result) => {
                const user = result.user;
                // Optional: Save user to DB if first time (handled implicitly by stats update usually)
            })
            .catch((error) => {
                console.error("Login Error:", error);
                alert("Giriş başarısız: " + error.message);
            });
    }
});

function updateUI(user) {
    userName.textContent = user.displayName;
    userAvatar.src = user.photoURL;
    authBtn.innerHTML = '<i class="fa-solid fa-right-from-bracket"></i> Çıkış Yap';
}

function resetUI() {
    userName.textContent = "Misafir Oyuncu";
    userAvatar.src = "https://ui-avatars.com/api/?name=Guest&background=random";
    userRank.textContent = "Çaylak";
    userRank.className = "rank-badge rookie";
    authBtn.innerHTML = '<i class="fa-brands fa-google"></i> Giriş Yap';
    statWins.textContent = "0";
    statLosses.textContent = "0";
    statRate.textContent = "%0";
    historyList.innerHTML = '<div class="empty-state">Giriş yapmalısınız.</div>';
}

function loadStats(uid) {
    const statsRef = ref(db, `users/${uid}/stats`);
    onValue(statsRef, (snapshot) => {
        const stats = snapshot.val() || { wins: 0, losses: 0 };
        statWins.textContent = stats.wins;
        statLosses.textContent = stats.losses;

        const total = stats.wins + stats.losses;
        const rate = total > 0 ? Math.round((stats.wins / total) * 100) : 0;
        statRate.textContent = `%${rate}`;

        // Simple Rank Logic
        if (stats.wins >= 50) {
            userRank.textContent = "Efsane";
            userRank.className = "rank-badge pro";
        } else if (stats.wins >= 10) {
            userRank.textContent = "Usta";
            userRank.className = "rank-badge pro";
        } else {
            userRank.textContent = "Çaylak";
            userRank.className = "rank-badge rookie";
        }
    });
}

function loadHistory(uid) {
    const historyRef = ref(db, `match_history/${uid}`);
    onValue(historyRef, (snapshot) => {
        const matches = snapshot.val();
        if (!matches) {
            historyList.innerHTML = '<div class="empty-state">Henüz maç geçmişi yok.</div>';
            return;
        }

        // Convert object to array and reverse (newest first)
        const matchArray = Object.values(matches).reverse().slice(0, 10); // Last 10

        historyList.innerHTML = '';
        matchArray.forEach(match => {
            const el = document.createElement('div');
            el.className = `match-item ${match.result === 'win' ? 'win' : 'loss'}`;
            el.innerHTML = `
                <div class="match-info">
                    <span class="opponent-name">vs ${match.opponentName || 'Bilinmiyor'}</span>
                    <span class="match-date">${new Date(match.timestamp).toLocaleDateString()}</span>
                </div>
                <div class="match-result">
                    ${match.result === 'win' ? 'KAZANDIN' : 'KAYBETTİN'}
                </div>
            `;
            historyList.appendChild(el);
        });
    });
}
