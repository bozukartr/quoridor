// Shared, deterministic Quoridor search. Power-ups are scored by the live AI separately.
import { distanceToGoal, getValidMoves, goalRowFor, isWallLegal } from './ai.js';

const other = pid => pid === 'p1' ? 'p2' : 'p1';
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function evaluatePosition(state, pid = 'p1') {
    const foe = other(pid);
    if (state.players[pid].y === goalRowFor(pid, state.rows)) return 10000;
    if (state.players[foe].y === goalRowFor(foe, state.rows)) return -10000;
    const own = distanceToGoal(state, state.players[pid].x, state.players[pid].y, goalRowFor(pid, state.rows));
    const rival = distanceToGoal(state, state.players[foe].x, state.players[foe].y, goalRowFor(foe, state.rows));
    // Shortest paths dominate, with a smaller premium for the remaining wall reserve.
    return clamp((rival - own) * 110 + ((state.players[pid].wallsLeft || 0) - (state.players[foe].wallsLeft || 0)) * 18, -2000, 2000);
}

export function winChance(score) {
    if (score >= 9000) return 100;
    if (score <= -9000) return 0;
    return Math.round(100 / (1 + Math.exp(-score / 260)));
}

export function applyEngineAction(state, pid, action) {
    const players = { p1: { ...state.players.p1 }, p2: { ...state.players.p2 } };
    if (action.type === 'move') players[pid] = { ...players[pid], ...action.to };
    else if (action.type === 'wall') players[pid].wallsLeft--;
    return { ...state, players, walls: action.type === 'wall'
        ? [...state.walls, { x: action.x, y: action.y, type: action.orientation }] : state.walls };
}

export function legalEngineActions(state, pid) {
    const moves = getValidMoves(state, pid).map(to => ({ type: 'move', to }));
    if (!state.players[pid].wallsLeft || state.frozenPlayer === pid) return moves;
    const rival = state.players[other(pid)];
    const own = state.players[pid];
    const walls = [];
    // A wall away from both pawns' routes is unlikely to affect this turn.
    for (let x = 0; x < state.cols - 1; x++) for (let y = 0; y < state.rows - 1; y++) {
        if (Math.min(Math.abs(x - rival.x) + Math.abs(y - rival.y),
            Math.abs(x - own.x) + Math.abs(y - own.y)) > 4) continue;
        for (const orientation of ['horizontal', 'vertical']) {
            if (isWallLegal(state, x, y, orientation)) walls.push({ type: 'wall', x, y, orientation });
        }
    }
    const before = evaluatePosition(state, pid);
    walls.sort((a, b) => evaluatePosition(applyEngineAction(state, pid, b), pid)
        - evaluatePosition(applyEngineAction(state, pid, a), pid));
    return [...moves, ...walls.slice(0, 8).filter(a => evaluatePosition(applyEngineAction(state, pid, a), pid) >= before - 75)];
}

export function analyzePosition(state, { pid = 'p1', depth = 2, maxNodes = 1200 } = {}) {
    let nodes = 0;
    const perspective = pid;
    const limit = clamp(Math.floor(depth), 1, 4);
    const search = (position, turn, remaining, alpha, beta) => {
        nodes++;
        const terminal = Math.abs(evaluatePosition(position, perspective)) >= 9000;
        if (remaining === 0 || terminal || nodes >= maxNodes) return evaluatePosition(position, perspective);
        const actions = legalEngineActions(position, turn);
        if (!actions.length) return evaluatePosition(position, perspective);
        const maximizing = turn === perspective;
        const ranked = actions.map(action => ({ action, next: applyEngineAction(position, turn, action) }));
        ranked.sort((a, b) => (evaluatePosition(b.next, perspective) - evaluatePosition(a.next, perspective)) * (maximizing ? 1 : -1));
        let best = maximizing ? -Infinity : Infinity;
        for (const entry of ranked.slice(0, remaining > 1 ? 8 : 12)) {
            const score = search(entry.next, other(turn), remaining - 1, alpha, beta);
            best = maximizing ? Math.max(best, score) : Math.min(best, score);
            if (maximizing) alpha = Math.max(alpha, best); else beta = Math.min(beta, best);
            if (beta <= alpha || nodes >= maxNodes) break;
        }
        return best;
    };
    const options = legalEngineActions(state, pid).map(action => ({ action, next: applyEngineAction(state, pid, action) }));
    options.sort((a, b) => evaluatePosition(b.next, pid) - evaluatePosition(a.next, pid));
    let bestAction = null, bestScore = -Infinity;
    for (const option of options.slice(0, 14)) {
        const score = search(option.next, other(pid), limit - 1, -Infinity, Infinity);
        if (score > bestScore) { bestScore = score; bestAction = option.action; }
        if (nodes >= maxNodes) break;
    }
    if (!bestAction) bestScore = evaluatePosition(state, pid);
    return { bestAction, score: bestScore, winChance: winChance(bestScore), nodes, depth: limit };
}

export function classifyMove(before, after, pid, chosen, options = {}) {
    const best = analyzePosition(before, { pid, ...options });
    const played = -analyzePosition(after, { pid: other(pid), depth: Math.max(1, best.depth - 1), maxNodes: options.maxNodes || 900 }).score;
    const loss = Math.max(0, best.score - played);
    return { bestAction: best.bestAction, loss, label: loss < 35 ? 'En iyi' : loss < 110 ? 'İyi' : loss < 230 ? 'Hata' : 'Büyük hata',
        beforeChance: winChance(evaluatePosition(before, pid)), afterChance: winChance(played), chosen };
}
