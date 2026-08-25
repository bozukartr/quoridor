// Import Shared Firebase Config
import { app, db, auth } from "./firebase-config.js";
import { ref, set, onValue, update, push, child, get, remove } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { GameRenderer } from "./game-renderer.js";
import { LocalRoom } from "./local-room.js";
import { chooseAiAction, aiThinkDelay, AI_LEVELS, getValidMoves as aiValidMoves } from "./ai.js";

// Game State Constants
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
        p1: { x: 3, y: 0, wallsLeft: 8, hasPowerup: false },
        p2: { x: 3, y: 8, wallsLeft: 8, hasPowerup: false }
    },
    powerups: [], // Array of {x, y, type}
    walls: [], // Array of {x, y, type} (x,y = Gap Coordinates)
    gameActive: false,
    activeEffects: { p1: { chaos: false, hourglass: false }, p2: { chaos: false, hourglass: false } }, // New State
    timeRemaining: { p1: 90, p2: 90 }, // Chess Timer (Seconds)
    pendingAction: null, // { type: 'move'|'wall', x, y, orientation? }
    usedPowerupsInTurn: new Set(), // Track usage per turn
    vsAI: false, // Tek kişilik mod (yapay zekaya karşı)
    aiLevel: 'medium', // 'easy' | 'medium' | 'hard'
    localRoom: null, // Tek kişilik modda Firebase yerine kullanılan yerel oda
    aiThinking: false
};

const AI_PID = 'p2'; // Yapay zeka her zaman p2 olarak oynar

// --- ODA ERİŞİMİ (çevrimiçi: Firebase, tek kişilik: yerel oda) ---
function roomUpdate(updates) {
    if (STATE.vsAI) {
        if (STATE.localRoom) STATE.localRoom.update(updates);
        return;
    }
    update(ref(db, 'rooms/' + STATE.roomId), updates);
}

function roomSubscribe(callback) {
    if (STATE.vsAI) {
        return STATE.localRoom ? STATE.localRoom.onValue(callback) : () => { };
    }
    return onValue(ref(db, 'rooms/' + STATE.roomId), callback);
}

// --- WebGL Renderer ---
let renderer = null;

// --- DOM ELEMENTS ---
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

// --- Render scheduler (throttled via rAF) ---
let _renderPending = false;
function scheduleRender() {
    if (_renderPending || !renderer) return;
    _renderPending = true;
    requestAnimationFrame(() => {
        _renderPending = false;
        if (!renderer || !STATE.gameActive) return;
        const validMoves = STATE.isMyTurn && STATE.mode === 'move'
            ? getValidMoves(STATE.players[STATE.playerId].x, STATE.players[STATE.playerId].y)
            : null;
        renderer.update(STATE, STATE.pendingAction, validMoves);
    });
}

// --- INITIALIZATION ---
function init() {
    setupEventListeners();
    setupTutorialListeners();

    // Auto-Fill Username if Logged In
    onAuthStateChanged(auth, (user) => {
        const userInput = document.getElementById('username-input');
        const icon = userInput.previousElementSibling;

        if (user && userInput) {
            userInput.value = user.displayName;
            userInput.disabled = true;
            userInput.style.backgroundColor = 'rgba(16, 185, 129, 0.1)';
            userInput.style.borderColor = '#10b981';
            userInput.style.color = '#fff';

            if (icon) {
                icon.className = "fa-solid fa-check-circle";
                icon.style.color = "#10b981";
            }

            // Listen for Global Invites
            listenForInvites(user.uid);
        }

        // Handle URL Invites (after Auth to ensure username is populated if possible)
        // We do this check only once, so we might need a flag or check if we already joined.
        if (!STATE.roomId) { // Only if not already in game
            const urlParams = new URLSearchParams(window.location.search);
            const roomParam = urlParams.get('room');
            if (roomParam) {
                if (urlParams.get('host') === 'true') {
                    // Slight delay to ensure UI ready
                    setTimeout(() => createRoom(roomParam), 500);
                } else if (urlParams.get('join') === 'true') {
                    const roomInput = document.getElementById('room-code-input');
                    if (roomInput) {
                        roomInput.value = roomParam;
                        setTimeout(() => joinRoom(), 500);
                    }
                }
            }
        }
    });
}

