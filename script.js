
// Import Firebase functions
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, set, onValue, update, push, child, get, remove } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// --- FIREBASE CONFIGURATION ---
// TODO: USER MUST REPLACE THIS WITH THEIR OWN CONFIG
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

try {
    app = initializeApp(firebaseConfig);
    db = getDatabase(app);
} catch (e) {
    console.error("Firebase Init Error: ", e);
    alert("Firebase Config Eksik! Lütfen script.js dosyasını düzenleyin.");
}

// --- GAME STATE ---
// --- GAME STATE ---
// --- GAME STATE ---
const GRID_COLS = 7;
const GRID_ROWS = 9;
const STATE = {
    roomId: null,
    playerId: null, // 'p1' (Blue) or 'p2' (Red)
    isMyTurn: false,
    mode: 'move', // 'move' or 'wall'
    wallOrientation: 'vertical', // 'vertical' or 'horizontal'
    board: [],
    players: {
        p1: { x: 3, y: 0, wallsLeft: 10, hasPowerup: false },
        p2: { x: 3, y: 8, wallsLeft: 10, hasPowerup: false }
    },
    powerups: [], // Array of {x, y, type}
    walls: [], // Array of {x, y, type} (x,y = Gap Coordinates)
    gameActive: false,
    activeEffects: { p1: { chaos: false, hourglass: false }, p2: { chaos: false, hourglass: false } }, // New State
    pendingAction: null // { type: 'move'|'wall', x, y, orientation? }
};

// --- DOM ELEMENTS ---
const gridBoard = document.getElementById('grid-board');
const screens = {
    start: document.getElementById('start-screen'),
    waiting: document.getElementById('waiting-screen'),
    game: document.getElementById('game-screen'),
    gameOver: document.getElementById('game-over-screen')
};
const controls = {
    moveBtn: document.getElementById('move-mode-btn'),
    wallBtn: document.getElementById('wall-mode-btn'),
    rotateBtn: document.getElementById('wall-rotate-btn'),
    orientationSpan: document.getElementById('wall-orientation')
};

// --- INITIALIZATION ---
function init() {
    setupEventListeners();
    generateGrid();
}

function setupEventListeners() {
    // Buttons
    document.getElementById('create-room-btn').addEventListener('click', createRoom);
    document.getElementById('join-room-btn').addEventListener('click', joinRoom);
    document.getElementById('restart-btn').addEventListener('click', () => location.reload()); // Main Menu
    document.getElementById('rematch-btn').addEventListener('click', resetRoom); // Rematch
    document.getElementById('cancel-room-btn').addEventListener('click', cancelWaiting);

    // Header Controls
    document.getElementById('btn-leave').addEventListener('click', () => {
        showModal('Çıkış', 'Oyundan çıkmak istediğine emin misin?', () => {
            location.reload();
        });
    });
    document.getElementById('btn-surrender').addEventListener('click', () => {
        showModal('Teslim Ol', 'Teslim olup oyunu bitirmek istiyor musun?', () => {
            sendMove({ type: 'surrender' });
        });
    });

    // Game Controls
    controls.moveBtn.addEventListener('click', () => setMode('move'));
    controls.wallBtn.addEventListener('click', () => setMode('wall'));
    controls.rotateBtn.addEventListener('click', toggleOrientation);

    // Inventory Controls
    const bindPowerup = (id, type) => {
        const btn = document.getElementById(id);
        if (btn) btn.addEventListener('click', () => activatePowerup(type));
    };
    bindPowerup('btn-destroy', 'destroy');
    bindPowerup('btn-ghost', 'ghost');
    bindPowerup('btn-freeze', 'freeze');
    bindPowerup('btn-wall', 'wall');
    bindPowerup('btn-return', 'return');
    bindPowerup('btn-chaos', 'chaos');
    bindPowerup('btn-double_turn', 'double_turn');
    bindPowerup('btn-hourglass', 'hourglass');
}

function activatePowerup(type) {
    const me = STATE.players[STATE.playerId];
    const count = (me.inventory && me.inventory[type]) || 0;

    if (count <= 0) {
        showToast("Bu özelliğe sahip değilsin!");
        return;
    }

    if (type === 'destroy') {
        setMode('destroy');
        showToast('💣 Yıkmak istediğiniz duvarı seçin!');
    } else if (type === 'ghost') {
        if (STATE.ghostMode) {
            STATE.ghostMode = false;
            showToast("👻 Hayalet Modu İptal Edildi.");
        } else {
            STATE.ghostMode = true;
            showToast('👻 Hayalet Modu Aktif! (Harekette harcanır)');
            setMode('move');
        }
    } else if (type === 'freeze') {
        showModal('Dondurucu ❄️', 'Rakibi dondurmak (duvar koyamaz) istiyor musunuz?', () => {
            sendMove({ type: 'activate', powerupType: 'freeze' }, false);
            showToast('❄️ Rakip donduruldu!');
        });
    } else if (type === 'wall') {
        sendMove({ type: 'activate', powerupType: 'wall' }, false);
        showToast('🧱 +1 Duvar kazandınız!');
    } else if (type === 'return') {
        showModal('Geri Sar ↩️', 'Rakibi başlangıç noktasına geri göndermek istiyor musunuz? (Sıra Rakibe Geçer)', () => {
            sendMove({ type: 'activate', powerupType: 'return' }, true);
            showToast('↩️ Rakip geri gönderildi!');
        });
    } else if (type === 'chaos') {
        showModal('Şaşırtma 🔀', 'Rakibin bir sonraki hamlesini şaşırtmak istiyor musunuz?', () => {
            sendMove({ type: 'activate', powerupType: 'chaos' }, true);
            showToast('🔀 Şaşırtma aktif!');
        });
    } else if (type === 'double_turn') {
        // "Sıra bir kez daha kendisinde olur"
        sendMove({ type: 'activate', powerupType: 'double_turn' }, false); // Don't end turn yet, let logic handle
        showToast('🔁 Dejavu! Bir hamle hakkı daha!');
    } else if (type === 'hourglass') {
        showModal('Kum Saati ⏳', 'Rakibi 3 saniye süreyle kısıtlamak istiyor musunuz?', () => {
            sendMove({ type: 'activate', powerupType: 'hourglass' }, true);
            showToast('⏳ Kum Saati aktif!');
        });
    }
}

