// ai.js — Tek kişilik mod için yapay zeka rakip.
// Saf mantık: DOM/Firebase bağımlılığı yok, bu yüzden Node üzerinde de test edilebilir.
//
// Beklenen state şekli (script.js'teki STATE ile aynı alanlar):
// { cols, rows, walls: [{x,y,type}], powerups: [{x,y,type}],
//   players: { p1: {x,y,wallsLeft,inventory}, p2: {...} },
//   timeRemaining: {p1,p2}, frozenPlayer, activeEffects }

export const AI_LEVELS = {
    easy: {
        label: 'Kolay',
        randomMoveChance: 0.35,   // en iyi hamle yerine rastgele oynama olasılığı
        wallChance: 0.12,         // duvar koymayı düşünme olasılığı
        minWallScore: 2,          // duvarın kabul edilmesi için gereken net kazanç
        usePowerups: false,
        thinkMs: [500, 900]
    },
    medium: {
        label: 'Orta',
        randomMoveChance: 0.10,
        wallChance: 0.7,
        minWallScore: 1.2,
        usePowerups: true,
        thinkMs: [450, 850]
    },
    hard: {
        label: 'Zor',
        randomMoveChance: 0,
        wallChance: 1,
        minWallScore: 0.5,
        usePowerups: true,
        thinkMs: [350, 700]
    }
};

const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];

export function goalRowFor(pid, rows) {
    // p1 aşağı (son satır), p2 yukarı (0. satır) gider — script.js ile aynı.
    return pid === 'p1' ? rows - 1 : 0;
}

// --- Kural yardımcıları (script.js'teki kurallarla birebir) ---

export function isBlockedByWall(walls, x1, y1, x2, y2) {
    if (x1 === x2) {
        const row = Math.min(y1, y2);
        return walls.some(w => w.type === 'horizontal' && w.y === row && (w.x === x1 || w.x === x1 - 1));
    }
    if (y1 === y2) {
        const col = Math.min(x1, x2);
        return walls.some(w => w.type === 'vertical' && w.x === col && (w.y === y1 || w.y === y1 - 1));
    }
    return false;
}

// Hedef satıra olan en kısa mesafe (rakip taşı yok sayılır — standart Quoridor sezgiseli).
export function distanceToGoal(state, sx, sy, goalY) {
    const { cols, rows, walls } = state;
    if (sy === goalY) return 0;
    const dist = new Int16Array(cols * rows).fill(-1);
    const queue = [sx + sy * cols];
    dist[sx + sy * cols] = 0;

    for (let head = 0; head < queue.length; head++) {
        const idx = queue[head];
        const x = idx % cols, y = (idx / cols) | 0;
        const d = dist[idx];
        for (const [dx, dy] of DIRS) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
            const nIdx = nx + ny * cols;
            if (dist[nIdx] !== -1) continue;
            if (isBlockedByWall(walls, x, y, nx, ny)) continue;
            dist[nIdx] = d + 1;
            if (ny === goalY) return d + 1;
            queue.push(nIdx);
        }
    }
    return Infinity;
}

export function canReachCell(state, sx, sy, tx, ty) {
    const { cols, rows, walls } = state;
    if (sx === tx && sy === ty) return true;
    const seen = new Uint8Array(cols * rows);
    const queue = [sx + sy * cols];
    seen[sx + sy * cols] = 1;

    for (let head = 0; head < queue.length; head++) {
        const idx = queue[head];
        const x = idx % cols, y = (idx / cols) | 0;
        for (const [dx, dy] of DIRS) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
            const nIdx = nx + ny * cols;
            if (seen[nIdx]) continue;
            if (isBlockedByWall(walls, x, y, nx, ny)) continue;
            if (nx === tx && ny === ty) return true;
            seen[nIdx] = 1;
            queue.push(nIdx);
        }
    }
    return false;
}

// Zıplama/çapraz kuralları dahil geçerli hamleler.
export function getValidMoves(state, pid) {
    const { cols, rows, walls } = state;
    const me = state.players[pid];
    const opp = state.players[pid === 'p1' ? 'p2' : 'p1'];
    const moves = [];

    for (const d of DIRS) {
        const nx = me.x + d[0];
        const ny = me.y + d[1];
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
        if (isBlockedByWall(walls, me.x, me.y, nx, ny)) continue;

        if (nx === opp.x && ny === opp.y) {
            const jx = nx + d[0], jy = ny + d[1];
            if (jx >= 0 && jx < cols && jy >= 0 && jy < rows && !isBlockedByWall(walls, nx, ny, jx, jy)) {
                moves.push({ x: jx, y: jy });
            } else {
                const diags = d[0] === 0 ? [[-1, 0], [1, 0]] : [[0, -1], [0, 1]];
                for (const diag of diags) {
                    const fx = nx + diag[0], fy = ny + diag[1];
                    if (fx < 0 || fx >= cols || fy < 0 || fy >= rows) continue;
                    if (!isBlockedByWall(walls, nx, ny, fx, fy)) moves.push({ x: fx, y: fy });
                }
            }
        } else {
            moves.push({ x: nx, y: ny });
        }
    }
    return moves;
}

