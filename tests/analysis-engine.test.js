import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePosition, applyEngineAction, classifyMove, legalEngineActions, winChance } from '../analysis-engine.js';
import { isWallLegal } from '../ai.js';

const board = () => ({ cols: 7, rows: 9, walls: [], powerups: [], players: {
    p1: { x: 3, y: 0, wallsLeft: 8 }, p2: { x: 3, y: 8, wallsLeft: 8 }
} });

test('search chooses an immediate winning move without mutating the board', () => {
    const state = board();
    state.players.p1.y = 7;
    const original = structuredClone(state);
    const result = analyzePosition(state, { pid: 'p1', depth: 2 });
    assert.equal(result.bestAction.type, 'move');
    assert.equal(result.bestAction.to.y, 8);
    assert.equal(result.winChance, 100);
    assert.deepEqual(state, original);
});

test('every candidate wall obeys the game validator and spends a wall', () => {
    const state = board();
    const actions = legalEngineActions(state, 'p1');
    for (const action of actions.filter(a => a.type === 'wall')) {
        assert.equal(isWallLegal(state, action.x, action.y, action.orientation), true);
        assert.equal(applyEngineAction(state, 'p1', action).players.p1.wallsLeft, 7);
    }
    state.frozenPlayer = 'p1';
    assert.equal(legalEngineActions(state, 'p1').some(a => a.type === 'wall'), false);
});

test('retreat from an immediate win is labelled a large mistake', () => {
    const state = board();
    state.players.p1.y = 7;
    const retreat = applyEngineAction(state, 'p1', { type: 'move', to: { x: 3, y: 6 } });
    const report = classifyMove(state, retreat, 'p1');
    assert.equal(report.label, 'Büyük hata');
    assert.equal(winChance(0), 50);
});

test('deeper search blocks an opponent one move from winning', () => {
    const state = board();
    state.players.p1.y = 7;
    state.players.p2.y = 5;
    const result = analyzePosition(state, { pid: 'p2', depth: 3, maxNodes: 1200 });
    assert.equal(result.depth, 3);
    assert.equal(result.bestAction.type, 'wall');
    const next = applyEngineAction(state, 'p2', result.bestAction);
    assert.equal(isWallLegal(state, result.bestAction.x, result.bestAction.y, result.bestAction.orientation), true);
    assert.equal(next.players.p2.wallsLeft, 7);
});

test('a tight node budget returns the last complete search depth', () => {
    const result = analyzePosition(board(), { pid: 'p2', depth: 5, maxNodes: 20 });
    assert.ok(result.depth < 5);
    assert.equal(result.bestAction.type, 'move');
    assert.ok(result.nodes <= 20);
});
