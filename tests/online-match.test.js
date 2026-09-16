import test from 'node:test';
import assert from 'node:assert/strict';
import { remainingMs, startClock, commitTimedMove, finishTimeout, saveSession, readSession, canResumeRoom } from '../online-match.js';
const room = () => startClock({ matchId: 'm1', status: 'active', turn: 'p1', boardState: {
    p1: { x: 3, y: 0 }, p2: { x: 3, y: 8 }, timeRemaining: { p1: 90, p2: 90 }
} }, 1000);
const move = (r, extra = {}) => commitTimedMove(r, { matchId: 'm1', revision: r.revision, pid: 'p1',
    updates: { '/boardState/p1/y': 1, '/turn': 'p2', '/boardState/timeRemaining/p1': 90 }, now: 1250, timestamp: 1250, ...extra });

test('background suspension consumes elapsed time without timer ticks', () => {
    assert.deepEqual(remainingMs(room(), 61000), { p1: 30000, p2: 90000 });
    assert.equal(remainingMs(room(), 1000000).p1, 0);
});
test('turn commit retains subsecond precision and ignores stale UI time', () => {
    const next = move(room());
    assert.equal(next.clock.remainingMs.p1, 89750);
    assert.deepEqual(remainingMs(next, 2250), { p1: 89750, p2: 89000 });
});
test('non-ending powerup does not refund the active turn time', () => {
    const next = move(room(), { updates: { '/boardState/p1/inventory/wall': 0, '/boardState/p1/wallsLeft': 9 }, now: 11000, timestamp: 11000 });
    assert.equal(remainingMs(next, 21000).p1, 70000);
});
test('time bonus and penalty apply to current time, preserving zero', () => {
    const next = move(room(), { adjustments: { p1: 10, p2: -10 } });
    assert.equal(next.clock.remainingMs.p1, 99750);
    assert.equal(next.clock.remainingMs.p2, 80000);
    const expired = move(room(), { now: 91000, timestamp: 91000, adjustments: { p1: 10 } });
    assert.equal(expired.boardState.winner, 'p2');
});
test('late winning move loses on time; either client can settle timeout', () => {
    const expired = move(room(), { now: 92000, timestamp: 92000, updates: { '/boardState/p1/y': 8, '/boardState/winner': 'p1' } });
    assert.equal(expired.boardState.winner, 'p2');
    assert.equal(expired.boardState.p1.y, 0);
    assert.equal(finishTimeout(room(), 90000), undefined);
    assert.equal(finishTimeout(room(), 92000).status, 'finished');
});
test('stale revision, wrong match and off-turn moves are rejected', () => {
    const r = room();
    assert.equal(move(r, { revision: -1 }), undefined);
    assert.equal(move(r, { matchId: 'old' }), undefined);
    assert.equal(move(r, { pid: 'p2' }), undefined);
    assert.equal(move(move(r)), undefined);
});
test('stored session expires and cannot rejoin a reused room code', () => {
    const values = new Map();
    const storage = { setItem: (k,v) => values.set(k,v), getItem: k => values.get(k) };
    saveSession(storage, { roomId: 'ABCD', playerId: 'p1', seatId: 'seat', roomSessionId: 'session' });
    const saved = readSession(storage);
    assert.ok(saved);
    assert.equal(canResumeRoom(saved, { roomSessionId: 'session', seats: { p1: 'seat' }, status: 'active' }), true);
    assert.equal(canResumeRoom(saved, { roomSessionId: 'new-session', seats: { p1: 'seat' }, status: 'active' }), false);
    assert.equal(readSession(storage, Date.now() + 86400001), null);
    assert.equal(readSession({ getItem: () => '{invalid' }), null);
});

test('surrender remains available during the opponent turn', () => {
    const r = room();
    const next = move(r, { pid: 'p2', updates: { '/status': 'finished', '/boardState/winner': 'p1', '/turn': 'p1' } });
    assert.equal(next.status, 'finished');
    assert.equal(next.boardState.winner, 'p1');
});
