import { getValidMoves, goalRowFor, isWallLegal } from './ai.js';
import { analyzePosition, applyEngineAction } from './analysis-engine.js';

export function legalReviewAction(state, pid, action) {
    if (!state?.players?.[pid] || !action || state.players.p1.y === goalRowFor('p1', state.rows)
        || state.players.p2.y === goalRowFor('p2', state.rows)) return false;
    if (action.type === 'move') return getValidMoves(state, pid).some(to => to.x === action.to?.x && to.y === action.to?.y);
    if (action.type === 'wall') return state.players[pid].wallsLeft > 0 && state.frozenPlayer !== pid
        && Number.isInteger(action.x) && Number.isInteger(action.y)
        && ['horizontal', 'vertical'].includes(action.orientation)
        && isWallLegal(state, action.x, action.y, action.orientation);
    return false;
}

export function tryReviewAction(state, pid, action) {
    return legalReviewAction(state, pid, action) ? applyEngineAction(state, pid, action) : null;
}

// A short independent line for the review screen. Never writes to the live match.
export function buildReviewLine(state, pid, firstAction, plies = 4) {
    const line = [];
    let current = state, turn = pid;
    for (let i = 0; i < Math.min(4, plies); i++) {
        const action = i === 0 && firstAction ? firstAction
            : analyzePosition(current, { pid: turn, depth: 2, maxNodes: 420 }).bestAction;
        const next = tryReviewAction(current, turn, action);
        if (!next) break;
        line.push({ state: next, pid: turn, action });
        current = next;
        turn = turn === 'p1' ? 'p2' : 'p1';
    }
    return line;
}
