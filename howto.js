
const GRID_ROWS = 9;
const GRID_COLS = 7;

// --- STATE MIRROR ---
let STATE = {
    playerId: 'p1', // User is always P1 (Blue)
    isMyTurn: true, // Always true for tutorial mostly
    mode: 'move',
    wallOrientation: 'horizontal',
    walls: [],
    players: {
        p1: { x: 3, y: 8, wallsLeft: 10 },
        p2: { x: 3, y: 0, wallsLeft: 10 }
    },
    pendingAction: null,
    lesson: null,
    step: 0,
    activeEffects: { p1: {}, p2: {} },
    ghostMode: false
};

// --- DOM ELEMENTS ---
const gridBoard = document.getElementById('grid-board');
const instructionText = document.getElementById('instruction-text');
const lessonTitle = document.getElementById('lesson-title');
const progressBar = document.getElementById('progress-bar');
const progressFill = document.getElementById('progress-fill');
const successModal = document.getElementById('success-modal');

// --- LESSON DATA ---
const LESSONS = {
    movement: {
        title: "Hareket Etme",
        steps: [
            {
                text: "Piyonunu (Mavi) bir kare ileri, geri, sağa veya sola hareket ettirebilirsin. Hadi, piyonunu bir kare ileri (yukarı) taşı.",
                goal: 'move',
                target: { x: 3, y: 7 },
                setup: { p1: { x: 3, y: 8 }, p2: { x: 3, y: 0 } }
            }
        ]
    },
    wall: {
        title: "Duvar Örme",
        steps: [
            {
                text: "Duvar moduna geçmek için aşağıdaki Duvar butonuna tıkla.",
                goal: 'mode_switch',
                mode: 'wall',
                setup: { p1: { x: 3, y: 8 }, p2: { x: 3, y: 0 } }
            },
            {
                text: "Şimdi haritada herhangi bir yere yatay bir duvar yerleştir. (Duvarlar iki kare uzunluğundadır).",
                goal: 'place_wall',
                orientation: 'horizontal'
            },
            {
                text: "Harika! Duvar yönünü değiştirmek için döndürme butonuna bas.",
                goal: 'rotate_wall'
            },
            {
                text: "Şimdi dikey bir duvar yerleştir.",
                goal: 'place_wall',
                orientation: 'vertical'
            }
        ]
    },
    destroy: {
        title: "Duvar Kırıcı (Powerup)",
        steps: [
            {
                text: "Rakibin önünü kapattı! Neyse ki 'Duvar Kırıcı' gücün var. Aşağıdaki Bomba ikonuna tıkla.",
                goal: 'powerup_activate',
                powerup: 'destroy',
                setup: {
                    p1: { x: 3, y: 8 },
                    p2: { x: 3, y: 0 },
                    walls: [{ x: 3, y: 7, type: 'horizontal' }]
                }
            },
            {
                text: "Şimdi kırmak istediğin duvarın üzerine tıkla. (Duvarın merkezine)",
                goal: 'destroy_wall',
                mode: 'destroy'
            }
        ]
    },
    ghost: {
        title: "Hayalet Modu (Powerup)",
        steps: [
            {
                text: "Duvarlar seni durduramaz! Hayalet Modu ile duvarların içinden geçebilirsin. Aşağıdaki Hayalet ikonuna tıkla.",
                goal: 'powerup_activate',
                powerup: 'ghost',
                setup: {
                    p1: { x: 3, y: 8 },
                    p2: { x: 3, y: 0 },
                    walls: [{ x: 3, y: 7, type: 'horizontal' }]
                }
            },
            {
                text: "Şimdi duvarın arkasındaki kareye tıkla ve içinden geç!",
                goal: 'move',
                target: { x: 3, y: 7 },
                ghostMode: true
            }
        ]
    }
};

// --- INIT ---
function init() {
    const params = new URLSearchParams(window.location.search);
    const topic = params.get('topic') || 'movement';

    // Controls
    document.getElementById('move-mode-btn').addEventListener('click', () => setMode('move'));
    document.getElementById('wall-mode-btn').addEventListener('click', () => setMode('wall'));
    document.getElementById('wall-rotate-btn').addEventListener('click', toggleOrientation);
    document.getElementById('back-btn').addEventListener('click', () => window.history.back());
    document.getElementById('finish-btn').addEventListener('click', () => window.location.href = 'index.html');

    // Powerups
    document.getElementById('btn-destroy').addEventListener('click', () => activatePowerup('destroy'));
    document.getElementById('btn-ghost').addEventListener('click', () => activatePowerup('ghost'));

    // SYNC INITIAL UI
    const orientationSpan = document.getElementById('wall-orientation');
    if (orientationSpan) {
        orientationSpan.textContent = STATE.wallOrientation === 'vertical' ? 'Dikey' : 'Yatay';
    }

    generateGrid();
    loadLesson(topic);

    // Resize Listener
    window.addEventListener('resize', () => {
        renderBoard();
    });
}

