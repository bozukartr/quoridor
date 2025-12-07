
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
    powerup: null, // {x, y}
    walls: [], // Array of {x, y, type} (x,y = Gap Coordinates)
    gameActive: false,
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
        if (confirm('Rakibi dondurmak (duvar koyamaz) istiyor musunuz?')) {
            sendMove({ type: 'activate', powerupType: 'freeze' }, false);
            showToast('❄️ Rakip donduruldu!');
        }
    } else if (type === 'wall') {
        sendMove({ type: 'activate', powerupType: 'wall' }, false);
        showToast('🧱 +1 Duvar kazandınız!');
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

const POWERUPS = ['destroy', 'ghost', 'freeze', 'wall'];

function generatePowerup() {
    // Random Type
    const type = POWERUPS[Math.floor(Math.random() * POWERUPS.length)];
    // Random Pos (Anywhere)
    return {
        x: Math.floor(Math.random() * GRID_COLS),
        y: Math.floor(Math.random() * GRID_ROWS),
        type: type
    };
}

function toggleOrientation() {
    STATE.wallOrientation = STATE.wallOrientation === 'vertical' ? 'horizontal' : 'vertical';
    controls.orientationSpan.textContent = STATE.wallOrientation === 'vertical' ? 'Dikey' : 'Yatay';
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
    let pickupPowerup = false;
    if (STATE.powerup && targetX === STATE.powerup.x && targetY === STATE.powerup.y) {
        pickupPowerup = true;
        const type = STATE.powerup.type;
        const names = { destroy: 'Duvar Kırıcı 💣', ghost: 'Hayalet Modu 👻', freeze: 'Dondurucu ❄️', wall: '+1 Duvar 🧱' };
        showToast(`${names[type] || 'Powerup'} Alındı!`, "success");
    }

    // Optimistic Update
    updatePlayerPos(STATE.playerId, targetX, targetY);

    // Send
    const consumePowerup = STATE.ghostMode;
    sendMove({ type: 'move', to: { x: targetX, y: targetY }, pickupPowerup, consumePowerup });

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

function endGame(winnerId) {
    STATE.gameActive = false;
    document.getElementById('winner-text').textContent = winnerId === STATE.playerId ? "KAZANDIN!" : "KAYBETTİN...";
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

    // 7. Render Powerup
    if (STATE.powerup) {
        const cell = document.querySelector(`.cell[data-x="${STATE.powerup.x}"][data-y="${STATE.powerup.y}"]`);
        if (cell) {
            const types = {
                destroy: { icon: 'fa-bomb', color: '#ef4444' },
                ghost: { icon: 'fa-ghost', color: '#a855f7' },
                freeze: { icon: 'fa-snowflake', color: '#0ea5e9' },
                wall: { icon: 'fa-plus-square', color: '#f97316' }
            };
            const p = types[STATE.powerup.type] || types.destroy;

            const el = document.createElement('div');
            el.innerHTML = `<i class="fa-solid ${p.icon}" style="color: ${p.color}; font-size: 1.2rem; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));"></i>`;
            el.style.position = 'absolute';
            el.style.top = '50%';
            el.style.left = '50%';
            el.style.transform = 'translate(-50%, -50%)';
            el.style.zIndex = '8';
            el.className = 'powerup-icon';
            cell.appendChild(el);
        }
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

// --- FIREBASE ACTIONS ---

function resetRoom() {
    if (!STATE.roomId) return;

    // Reset to initial state
    const initialState = {
        p1: { x: Math.floor(GRID_COLS / 2), y: 0, wallsLeft: 10, inventory: { destroy: 0, ghost: 0, freeze: 0, wall: 0 } },
        p2: { x: Math.floor(GRID_COLS / 2), y: GRID_ROWS - 1, wallsLeft: 10, inventory: { destroy: 0, ghost: 0, freeze: 0, wall: 0 } },
        walls: [],
        powerup: generatePowerup()
    };

    const roomRef = ref(db, 'rooms/' + STATE.roomId);
    update(roomRef, {
        turn: 'p1',
        boardState: initialState
    });

    showScreen('game');
}

function createRoom() {
    const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
    const username = document.getElementById('username-input').value || 'P1';

    const roomRef = ref(db, 'rooms/' + roomId);
    set(roomRef, {
        p1: username,
        turn: 'p1',
        status: 'waiting',
        boardState: {
            p1: { x: Math.floor(GRID_COLS / 2), y: 0, wallsLeft: 10, inventory: { destroy: 0, ghost: 0, freeze: 0, wall: 0 } },
            p2: { x: Math.floor(GRID_COLS / 2), y: GRID_ROWS - 1, wallsLeft: 10, inventory: { destroy: 0, ghost: 0, freeze: 0, wall: 0 } },
            walls: [],
            powerup: generatePowerup()
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

            // Migration/Safety: Ensure wallsV/wallsH exist
            ['p1', 'p2'].forEach(pid => {
                if (typeof STATE.players[pid].wallsV === 'undefined') STATE.players[pid].wallsV = 5;
                if (typeof STATE.players[pid].wallsH === 'undefined') STATE.players[pid].wallsH = 5;
                if (typeof STATE.players[pid].hasPowerup === 'undefined') STATE.players[pid].hasPowerup = false;
            });

            STATE.walls = data.boardState.walls || [];
            STATE.powerup = data.boardState.powerup || null;
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

    const updates = {};
    if (endTurn) {
        updates['/turn'] = nextTurn;

        if (STATE.frozenPlayer === STATE.playerId) {
            updates['/boardState/frozenPlayer'] = null;
        }

        if (!STATE.powerup && Math.random() < 0.1) {
            updates['/boardState/powerup'] = generatePowerup();
        }
    }

    const pid = STATE.playerId;
    // Default inventory fallback
    const myInv = STATE.players[pid].inventory || { destroy: 0, ghost: 0, freeze: 0, wall: 0 };
    const invPath = `/boardState/${pid}/inventory`;

    if (moveData.type === 'move') {
        updates[`/boardState/${pid}/x`] = moveData.to.x;
        updates[`/boardState/${pid}/y`] = moveData.to.y;

        if (moveData.pickupPowerup && STATE.powerup) {
            updates[`/boardState/powerup`] = null;
            const type = STATE.powerup.type;
            updates[`${invPath}/${type}`] = (myInv[type] || 0) + 1;
        }

        if (moveData.consumePowerup) {
            updates[`${invPath}/ghost`] = Math.max(0, (myInv.ghost || 0) - 1);
        }
    } else if (moveData.type === 'wall') {
        const newWalls = [...STATE.walls, { x: moveData.x, y: moveData.y, type: moveData.orientation, owner: STATE.playerId }];
        updates['/boardState/walls'] = newWalls;

        const pState = STATE.players[pid];
        const currentWalls = (pState.wallsLeft === undefined) ? 10 : pState.wallsLeft;
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
            const pState = STATE.players[pid];
            const currentWalls = (pState.wallsLeft === undefined) ? 10 : pState.wallsLeft;
            updates[`/boardState/${pid}/wallsLeft`] = currentWalls + 1;
            updates[`${invPath}/wall`] = Math.max(0, (myInv.wall || 0) - 1);
        }
    }

    update(roomRef, updates);
    if (endTurn) {
        STATE.isMyTurn = false;
        updateTurnUI(nextTurn);
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
    if (me && me.inventory) {
        const types = ['destroy', 'ghost', 'freeze', 'wall'];
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

    updateWallCounts();
    renderBoard();
}

function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
}

// Start
init();