function cancelWaiting() {
    if (STATE.roomId) {
        // If Creator, remove room
        if (STATE.playerId === 'p1') {
            const roomRef = ref(db, 'rooms/' + STATE.roomId);
            remove(roomRef);
        }
        // Unsubscribe
        if (STATE.roomUnsubscribe) {
            STATE.roomUnsubscribe();
            STATE.roomUnsubscribe = null;
        }
    }
    STATE.roomId = null;
    STATE.playerId = null;
    showScreen('start');
}

function generateGrid() {
    gridBoard.innerHTML = '';
    // Set grid columns in JS dynamically or CSS
    gridBoard.style.gridTemplateColumns = `repeat(${GRID_COLS}, var(--cell-size))`;
    gridBoard.style.gridTemplateRows = `repeat(${GRID_ROWS}, var(--cell-size))`;

    for (let y = 0; y < GRID_ROWS; y++) {
        for (let x = 0; x < GRID_COLS; x++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.x = x;
            cell.dataset.y = y;
            cell.addEventListener('click', (e) => handleCellClick(x, y, e));
            cell.addEventListener('mousemove', (e) => handleCellHover(x, y, e));
            cell.addEventListener('mouseleave', () => clearPreviews());
            gridBoard.appendChild(cell);
        }
    }
}