function loadLesson(key) {
    const lessonData = LESSONS[key] || LESSONS['movement'];
    STATE.lesson = lessonData;
    STATE.step = 0;
    lessonTitle.textContent = lessonData.title;

    // Apply Setup
    const step0 = lessonData.steps[0];
    if (step0.setup) {
        STATE.players.p1 = { ...STATE.players.p1, ...step0.setup.p1 };
        STATE.players.p2 = { ...STATE.players.p2, ...step0.setup.p2 };
        if (step0.setup.walls) {
            STATE.walls = step0.setup.walls.map(w => ({ ...w }));
        } else {
            STATE.walls = [];
        }
    } else {
        STATE.walls = [];
    }
    STATE.pendingAction = null;
    STATE.ghostMode = false;
    setMode('move');

    // Show Powerups if needed
    const pContainer = document.getElementById('tutorial-powerups');
    const btnDestroy = document.getElementById('btn-destroy');
    const btnGhost = document.getElementById('btn-ghost');

    pContainer.style.display = 'none';
    btnDestroy.classList.add('hidden');
    btnGhost.classList.add('hidden');

    if (key === 'destroy') {
        pContainer.style.display = 'flex';
        btnDestroy.classList.remove('hidden');
    } else if (key === 'ghost') {
        pContainer.style.display = 'flex';
        btnGhost.classList.remove('hidden');
    }

    renderStep();
    renderBoard();
}

function renderStep() {
    const stepData = STATE.lesson.steps[STATE.step];
    instructionText.textContent = stepData.text;
    const pct = ((STATE.step) / STATE.lesson.steps.length) * 100;
    progressFill.style.width = `${pct}%`;

    // Highlight controls
    const wBtn = document.getElementById('wall-mode-btn');
    const rBtn = document.getElementById('wall-rotate-btn');
    const dBtn = document.getElementById('btn-destroy');
    const gBtn = document.getElementById('btn-ghost');

    // Reset ALL states
    wBtn.classList.remove('pulse');
    rBtn.classList.remove('pulse');
    dBtn.classList.remove('active'); // Use generic active
    gBtn.classList.remove('active');

    if (stepData.goal === 'mode_switch') wBtn.classList.add('pulse');
    if (stepData.goal === 'rotate_wall') rBtn.classList.add('pulse');
    if (stepData.goal === 'powerup_activate') {
        if (stepData.powerup === 'destroy') dBtn.classList.add('active'); // Will color icon red
        if (stepData.powerup === 'ghost') gBtn.classList.add('active'); // Will color icon purple
    }
}

function activatePowerup(type) {
    const currentStep = STATE.lesson.steps[STATE.step];
    // Allow activation only if goal matches
    if (currentStep.goal === 'powerup_activate' && currentStep.powerup === type) {
        if (type === 'destroy') {
            setMode('destroy');
        } else if (type === 'ghost') {
            STATE.ghostMode = true;
            setMode('move');
        }
        nextStep();
    }
}

function nextStep() {
    STATE.step++;
    if (STATE.step >= STATE.lesson.steps.length) {
        progressFill.style.width = '100%';
        instructionText.textContent = "Ders Tamamlandı!";
        setTimeout(() => successModal.classList.remove('hidden'), 500);
    } else {
        renderStep();
        renderBoard();
    }
}