function setupEventListeners() {
    // Buttons
    document.getElementById('create-room-btn').addEventListener('click', createRoom);
    document.getElementById('join-room-btn').addEventListener('click', joinRoom);

    // Tek kişilik mod: zorluk seçimi + başlat
    document.querySelectorAll('#ai-difficulty .diff-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#ai-difficulty .diff-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            STATE.aiLevel = btn.dataset.level;
        });
    });
    const playAiBtn = document.getElementById('play-ai-btn');
    if (playAiBtn) playAiBtn.addEventListener('click', () => startAIGame(STATE.aiLevel));
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

    // Rule: Except 'wall', must be my turn
    if (!STATE.isMyTurn && type !== 'wall') {
        showToast("Sıra sizde değil! (Sadece +1 Duvar kullanılabilir)");
        return;
    }

    // Rule: Single use per turn (except Wall and Ghost toggle)
    if (type !== 'wall') {
        // Ghost Logic is special (toggle)
        if (type === 'ghost' && STATE.ghostMode) {
            // Allow deactivation
        } else {
            if (STATE.usedPowerupsInTurn.has(type)) {
                showToast("Bu özelliği bu tur zaten kullandınız! (Sıra bekleyiniz)", "error");
                return;
            }
        }
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
            STATE.usedPowerupsInTurn.add('ghost');
            setMode('move');
        }
    } else if (type === 'freeze') {
        showModal('Dondurucu ❄️', 'Rakibi dondurmak (duvar koyamaz) istiyor musunuz?', () => {
            sendMove({ type: 'activate', powerupType: 'freeze' }, false);
            showToast('❄️ Rakip donduruldu!');
            STATE.usedPowerupsInTurn.add('freeze');
        });
    } else if (type === 'wall') {
        sendMove({ type: 'activate', powerupType: 'wall' }, false);
        showToast('🧱 +1 Duvar kazandınız!');
    } else if (type === 'return') {
        showModal('Geri Sar ↩️', 'Rakibi başlangıç noktasına geri göndermek istiyor musunuz? (Sıra Rakibe Geçer)', () => {
            sendMove({ type: 'activate', powerupType: 'return' }, true);
            showToast('↩️ Rakip geri gönderildi!');
            STATE.usedPowerupsInTurn.add('return');
        });
    } else if (type === 'chaos') {
        showModal('Şaşırtma 🔀', 'Rakibin bir sonraki hamlesini şaşırtmak istiyor musunuz?', () => {
            sendMove({ type: 'activate', powerupType: 'chaos' }, true);
            showToast('🔀 Şaşırtma aktif!');
            STATE.usedPowerupsInTurn.add('chaos');
        });
    } else if (type === 'double_turn') {
        // "Sıra bir kez daha kendisinde olur"
        sendMove({ type: 'activate', powerupType: 'double_turn' }, false); // Don't end turn yet, let logic handle
        showToast('🔁 Dejavu! Bir hamle hakkı daha!');
        STATE.usedPowerupsInTurn.add('double_turn');
    } else if (type === 'hourglass') {
        showModal('Kum Saati ⏳', 'Rakibin toplam süresinden 10 saniye silmek istiyor musunuz? (Sıra rakibe geçer)', () => {
            sendMove({ type: 'activate', powerupType: 'hourglass' }, true);
            showToast('⏳ Kum Saati aktif!');
            STATE.usedPowerupsInTurn.add('hourglass');
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

function initRenderer() {
    const container = document.getElementById('board-canvas-container');
    if (!container) return;
    if (renderer) { renderer.destroy(); renderer = null; }
    renderer = new GameRenderer(container);
    renderer.onCellClick = handleCellClick;
    renderer.onCellHover = handleCellHover;
    renderer.onCellLeave = () => renderer.clearHover();
}

// Window resize → renderer resize (debounced)
let _resizeTimer = null;
window.addEventListener('resize', () => {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => { if (renderer) { renderer._onResize(); scheduleRender(); } }, 200);
});

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

function handleCellHover(cx, cy, offsetX, offsetY, cellSize, isFlipped) {
    if (!renderer) return;
    if (!STATE.gameActive || !STATE.isMyTurn || STATE.mode !== 'wall') {
        renderer.clearHover();
        return;
    }

    let isLeft = offsetX < cellSize / 2;
    let isTop = offsetY < cellSize / 2;
    if (isFlipped) { isLeft = !isLeft; isTop = !isTop; }

    let targetX = cx, targetY = cy;
    if (STATE.wallOrientation === 'vertical') {
        if (isLeft) targetX = cx - 1;
    } else {
        if (isTop) targetY = cy - 1;
    }

    if (targetX < 0 || targetY < 0 ||
        (STATE.wallOrientation === 'vertical' && targetX >= GRID_COLS - 1) ||
        (STATE.wallOrientation === 'horizontal' && targetY >= GRID_ROWS - 1)) {
        renderer.clearHover();
        return;
    }

    renderer.setHover({ x: targetX, y: targetY, orientation: STATE.wallOrientation });
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

function generatePowerup(activePowerups = []) {
    let type, x, y, attempts = 0;

    // Count existing types
    const timeCount = activePowerups.filter(p => p.type === 'time_bonus').length;
    const otherCount = activePowerups.length - timeCount;

    // Weighted Selection
    const weights = {
        wall: otherCount < 3 ? 0.30 : 0,
        destroy: otherCount < 3 ? 0.30 : 0,
        ghost: otherCount < 3 ? 0.30 : 0,
        freeze: otherCount < 3 ? 0.30 : 0,
        return: otherCount < 3 ? 0.30 : 0,
        chaos: otherCount < 3 ? 0.30 : 0,
        double_turn: otherCount < 3 ? 0.30 : 0,
        hourglass: otherCount < 3 ? 0.30 : 0,
        time_bonus: timeCount < 2 ? 0.30 : 0,
        star: otherCount < 3 ? 0.20 : 0
    };

    let totalWeight = 0;
    for (const key in weights) totalWeight += weights[key];

    if (totalWeight === 0) return null; // Quota full

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

        // 1. Avoid Players AND their immediate neighbors (3x3 area)
        const p1 = STATE.players.p1;
        const p2 = STATE.players.p2;

        // Check if (x,y) is within 1 cell of P1
        if (Math.abs(x - p1.x) <= 1 && Math.abs(y - p1.y) <= 1) continue;

        // Check if (x,y) is within 1 cell of P2
        if (Math.abs(x - p2.x) <= 1 && Math.abs(y - p2.y) <= 1) continue;

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

// Called by GameRenderer with canvas-converted coordinates
function handleCellClick(cx, cy, offsetX, offsetY, cellSize, isFlipped) {
    if (!STATE.gameActive || !STATE.isMyTurn) return;

    let actionType = STATE.mode;
    let targetX = cx, targetY = cy;
    let orientation = STATE.wallOrientation;

    if (actionType === 'wall' || actionType === 'destroy') {
        let isLeft = offsetX < cellSize / 2;
        let isTop = offsetY < cellSize / 2;
        if (isFlipped) { isLeft = !isLeft; isTop = !isTop; }

        if (actionType === 'destroy') {
            const dx = Math.abs(offsetX / cellSize - 0.5);
            const dy = Math.abs(offsetY / cellSize - 0.5);
            orientation = dx > dy ? 'vertical' : 'horizontal';
            if (isLeft) targetX = cx - 1;
            if (isTop) targetY = cy - 1;
        } else {
            if (orientation === 'vertical') { if (isLeft) targetX = cx - 1; }
            else { if (isTop) targetY = cy - 1; }
        }
    }

    if (targetX < 0 || targetY < 0) return;

    if (actionType === 'move') {
        const myEffects = STATE.activeEffects?.[STATE.playerId];
        if (myEffects?.chaos) {
            const validMoves = getValidMoves(STATE.players[STATE.playerId].x, STATE.players[STATE.playerId].y);
            const others = validMoves.filter(m => m.x !== targetX || m.y !== targetY);
            const choices = others.length > 0 ? others : validMoves;
            if (choices.length > 0) {
                const rand = choices[Math.floor(Math.random() * choices.length)];
                targetX = rand.x; targetY = rand.y;
                showToast("🔀 Şaşırtma etkisi! Farklı yöne gittin!", "error");
            }
        }
        tryMove(targetX, targetY);
        clearPendingAction();
        return;
    }

    if (actionType === 'destroy') {
        tryDestroyWall(targetX, targetY, orientation);
        return;
    }

    // WALLS — two-step confirmation
    const isSame = STATE.pendingAction?.type === actionType
        && STATE.pendingAction?.x === targetX
        && STATE.pendingAction?.y === targetY
        && STATE.pendingAction?.orientation === orientation;

    if (isSame) {
        tryPlaceWall(targetX, targetY);
        clearPendingAction();
    } else {
        let valid = targetX >= 0 && targetY >= 0;
        if (orientation === 'vertical' && targetX >= GRID_COLS - 1) valid = false;
        if (orientation === 'horizontal' && targetY >= GRID_ROWS - 1) valid = false;
        if (STATE.walls.some(w => w.x === targetX && w.y === targetY && w.type === orientation)) valid = false;

        if (valid) {
            STATE.pendingAction = { type: actionType, x: targetX, y: targetY, orientation };
            scheduleRender();
        } else if (actionType === 'wall') {
            showToast("Geçersiz duvar!", "error");
        }
    }
}

function clearPendingAction() {
    STATE.pendingAction = null;
    scheduleRender();
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
    setMode('move');
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
            time_bonus: '+10 Saniye ⏱️',
            star: '🌟 EFSANEVİ YILDIZ 🌟'
        };
        const pName = names[p.type] || 'Powerup';

        if (p.type === 'star') {
            showToast(`🌟 EFSANEVİ! TÜM GÜÇLER EKLENDİ!`, "success");
            sounds.play('win');
            STATE.powerupCount = (STATE.powerupCount || 0) + 1; // Track Powerup
        } else if (p.type === 'time_bonus') {
            showToast(`⏱️ +10 Saniye Kazanıldı!`, "success");
            sounds.play('powerup_collect');
            STATE.powerupCount = (STATE.powerupCount || 0) + 1;
        } else {
            showToast(`${pName} Alındı!`, "success");
            sounds.play('powerup_collect');
            STATE.powerupCount = (STATE.powerupCount || 0) + 1; // Track Powerup
        }
    } else {
        sounds.play('move');
    }

    // Optimistic Update
    updatePlayerPos(STATE.playerId, targetX, targetY);
    STATE.moveCount = (STATE.moveCount || 0) + 1; // Track Move

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


    // NEW RULE: Check Powerup Accessibility
    let powerupsBlocked = false;
    if (STATE.powerups && STATE.powerups.length > 0) {
        for (const p of STATE.powerups) {
            const p1ToPowerup = hasPathToCell(STATE.players.p1.x, STATE.players.p1.y, p.x, p.y);
            const p2ToPowerup = hasPathToCell(STATE.players.p2.x, STATE.players.p2.y, p.x, p.y);

            // If NEITHER player can reach the powerup, it's considered blocked.
            if (!p1ToPowerup && !p2ToPowerup) {
                powerupsBlocked = true;
                break;
            }
        }
    }

    STATE.walls.pop();

    if (!p1CanReach || !p2CanReach) {
        showToast("Yolu tamamen kapatamazsın!", "error");
        return;
    }
    if (powerupsBlocked) {
        showToast("Özelliklerin önü tamamen kapatılamaz!", "error");
        return;
    }

    // Send
    sendMove({ type: 'wall', x, y, orientation: STATE.wallOrientation });
    sounds.play('wall_place');
    setMode('move');
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

function hasPathToCell(sx, sy, tx, ty) {
    // Quick check: if start == target
    if (sx === tx && sy === ty) return true;

    const visited = new Set();
    const queue = [{ x: sx, y: sy }];
    visited.add(`${sx},${sy}`);
    // Standard orthogonal neighbors
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];

    while (queue.length > 0) {
        const curr = queue.shift();
        if (curr.x === tx && curr.y === ty) return true;

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
    scheduleRender();
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

// Legacy stub — actual rendering delegated to GameRenderer via scheduleRender()
function renderBoard() { scheduleRender(); }

function showScreen(name) {
    if (name !== 'gameOver') stopConfetti();
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
}

// --- TEK KİŞİLİK MOD (YAPAY ZEKA) ---

function startAIGame(level) {
    const username = document.getElementById('username-input').value || 'Sen';
    const aiLevel = AI_LEVELS[level] ? level : 'medium';

    // Varsa önceki oyunu temizle
    if (STATE.roomUnsubscribe) { STATE.roomUnsubscribe(); STATE.roomUnsubscribe = null; }
    if (STATE.aiTimer) { clearTimeout(STATE.aiTimer); STATE.aiTimer = null; }
    if (STATE.localRoom) STATE.localRoom.destroy();

    STATE.vsAI = true;
    STATE.aiLevel = aiLevel;
    STATE.aiThinking = false;
    STATE.roomId = 'local-ai';
    STATE.playerId = 'p1';
    STATE.gameActive = false;

    const data = {
        p1: username,
        p2: `Bot (${AI_LEVELS[aiLevel].label})`,
        turn: Math.random() < 0.5 ? 'p1' : 'p2',
        status: 'active',
        boardState: createInitialBoardState()
    };

    STATE.localRoom = new LocalRoom(data);
    startGame(data);
}

function aiSnapshot() {
    return {
        cols: GRID_COLS,
        rows: GRID_ROWS,
        walls: (STATE.walls || []).map(w => ({ x: w.x, y: w.y, type: w.type })),
        powerups: (STATE.powerups || []).map(p => ({ ...p })),
        players: {
            p1: { ...STATE.players.p1, inventory: { ...(STATE.players.p1.inventory || {}) } },
            p2: { ...STATE.players.p2, inventory: { ...(STATE.players.p2.inventory || {}) } }
        },
        timeRemaining: { ...STATE.timeRemaining },
        frozenPlayer: STATE.frozenPlayer || null,
        activeEffects: STATE.activeEffects || {}
    };
}

function maybeRunAI(data) {
    if (!STATE.vsAI || !STATE.gameActive || STATE.aiThinking) return;
    if (data.boardState && data.boardState.winner) return;
    if (data.turn !== AI_PID) return;

    STATE.aiThinking = true;
    STATE.aiTimer = setTimeout(() => {
        STATE.aiTimer = null;
        try {
            aiTakeTurn();
        } catch (e) {
            console.error('AI hatası:', e);
            roomUpdate({ '/turn': STATE.playerId }); // Oyun kilitlenmesin
        } finally {
            STATE.aiThinking = false;
        }
    }, aiThinkDelay(STATE.aiLevel));
}

function aiTakeTurn() {
    if (!STATE.vsAI || !STATE.gameActive || STATE.currentTurn !== AI_PID) return;

    const snapshot = aiSnapshot();
    const { pre, main } = chooseAiAction(snapshot, { pid: AI_PID, level: STATE.aiLevel });

    if (!main) {
        roomUpdate({ '/turn': STATE.playerId });
        return;
    }
    aiApplyAction(snapshot, pre, main);
}

// Yapay zekanın turunu tek bir güncellemede uygular (sendMove'un p2 karşılığı).
function aiApplyAction(snapshot, pre, main) {
    const pid = AI_PID;
    const oppId = pid === 'p1' ? 'p2' : 'p1';
    const updates = {};

    const inv = { ...(STATE.players[pid].inventory || {}) };
    let wallsLeft = (STATE.players[pid].wallsLeft === undefined) ? 8 : STATE.players[pid].wallsLeft;
    let powerups = (STATE.powerups || []).map(p => ({ ...p }));
    let walls = (STATE.walls || []).map(w => ({ ...w }));
    let aiTime = (STATE.timeRemaining && STATE.timeRemaining[pid] !== undefined) ? STATE.timeRemaining[pid] : 90;
    let powerupsChanged = false;
    let wallsChanged = false;
    let freezeApplied = false;
    let winner = null;

    // 1) Sırayı bitirmeyen güçlendirmeler
    for (const action of pre) {
        if (action.powerupType === 'wall' && (inv.wall || 0) > 0) {
            inv.wall = Math.max(0, (inv.wall || 0) - 1);
            wallsLeft += 1;
            showToast('🧱 Yapay zeka +1 duvar kazandı.', 'warning');
        } else if (action.powerupType === 'freeze' && (inv.freeze || 0) > 0) {
            inv.freeze = Math.max(0, (inv.freeze || 0) - 1);
            updates['/boardState/frozenPlayer'] = oppId;
            freezeApplied = true;
            showToast('❄️ Yapay zeka seni dondurdu! Bu tur duvar koyamazsın.', 'error');
        }
    }

    // 2) Asıl hamle
    if (main.type === 'move') {
        let { x, y } = main.to;

        // Oyuncunun "Şaşırtma" etkisi aktifse yapay zekanın hamlesi de sapar.
        if (STATE.activeEffects && STATE.activeEffects[pid] && STATE.activeEffects[pid].chaos) {
            const options = aiValidMoves(snapshot, pid);
            const others = options.filter(m => m.x !== x || m.y !== y);
            const choices = others.length > 0 ? others : options;
            if (choices.length > 0) {
                const rand = choices[Math.floor(Math.random() * choices.length)];
                x = rand.x; y = rand.y;
                showToast('🔀 Şaşırtma işe yaradı! Yapay zeka yolunu şaşırdı.', 'success');
            }
            updates[`/boardState/activeEffects/${pid}/chaos`] = false;
        }
        if (STATE.activeEffects && STATE.activeEffects[pid] && STATE.activeEffects[pid].hourglass) {
            updates[`/boardState/activeEffects/${pid}/hourglass`] = false;
        }

        updates[`/boardState/${pid}/x`] = x;
        updates[`/boardState/${pid}/y`] = y;

        // Güçlendirme topla
        const pIndex = powerups.findIndex(p => p.x === x && p.y === y);
        if (pIndex !== -1) {
            const type = powerups[pIndex].type;
            powerups.splice(pIndex, 1);
            powerupsChanged = true;

            if (type === 'star') {
                ['destroy', 'ghost', 'freeze', 'wall', 'return', 'chaos', 'double_turn', 'hourglass']
                    .forEach(t => { inv[t] = (inv[t] || 0) + 1; });
                showToast('🌟 Yapay zeka efsanevi yıldızı aldı!', 'error');
            } else if (type === 'time_bonus') {
                aiTime += 10;
                showToast('⏱️ Yapay zeka +10 saniye aldı.', 'warning');
            } else {
                inv[type] = (inv[type] || 0) + 1;
                showToast('Yapay zeka bir güçlendirme aldı!', 'warning');
            }
            sounds.play('powerup_collect');
        } else {
            sounds.play('move');
        }

        if (y === 0) winner = pid; // p2 hedefi 0. satır
    } else if (main.type === 'wall') {
        walls.push({ x: main.x, y: main.y, type: main.orientation, owner: pid });
        wallsChanged = true;
        wallsLeft = Math.max(0, wallsLeft - 1);
        sounds.play('wall_place');
    } else if (main.type === 'destroy') {
        walls = walls.filter(w => !(w.x === main.x && w.y === main.y && w.type === main.orientation));
        wallsChanged = true;
        inv.destroy = Math.max(0, (inv.destroy || 0) - 1);
        showToast('💣 Yapay zeka bir duvarı yıktı!', 'warning');
    } else if (main.type === 'activate') {
        if (main.powerupType === 'return') {
            inv.return = Math.max(0, (inv.return || 0) - 1);
            updates[`/boardState/${oppId}/x`] = Math.floor(GRID_COLS / 2);
            updates[`/boardState/${oppId}/y`] = oppId === 'p2' ? GRID_ROWS - 1 : 0;
            showToast('↩️ Yapay zeka seni başlangıca geri gönderdi!', 'error');
        } else if (main.powerupType === 'hourglass') {
            inv.hourglass = Math.max(0, (inv.hourglass || 0) - 1);
            const oppTime = Math.max(0, ((STATE.timeRemaining && STATE.timeRemaining[oppId]) || 90) - 10);
            updates[`/boardState/timeRemaining/${oppId}`] = oppTime;
            showToast('⏳ Yapay zeka süreni 10 saniye azalttı!', 'error');
            if (oppTime <= 0) winner = pid;
        } else if (main.powerupType === 'chaos') {
            inv.chaos = Math.max(0, (inv.chaos || 0) - 1);
            updates[`/boardState/activeEffects/${oppId}/chaos`] = true;
            showToast('🔀 Yapay zeka şaşırtma kullandı! Sıradaki hamlen sapabilir.', 'error');
        }
    }

    // 3) Tur sonu
    updates[`/boardState/${pid}/inventory`] = inv;
    updates[`/boardState/${pid}/wallsLeft`] = wallsLeft;
    updates[`/boardState/timeRemaining/${pid}`] = aiTime;

    // Kendi donmuşluğu bu turda kalkar; ama az önce rakibi dondurduysa onu ezme
    if (STATE.frozenPlayer === pid && !freezeApplied) updates['/boardState/frozenPlayer'] = null;

    if (winner) {
        updates['/boardState/winner'] = winner;
        updates['/status'] = 'finished';
    } else {
        updates['/turn'] = oppId;

        // Güçlendirme doğuşu (çevrimiçi modla aynı olasılık)
        if (powerups.length < 5 && Math.random() < 0.22) {
            const newP = generatePowerup(powerups);
            if (newP) { powerups.push(newP); powerupsChanged = true; }
        }
    }

    if (powerupsChanged) updates['/boardState/powerups'] = powerups;
    if (wallsChanged) updates['/boardState/walls'] = walls;

    stopTurnTimer();
    roomUpdate(updates);
}

// --- FIREBASE ACTIONS ---

// Yeni bir oyunun başlangıç tahtası (oda kurma, rövanş ve tek kişilik mod ortak kullanır)
function createInitialBoardState() {
    return {
        p1: { x: Math.floor(GRID_COLS / 2), y: 0, wallsLeft: 8, inventory: { destroy: 0, ghost: 0, freeze: 0, wall: 0 } },
        p2: { x: Math.floor(GRID_COLS / 2), y: GRID_ROWS - 1, wallsLeft: 8, inventory: { destroy: 0, ghost: 0, freeze: 0, wall: 0 } },
        walls: [],
        powerups: [],
        timeRemaining: { p1: 90, p2: 90 }
    };
}

function resetRoom() {
    if (!STATE.roomId) return;

    // Reset to initial state
    const initialState = {
        ...createInitialBoardState(),
        winner: null // Explicitly clear winner for rematch
    };

    if (STATE.vsAI) {
        STATE.aiThinking = false;
        if (STATE.aiTimer) { clearTimeout(STATE.aiTimer); STATE.aiTimer = null; }
    }

    roomUpdate({
        turn: Math.random() < 0.5 ? 'p1' : 'p2',
        status: 'active', // Ensure status is active
        boardState: initialState
    });

    // Explicitly clear winner if it was set at root or in boardState
    // initialState above clears boardState.winner, but let's be safe about root status.

    showScreen('game');
}

function createRoom(customId = null) {
    STATE.vsAI = false; // Çevrimiçi moda dönüş
    // Ensure customId is a string (and not an Event object from click listeners)
    const validCustomId = (typeof customId === 'string') ? customId : null;
    const roomId = validCustomId || Math.random().toString(36).substring(2, 6).toUpperCase();
    const username = document.getElementById('username-input').value || 'P1';

    const roomRef = ref(db, 'rooms/' + roomId);
    set(roomRef, {
        p1: username,
        turn: Math.random() < 0.5 ? 'p1' : 'p2',
        status: 'waiting',
        boardState: createInitialBoardState()
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

function joinRoom(retryCount = 0) {
    STATE.vsAI = false; // Çevrimiçi moda dönüş
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
                showToast("Bu oda dolu!", "error");
            }
        } else {
            // Retry Mechanism for Invites
            if (retryCount < 5) {
                showToast(`Oda aranıyor... (${retryCount + 1})`);
                setTimeout(() => joinRoom(retryCount + 1), 1000);
            } else {
                showToast("Oda bulunamadı! Kodu kontrol et.", "error");
            }
        }
    }).catch(e => {
        console.error("Join Error:", e);
    });
}



function updateHeader() {
    const p1Time = (STATE.timeRemaining && STATE.timeRemaining.p1 !== undefined) ? STATE.timeRemaining.p1 : 90;
    const p2Time = (STATE.timeRemaining && STATE.timeRemaining.p2 !== undefined) ? STATE.timeRemaining.p2 : 90;

    const p1TimerEl = document.getElementById('p1-timer');
    const p2TimerEl = document.getElementById('p2-timer');

    if (p1TimerEl) {
        p1TimerEl.innerHTML = `<i class="fa-solid fa-hourglass-start"></i> <span>${p1Time}s</span>`;
        p1TimerEl.classList.toggle('low-time', p1Time <= 15);
    }
    if (p2TimerEl) {
        p2TimerEl.innerHTML = `<i class="fa-solid fa-hourglass-start"></i> <span>${p2Time}s</span>`;
        p2TimerEl.classList.toggle('low-time', p2Time <= 15);
    }
}

let turnTimerInterval = null;

function startTurnTimer(activePlayerId) {
    if (turnTimerInterval) clearInterval(turnTimerInterval);
    if (!STATE.gameActive) return;

    // Only run timer for the active player
    turnTimerInterval = setInterval(() => {
        if (STATE.timeRemaining && STATE.timeRemaining[activePlayerId] > 0) {
            STATE.timeRemaining[activePlayerId]--;
            updateHeader();

            // Local timeout check
            if (activePlayerId === STATE.playerId && STATE.timeRemaining[activePlayerId] <= 0) {
                clearInterval(turnTimerInterval);
                sendMove({ type: 'surrender' }); // Auto-surrender on timeout
                showToast("Süre doldu!", "error");
            } else if (STATE.vsAI && activePlayerId === AI_PID && STATE.timeRemaining[activePlayerId] <= 0) {
                // Tek kişilik modda yapay zekanın süresi biterse oyuncu kazanır
                clearInterval(turnTimerInterval);
                if (STATE.aiTimer) { clearTimeout(STATE.aiTimer); STATE.aiTimer = null; }
                STATE.aiThinking = false;
                roomUpdate({ '/boardState/winner': STATE.playerId, '/status': 'finished' });
                showToast("Yapay zekanın süresi doldu!", "success");
            }
        } else {
            clearInterval(turnTimerInterval);
        }
    }, 1000);
}

function stopTurnTimer() {
    if (turnTimerInterval) clearInterval(turnTimerInterval);
}

function startGame(data) {
    if (STATE.roomUnsubscribe) {
        STATE.roomUnsubscribe();
        STATE.roomUnsubscribe = null;
    }
    STATE.gameActive = true;
    STATE.statsRecorded = false;
    STATE.ghostMode = false;
    STATE.startTime = Date.now();
    STATE.moveCount = 0;
    STATE.powerupCount = 0;
    STATE.powerupUsage = {};
    STATE.timeRemaining = { p1: 90, p2: 90 };
    STATE.usedPowerupsInTurn = new Set();

    showScreen('game');
    document.getElementById('p1-name').textContent = (data.p1 || 'P1').split(' ')[0];
    // Yapay zeka adı zorluk bilgisini taşıdığı için kısaltılmaz
    document.getElementById('p2-name').textContent = STATE.vsAI
        ? (data.p2 || 'Bot')
        : (data.p2 || 'P2').split(' ')[0];
    updateHeader();

    // Init / reset renderer
    if (!renderer) {
        initRenderer();
    } else {
        renderer._onResize();
    }
    if (renderer) {
        renderer.setFlipped(STATE.playerId === 'p1');
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

    STATE.roomUnsubscribe = roomSubscribe((snapshot) => {
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

            if (data.boardState.activeEffects) {
                STATE.activeEffects = data.boardState.activeEffects;
            }

            // Sync Timers
            if (data.boardState.timeRemaining) {
                STATE.timeRemaining = data.boardState.timeRemaining;
                updateHeader();
            }

            // Check Winner
            if (data.boardState.winner) {
                console.log("🏆 GAME OVER DETECTED");

                // Stop Timer on Game Over
                stopTurnTimer();

                if (!STATE.statsRecorded && auth.currentUser && !STATE.vsAI) {
                    STATE.statsRecorded = true;
                    const isWin = (data.boardState.winner === STATE.playerId);
                    const opponentName = (STATE.playerId === 'p1') ? (data.p2 || 'Rakip') : (data.p1 || 'Rakip');

                    // Extra Stats Calculation
                    const durationMs = Date.now() - (STATE.startTime || Date.now());
                    const durationSec = Math.floor(durationMs / 1000);
                    const minutes = Math.floor(durationSec / 60);
                    const seconds = durationSec % 60;
                    const durationStr = `${minutes}dk ${seconds}sn`;

                    const myPid = STATE.playerId;
                    const wallsLeft = (STATE.players[myPid].wallsLeft !== undefined) ? STATE.players[myPid].wallsLeft : 8;

                    const extraStats = {
                        duration: durationStr,
                        moves: STATE.moveCount || 0,
                        wallsLeft: wallsLeft,
                        powerups: STATE.powerupCount || 0,
                        powerupUsage: STATE.powerupUsage || {}
                    };

                    updateUserStats(auth.currentUser.uid, isWin, opponentName, extraStats);
                }
                endGame(data.boardState.winner);
            }

            // Migration/Safety: Ensure wallsV/wallsH exist
            ['p1', 'p2'].forEach(pid => {
                if (typeof STATE.players[pid].wallsV === 'undefined') STATE.players[pid].wallsV = 5;
                if (typeof STATE.players[pid].wallsH === 'undefined') STATE.players[pid].wallsH = 5;
                if (typeof STATE.players[pid].hasPowerup === 'undefined') STATE.players[pid].hasPowerup = false;
            });

            STATE.walls = data.boardState.walls || [];
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

        if (STATE.gameActive) {
            updateTurnUI(data.turn);
            checkWin();
            maybeRunAI(data);
        }
    });
}

function sendMove(moveData, endTurn = true) {
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

        // Check WIN Condition on Move
        const isWinP1 = (pid === 'p1' && moveData.to.y === GRID_ROWS - 1);
        const isWinP2 = (pid === 'p2' && moveData.to.y === 0);

        if (isWinP1 || isWinP2) {
            updates['/boardState/winner'] = pid;
            updates['/status'] = 'finished';
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
                } else if (type === 'time_bonus') {
                    // Instant Time Bonus
                    if (STATE.timeRemaining && STATE.timeRemaining[pid] !== undefined) {
                        STATE.timeRemaining[pid] += 10; // Update local state first
                        updates[`/boardState/timeRemaining/${pid}`] = STATE.timeRemaining[pid];
                    }
                } else {
                    updates[`${invPath}/${type}`] = (myInv[type] || 0) + 1;
                }
            }
        }

        if (moveData.consumePowerup) {
            updates[`${invPath}/ghost`] = Math.max(0, (myInv.ghost || 0) - 1);
            STATE.powerupUsage['ghost'] = (STATE.powerupUsage['ghost'] || 0) + 1;
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
        STATE.powerupUsage['destroy'] = (STATE.powerupUsage['destroy'] || 0) + 1;
    } else if (moveData.type === 'activate') {
        // Track Activation
        const type = moveData.powerupType;
        STATE.powerupUsage[type] = (STATE.powerupUsage[type] || 0) + 1;

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
            // NEW RULE: Deduct 10 seconds from opponent
            // Logic: we update the boardState.timeRemaining in Firebase directly.
            updates[`/boardState/timeRemaining/${oppId}`] = Math.max(0, (STATE.timeRemaining[oppId] || 90) - 10);

            updates[`${invPath}/hourglass`] = Math.max(0, (myInv.hourglass || 0) - 1);
            showToast("⌛ Zaman Hırsızı! Rakip 10sn kaybetti.", "warning");

            // Check if this caused a timeout victory
            if ((STATE.timeRemaining[oppId] || 90) - 10 <= 0) {
                updates['/boardState/winner'] = pid;
                updates['/status'] = 'finished';
                showToast("⌛ Rakibin süresi bitti! Kazandın!", "success");
            }
        }
    } else if (moveData.type === 'surrender') {
        updates['/boardState/winner'] = nextTurn;
        updates['/status'] = 'finished';
    }

    let usedDoubleTurn = false;

    if (endTurn) {
        // Stop my timer immediately locally
        stopTurnTimer();

        // Push FINAL time for this turn to server (Sync)
        // Note: STATE.timeRemaining[pid] was ticking down locally.
        updates[`/boardState/timeRemaining/${pid}`] = STATE.timeRemaining[pid];

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

        // Spawn Logic: Max 5 Total (3 Regular + 2 Time)
        if (currentPowerups.length < 5 && Math.random() < 0.22) {
            const newP = generatePowerup(currentPowerups);
            if (newP) {
                currentPowerups.push(newP);
                updates['/boardState/powerups'] = currentPowerups;
            }
        }
    }

    roomUpdate(updates);

    // Only yield turn if we didn't use double_turn
    if (endTurn && !usedDoubleTurn) {
        STATE.isMyTurn = false;
        // updateTurnUI will be called by listener, but we can optimistically stop strict interactions
    }
}

function updateTurnUI(turn) {
    // Reset Powerup Usage Limits ONLY on Turn Change to Me
    if (turn === STATE.playerId && STATE.currentTurn !== STATE.playerId) {
        STATE.usedPowerupsInTurn.clear();
    }

    STATE.currentTurn = turn;
    STATE.isMyTurn = (turn === STATE.playerId);

    const p1Info = document.getElementById('p1-info');
    const p2Info = document.getElementById('p2-info');
    p1Info.classList.toggle('active', turn === 'p1');
    p2Info.classList.toggle('active', turn === 'p2');

    // Start Timer for the active player
    startTurnTimer(turn);
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

        // Hourglass countdown
        let timeLeft = 3;
        if (STATE._hourglassTimer) clearInterval(STATE._hourglassTimer);
        STATE._hourglassTimer = setInterval(() => {
            timeLeft--;
            timerEl.innerText = `⏳ ${timeLeft}`;
            if (!STATE.isMyTurn) {
                clearInterval(STATE._hourglassTimer);
                STATE._hourglassTimer = null;
                timerEl.remove();
                return;
            }
            if (timeLeft < 0) {
                clearInterval(STATE._hourglassTimer);
                STATE._hourglassTimer = null;
                timerEl.remove();
                if (STATE.isMyTurn) {
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
        if (STATE._hourglassTimer) { clearInterval(STATE._hourglassTimer); STATE._hourglassTimer = null; }
    }

    updateWallCounts();
    scheduleRender();
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

// --- TUTORIAL LOGIC ---
const TUTORIAL_CONTENT = {
    goal: {
        title: "Oyunun Amacı",
        desc: "Piyonunu karşı taraftaki son sıraya ulaştıran ilk oyuncu kazanır.",
        icon_html: '<i class="fa-solid fa-flag-checkered"></i>',
        color: '#ffffff'
    },
    movement: {
        title: "Hareket",
        desc: "Sıra sendeyken piyonunu yatay veya dikey yönde bir kare ilerletebilirsin.",
        icon_html: '<i class="fa-solid fa-person-walking"></i>',
        color: '#ffffff'
    },
    wall: {
        title: "Duvar Örme",
        desc: "Rakibini yavaşlatmak için duvar koyabilirsin. Rakibin yolu tamamen kapatılamaz.",
        icon_html: '<i class="fa-solid fa-road"></i>',
        color: '#ffffff'
    },
    destroy: {
        title: "Duvar Kırıcı",
        desc: "Yolundaki herhangi bir duvarı yok etmeni sağlar.",
        icon_html: '<i class="fa-solid fa-bomb"></i>',
        color: '#ef4444'
    },
    ghost: {
        title: "Hayalet Modu",
        desc: "Bir sonraki hamlende duvarların içinden geçebilirsin.",
        icon_html: '<i class="fa-solid fa-ghost"></i>',
        color: '#a855f7'
    },
    freeze: {
        title: "Dondurucu",
        desc: "Rakibin bir sonraki turda duvar koymasını engeller.",
        icon_html: '<i class="fa-solid fa-snowflake"></i>',
        color: '#0ea5e9'
    },
    wall_plus: {
        title: "+1 Duvar",
        desc: "Envanterine ekstra bir duvar ekler.",
        icon_html: '<i class="fa-solid fa-plus-square"></i>',
        color: '#f97316'
    },
    return: {
        title: "Geri Sar",
        desc: "Rakibi başlangıç noktasına geri gönderir.",
        icon_html: '<i class="fa-solid fa-undo"></i>',
        color: '#10b981'
    },
    chaos: {
        title: "Kaos",
        desc: "Rakip bir sonraki hamlesinde rastgele bir yöne hareket eder.",
        icon_html: '<i class="fa-solid fa-shuffle"></i>',
        color: '#d946ef'
    },
    double_turn: {
        title: "Çift Hamle",
        desc: "Sıra tekrar sana geçer, arka arkaya iki hamle yaparsın.",
        icon_html: '<i class="fa-solid fa-repeat"></i>',
        color: '#eab308'
    },
    hourglass: {
        title: "Kum Saati",
        desc: "Rakibin toplam süresinden 10 saniye siler.",
        icon_html: '<i class="fa-solid fa-hourglass-half"></i>',
        color: '#b45309'
    },
    star: {
        title: "Yıldız Gücü",
        desc: "Çok nadirdir. Alındığında diğer tüm güçlerden birer adet kazandırır.",
        icon_html: '<i class="fa-solid fa-star tutorial-pulse"></i>',
        color: '#ffd700'
    }
};

function openTutorial() {
    const modal = document.getElementById('tutorial-modal');
    renderTutorial();
    // Select first item by default
    updateTutorialInfo('movement');
    modal.classList.remove('hidden');
}

function closeTutorial() {
    document.getElementById('tutorial-modal').classList.add('hidden');
}

function renderTutorial() {
    const grid = document.getElementById('tutorial-grid');
    grid.innerHTML = ''; // Clear

    Object.keys(TUTORIAL_CONTENT).forEach(key => {
        const item = TUTORIAL_CONTENT[key];
        const el = document.createElement('div');
        el.className = 'tutorial-icon';
        el.innerHTML = item.icon_html;
        el.style.color = item.color;

        if (key === 'movement') el.classList.add('selected'); // Default active styling

        el.addEventListener('click', () => {
            // Update active state
            document.querySelectorAll('.tutorial-icon').forEach(i => i.classList.remove('selected'));
            el.classList.add('selected');
            updateTutorialInfo(key);
        });

        grid.appendChild(el);
    });
}

function updateTutorialInfo(key) {
    const item = TUTORIAL_CONTENT[key];
    document.getElementById('tutorial-title').textContent = item.title;
    document.getElementById('tutorial-desc').textContent = item.desc;

    const preview = document.getElementById('tutorial-preview-icon');
    preview.innerHTML = item.icon_html;
    preview.style.color = item.color;

    // ADDED: "Öğren" Button logic
    let learnBtn = document.getElementById('tutorial-learn-btn');
    if (!learnBtn) {
        learnBtn = document.createElement('button');
        learnBtn.id = 'tutorial-learn-btn';
        learnBtn.className = 'btn primary';
        learnBtn.style.width = '100%';
        learnBtn.style.marginTop = '1.5rem';
        learnBtn.style.display = 'flex';
        learnBtn.style.justifyContent = 'center';
        learnBtn.style.alignItems = 'center';
        learnBtn.style.gap = '8px';
        learnBtn.innerHTML = '<span>Öğren & Dene</span> <i class="fa-solid fa-gamepad"></i>';

        // Append after desc
        const descEl = document.getElementById('tutorial-desc');
        descEl.parentNode.appendChild(learnBtn);
    }

    // Update Click Listener
    // Clone to remove old listeners or just set onclick
    learnBtn.onclick = () => {
        window.location.href = `howto.html?topic=${key}`;
    };
}

// Tutorial Event Listeners (Add to setupListeners or here safely)
// We need to attach these once DOM is ready, init does setupEventListeners.
// Let's modify init/setupEventListeners to call a helper or attach directly if elements exist.
// Since this is global scope, I can't guarantee DOM ready unless I hook into setupEventListeners.
// I'll add hook in init or modifying setupEventListeners. 
// Easier: Just append to setupEventListeners via a replacement or add a new block. 
// I'll add a separate helper execution inside init.

function setupTutorialListeners() {
    const openBtn = document.getElementById('open-tutorial-btn');
    const closeBtn = document.getElementById('close-tutorial-btn');

    if (openBtn) openBtn.addEventListener('click', openTutorial);
    if (closeBtn) closeBtn.addEventListener('click', closeTutorial);

    // Also close on background click
    const modal = document.getElementById('tutorial-modal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeTutorial();
        });
    }
}

// Start
// Start
init();


// --- STATS LOGIC ---
async function updateUserStats(uid, isWin, opponentName, extraStats = {}) {
    try {
        const statsRef = ref(db, `users/${uid}/stats`);
        const historyRef = ref(db, `match_history/${uid}`);

        // 1. Get Current Stats
        const snapshot = await get(statsRef);
        let stats = snapshot.val() || { wins: 0, losses: 0, powerupUsage: {} };

        if (isWin) stats.wins++;
        else stats.losses++;

        // Merge Powerup Usage
        if (extraStats.powerupUsage) {
            if (!stats.powerupUsage) stats.powerupUsage = {};
            for (const [type, count] of Object.entries(extraStats.powerupUsage)) {
                stats.powerupUsage[type] = (stats.powerupUsage[type] || 0) + count;
            }
        }

        // 2. Update Stats
        await set(statsRef, stats);

        // 3. Add History
        const matchData = {
            opponentName: opponentName,
            result: isWin ? 'win' : 'loss',
            timestamp: Date.now(),
            ...extraStats
        };

        await push(historyRef, matchData);

        console.log("Stats Updated:", stats);
        showToast(`İstatistikler Kaydedildi! (${isWin ? 'Galibiyet' : 'Mağlubiyet'})`, "success");
    } catch (e) {
        console.error("Stats Update Error:", e);
        showToast("İstatistik Kayıt Hatası: " + e.message, "error");
    }
}

// --- GLOBAL NOTIFICATIONS ---
function listenForInvites(uid) {
    const invitesRef = ref(db, `users/${uid}/gameInvites`);
    onValue(invitesRef, (snapshot) => {
        const invites = snapshot.val();
        if (!invites) return;

        const inviteArray = Object.entries(invites).sort((a, b) => b[1].timestamp - a[1].timestamp);
        if (inviteArray.length === 0) return;

        const [inviterUid, inviteData] = inviteArray[0];
        // Clean up old invites (> 60 sec)
        if (Date.now() - inviteData.timestamp > 60000) return;

        showModal(
            "🎮 Oyun Daveti",
            `${inviteData.inviterName} seni maça davet ediyor!`,
            () => {
                // Accept
                set(ref(db, `users/${uid}/gameInvites/${inviterUid}`), null);
                window.location.href = `index.html?room=${inviteData.roomId}&join=true`;
            },
            () => {
                // Reject
                set(ref(db, `users/${uid}/gameInvites/${inviterUid}`), null);
                showToast("Davet reddedildi.");
            }
        );
    });
}


