import test from 'node:test';
import assert from 'node:assert/strict';
import { resetMatchState, claimSecondPlayer, rematchRoom } from '../match-session.js';
import { LocalRoom } from '../local-room.js';

test('rematch removes effects and recording guard while retaining player identity', () => {
    const state = {
        roomId: 'ABCD', playerId: 'p2', vsAI: false, statsRecorded: true,
        ghostMode: true, aiThinking: true, currentTurn: 'p2', moveCount: 20,
        powerupCount: 5, powerupUsage: { ghost: 4 }, frozenPlayer: 'p2',
        activeEffects: { p2: { double_turn: true, chaos: true } },
        usedPowerupsInTurn: new Set(['ghost']), timeRemaining: { p1: 0, p2: 12 }
    };
    resetMatchState(state, { matchId: 'second', boardState: { timeRemaining: { p1: 90, p2: 90 } } }, 123);
    assert.equal(state.statsRecorded, false);
    assert.equal(state.ghostMode, false);
    assert.equal(state.aiThinking, false);
    assert.equal(state.currentTurn, null);
    assert.equal(state.frozenPlayer, null);
    assert.deepEqual(state.activeEffects, { p1: {}, p2: {} });
    assert.deepEqual(state.powerupUsage, {});
    assert.equal(state.usedPowerupsInTurn.size, 0);
    assert.equal(state.moveCount + state.powerupCount, 0);
    assert.equal(state.startTime, 123);
    assert.equal(state.roomId, 'ABCD');
    assert.equal(state.playerId, 'p2');
});

test('only one competing participant can claim a waiting room', () => {
    const waiting = { p1: 'Host', status: 'waiting', boardState: { p1: { x: 3 } } };
    const winner = claimSecondPlayer(waiting, 'Alice');
    assert.equal(winner.p2, 'Alice');
    assert.equal(winner.status, 'active');
    assert.equal(claimSecondPlayer(winner, 'Bob'), undefined);
    assert.equal(waiting.p2, undefined);
    assert.equal(claimSecondPlayer({ ...waiting, status: 'finished' }, 'Bob'), undefined);
    assert.equal(claimSecondPlayer(null, 'Alice'), null);
});

test('simultaneous rematches cannot overwrite a match that already restarted', () => {
    const finished = { matchId: 'first', status: 'finished', p1: 'A', p2: 'B', boardState: { winner: 'p1' } };
    const board = { p1: { x: 3, y: 0 }, p2: { x: 3, y: 8 }, walls: [] };
    const next = rematchRoom(finished, 'first', 'second', board, 'p2');
    assert.equal(next.matchId, 'second');
    assert.equal(next.boardState.winner, undefined);
    assert.equal(next.p2, 'B');
    assert.equal(rematchRoom(next, 'first', 'third', board, 'p1'), undefined);
    assert.equal(rematchRoom(next, 'second', 'third', board, 'p1'), undefined);
});

test('local AI rematch publishes a fresh snapshot without previous powers', async () => {
    const room = new LocalRoom({ matchId: 'one', status: 'finished', boardState: { winner: 'p2', activeEffects: { p1: { chaos: true } } } });
    const snapshots = [];
    const unsubscribe = room.onValue(snapshot => snapshots.push(snapshot.val()));
    await Promise.resolve();
    room.set(rematchRoom(room.val(), 'one', 'two', { walls: [], timeRemaining: { p1: 90, p2: 90 } }, 'p1'));
    await Promise.resolve();
    assert.equal(snapshots.length, 2);
    assert.equal(snapshots[1].status, 'active');
    assert.equal(snapshots[1].boardState.activeEffects, undefined);
    unsubscribe();
});