// --- CORE ENGINE (PORTED) ---
function generateGrid() {
    gridBoard.innerHTML = '';
    // Use CSS Variable for size
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

function renderBoard() {
    // 1. Clear moving elements
    gridBoard.querySelectorAll('.player, .wall').forEach(e => e.remove());
    // Clear highlights
    document.querySelectorAll('.cell').forEach(c => {
        c.classList.remove('valid-move');
        c.classList.remove('target-cell');
    });

    // 2. Metric Helper
    const cellEl = gridBoard.querySelector('.cell');
    if (!cellEl) return;
    const cellSize = cellEl.offsetWidth;
    let gap = 3;
    const cStyle = getComputedStyle(gridBoard);
    if (cStyle.gap && cStyle.gap !== 'normal') gap = parseFloat(cStyle.gap);

    // 3. Render Helper
    const placeVisualWall = (x, y, type, classes = []) => {
        const w = document.createElement('div');
        w.className = `wall ${type} ${classes.join(' ')}`;

        // Exact logic from script.js
        let top, left;
        if (type === 'vertical') {
            left = (x + 1) * (cellSize + gap) - gap / 2;
            top = y * (cellSize + gap);
        } else {
            top = (y + 1) * (cellSize + gap) - gap / 2;
            left = x * (cellSize + gap);
        }
        w.style.left = `${left}px`;
        w.style.top = `${top}px`;
        gridBoard.appendChild(w);
    };

    // 4. Render Actual Walls
    STATE.walls.forEach(w => placeVisualWall(w.x, w.y, w.type, ['placed']));

    // 5. Render Pending
    if (STATE.pendingAction && STATE.pendingAction.type === 'wall') {
        const pa = STATE.pendingAction;
        placeVisualWall(pa.x, pa.y, pa.orientation, ['pending']);
    }

    // 6. Render Players
    renderPlayer('p1');
    renderPlayer('p2');

    // 7. Highlight Target
    const currentStep = STATE.lesson.steps[STATE.step];
    if (currentStep && currentStep.target && STATE.mode === 'move') {
        const tCell = document.querySelector(`.cell[data-x="${currentStep.target.x}"][data-y="${currentStep.target.y}"]`);
        if (tCell) tCell.classList.add('target-cell');
    }
}

function renderPlayer(pid) {
    const p = STATE.players[pid];
    const cell = document.querySelector(`.cell[data-x="${p.x}"][data-y="${p.y}"]`);
    if (cell) {
        const el = document.createElement('div');
        el.className = `player ${pid === 'p1' ? 'blue' : 'red'}`;
        // Active ghost style
        if (pid === 'p1' && STATE.ghostMode) {
            el.style.opacity = '0.7';
            el.style.boxShadow = '0 0 10px white';
        } else {
            el.style.opacity = '1';
            el.style.boxShadow = '';
        }
        cell.appendChild(el);
    }
}

function handleCellClick(x, y, e) {
    const currentStep = STATE.lesson.steps[STATE.step];

    // --- MODE: MOVE ---
    if (STATE.mode === 'move') {
        if (currentStep.goal === 'move') {
            const validMoves = getValidMoves(STATE.players.p1.x, STATE.players.p1.y);
            const isValid = validMoves.some(m => m.x === x && m.y === y);

            if (isValid) {
                if (currentStep.target && (x !== currentStep.target.x || y !== currentStep.target.y)) return;

                STATE.players.p1.x = x;
                STATE.players.p1.y = y;
                renderBoard();
                nextStep();
            }
        }
        return;
    }

    // --- MODE: DESTROY ---
    if (STATE.mode === 'destroy') {
        if (currentStep.goal === 'destroy_wall') {
            // Basic hit test logic
            let targetX = x;
            let targetY = y;
            if (e) {
                const rect = e.target.getBoundingClientRect();
                const offsetX = e.clientX - rect.left;
                const offsetY = e.clientY - rect.top;
                let isLeft = offsetX < rect.width / 2;
                let isTop = offsetY < rect.height / 2;
                if (isTop) targetY = y - 1;
                if (isLeft) targetX = x - 1;
            }

            let found = STATE.walls.findIndex(w =>
                (w.x === targetX && w.y === targetY) ||
                (w.type === 'horizontal' && w.y === targetY && (w.x === targetX || w.x === targetX - 1)) ||
                (w.type === 'vertical' && w.x === targetX && (w.y === targetY || w.y === targetY - 1))
            );

            if (found !== -1) {
                STATE.walls.splice(found, 1);
                setMode('move');
                renderBoard();
                nextStep();
            }
        }
        return;
    }

    // --- MODE: WALL ---
    if (STATE.mode === 'wall') {
        if (currentStep.goal === 'place_wall') {
            const orientation = STATE.wallOrientation;
            if (currentStep.orientation && orientation !== currentStep.orientation) return;

            let targetX = x;
            let targetY = y;
            if (e) {
                const rect = e.target.getBoundingClientRect();
                const offsetX = e.clientX - rect.left;
                const offsetY = e.clientY - rect.top;
                let isLeft = offsetX < rect.width / 2;
                let isTop = offsetY < rect.height / 2;
                if (orientation === 'vertical') {
                    if (isLeft) targetX = x - 1;
                } else {
                    if (isTop) targetY = y - 1;
                }
            }
            if (targetX < 0 || targetY < 0) return;
            if (orientation === 'vertical' && targetX >= GRID_COLS - 1) return;
            if (orientation === 'horizontal' && targetY >= GRID_ROWS - 1) return;
            const exists = STATE.walls.some(w => w.x === targetX && w.y === targetY && w.type === orientation);
            if (exists) return;

            const isSame = STATE.pendingAction && STATE.pendingAction.x === targetX && STATE.pendingAction.y === targetY;
            if (isSame) {
                STATE.walls.push({ x: targetX, y: targetY, type: orientation });
                STATE.pendingAction = null;
                renderBoard();
                nextStep();
            } else {
                STATE.pendingAction = { type: 'wall', x: targetX, y: targetY, orientation };
                renderBoard();
            }
        }
    }
}

function handleCellHover(x, y, e) {
    if (STATE.mode !== 'wall') return;
    clearPreviews();

    let targetX = x;
    let targetY = y;
    const rect = e.target.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    let isLeft = offsetX < rect.width / 2;
    let isTop = offsetY < rect.height / 2;

    if (STATE.wallOrientation === 'vertical') {
        if (isLeft) targetX = x - 1;
    } else {
        if (isTop) targetY = y - 1;
    }

    if (targetX < 0 || targetY < 0) return;
    if (STATE.wallOrientation === 'vertical' && targetX >= GRID_COLS - 1) return;
    if (STATE.wallOrientation === 'horizontal' && targetY >= GRID_ROWS - 1) return;

    const cell = document.querySelector(`.cell[data-x="${targetX}"][data-y="${targetY}"]`);
    if (cell) {
        const w = document.createElement('div');
        w.className = `wall ${STATE.wallOrientation} preview`;
        cell.appendChild(w);
    }
}

function clearPreviews() {
    document.querySelectorAll('.wall.preview').forEach(e => e.remove());
}

function setMode(mode) {
    STATE.mode = mode;
    document.getElementById('move-mode-btn').classList.toggle('active', mode === 'move');
    document.getElementById('wall-mode-btn').classList.toggle('active', mode === 'wall');

    const rBtn = document.getElementById('wall-rotate-btn');
    if (mode === 'wall') rBtn.classList.remove('hidden');
    else rBtn.classList.add('hidden');

    const currentStep = STATE.lesson.steps[STATE.step];
    if (currentStep.goal === 'mode_switch' && currentStep.mode === mode) nextStep();
}

function toggleOrientation() {
    STATE.wallOrientation = STATE.wallOrientation === 'horizontal' ? 'vertical' : 'horizontal';

    const orientationSpan = document.getElementById('wall-orientation');
    if (orientationSpan) {
        orientationSpan.textContent = STATE.wallOrientation === 'vertical' ? 'Dikey' : 'Yatay';
    }

    const currentStep = STATE.lesson.steps[STATE.step];
    if (currentStep && currentStep.goal === 'rotate_wall') nextStep();
}

function getValidMoves(cx, cy) {
    const moves = [];
    const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    dirs.forEach(d => {
        const nx = cx + d[0];
        const ny = cy + d[1];
        if (nx >= 0 && nx < GRID_COLS && ny >= 0 && ny < GRID_ROWS) {
            if (!isBlockedByWall(cx, cy, nx, ny)) {
                moves.push({ x: nx, y: ny });
            }
        }
    });
    return moves;
}

function isBlockedByWall(x1, y1, x2, y2) {
    if (STATE.ghostMode) return false;
    if (x1 === x2) { // Vertical Move
        const row = Math.min(y1, y2);
        return STATE.walls.some(w => w.type === 'horizontal' && w.y === row && (w.x === x1 || w.x === x1 - 1));
    }
    if (y1 === y2) { // Horizontal Move
        const col = Math.min(x1, x2);
        return STATE.walls.some(w => w.type === 'vertical' && w.x === col && (w.y === y1 || w.y === y1 - 1));
    }
    return false;
}

init();