// script.js'teki tryPlaceWall doğrulamasının birebir karşılığı.
export function isWallLegal(state, x, y, orientation) {
    const { cols, rows, walls, powerups, players } = state;
    if (x < 0 || x > cols - 2 || y < 0 || y > rows - 2) return false;

    const overlap = walls.some(w => {
        if (w.x === x && w.y === y && w.type === orientation) return true;
        if (orientation === 'horizontal') {
            if (w.type === 'horizontal' && w.y === y && (w.x === x - 1 || w.x === x + 1)) return true;
            if (w.type === 'vertical' && w.x === x && w.y === y) return true;
        } else {
            if (w.type === 'vertical' && w.x === x && (w.y === y - 1 || w.y === y + 1)) return true;
            if (w.type === 'horizontal' && w.x === x && w.y === y) return true;
        }
        return false;
    });
    if (overlap) return false;

    const probe = { ...state, walls: [...walls, { x, y, type: orientation }] };
    if (distanceToGoal(probe, players.p1.x, players.p1.y, rows - 1) === Infinity) return false;
    if (distanceToGoal(probe, players.p2.x, players.p2.y, 0) === Infinity) return false;

    // Güçlendirmelerin önü tamamen kapatılamaz (oyunun kendi kuralı).
    for (const p of (powerups || [])) {
        const p1Reach = canReachCell(probe, players.p1.x, players.p1.y, p.x, p.y);
        const p2Reach = canReachCell(probe, players.p2.x, players.p2.y, p.x, p.y);
        if (!p1Reach && !p2Reach) return false;
    }
    return true;
}

// --- Karar mantığı ---

function pickRandom(list) {
    return list[Math.floor(Math.random() * list.length)];
}

function bestMove(state, pid, level) {
    const moves = getValidMoves(state, pid);
    if (moves.length === 0) return null;

    const goalY = goalRowFor(pid, state.rows);
    if (level.randomMoveChance > 0 && Math.random() < level.randomMoveChance) {
        return pickRandom(moves);
    }

    let best = null, bestScore = Infinity;
    for (const m of moves) {
        let score = distanceToGoal(state, m.x, m.y, goalY);
        if (score === Infinity) continue;
        // Üzerine basılacak güçlendirme küçük bir bonus.
        if ((state.powerups || []).some(p => p.x === m.x && p.y === m.y)) score -= 0.9;
        score += Math.random() * 0.05; // eşitlikleri boz
        if (score < bestScore) { bestScore = score; best = m; }
    }
    return best || pickRandom(moves);
}

function bestWall(state, pid, level) {
    const me = state.players[pid];
    if (!me.wallsLeft || me.wallsLeft <= 0) return null;
    if (state.frozenPlayer === pid) return null;

    const oppId = pid === 'p1' ? 'p2' : 'p1';
    const opp = state.players[oppId];
    const myGoal = goalRowFor(pid, state.rows);
    const oppGoal = goalRowFor(oppId, state.rows);

    const myDist = distanceToGoal(state, me.x, me.y, myGoal);
    const oppDist = distanceToGoal(state, opp.x, opp.y, oppGoal);

    let best = null, bestScore = 0;
    for (let x = 0; x <= state.cols - 2; x++) {
        for (let y = 0; y <= state.rows - 2; y++) {
            for (const orientation of ['vertical', 'horizontal']) {
                if (!isWallLegal(state, x, y, orientation)) continue;
                const probe = { ...state, walls: [...state.walls, { x, y, type: orientation }] };
                const newOpp = distanceToGoal(probe, opp.x, opp.y, oppGoal);
                const newMy = distanceToGoal(probe, me.x, me.y, myGoal);
                if (newOpp === Infinity || newMy === Infinity) continue;
                // Rakibi ne kadar yavaşlattı eksi kendine verdiği zarar.
                const score = (newOpp - oppDist) - 1.2 * (newMy - myDist) + Math.random() * 0.05;
                if (score > bestScore) { bestScore = score; best = { x, y, orientation, score }; }
            }
        }
    }
    if (!best || best.score < level.minWallScore) return null;
    return best;
}

function inventoryOf(player) {
    return player.inventory || {};
}

// Sırayı bitirmeyen güçlendirmeler (duvar hakkı, dondurma).
function choosePreActions(state, pid, level, ctx) {
    if (!level.usePowerups) return [];
    const me = state.players[pid];
    const inv = inventoryOf(me);
    const actions = [];

    // Duvar hakkı bittiyse +1 duvar.
    if ((inv.wall || 0) > 0 && (me.wallsLeft || 0) === 0) {
        actions.push({ type: 'activate', powerupType: 'wall' });
    }
    // Rakip önde ve duvarı varsa dondur.
    const opp = state.players[pid === 'p1' ? 'p2' : 'p1'];
    if ((inv.freeze || 0) > 0 && ctx.oppDist <= ctx.myDist && (opp.wallsLeft || 0) > 0 && state.frozenPlayer !== (pid === 'p1' ? 'p2' : 'p1')) {
        actions.push({ type: 'activate', powerupType: 'freeze' });
    }
    return actions;
}

