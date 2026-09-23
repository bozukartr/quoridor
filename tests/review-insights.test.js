import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewTrend, reviewSummary, keyMoveIndexes, describePosition } from '../review-insights.js';

const state = (y = 0) => ({ cols: 7, rows: 9, walls: [], players: {
    p1: { x: 3, y, wallsLeft: 8 }, p2: { x: 3, y: 8, wallsLeft: 8 }
} });

test('advantage trend tracks every position in the game', () => {
    const values = reviewTrend([{ state: state() }, { state: state(1) }], 'p1');
    assert.equal(values.length, 2);
    assert.ok(values[1] > values[0]);
});

test('key moves and summary count only reviewed turns and the selected player', () => {
    const reports = [{ label: 'En iyi' }, { label: 'Hata' }, null, { label: 'Büyük hata' }, { label: 'İyi' }];
    const history = ['p1', 'p2', 'p1', 'p1', 'p1'].map(turn => ({ turn }));
    assert.deepEqual(keyMoveIndexes(reports), [2, 4]);
    assert.deepEqual(keyMoveIndexes([{ label: 'En iyi', beforeChance: 30, afterChance: 55 }]), [1]);
    assert.deepEqual(reviewSummary(reports, history, 'p1'),
        { best: 1, good: 1, mistakes: 1, critical: 2, reviewed: 3 });
});

test('position feedback describes actual path improvement', () => {
    assert.match(describePosition(state(), state(1), 'p1'), /kısaldı/);
});
