import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_NEW_COMPLETED_MATCHES, engineUpdateEligibility } from '../engine-update-policy.js';

const completed = (n, extra = {}) => ({ matchId: `match-${n}`, status: 'finished', winner: n % 2 ? 'p1' : 'p2', completedAt: n + 1000, rulesVersion: 1, ...extra });

test('requires 20 distinct completed matches after the last engine promotion', () => {
    const nineteen = Array.from({ length: 19 }, (_, i) => completed(i));
    assert.equal(MIN_NEW_COMPLETED_MATCHES, 20);
    assert.deepEqual(engineUpdateEligibility(nineteen, { promotedAt: 999, rulesVersion: 1 }),
        { eligible: false, completed: 19, required: 20, remaining: 1 });
    assert.equal(engineUpdateEligibility([...nineteen, completed(19)], { promotedAt: 999, rulesVersion: 1 }).eligible, true);
});

test('deduplicates updates and excludes stale, incomplete, invalid and incompatible games', () => {
    const games = [completed(1), completed(1), completed(2, { completedAt: 1000 }),
        completed(3, { status: 'active' }), completed(4, { winner: null }),
        completed(5, { rulesVersion: 2 }), completed(6, { matchId: '' })];
    assert.deepEqual(engineUpdateEligibility(games, { promotedAt: 1000, rulesVersion: 1 }),
        { eligible: false, completed: 1, required: 20, remaining: 19 });
});

test('a newly published version resets the count to games after its promotion time', () => {
    const games = Array.from({ length: 20 }, (_, i) => completed(i));
    assert.equal(engineUpdateEligibility(games, { promotedAt: 999 }).eligible, true);
    assert.equal(engineUpdateEligibility(games, { promotedAt: 1020 }).completed, 0);
});