// Sırayı bitiren güçlendirmeler.
function chooseTurnEndingPowerup(state, pid, level, ctx) {
    if (!level.usePowerups) return null;
    const me = state.players[pid];
    const oppId = pid === 'p1' ? 'p2' : 'p1';
    const inv = inventoryOf(me);

    // Rakip kazanmak üzereyse başa gönder.
    // Not: Başlangıç karesi duvarlarla kapanmış olabilir; oyuncuyu çıkışsız bir
    // cebe ışınlamak oyunu kilitleyeceği için önce yolu olduğundan emin ol.
    if ((inv.return || 0) > 0 && ctx.oppDist <= 2) {
        const startX = Math.floor(state.cols / 2);
        const startY = oppId === 'p2' ? state.rows - 1 : 0;
        const probe = {
            ...state,
            players: { ...state.players, [oppId]: { ...state.players[oppId], x: startX, y: startY } }
        };
        if (distanceToGoal(probe, startX, startY, goalRowFor(oppId, state.rows)) !== Infinity) {
            return { type: 'activate', powerupType: 'return' };
        }
    }
    // Rakibin süresi azaldıysa kum saati.
    const oppTime = (state.timeRemaining && state.timeRemaining[oppId]) || 90;
    if ((inv.hourglass || 0) > 0 && oppTime <= 20) {
        return { type: 'activate', powerupType: 'hourglass' };
    }
    // Rakip yaklaştıysa şaşırtma.
    if ((inv.chaos || 0) > 0 && ctx.oppDist <= 4 && ctx.oppDist < ctx.myDist) {
        return { type: 'activate', powerupType: 'chaos' };
    }
    // Kendi yolunu ciddi biçimde açan bir duvar varsa kır.
    if ((inv.destroy || 0) > 0 && state.walls.length > 0) {
        let target = null, bestGain = 1;
        for (const w of state.walls) {
            const probe = { ...state, walls: state.walls.filter(o => o !== w) };
            const gain = ctx.myDist - distanceToGoal(probe, me.x, me.y, goalRowFor(pid, state.rows));
            if (gain > bestGain) { bestGain = gain; target = w; }
        }
        if (target) {
            return { type: 'destroy', x: target.x, y: target.y, orientation: target.type };
        }
    }
    return null;
}

/**
 * Yapay zekanın bu turda yapacağı işi seçer.
 * @returns {{ pre: Array, main: Object }} pre = sırayı bitirmeyen aksiyonlar, main = asıl hamle.
 */
export function chooseAiAction(state, { pid = 'p2', level = 'medium' } = {}) {
    const cfg = AI_LEVELS[level] || AI_LEVELS.medium;
    const me = state.players[pid];
    const oppId = pid === 'p1' ? 'p2' : 'p1';
    const opp = state.players[oppId];

    const ctx = {
        myDist: distanceToGoal(state, me.x, me.y, goalRowFor(pid, state.rows)),
        oppDist: distanceToGoal(state, opp.x, opp.y, goalRowFor(oppId, state.rows))
    };

    const pre = choosePreActions(state, pid, cfg, ctx);
    // Ön aksiyonlar state'i etkiliyorsa (ör. +1 duvar) hesapta dikkate al.
    let working = state;
    if (pre.some(a => a.powerupType === 'wall')) {
        working = {
            ...state,
            players: { ...state.players, [pid]: { ...me, wallsLeft: (me.wallsLeft || 0) + 1 } }
        };
    }

    const powerupMain = chooseTurnEndingPowerup(working, pid, cfg, ctx);
    if (powerupMain) return { pre, main: powerupMain };

    // Kazanma hamlesi varsa hemen oyna.
    const goalY = goalRowFor(pid, state.rows);
    const moves = getValidMoves(working, pid);
    const winning = moves.find(m => m.y === goalY);
    if (winning) return { pre, main: { type: 'move', to: winning } };

    // Rakip önde/berabere ise duvar koymayı değerlendir.
    const shouldConsiderWall = ctx.oppDist <= ctx.myDist + (cfg === AI_LEVELS.hard ? 1 : 0);
    if (shouldConsiderWall && Math.random() < cfg.wallChance) {
        const wall = bestWall(working, pid, cfg);
        if (wall) return { pre, main: { type: 'wall', x: wall.x, y: wall.y, orientation: wall.orientation } };
    }

    const move = bestMove(working, pid, cfg);
    if (move) return { pre, main: { type: 'move', to: move } };

    // Hiç hamle yoksa (teorik olarak imkânsız) sırayı boş geçmek yerine duvar dene.
    const fallbackWall = bestWall(working, pid, { ...cfg, minWallScore: -Infinity });
    if (fallbackWall) {
        return { pre, main: { type: 'wall', x: fallbackWall.x, y: fallbackWall.y, orientation: fallbackWall.orientation } };
    }
    return { pre, main: null };
}

export function aiThinkDelay(level = 'medium') {
    const cfg = AI_LEVELS[level] || AI_LEVELS.medium;
    const [min, max] = cfg.thinkMs;
    return min + Math.random() * (max - min);
}