// --- UX HELPERS ---
function showToast(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${msg}</span> <i class="fa-solid fa-${type === 'error' ? 'circle-exclamation' : 'circle-check'}"></i>`;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function handleCellHover(x, y, e) {
    if (!STATE.gameActive || !STATE.isMyTurn || STATE.mode !== 'wall') return;
    clearPreviews();

    // Determine target based on mouse position within cell
    let targetX = x;
    let targetY = y;

    const rect = e.target.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;

    let isLeft = offsetX < rect.width / 2;
    let isTop = offsetY < rect.height / 2;

    // Flipped Board Logic (P1)
    if (STATE.playerId === 'p1') {
        isLeft = !isLeft;
        isTop = !isTop;
    }

    if (STATE.wallOrientation === 'vertical') {
        if (isLeft) targetX = x - 1;
    } else {
        if (isTop) targetY = y - 1;
    }

    // Check validity (basic boundary check)
    // Bounds: 0 <= x < GRID_COLS, 0 <= y < GRID_ROWS
    if (targetX < 0 || targetY < 0) return;

    let valid = true;
    if (STATE.wallOrientation === 'vertical' && targetX >= GRID_COLS - 1) valid = false;
    if (STATE.wallOrientation === 'horizontal' && targetY >= GRID_ROWS - 1) valid = false;

    if (valid) {
        // Show Ghost
        const cell = document.querySelector(`.cell[data-x="${targetX}"][data-y="${targetY}"]`);
        if (cell) {
            const wall = document.createElement('div');
            wall.className = `wall ${STATE.wallOrientation} preview`;
            cell.appendChild(wall);
        }
    }
}

function clearPreviews() {
    document.querySelectorAll('.wall.preview').forEach(el => el.remove());
}

// --- GAME LOGIC ---

function setMode(mode) {
    STATE.mode = mode;
    controls.moveBtn.classList.toggle('active', mode === 'move');
    controls.wallBtn.classList.toggle('active', mode === 'wall');

    // Clear pending when switching modes
    STATE.pendingAction = null;

    if (mode === 'wall') {
        controls.rotateBtn.classList.remove('hidden');
        updateWallCounts();
    } else {
        controls.rotateBtn.classList.add('hidden');
    }
}


function updateWallCounts() {
    if (!STATE.playerId) return;
    const me = STATE.players[STATE.playerId];
    const left = me.wallsLeft !== undefined ? me.wallsLeft : 10;
    // Update button text
    controls.wallBtn.innerHTML = `<i class="fa-solid fa-block-brick"></i> Duvar <span style="font-size:0.9em; opacity:0.8; margin-left:4px;">(${left})</span>`;
}

const POWERUPS = ['destroy', 'ghost', 'freeze', 'wall', 'return', 'chaos', 'double_turn', 'hourglass'];

// --- SOUND MANAGER ---
class SoundManager {
    constructor() {
        this.sounds = {};
        this.volume = 0.5;
        this.assets = ['click', 'error', 'lose', 'move', 'powerup_collect', 'powerup_spawn', 'turn_start', 'wall_place', 'wall_rotate', 'win'];
        this.init();
    }

    init() {
        this.assets.forEach(name => {
            this.sounds[name] = new Audio(`assets/sounds/${name}.mp3`);
            this.sounds[name].preload = 'auto'; // Ensure fast playback
        });

        const slider = document.getElementById('volume-slider');
        if (slider) {
            slider.addEventListener('input', (e) => this.setVolume(e.target.value));
            slider.addEventListener('mousedown', (e) => e.stopPropagation()); // Prevent game clicks
        }

        // Global Click Sound for Buttons
        document.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
                this.play('click');
            }
        });
    }

    setVolume(v) {
        this.volume = v;
        Object.values(this.sounds).forEach(s => s.volume = v);

        // Update Icon
        const icon = document.getElementById('volume-icon');
        if (icon) {
            if (v == 0) icon.className = 'fa-solid fa-volume-mute';
            else if (v < 0.5) icon.className = 'fa-solid fa-volume-low';
            else icon.className = 'fa-solid fa-volume-high';
        }
    }

    play(name) {
        const s = this.sounds[name];
        if (s) {
            s.currentTime = 0;
            s.volume = this.volume;
            s.play().catch(() => { }); // Ignore auto-play errors
        }
    }
}
const sounds = new SoundManager();

function generatePowerup() {
    let type, x, y, attempts = 0;

    // Weighted Selection: 4-5 turns freq
    const weights = {
        wall: 0.30,        // Most Common
        destroy: 0.30,
        ghost: 0.30,
        freeze: 0.30,
        return: 0.30,
        chaos: 0.30,
        double_turn: 0.30,
        hourglass: 0.30,
        star: 0.20         // Rarest
    };

    let totalWeight = 0;
    for (const key in weights) totalWeight += weights[key];

    const rand = Math.random() * totalWeight;
    let sum = 0;
    for (const key in weights) {
        sum += weights[key];
        if (rand < sum) {
            type = key;
            break;
        }
    }
    // Fallback
    if (!type) type = 'wall';

    // Try to ensure valid placement
    while (attempts < 50) {
        // type was already selected above, do NOT overwrite it
        x = Math.floor(Math.random() * GRID_COLS);
        y = Math.floor(Math.random() * GRID_ROWS);
        attempts++;

        // 1. Avoid Players
        const p1 = STATE.players.p1;
        const p2 = STATE.players.p2;
        if ((x === p1.x && y === p1.y) || (x === p2.x && y === p2.y)) continue;

        // 2. Avoid Start Zones (Rows 0,1 and 7,8 near center)
        if ((y <= 1 || y >= GRID_ROWS - 2) && (x >= 2 && x <= 4)) continue;

        // 3. Avoid Intersection with existing
        if (STATE.powerups.some(p => p.x === x && p.y === y)) continue;

        return { x, y, type };
    }
    return null; // Failed to place
}

function toggleOrientation() {
    STATE.wallOrientation = STATE.wallOrientation === 'vertical' ? 'horizontal' : 'vertical';
    controls.orientationSpan.textContent = STATE.wallOrientation === 'vertical' ? 'Dikey' : 'Yatay';
    sounds.play('wall_rotate');
}

function handleCellClick(x, y, e) {
    if (!STATE.gameActive || !STATE.isMyTurn) return;

    let actionType = STATE.mode;
    let targetX = x;
    let targetY = y;
    let orientation = STATE.wallOrientation;

    // Calculate precise target (Nearest Gap)
    if (e && (actionType === 'wall' || actionType === 'destroy')) {
        const rect = e.target.getBoundingClientRect();
        const offsetX = e.clientX - rect.left;
        const offsetY = e.clientY - rect.top;

        // Closest Gap Logic:
        let isLeft = offsetX < rect.width / 2;
        let isTop = offsetY < rect.height / 2;

        if (STATE.playerId === 'p1') {
            isLeft = !isLeft;
            isTop = !isTop;
        }

        if (isLeft) targetX = x - 1;
        if (isTop) targetY = y - 1;

        if (actionType === 'destroy') {
            // Guess orientation based on edge proximity
            const dx = Math.abs(offsetX / rect.width - 0.5);
            const dy = Math.abs(offsetY / rect.height - 0.5);
            if (dx > dy) orientation = 'vertical';
            else orientation = 'horizontal';
        }
    }

    // Prevent out of bounds
    if (targetX < 0 || targetY < 0) return;

    // --- LOGIC SPLIT ---
    // MOVEMENT: Instant
    if (actionType === 'move') {
        // Chaos Effect Logic (Client Side Check)
        const myEffects = STATE.activeEffects && STATE.activeEffects[STATE.playerId];
        if (myEffects && myEffects.chaos) {
            // Redirect to random valid neighbor
            const validMoves = getValidMoves(STATE.players[STATE.playerId].x, STATE.players[STATE.playerId].y);
            // Filter out targetX/Y if possible to ensure "Ters-Düz" feel (not what I clicked)
            const others = validMoves.filter(m => m.x !== targetX || m.y !== targetY);
            const choices = others.length > 0 ? others : validMoves;
            if (choices.length > 0) {
                const rand = choices[Math.floor(Math.random() * choices.length)];
                targetX = rand.x;
                targetY = rand.y;
                showToast("🔀 Şaşırtma etkisi! Farklı yöne gittin!", "error");
            }
        }

        tryMove(targetX, targetY);
        clearPendingAction();
        return;
    }

    // DESTROY: Instant
    if (actionType === 'destroy') {
        tryDestroyWall(targetX, targetY, orientation);
        return;
    }

    // WALLS: Two-Step Confirmation
    const isSameAction = STATE.pendingAction &&
        STATE.pendingAction.type === actionType &&
        STATE.pendingAction.x === targetX &&
        STATE.pendingAction.y === targetY &&
        STATE.pendingAction.orientation === orientation;

    if (isSameAction) {
        // CONFIRM WALL
        tryPlaceWall(targetX, targetY);
        clearPendingAction();
    } else {
        // SELECT (First Tap)
        let isValid = false;

        // Check wall bounds
        isValid = true;
        if (orientation === 'vertical' && targetX >= GRID_COLS - 1) isValid = false;
        if (orientation === 'horizontal' && targetY >= GRID_ROWS - 1) isValid = false;
        // Check overlap (Rule: Must NOT exist for placement)
        const exists = STATE.walls.some(w => w.x === targetX && w.y === targetY && w.type === orientation);
        if (exists) isValid = false;

        if (isValid) {
            STATE.pendingAction = {
                type: actionType,
                x: targetX,
                y: targetY,
                orientation: orientation
            };
            renderBoard(); // Re-render to show selection
        } else {
            // Optional: Feedback for invalid tap?
            if (actionType === 'wall') showToast("Geçersiz duvar!", "error");
        }
    }
}

function clearPendingAction() {
    STATE.pendingAction = null;
    renderBoard();
}

function tryDestroyWall(x, y, orientation) {
    // Find absolute match first
    let wall = STATE.walls.find(w => w.x === x && w.y === y && w.type === orientation);

    // If not found, check neighbors that might span here
    if (!wall) {
        if (orientation === 'horizontal') {
            // Check start at x-1
            wall = STATE.walls.find(w => w.x === x - 1 && w.y === y && w.type === 'horizontal');
        } else {
            // Check start at y-1
            wall = STATE.walls.find(w => w.type === 'vertical' && w.x === x && w.y === y - 1);
        }
    }

    if (!wall) {
        showToast("Burada kırılabilecek duvar yok!", "error");
        return;
    }

    // Send destroy for the FOUND wall (use its x,y)
    sendMove({ type: 'destroy', x: wall.x, y: wall.y, orientation: wall.type });
}

function tryMove(targetX, targetY) {
    const me = STATE.players[STATE.playerId];

    // Jump / Diagonal Validation
    const validMoves = getValidMoves(me.x, me.y);
    const isValid = validMoves.some(m => m.x === targetX && m.y === targetY);

    if (!isValid) return;

    // Execute Move
    // Check Powerup
    // Check Powerup
    let pickupPowerupIndex = -1;
    const pIndex = STATE.powerups.findIndex(p => p.x === targetX && p.y === targetY);

    if (pIndex !== -1) {
        pickupPowerupIndex = pIndex;
        const p = STATE.powerups[pIndex];
        const names = {
            destroy: 'Duvar Kırıcı 💣',
            ghost: 'Hayalet Modu 👻',
            freeze: 'Dondurucu ❄️',
            wall: '+1 Duvar 🧱',
            return: 'Geri Sar ↩️',
            chaos: 'Şaşırtma 🔀',
            double_turn: 'Dejavu 🔁',
            hourglass: 'Kum Saati ⏳',
            star: '🌟 EFSANEVİ YILDIZ 🌟'
        };
        const pName = names[p.type] || 'Powerup';

        if (p.type === 'star') {
            showToast(`🌟 EFSANEVİ! TÜM GÜÇLER EKLENDİ!`, "success");
            sounds.play('win'); // Use win sound for legendary pickup
        } else {
            showToast(`${pName} Alındı!`, "success");
            sounds.play('powerup_collect');
        }
    } else {
        sounds.play('move');
    }

    // Optimistic Update
    updatePlayerPos(STATE.playerId, targetX, targetY);

    // Send
    const consumePowerup = STATE.ghostMode;
    sendMove({ type: 'move', to: { x: targetX, y: targetY }, pickupPowerupIndex, consumePowerup });

    if (STATE.ghostMode) {
        STATE.ghostMode = false;
        showToast("Hayalet Modu Sona Erdi.");
    }
}

function getValidMoves(cx, cy) {
    const moves = [];
    const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]]; // N, S, W, E
    const opp = STATE.players[STATE.playerId === 'p1' ? 'p2' : 'p1'];

    dirs.forEach(d => {
        const nx = cx + d[0];
        const ny = cy + d[1];

        // 1. Basic Adjacency Check
        if (nx >= 0 && nx < GRID_COLS && ny >= 0 && ny < GRID_ROWS) {
            if (!isBlockedByWall(cx, cy, nx, ny)) {
                // 2. Occupancy Check
                if (nx === opp.x && ny === opp.y) {
                    // JUMP LOGIC
                    const jx = nx + d[0];
                    const jy = ny + d[1];

                    // Try Straight Jump
                    if (jx >= 0 && jx < GRID_COLS && jy >= 0 && jy < GRID_ROWS && !isBlockedByWall(nx, ny, jx, jy)) {
                        moves.push({ x: jx, y: jy });
                    } else {
                        // Blocked -> Try Diagonals
                        // If moving N/S (dx=0), try W/E. If W/E (dy=0), try N/S.
                        const diags = d[0] === 0 ? [[-1, 0], [1, 0]] : [[0, -1], [0, 1]];
                        diags.forEach(diag => {
                            const dx_final = nx + diag[0];
                            const dy_final = ny + diag[1];
                            if (dx_final >= 0 && dx_final < GRID_COLS && dy_final >= 0 && dy_final < GRID_ROWS) {
                                if (!isBlockedByWall(nx, ny, dx_final, dy_final)) {
                                    moves.push({ x: dx_final, y: dy_final });
                                }
                            }
                        });
                    }
                } else {
                    // Empty Cell -> Valid Move
                    moves.push({ x: nx, y: ny });
                }
            }
        }
    });
    return moves;
}

function isBlockedByWall(x1, y1, x2, y2) {
    if (STATE.ghostMode) return false;
    // Determine movement direction
    // Vertical interactions blocked by Horizontal Walls
    if (x1 === x2) {
        const row = Math.min(y1, y2); // Gap Row
        // Blocked if H-Wall at (x1, row) OR (x1-1, row)
        return STATE.walls.some(w => w.type === 'horizontal' && w.y === row && (w.x === x1 || w.x === x1 - 1));
    }
    // Horizontal interactions blocked by Vertical Walls
    if (y1 === y2) {
        const col = Math.min(x1, x2); // Gap Col
        // Blocked if V-Wall at (col, y1) OR (col, y1-1)
        return STATE.walls.some(w => w.type === 'vertical' && w.x === col && (w.y === y1 || w.y === y1 - 1));
    }
    return false;
}

function tryPlaceWall(x, y) {
    const me = STATE.players[STATE.playerId];

    if (STATE.frozenPlayer === STATE.playerId) {
        showToast("❄️ Donduruldunuz! Duvar koyamazsınız.", "error");
        return;
    }

    if (me.wallsLeft <= 0) {
        showToast("Duvar hakkın bitti!", "error");
        return;
    }

    // Limits check
    // V-Wall (x,y) valid for x in 0..5, y in 0..7
    // H-Wall (x,y) valid for x in 0..5, y in 0..7
    // Note: GRID_COLS=7 (0..6), GapCols=6 (0..5). GRID_ROWS=9 (0..8), GapRows=8 (0..7).
    if (x < 0 || x > 5 || y < 0 || y > 7) return;

    // Overlap Check
    const isOverlap = STATE.walls.some(w => {
        if (w.x === x && w.y === y && w.type === STATE.wallOrientation) return true;
        if (STATE.wallOrientation === 'horizontal') {
            if (w.type === 'horizontal' && w.y === y && (w.x === x - 1 || w.x === x + 1)) return true;
            if (w.type === 'vertical' && w.x === x && w.y === y) return true;
        } else {
            if (w.type === 'vertical' && w.x === x && (w.y === y - 1 || w.y === y + 1)) return true;
            if (w.type === 'horizontal' && w.x === x && w.y === y) return true;
        }
        return false;
    });

    if (isOverlap) {
        showToast("Geçersiz konum!", "error");
        return;
    }

    // --- PATH VALIDATION ---
    const tempWall = { x, y, type: STATE.wallOrientation };
    STATE.walls.push(tempWall);
    const p1CanReach = hasPath(STATE.players.p1.x, STATE.players.p1.y, GRID_ROWS - 1);
    const p2CanReach = hasPath(STATE.players.p2.x, STATE.players.p2.y, 0);
    STATE.walls.pop();

    if (!p1CanReach || !p2CanReach) {
        showToast("Yolu tamamen kapatamazsın!", "error");
        return;
    }

    // Send
    sendMove({ type: 'wall', x, y, orientation: STATE.wallOrientation });
    sounds.play('wall_place');
}

function hasPath(sx, sy, targetY) {
    const visited = new Set();
    const queue = [{ x: sx, y: sy }];
    visited.add(`${sx},${sy}`);
    // Standard orthogonal neighbors
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];

    while (queue.length > 0) {
        const curr = queue.shift();
        if (curr.y === targetY) return true;

        for (const d of dirs) {
            const nx = curr.x + d[0];
            const ny = curr.y + d[1];
            if (nx >= 0 && nx < GRID_COLS && ny >= 0 && ny < GRID_ROWS) {
                if (!visited.has(`${nx},${ny}`) && !isBlockedByWall(curr.x, curr.y, nx, ny)) {
                    visited.add(`${nx},${ny}`);
                    queue.push({ x: nx, y: ny });
                }
            }
        }
    }
    return false;
}

function updatePlayerPos(pid, x, y) {
    STATE.players[pid].x = x;
    STATE.players[pid].y = y;
    renderBoard();
    checkWin();
}

function checkWin() {
    const p1 = STATE.players.p1;
    const p2 = STATE.players.p2;

    if (p1.y === GRID_ROWS - 1) endGame('p1');
    if (p2.y === 0) endGame('p2');
}

// --- VISUAL EFFECTS ---
let confettiLoop;

function startConfetti() {
    const canvas = document.getElementById('confetti-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles = [];
    const colors = ['#ffd700', '#ffeb3b', '#f59e0b', '#ffffff', '#eab308'];

    function createParticle() {
        return {
            x: Math.random() * canvas.width,
            y: -10,
            color: colors[Math.floor(Math.random() * colors.length)],
            size: Math.random() * 8 + 4,
            speedY: Math.random() * 3 + 2,
            speedX: Math.random() * 2 - 1,
            rotation: Math.random() * 360,
            rotationSpeed: Math.random() * 10 - 5
        };
    }

    // Initial Burst
    for (let i = 0; i < 100; i++) particles.push(createParticle());

    function loop() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Spawn
        if (particles.length < 200) particles.push(createParticle());

        particles.forEach((p, index) => {
            p.y += p.speedY;
            p.x += p.speedX;
            p.rotation += p.rotationSpeed;

            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rotation * Math.PI / 180);
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
            ctx.restore();

            if (p.y > canvas.height) {
                particles[index] = createParticle();
            }
        });

        confettiLoop = requestAnimationFrame(loop);
    }

    // Stop previous if any
    if (confettiLoop) cancelAnimationFrame(confettiLoop);
    loop();
}

function stopConfetti() {
    if (confettiLoop) {
        cancelAnimationFrame(confettiLoop);
        confettiLoop = null;
    }
    const canvas = document.getElementById('confetti-canvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
}

function endGame(winnerId) {
    STATE.gameActive = false;
    stopConfetti();

    // Determine Result
    const isWin = (winnerId === STATE.playerId);

    // Select Elements
    const screen = document.getElementById('game-over-screen');
    const title = screen.querySelector('.result-title');
    const msg = screen.querySelector('.result-message');
    const icon = screen.querySelector('.result-icon');

    if (title && msg && icon) {
        // Update Classes
        screen.classList.remove('victory', 'defeat');
        screen.classList.add(isWin ? 'victory' : 'defeat');

        // Update Content
        title.textContent = isWin ? "ZAFER!" : "YENİLGİ...";
        msg.textContent = isWin
            ? "Muhteşem bir strateji ile rakibi alt ettin."
            : "Bu sefer şans rakipten yanaydı. Pes etme!";
        icon.innerHTML = isWin ? '<i class="fa-solid fa-trophy"></i>' : '<i class="fa-solid fa-skull"></i>';

        if (isWin) {
            startConfetti();
            sounds.play('win');
        } else {
            sounds.play('lose');
        }
    }

    showScreen('gameOver');
}

function renderBoard() {
    // 1. Clear moving elements (players) and walls (absolute)
    gridBoard.querySelectorAll('.player, .wall, .powerup-icon').forEach(e => e.remove());
    document.querySelectorAll('.cell').forEach(c => {
        c.classList.remove('valid-move');
        c.classList.remove('pending-move');
        c.innerHTML = ''; // Clear anything inside cells just in case
    });

    // 2. Metric Helper (Get current cell size dynamically)
    const cellEl = gridBoard.querySelector('.cell');
    if (!cellEl) return;
    const cellSize = cellEl.offsetWidth;
    // Assume gap is from CSS variable default or calculated
    let gap = 3; // Fallback
    const computedStyle = getComputedStyle(gridBoard);
    if (computedStyle.gap) gap = parseFloat(computedStyle.gap);

    // 3. Render Helper
    const placeVisualWall = (x, y, type, classes = []) => {
        const w = document.createElement('div');
        w.className = `wall ${type} ${classes.join(' ')}`;

        // Coords: Gap X matches Left of Col X+1? No.
        // Gap 0 is between Col 0 and 1.
        // Grid: [Cell0] [Gap0] [Cell1] ...
        // Left of Gap x = (x+1)*Cell + x*Gap
        // Center of Gap x = Left + Gap/2

        let top, left;

        if (type === 'vertical') {
            // Centered on Gap X (horizontal axis)
            // Spans Row Y to Y+1 (vertical axis)

            // X-Pos (Left): (x + 1) * (cellSize + gap) - gap/2 - thickness/2 (handled by CSS center transform usually)
            // Let's position LEFT at the start of the gap?
            // Left of Gap X = (x+1) * cellSize + x * gap.
            // But my CSS uses transform: translateX(-50%). So I should position 'left' at the CENTER of the gap.
            // Center of Gap X = ((x+1) * cellSize + x * gap) + gap/2
            // Simplifies to: (x + 1) * (cellSize + gap) - gap/2

            left = (x + 1) * (cellSize + gap) - gap / 2;

            // Y-Pos (Top): Top of Row Y.
            // Top of Row Y = y * (cellSize + gap)
            top = y * (cellSize + gap);
        } else {
            // Horizontal
            // Centered on Gap Y (vertical axis)
            // Left of Col X (horizontal axis)

            // Y-Pos (Top): Center of Gap Y.
            top = (y + 1) * (cellSize + gap) - gap / 2;

            // X-Pos (Left): Left of Col X.
            left = x * (cellSize + gap);
        }

        w.style.left = `${left}px`;
        w.style.top = `${top}px`;
        gridBoard.appendChild(w);
    };

    // 4. Render Actual Walls
    STATE.walls.forEach(w => {
        placeVisualWall(w.x, w.y, w.type, [w.owner || '']);
    });

    // 5. Render Pending Wall
    if (STATE.pendingAction && STATE.pendingAction.type === 'wall') {
        const pa = STATE.pendingAction;
        placeVisualWall(pa.x, pa.y, pa.orientation, ['pending']);
    }

    // 6. Render Players
    renderPlayer('p1');
    renderPlayer('p2');

    // 7. Render Poweru
    // 7. Render Powerups
    if (STATE.powerups) {
        const types = {
            destroy: { icon: 'fa-bomb', color: '#ef4444' },
            ghost: { icon: 'fa-ghost', color: '#a855f7' },
            freeze: { icon: 'fa-snowflake', color: '#0ea5e9' },
            wall: { icon: 'fa-plus-square', color: '#f97316' },
            return: { icon: 'fa-undo', color: '#10b981' },
            chaos: { icon: 'fa-shuffle', color: '#d946ef' },
            double_turn: { icon: 'fa-repeat', color: '#eab308' },
            hourglass: { icon: 'fa-hourglass-half', color: '#b45309' },
            star: { icon: 'fa-star', color: '#ffd700', class: 'legendary-pulse' }
        };

        STATE.powerups.forEach(pObj => {
            const cell = document.querySelector(`.cell[data-x="${pObj.x}"][data-y="${pObj.y}"]`);
            if (cell) {
                const p = types[pObj.type] || types.destroy;
                const el = document.createElement('div');
                el.innerHTML = `<i class="fa-solid ${p.icon}" style="color: ${p.color}; font-size: 1.2rem; filter: drop-shadow(0 0 5px ${p.color});"></i>`;
                el.style.position = 'absolute';
                el.style.top = '50%';
                el.style.left = '50%';
                el.style.transform = 'translate(-50%, -50%)';
                el.style.zIndex = '8';
                el.className = `powerup-icon ${p.class || ''}`;
                cell.appendChild(el);
            }
        });
    }

    renderValidMoves();
}

function renderPlayer(pid) {
    const p = STATE.players[pid];
    const cell = document.querySelector(`.cell[data-x="${p.x}"][data-y="${p.y}"]`);
    if (cell) {
        const el = document.createElement('div');
        el.className = `player ${pid === 'p1' ? 'blue' : 'red'}`;
        cell.appendChild(el);
    }
}

function renderValidMoves() {
    if (!STATE.isMyTurn || STATE.mode !== 'move') return;

    const me = STATE.players[STATE.playerId];
    const moves = getValidMoves(me.x, me.y);

    moves.forEach(m => {
        const cell = document.querySelector(`.cell[data-x="${m.x}"][data-y="${m.y}"]`);
        if (cell) cell.classList.add('valid-move');

        // Pending Move Highlight (if selected via multi-step, though movement is instant now)
        if (STATE.pendingAction && STATE.pendingAction.type === 'move' &&
            STATE.pendingAction.x === m.x && STATE.pendingAction.y === m.y) {
            cell.classList.add('pending-move');
        }
    });
}

function showScreen(name) {
    if (name !== 'gameOver') stopConfetti();
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
}

// --- FIREBASE ACTIONS ---

function resetRoom() {
    if (!STATE.roomId) return;

    // Reset to initial state
    const initialState = {
        p1: { x: Math.floor(GRID_COLS / 2), y: 0, wallsLeft: 10, inventory: { destroy: 0, ghost: 0, freeze: 0, wall: 0 } },
        p2: { x: Math.floor(GRID_COLS / 2), y: GRID_ROWS - 1, wallsLeft: 10, inventory: { destroy: 0, ghost: 0, freeze: 0, wall: 0 } },
        walls: [],
        powerups: []
    };

    const roomRef = ref(db, 'rooms/' + STATE.roomId);
    update(roomRef, {
        turn: Math.random() < 0.5 ? 'p1' : 'p2',
        status: 'active', // Ensure status is active
        boardState: initialState
    });

    // Explicitly clear winner if it was set at root or in boardState
    // initialState above clears boardState.winner, but let's be safe about root status.

    showScreen('game');
}

function createRoom() {
    const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
    const username = document.getElementById('username-input').value || 'P1';

    const roomRef = ref(db, 'rooms/' + roomId);
    set(roomRef, {
        p1: username,
        turn: Math.random() < 0.5 ? 'p1' : 'p2',
        status: 'waiting',
        boardState: {
            p1: { x: Math.floor(GRID_COLS / 2), y: 0, wallsLeft: 10, inventory: { destroy: 0, ghost: 0, freeze: 0, wall: 0 } },
            p2: { x: Math.floor(GRID_COLS / 2), y: GRID_ROWS - 1, wallsLeft: 10, inventory: { destroy: 0, ghost: 0, freeze: 0, wall: 0 } },
            walls: [],
            powerups: []
        }
    });

    STATE.roomId = roomId;
    STATE.playerId = 'p1';

    showScreen('waiting');
    document.getElementById('display-room-code').textContent = roomId;

    STATE.roomUnsubscribe = onValue(roomRef, (snapshot) => {
        const data = snapshot.val();
        if (data && data.p2) {
            startGame(data);
        }
    });
}

function joinRoom() {
    const roomId = document.getElementById('room-code-input').value.toUpperCase();
    const username = document.getElementById('username-input').value || 'P2';

    if (!roomId) return;

    const roomRef = ref(db, 'rooms/' + roomId);
    get(roomRef).then((snapshot) => {
        if (snapshot.exists()) {
            const data = snapshot.val();
            if (!data.p2) {
                update(roomRef, {
                    p2: username,
                    status: 'active'
                });
                STATE.roomId = roomId;
                STATE.playerId = 'p2';
                listenGameLoop();
            } else {
                alert("Oda dolu!");
            }
        } else {
            alert("Oda bulunamadı!");
        }
    });
}

function startGame(data) {
    if (STATE.roomUnsubscribe) {
        STATE.roomUnsubscribe();
        STATE.roomUnsubscribe = null;
    }
    STATE.gameActive = true;
    showScreen('game');
    document.getElementById('p1-name').textContent = data.p1;
    document.getElementById('p2-name').textContent = data.p2;

    // Flip for P1
    if (STATE.playerId === 'p1') {
        gridBoard.classList.add('flipped');
    } else {
        gridBoard.classList.remove('flipped');
    }

    listenGameLoop();
    updateTurnUI(data.turn);
}

function listenGameLoop() {
    // Cleanup any existing listener first
    if (STATE.roomUnsubscribe) {
        STATE.roomUnsubscribe();
        STATE.roomUnsubscribe = null;
    }

    const roomRef = ref(db, 'rooms/' + STATE.roomId);
    STATE.roomUnsubscribe = onValue(roomRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) return;

        // Sync State
        if (data.boardState) {
            STATE.players.p1 = data.boardState.p1 || STATE.players.p1;
            STATE.players.p2 = data.boardState.p2 || STATE.players.p2;

            // Powerup Spawn Sound
            const newPowerups = data.boardState.powerups || [];
            if (STATE.powerups && newPowerups.length > STATE.powerups.length && STATE.gameActive) {
                sounds.play('powerup_spawn');
            }
            STATE.powerups = newPowerups;

            STATE.powerups = newPowerups;

            if (data.boardState.activeEffects) {
                STATE.activeEffects = data.boardState.activeEffects;
            }

            // Check Winner
            if (data.boardState.winner) {
                endGame(data.boardState.winner);
            }

            // Migration/Safety: Ensure wallsV/wallsH exist
            ['p1', 'p2'].forEach(pid => {
                if (typeof STATE.players[pid].wallsV === 'undefined') STATE.players[pid].wallsV = 5;
                if (typeof STATE.players[pid].wallsH === 'undefined') STATE.players[pid].wallsH = 5;
                if (typeof STATE.players[pid].hasPowerup === 'undefined') STATE.players[pid].hasPowerup = false;
            });

            STATE.walls = data.boardState.walls || [];
            STATE.powerups = data.boardState.powerups || [];
            STATE.frozenPlayer = data.boardState.frozenPlayer || null;
        }

        if (data.status === 'active') {
            if (!STATE.gameActive && document.getElementById('game-over-screen').classList.contains('active')) {
                if (STATE.walls.length === 0) {
                    STATE.gameActive = true;
                    showScreen('game');
                }
            } else if (!STATE.gameActive) {
                startGame(data);
            }
        }

        updateTurnUI(data.turn);
        checkWin();
    });
}

function sendMove(moveData, endTurn = true) {
    const roomRef = ref(db, 'rooms/' + STATE.roomId);
    const nextTurn = STATE.playerId === 'p1' ? 'p2' : 'p1';

    // Current State Copies
    const currentPowerups = [...(STATE.powerups || [])];
    const updates = {};
    const pid = STATE.playerId;
    const invPath = `/boardState/${pid}/inventory`;
    const myInv = STATE.players[pid].inventory || { destroy: 0, ghost: 0, freeze: 0, wall: 0 };

    if (moveData.type === 'move') {
        const pPath = `/boardState/${pid}`;
        updates[`${pPath}/x`] = moveData.to.x;
        updates[`${pPath}/y`] = moveData.to.y;

        // Consume Chaos if active
        if (STATE.activeEffects && STATE.activeEffects[pid] && STATE.activeEffects[pid].chaos) {
            updates[`/boardState/activeEffects/${pid}/chaos`] = false;
        }
        // Consume Hourglass if active (implicit by turn end) -> No, ensure it clears
        if (STATE.activeEffects && STATE.activeEffects[pid] && STATE.activeEffects[pid].hourglass) {
            updates[`/boardState/activeEffects/${pid}/hourglass`] = false;
        }

        // Pickup Powerup
        if (moveData.pickupPowerupIndex !== undefined && moveData.pickupPowerupIndex !== -1) {
            const idx = moveData.pickupPowerupIndex;
            if (currentPowerups[idx]) {
                const type = currentPowerups[idx].type;
                currentPowerups.splice(idx, 1);
                updates['/boardState/powerups'] = currentPowerups;

                if (type === 'star') {
                    // Grant ALL Powerups
                    const allTypes = ['destroy', 'ghost', 'freeze', 'wall', 'return', 'chaos', 'double_turn', 'hourglass'];
                    allTypes.forEach(t => {
                        updates[`${invPath}/${t}`] = (myInv[t] || 0) + 1;
                    });
                } else {
                    updates[`${invPath}/${type}`] = (myInv[type] || 0) + 1;
                }
            }
        }

        if (moveData.consumePowerup) {
            updates[`${invPath}/ghost`] = Math.max(0, (myInv.ghost || 0) - 1);
        }
    } else if (moveData.type === 'wall') {
        const newWalls = [...STATE.walls, { x: moveData.x, y: moveData.y, type: moveData.orientation, owner: STATE.playerId }];
        updates['/boardState/walls'] = newWalls;

        const currentWalls = (STATE.players[pid].wallsLeft === undefined) ? 10 : STATE.players[pid].wallsLeft;
        updates[`/boardState/${pid}/wallsLeft`] = currentWalls - 1;
    } else if (moveData.type === 'destroy') {
        const newWalls = STATE.walls.filter(w => !(w.x === moveData.x && w.y === moveData.y && w.type === moveData.orientation));
        updates['/boardState/walls'] = newWalls;
        updates[`${invPath}/destroy`] = Math.max(0, (myInv.destroy || 0) - 1);
    } else if (moveData.type === 'activate') {
        if (moveData.powerupType === 'freeze') {
            updates['/boardState/frozenPlayer'] = nextTurn;
            updates[`${invPath}/freeze`] = Math.max(0, (myInv.freeze || 0) - 1);
        } else if (moveData.powerupType === 'wall') {
            const currentWalls = (STATE.players[pid].wallsLeft === undefined) ? 10 : STATE.players[pid].wallsLeft;
            updates[`/boardState/${pid}/wallsLeft`] = currentWalls + 1;
            updates[`${invPath}/wall`] = Math.max(0, (myInv.wall || 0) - 1);
        } else if (moveData.powerupType === 'return') {
            // Reset Opponent
            const oppId = pid === 'p1' ? 'p2' : 'p1';
            updates[`/boardState/${oppId}/x`] = Math.floor(GRID_COLS / 2);
            updates[`/boardState/${oppId}/y`] = oppId === 'p2' ? GRID_ROWS - 1 : 0;
            updates[`${invPath}/return`] = Math.max(0, (myInv.return || 0) - 1);
        } else if (moveData.powerupType === 'chaos') {
            const oppId = pid === 'p1' ? 'p2' : 'p1';
            updates[`/boardState/activeEffects/${oppId}/chaos`] = true;
            updates[`${invPath}/chaos`] = Math.max(0, (myInv.chaos || 0) - 1);
        } else if (moveData.powerupType === 'double_turn') {
            updates[`/boardState/activeEffects/${pid}/double_turn`] = true;
            updates[`${invPath}/double_turn`] = Math.max(0, (myInv.double_turn || 0) - 1);
        } else if (moveData.powerupType === 'hourglass') {
            const oppId = pid === 'p1' ? 'p2' : 'p1';
            updates[`/boardState/activeEffects/${oppId}/hourglass`] = true;
            updates[`${invPath}/hourglass`] = Math.max(0, (myInv.hourglass || 0) - 1);
        }
    } else if (moveData.type === 'surrender') {
        updates['/boardState/winner'] = nextTurn;
        updates['/status'] = 'finished';
    }

    let usedDoubleTurn = false;

    if (endTurn) {
        // Double Turn Logic: If active, consume and keep turn
        if (STATE.activeEffects && STATE.activeEffects[pid] && STATE.activeEffects[pid].double_turn) {
            updates[`/boardState/activeEffects/${pid}/double_turn`] = false;
            usedDoubleTurn = true;
            showToast("🔁 Dejavu! Bir hamle hakkı daha!", "info");
        } else {
            updates['/turn'] = nextTurn;
        }

        if (STATE.frozenPlayer === STATE.playerId) {
            updates['/boardState/frozenPlayer'] = null;
        }

        // Spawn Logic: Max 3, 22% Chance (Approx every 4-5 turns)
        if (currentPowerups.length < 3 && Math.random() < 0.22) {
            const newP = generatePowerup();
            if (newP) {
                currentPowerups.push(newP);
                updates['/boardState/powerups'] = currentPowerups;
            }
        }
    }

    update(roomRef, updates);

    // Only yield turn if we didn't use double_turn
    if (endTurn && !usedDoubleTurn) {
        STATE.isMyTurn = false;
        updateTurnUI(nextTurn);
    } else if (usedDoubleTurn) {
        // Force refresh board to remove correct wall from hand visually if needed, though listener will do it
        // effectively we just stay active.
        // Listener will eventually sync 'double_turn' = false
    }
}

function updateTurnUI(turn) {
    STATE.isMyTurn = (turn === STATE.playerId);
    const p1Info = document.getElementById('p1-info');
    const p2Info = document.getElementById('p2-info');
    p1Info.classList.toggle('active', turn === 'p1');
    p2Info.classList.toggle('active', turn === 'p2');

    // Inventory Badge Update
    const me = STATE.players[STATE.playerId];
    if (turn === STATE.playerId) sounds.play('turn_start');

    if (me && me.inventory) {
        const types = ['destroy', 'ghost', 'freeze', 'wall', 'return', 'chaos', 'double_turn', 'hourglass'];
        types.forEach(type => {
            const count = me.inventory[type] || 0;
            const btn = document.getElementById(`btn-${type}`);
            if (btn) {
                const badge = btn.querySelector('.badge');
                if (badge) badge.textContent = count;

                if (count > 0) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            }
        });
    }

    // Hourglass Timer UI
    const isUnderPressure = STATE.activeEffects && STATE.activeEffects[turn] && STATE.activeEffects[turn].hourglass;
    const infoDiv = turn === 'p1' ? document.getElementById('p1-info') : document.getElementById('p2-info');

    // Clear any existing timer visual
    document.querySelectorAll('.timer-indicator').forEach(e => e.remove());

    if (isUnderPressure && STATE.isMyTurn) {
        showToast("⏳ Kum Saati! 3 Saniyen Var!", "error");

        const timerEl = document.createElement('div');
        timerEl.className = 'timer-indicator';
        timerEl.style = "color: red; font-weight: bold; font-size: 1.2rem; margin-top: 5px;";
        timerEl.innerText = "⏳ 3";
        infoDiv.appendChild(timerEl);

        // Timer Logic
        let timeLeft = 3;
        // Clear previous interval if exists (need global ref or check)
        if (window.turnTimer) clearInterval(window.turnTimer);

        window.turnTimer = setInterval(() => {
            timeLeft--;
            timerEl.innerText = `⏳ ${timeLeft}`;
            if (!STATE.isMyTurn) {
                clearInterval(window.turnTimer);
                timerEl.remove();
            }
            if (timeLeft < 0) {
                clearInterval(window.turnTimer);
                timerEl.remove();
                if (STATE.isMyTurn) {
                    // Timeout! Random Move
                    const validMoves = getValidMoves(STATE.players[STATE.playerId].x, STATE.players[STATE.playerId].y);
                    if (validMoves.length > 0) {
                        const rand = validMoves[Math.floor(Math.random() * validMoves.length)];
                        tryMove(rand.x, rand.y);
                        showToast("Süre doldu! Rastgele oynandı.", "error");
                    }
                }
            }
        }, 1000);
    } else {
        if (window.turnTimer) clearInterval(window.turnTimer);
    }

    updateWallCounts();
    renderBoard();
}




// --- MODAL UTILS ---
function showModal(title, message, onConfirm, onCancel) {
    const el = document.getElementById('modal-overlay');
    const titleEl = document.getElementById('modal-title');
    const msgEl = document.getElementById('modal-message');

    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;

    // Replace buttons to clear listeners
    const btnConfirm = document.getElementById('modal-confirm');
    const btnCancel = document.getElementById('modal-cancel');

    if (btnConfirm && btnCancel) {
        const newConfirm = btnConfirm.cloneNode(true);
        const newCancel = btnCancel.cloneNode(true);

        btnConfirm.parentNode.replaceChild(newConfirm, btnConfirm);
        btnCancel.parentNode.replaceChild(newCancel, btnCancel);

        newConfirm.addEventListener('click', () => {
            closeModal();
            if (onConfirm) onConfirm();
        });

        newCancel.addEventListener('click', () => {
            closeModal();
            if (onCancel) onCancel();
        });
    }

    if (el) el.classList.remove('hidden');
}

function closeModal() {
    const el = document.getElementById('modal-overlay');
    if (el) el.classList.add('hidden');
}

// Start
init();

