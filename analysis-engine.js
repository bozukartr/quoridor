// Deterministic Quoridor search shared by the bot and match review.
// Special power-ups and the turn clock remain outside this positional model.
import { distanceToGoal, getValidMoves, goalRowFor, isWallLegal } from './ai.js';

const other = pid => pid === 'p1' ? 'p2' : 'p1';
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function evaluatePosition(state, pid = 'p1') {
    const foe = other(pid);
    if (state.players[pid].y === goalRowFor(pid, state.rows)) return 10000;
    if (state.players[foe].y === goalRowFor(foe, state.rows)) return -10000;
    const own = distanceToGoal(state, state.players[pid].x, state.players[pid].y, goalRowFor(pid, state.rows));
    const rival = distanceToGoal(state, state.players[foe].x, state.players[foe].y, goalRowFor(foe, state.rows));
    // Wall reserve matters most while both sides still have a long route.
    const wallWeight = clamp(Math.min(own, rival) * 3, 8, 24);
    return clamp((rival - own) * 115 + ((state.players[pid].wallsLeft || 0) - (state.players[foe].wallsLeft || 0)) * wallWeight, -2000, 2000);
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

function stateKey(state) {
    const a = state.players.p1, b = state.players.p2;
    return `${a.x},${a.y},${a.wallsLeft}|${b.x},${b.y},${b.wallsLeft}|${state.frozenPlayer || ''}|${state.walls.map(w => `${w.x},${w.y},${w.type[0]}`).sort().join(';')}`;
}

function candidateActions(state, pid, scorePosition) {
    const moves = getValidMoves(state, pid).map(to => ({ type: 'move', to }));
    if (!state.players[pid].wallsLeft || state.frozenPlayer === pid) return moves;
    const rival = state.players[other(pid)], own = state.players[pid];
    const before = scorePosition(state, pid);
    const walls = [];
    for (let x = 0; x < state.cols - 1; x++) for (let y = 0; y < state.rows - 1; y++) {
        if (Math.min(Math.abs(x - rival.x) + Math.abs(y - rival.y),
            Math.abs(x - own.x) + Math.abs(y - own.y)) > 5) continue;
        for (const orientation of ['horizontal', 'vertical']) {
            if (!isWallLegal(state, x, y, orientation)) continue;
            const action = { type: 'wall', x, y, orientation };
            const score = scorePosition(applyEngineAction(state, pid, action), pid);
            if (score >= before - 115) walls.push({ action, score });
        }
    }
    walls.sort((a, b) => b.score - a.score || a.action.y - b.action.y || a.action.x - b.action.x);
    return [...moves, ...walls.slice(0, 8).map(entry => entry.action)];
}

export function legalEngineActions(state, pid) {
    return candidateActions(state, pid, evaluatePosition);
}

export function analyzePosition(state, { pid = 'p1', depth = 3, maxNodes = 1800 } = {}) {
    const targetDepth = clamp(Math.floor(depth), 1, 5);
    const budget = Math.max(1, Math.floor(maxNodes));
    let nodes = 0;
    const evaluationCache = new Map(), actionCache = new Map(), transpositions = new Map();
    const scorePosition = (position, turn) => {
        const key = `${stateKey(position)}|${turn}`;
        if (!evaluationCache.has(key)) evaluationCache.set(key, evaluatePosition(position, turn));
        return evaluationCache.get(key);
    };
    const actionsFor = (position, turn) => {
        const key = `${stateKey(position)}|${turn}`;
        if (!actionCache.has(key)) actionCache.set(key, candidateActions(position, turn, scorePosition));
        return actionCache.get(key);
    };
    const search = (position, turn, remaining, alpha, beta) => {
        if (nodes >= budget) return { score: scorePosition(position, turn), complete: false };
        nodes++;
        const staticScore = scorePosition(position, turn);
        if (remaining === 0 || Math.abs(staticScore) >= 9000) return { score: staticScore, complete: true };
        const key = `${stateKey(position)}|${turn}|${remaining}`;
        if (transpositions.has(key)) return { score: transpositions.get(key), complete: true };
        const ranked = actionsFor(position, turn).map(action => ({ action, position: applyEngineAction(position, turn, action) }));
        ranked.sort((a, b) => scorePosition(b.position, turn) - scorePosition(a.position, turn));
        if (!ranked.length) return { score: staticScore, complete: true };
        let best = -Infinity, complete = true, cutoff = false;
        for (const entry of ranked.slice(0, remaining > 1 ? 9 : 12)) {
            const reply = search(entry.position, other(turn), remaining - 1, -beta, -alpha);
            if (!reply.complete) complete = false;
            best = Math.max(best, -reply.score);
            alpha = Math.max(alpha, best);
            if (alpha >= beta) { cutoff = true; break; }
            if (nodes >= budget) { complete = false; break; }
        }
        if (complete && !cutoff) transpositions.set(key, best);
        return { score: best, complete };
    };
    const root = actionsFor(state, pid).map(action => ({ action, position: applyEngineAction(state, pid, action) }));
    root.sort((a, b) => scorePosition(b.position, pid) - scorePosition(a.position, pid));
    let result = { bestAction: root[0]?.action || null, score: root[0] ? scorePosition(root[0].position, pid) : scorePosition(state, pid), depth: 0 };
    if (!root.length) return { ...result, winChance: winChance(result.score), nodes };
    for (let ply = 1; ply <= targetDepth && nodes < budget; ply++) {
        let best = null, bestScore = -Infinity, complete = true, alpha = -Infinity;
        // Previous principal move first improves pruning in the next iteration.
        root.sort((a, b) => Number(b.action === result.bestAction) - Number(a.action === result.bestAction)
            || scorePosition(b.position, pid) - scorePosition(a.position, pid));
        for (const entry of root.slice(0, 14)) {
            const reply = search(entry.position, other(pid), ply - 1, -Infinity, -alpha);
            if (!reply.complete) complete = false;
            const score = -reply.score;
            if (score > bestScore) { bestScore = score; best = entry.action; }
            alpha = Math.max(alpha, bestScore);
            if (nodes >= budget) { complete = false; break; }
        }
        if (!complete) break;
        result = { bestAction: best, score: bestScore, depth: ply };
    }
    return { ...result, winChance: winChance(result.score), nodes };
}

export function classifyMove(before, after, pid, chosen, options = {}) {
    const best = analyzePosition(before, { pid, ...options });
    const reply = analyzePosition(after, { pid: other(pid), depth: Math.max(1, best.depth - 1), maxNodes: options.maxNodes || 900 });
    const played = -reply.score;
    const loss = Math.max(0, best.score - played);
    return { bestAction: best.bestAction, loss, label: loss < 35 ? 'En iyi' : loss < 110 ? 'İyi' : loss < 230 ? 'Hata' : 'Büyük hata',
        beforeChance: winChance(evaluatePosition(before, pid)), afterChance: winChance(played), chosen,
        depth: best.depth, nodes: best.nodes + reply.nodes };
}
