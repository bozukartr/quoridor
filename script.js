
// Import Firebase functions
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, set, onValue, update, push, child, get } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

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
const GRID_COLS = 7;
const GRID_ROWS = 10;
const STATE = {
    roomId: null,
    playerId: null, // 'p1' (Blue) or 'p2' (Red)
    isMyTurn: false,
    mode: 'move', // 'move' or 'wall'
    wallOrientation: 'vertical', // 'vertical' or 'horizontal'
    board: [],
    players: {
        p1: { x: Math.floor(GRID_COLS / 2), y: 0, wallsLeft: 10 },
        p2: { x: Math.floor(GRID_COLS / 2), y: GRID_ROWS - 1, wallsLeft: 10 }
    },
    walls: [], // Array of {x, y, type}
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

    // Game Controls
    controls.moveBtn.addEventListener('click', () => setMode('move'));
    controls.wallBtn.addEventListener('click', () => setMode('wall'));
    controls.rotateBtn.addEventListener('click', toggleOrientation);
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

    if (STATE.wallOrientation === 'vertical') {
        // If clicked on left half, target is actually the cell to the left
        if (offsetX < rect.width / 2) {
            targetX = x - 1;
        }
    } else {
        // If clicked on top half, target is actually the cell above
        if (offsetY < rect.height / 2) {
            targetY = y - 1;
        }
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
    } else {
        controls.rotateBtn.classList.add('hidden');
    }
    renderValidMoves(); // Re-render to show/hide highlights
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

    // Calculate precise target
    if (actionType === 'wall' && e) {
        const rect = e.target.getBoundingClientRect();
        const offsetX = e.clientX - rect.left;
        const offsetY = e.clientY - rect.top;

        if (orientation === 'vertical') {
            if (offsetX < rect.width / 2) targetX = x - 1;
        } else {
            if (offsetY < rect.height / 2) targetY = y - 1;
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
        if (actionType === 'move') {
            // Basic Check: Is adjacent?
            const me = STATE.players[STATE.playerId];
            const dx = Math.abs(targetX - me.x);
            const dy = Math.abs(targetY - me.y);
            // Also Check if blocked
            if (dx + dy === 1 && !isBlockedByWall(me.x, me.y, targetX, targetY)) {
                isValid = true;
                // Check collision with opponent
                const opp = STATE.players[STATE.playerId === 'p1' ? 'p2' : 'p1'];
                if (targetX === opp.x && targetY === opp.y) isValid = false;
            }
        } else {
            // Check wall bounds
            isValid = true;
            if (orientation === 'vertical' && targetX >= GRID_COLS - 1) isValid = false;
            if (orientation === 'horizontal' && targetY >= GRID_ROWS - 1) isValid = false;
            // Check overlap
            const exists = STATE.walls.some(w => w.x === targetX && w.y === targetY && w.type === orientation);
            if (exists) isValid = false;
        }

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

function tryMove(targetX, targetY) {
    const me = STATE.players[STATE.playerId];

    // Check adjacency
    const dx = Math.abs(targetX - me.x);
    const dy = Math.abs(targetY - me.y);
    if (dx + dy !== 1) return; // Not adjacent

    // Check collision with opponent (cannot occupy same square)
    const opponentId = STATE.playerId === 'p1' ? 'p2' : 'p1';
    const opponent = STATE.players[opponentId];
    if (targetX === opponent.x && targetY === opponent.y) return;

    // Check walls blocking path
    if (isBlockedByWall(me.x, me.y, targetX, targetY)) {
        showToast("Yol kapalı!", "error");
        return;
    }

    // Update Local State for feedback (optimistic)
    updatePlayerPos(STATE.playerId, targetX, targetY);

    // Send to Firebase
    sendMove({ type: 'move', from: { x: me.x, y: me.y }, to: { x: targetX, y: targetY } });
}

function isBlockedByWall(x1, y1, x2, y2) {
    // Logic: check if a wall exists between these two cells
    // Wall types: 'v' (vertical, right of cell), 'h' (horizontal, bottom of cell)
    // IMPORTANT: Simplification -> Wall coords are typically defined by top-left cell reference

    for (const w of STATE.walls) {
        if (w.type === 'vertical') {
            // Blocks horizontal movement between (w.x, w.y) and (w.x+1, w.y)
            // AND ALSO (w.x, w.y+1) and (w.x+1, w.y+1) because walls are 2 units long usually in Quoridor
            // BUT for this simplified 10x10 grid instructions say "gridler arası duvar".
            // Let's assume walls are 1 unit length for higher granularity or 2?
            // User prompt: "gridler arası dikey ya da yatay bir duvar örer". Not specifying length.
            // I will implement 1-unit walls for simplicity on mobile 10x10.

            // Vertical wall at w.x, w.y blocks passage between (w.x, w.y) and (w.x+1, w.y)
            if (y1 === w.y && y2 === w.y) { // Moving on same row
                if ((x1 === w.x && x2 === w.x + 1) || (x1 === w.x + 1 && x2 === w.x)) {
                    return true;
                }
            }
        } else { // Horizontal
            // Blocks vertical movement between (w.x, w.y) and (w.x, w.y+1)
            if (x1 === w.x && x2 === w.x) { // Moving on same col
                if ((y1 === w.y && y2 === w.y + 1) || (y1 === w.y + 1 && y2 === w.y)) {
                    return true;
                }
            }
        }
    }
    return false;
}

function tryPlaceWall(x, y) {
    // Wall logic: Place wall at current cell's Right (vertical) or Bottom (horizontal)
    // Limits: Cannot go out of bounds

    if (STATE.wallOrientation === 'vertical') {
        if (x >= GRID_COLS - 1) return; // Cannot place right of last col
    } else {
        if (y >= GRID_ROWS - 1) return; // Cannot place bottom of last row
    }

    // Check if wall exists
    // Check if wall exists
    const exists = STATE.walls.some(w => w.x === x && w.y === y && w.type === STATE.wallOrientation);
    if (exists) {
        showToast("Burada zaten duvar var!", "error");
        return;
    }

    // TODO: Path validation (A* or BFS check if goal is reachable) - skipping for MVP speed

    // Send
    sendMove({ type: 'wall', x, y, orientation: STATE.wallOrientation });
}

function updatePlayerPos(pid, x, y) {
    STATE.players[pid].x = x;
    STATE.players[pid].y = y;
    renderBoard();
    checkWin();
}

function addWall(x, y, type) {
    STATE.walls.push({ x, y, type });
    renderBoard();
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

// --- RENDERING ---
function renderBoard() {
    // Clear moving elements (players) and walls from cells
    document.querySelectorAll('.player, .wall').forEach(e => e.remove());
    document.querySelectorAll('.cell').forEach(c => {
        c.classList.remove('valid-move');
        c.classList.remove('pending-move');
        // Clear any leftover children if necessary, but we are removing by selector above
    });

    // Render Players
    renderPlayer('p1');
    renderPlayer('p2');

    // Render Walls
    STATE.walls.forEach(w => {
        const cell = document.querySelector(`.cell[data-x="${w.x}"][data-y="${w.y}"]`);
        if (cell) {
            const wall = document.createElement('div');
            wall.className = `wall ${w.type}`;
            cell.appendChild(wall);
        }
    });

    // Render Pending Action (Selection)
    if (STATE.pendingAction) {
        if (STATE.pendingAction.type === 'wall') {
            const pa = STATE.pendingAction;
            const cell = document.querySelector(`.cell[data-x="${pa.x}"][data-y="${pa.y}"]`);
            if (cell) {
                const wall = document.createElement('div');
                wall.className = `wall ${pa.orientation} pending`;
                cell.appendChild(wall);
            }
        } else if (STATE.pendingAction.type === 'move') {
            // Maybe highlight the cell differently?
            const pa = STATE.pendingAction;
            const cell = document.querySelector(`.cell[data-x="${pa.x}"][data-y="${pa.y}"]`);
            if (cell) cell.classList.add('pending-move');
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
    const moves = [
        { x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }
    ];

    moves.forEach(dir => {
        const nx = me.x + dir.x;
        const ny = me.y + dir.y;

        if (nx >= 0 && nx < GRID_COLS && ny >= 0 && ny < GRID_ROWS) {
            if (!isBlockedByWall(me.x, me.y, nx, ny)) {
                // Check opponent collision
                const opp = STATE.players[STATE.playerId === 'p1' ? 'p2' : 'p1'];
                if (nx !== opp.x || ny !== opp.y) {
                    const cell = document.querySelector(`.cell[data-x="${nx}"][data-y="${ny}"]`);
                    if (cell) cell.classList.add('valid-move');
                }
            }
        }
    });
}

// --- FIREBASE ACTIONS ---

function resetRoom() {
    if (!STATE.roomId) return;

    // Reset to initial state
    const initialState = {
        p1: { x: Math.floor(GRID_COLS / 2), y: 0, wallsLeft: 10 },
        p2: { x: Math.floor(GRID_COLS / 2), y: GRID_ROWS - 1, wallsLeft: 10 },
        walls: []
    };

    const roomRef = ref(db, 'rooms/' + STATE.roomId);
    update(roomRef, {
        turn: 'p1',
        boardState: initialState
        // We don't change status, it remains 'active'
    });

    // Local update will happen via listener, but we can force screen
    showScreen('game');
}

function createRoom() {
    // Generate Room ID (random 4 chars)
    const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
    const username = document.getElementById('username-input').value || 'P1';

    // Set initial state
    const roomRef = ref(db, 'rooms/' + roomId);
    set(roomRef, {
        p1: username,
        turn: 'p1',
        status: 'waiting',
        boardState: {
            p1: { x: Math.floor(GRID_COLS / 2), y: 0 },
            p2: { x: Math.floor(GRID_COLS / 2), y: GRID_ROWS - 1 },
            walls: []
        }
    });

    STATE.roomId = roomId;
    STATE.playerId = 'p1';

    showScreen('waiting');
    document.getElementById('display-room-code').textContent = roomId;

    // Listen for join
    onValue(roomRef, (snapshot) => {
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
                // Join
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
    STATE.gameActive = true;
    showScreen('game');
    document.getElementById('p1-name').textContent = data.p1;
    document.getElementById('p2-name').textContent = data.p2;
    listenGameLoop();
    updateTurnUI(data.turn);
}

function listenGameLoop() {
    const roomRef = ref(db, 'rooms/' + STATE.roomId);
    onValue(roomRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) return;

        // Sync State
        if (data.boardState) {
            STATE.players.p1 = data.boardState.p1;
            STATE.players.p2 = data.boardState.p2;
            STATE.walls = data.boardState.walls || [];
        }

        if (data.status === 'active') {
            // Logic to auto-restart if we are in Game Over but game is continuing
            if (!STATE.gameActive && document.getElementById('game-over-screen').classList.contains('active')) {
                // Check if it looks like a new game (no walls, start pos)?
                // Or just trust 'active' status + board update?
                // Simple: If board seems reset (no walls), pull back to game.
                if (STATE.walls.length === 0) {
                    STATE.gameActive = true;
                    showScreen('game');
                }
            } else if (!STATE.gameActive) {
                startGame(data);
            }
        }

        updateTurnUI(data.turn);
        renderBoard();
        checkWin(); // Check remote win
    });
}

function sendMove(moveData) {
    // moveData: { type: 'move'|'wall', ... }
    const roomRef = ref(db, 'rooms/' + STATE.roomId);
    const nextTurn = STATE.playerId === 'p1' ? 'p2' : 'p1';

    // Apply move locally to object before sending to ensure format
    const updates = {};
    updates['/turn'] = nextTurn;

    if (moveData.type === 'move') {
        updates[`/boardState/${STATE.playerId}`] = moveData.to;
    } else if (moveData.type === 'wall') {
        // Retrieve current walls, push new one
        // Firebase list handling is tricky with loose indices, better read-modify-write or use push keys.
        // For simple sync, we'll read current STATE walls (which are synced) + new one
        // But concurrency might be an issue. However, it's turn based.
        const newWalls = [...STATE.walls, { x: moveData.x, y: moveData.y, type: moveData.orientation }];
        updates['/boardState/walls'] = newWalls;
    }

    update(roomRef, updates);
    STATE.isMyTurn = false;
    updateTurnUI(nextTurn);
}

function updateTurnUI(turn) {
    STATE.isMyTurn = (turn === STATE.playerId);
    const statusDiv = document.getElementById('game-status');
    const p1Info = document.getElementById('p1-info');
    const p2Info = document.getElementById('p2-info');

    if (STATE.isMyTurn) {
        statusDiv.textContent = "SIRA SENDE";
        statusDiv.style.background = "rgba(59, 130, 246, 0.4)";
    } else {
        statusDiv.textContent = "RAKİP BEKLENİYOR";
        statusDiv.style.background = "rgba(255, 255, 255, 0.1)";
    }

    p1Info.classList.toggle('active-turn', turn === 'p1');
    p2Info.classList.toggle('active-turn', turn === 'p2');

    renderBoard(); // Re-render to update move highlights
}

function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
}

// Start
init();
