import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { LocalRoom } from '../local-room.js';
import * as session from '../match-session.js';
import * as powers from '../powerups.js';
import * as ai from '../ai.js';
import * as engine from '../analysis-engine.js';
import * as insights from '../review-insights.js';
import * as variation from '../review-variation.js';
import { createSettings } from '../settings.js';
import * as online from '../online-match.js';

function harness() {
    const elements = new Map();
    const element = id => {
        if (elements.has(id)) return elements.get(id);
        const classes = new Set();
        const el = {
            value: '', textContent: '', innerHTML: '', style: { setProperty() {} }, children: [], dataset: {},
            classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x), toggle() {} },
            addEventListener() {}, setAttribute() {}, querySelector: x => element(id + x),
            append(child) { this.children.push(child); }, replaceChildren() { this.children = []; }
        };
        elements.set(id, el);
        return el;
    };
    const room = new LocalRoom();
    const histories = [];
    let stats = { wins: 0, losses: 0 };
    let timerId = 0;
    const pending = new Set();
    const stored = new Map();
    const storage = { getItem: key => stored.get(key), setItem: (key,value) => stored.set(key,value), removeItem: key => stored.delete(key) };
    const context = vm.createContext({
        ...session, ...online, ...powers, ...ai, ...engine, ...insights, ...variation, aiValidMoves: ai.getValidMoves, LocalRoom,
        crypto: webcrypto, structuredClone, console, Date, Math,
        localStorage: storage, URLSearchParams, settings: createSettings(storage), recordFinishedMatch() {},
        serverTimestamp: () => Date.now(),
        db: {}, app: {}, auth: { currentUser: { uid: 'test-player' } },
        document: { getElementById: element, createElement: () => element(`created-${Math.random()}`), addEventListener() {}, querySelectorAll: () => [] },
        window: { addEventListener() {}, location: { search: '' } }, navigator: {},
        Audio: class { play() { return Promise.resolve(); } },
        requestAnimationFrame() {},
        setTimeout: () => { const id = ++timerId; pending.add(id); return id; },
        clearTimeout: id => pending.delete(id),
        setInterval: () => { const id = ++timerId; pending.add(id); return id; },
        clearInterval: id => pending.delete(id),
        ref: (_, path) => path,
        onValue: (_, fn) => room.onValue(fn),
        get: async path => ({ val: () => path.startsWith('rooms/') ? room.val() : structuredClone(stats) }),
        set: async (_, value) => { stats = value; },
        push: async (_, value) => { histories.push(value); },
        update: async (_, updates) => room.update(updates),
        runTransaction: async (_, fn) => {
            const next = fn(room.val());
            if (next !== undefined) room.set(next);
            return { committed: next !== undefined, snapshot: { val: () => room.val() } };
        }
    });
    let source = readFileSync(new URL('../script.js', import.meta.url), 'utf8')
        .replace(/^import .*;\r?\n/gm, '').replace(/^init\(\);/m, '')
        .replace("new URL('./analysis-worker.js', import.meta.url)", "'analysis-worker.js'");
    source += `\ninitRenderer = () => {}; showToast = () => {}; startConfetti = () => {}; stopConfetti = () => {};
    globalThis.game = { STATE, startAIGame, startGame, resetRoom, sendMove, listenGameLoop, restoreOnlineRoom, roomUpdate, tryMove,
        recordAnalysisSnapshot, analysisHistory: () => analysisHistory, openMatchAnalysis, showAnalysisPosition,
        setAnalysisReports: reports => analysisReports = reports, toggleAnalysisPreview, setAnalysisSummaryVisible,
        startAnalysisRetry, tryAnalysisAlternative, startAnalysisLine, showAnalysisLineStep };`;
    vm.runInContext(source, context);
    return { game: context.game, room, histories, pending, elements, storage };
}
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }

test('real AI game loop supports repeated surrender/rematch with fresh counters and powers', async () => {
    const { game } = harness();
    game.startAIGame('easy');
    await flush();
    for (let i = 0; i < 3; i++) {
        const oldId = game.STATE.matchId;
        game.STATE.moveCount = 17;
        game.STATE.statsRecorded = true;
        game.STATE.ghostMode = true;
        game.sendMove({ type: 'surrender' });
        await flush();
        assert.equal(game.STATE.gameActive, false);
        await game.resetRoom();
        await flush();
        assert.equal(game.STATE.gameActive, true);
        assert.notEqual(game.STATE.matchId, oldId);
        assert.equal(game.STATE.moveCount, 0);
        assert.equal(game.STATE.statsRecorded, false);
        assert.equal(game.STATE.ghostMode, false);
        assert.equal(game.STATE.players.p1.wallsLeft, 8);
        assert.equal(game.STATE.players.p2.wallsLeft, 8);
    }
});

test('both first match and rematch record stats through the real subscription path', async () => {
    const { game, room, histories } = harness();
    game.STATE.connected = true;
    game.STATE.roomId = 'TEST'; game.STATE.playerId = 'p1';
    room.set({ matchId: 'first', p1: 'A', p2: 'B', status: 'active', turn: 'p1', boardState: {
        p1: { x: 3, y: 0, wallsLeft: 8 }, p2: { x: 3, y: 8, wallsLeft: 8 }, timeRemaining: { p1: 90, p2: 90 }
    } });
    game.startGame(room.val());
    await flush();
    for (let i = 0; i < 2; i++) {
        room.update({ status: 'finished', '/boardState/winner': 'p1' });
        await flush();
        assert.equal(histories.length, i + 1);
        // Duplicate snapshots must not duplicate match history.
        room.update({ unrelated: i });
        await flush();
        assert.equal(histories.length, i + 1);
        await game.resetRoom();
        await flush();
        assert.equal(game.STATE.gameActive, true);
    }
});

function onlineRoom() {
    return online.startClock({ matchId: 'online-match', roomSessionId: 'room-session', seats: { p1: 'seat-1' },
        p1: 'A', p2: 'B', status: 'active', turn: 'p1', boardState: {
            p1: { x: 3, y: 0, wallsLeft: 8, inventory: {} }, p2: { x: 3, y: 8, wallsLeft: 8, inventory: {} },
            timeRemaining: { p1: 90, p2: 90 }
        }
    }, Date.now());
}
test('offline input cannot write a queued move', async () => {
    const { game, room } = harness();
    game.STATE.roomId = 'TEST'; game.STATE.playerId = 'p1';
    room.set(onlineRoom()); game.startGame(room.val()); await flush();
    game.sendMove({ type: 'move', to: { x: 3, y: 1 } }); await flush();
    assert.equal(room.val().boardState.p1.y, 0);
    assert.equal(room.val().turn, 'p1');
});
test('reopening restores the saved seat and receives subsequent room updates', async () => {
    const { game, room, storage } = harness();
    room.set(onlineRoom());
    online.saveSession(storage, { roomId: 'TEST', playerId: 'p1', seatId: 'seat-1', roomSessionId: 'room-session' });
    game.STATE.connected = true;
    await game.restoreOnlineRoom(); await flush();
    assert.equal(game.STATE.playerId, 'p1');
    assert.equal(game.STATE.gameActive, true);
    room.update({ '/boardState/p2/y': 7 }); await flush();
    assert.equal(game.STATE.players.p2.y, 7);
});
test('an occupied seat with a different session is not restored', async () => {
    const { game, room, storage } = harness();
    room.set(onlineRoom());
    online.saveSession(storage, { roomId: 'TEST', playerId: 'p1', seatId: 'wrong-seat', roomSessionId: 'room-session' });
    game.STATE.connected = true;
    await game.restoreOnlineRoom(); await flush();
    assert.equal(game.STATE.gameActive, false);
    assert.equal(online.readSession(storage), null);
});
test('stale optimistic position is restored from a confirmed snapshot after rejection', async () => {
    const { game, room } = harness();
    game.STATE.connected = true;
    game.STATE.roomId = 'TEST'; game.STATE.playerId = 'p1';
    room.set(onlineRoom()); game.startGame(room.val()); await flush();
    // Simulate a server revision newer than the client's cached room.
    room.update({ revision: 99 });
    game.tryMove(3, 1);
    await flush();
    assert.equal(room.val().boardState.p1.y, 0);
    assert.equal(game.STATE.players.p1.y, 0);
    assert.equal(game.STATE.movePending, false);
});

test('analysis timeline records board changes once and resets for a rematch', async () => {
    const { game } = harness();
    game.startAIGame('easy');
    await flush();
    const initial = game.STATE.roomData;
    game.recordAnalysisSnapshot(initial);
    assert.equal(game.analysisHistory().length, 1);
    game.recordAnalysisSnapshot({ ...initial, boardState: { ...initial.boardState, timeRemaining: { p1: 80, p2: 90 } } });
    assert.equal(game.analysisHistory().length, 1);
    const next = structuredClone(initial);
    next.boardState.p1.y = 1;
    next.turn = 'p2';
    game.recordAnalysisSnapshot(next);
    assert.equal(game.analysisHistory().length, 2);
    assert.equal(game.analysisHistory()[0].turn, initial.turn);
    game.sendMove({ type: 'surrender' });
    await flush();
    await game.resetRoom();
    await flush();
    assert.equal(game.analysisHistory().length, 1);
});

test('analysis arrow navigation updates the board without a scrolling turn list', async () => {
    const { game, elements } = harness();
    game.startAIGame('easy');
    await flush();
    const next = structuredClone(game.STATE.roomData);
    next.boardState.p1.y = 1;
    next.turn = 'p2';
    game.recordAnalysisSnapshot(next);
    game.analysisHistory()[0].turn = 'p1';
    game.openMatchAnalysis();
    assert.equal(elements.get('analysis-summary').hidden, false);
    assert.equal(elements.get('analysis-summary-graph').children.length, 2);
    game.setAnalysisSummaryVisible(false);
    assert.equal(elements.get('analysis-summary').hidden, true);
    assert.equal(elements.get('analysis-step').textContent, '0 / 1');
    assert.equal(elements.get('analysis-prev').disabled, true);
    assert.equal(elements.get('analysis-board').children.length, 65);
    assert.equal(elements.get('analysis-move-strip').children.length, 2);
    assert.equal(elements.get('analysis-graph').children.length, 2);
    game.showAnalysisPosition(1);
    assert.equal(elements.get('analysis-step').textContent, '1 / 1');
    assert.equal(elements.get('analysis-next').disabled, true);
    assert.match(elements.get('analysis-move-title').textContent, /Taş/);
    assert.equal(elements.get('analysis-board').children.length, 67);
});

test('retry accepts legal pawn and wall alternatives without changing the match', async () => {
    const { game, elements } = harness();
    game.startAIGame('easy');
    await flush();
    const next = structuredClone(game.STATE.roomData);
    next.boardState.p1.y = 1; next.turn = 'p2';
    game.recordAnalysisSnapshot(next);
    game.analysisHistory()[0].turn = 'p1';
    game.openMatchAnalysis();
    game.setAnalysisReports([{ bestAction: { type: 'move', to: { x: 3, y: 1 } }, label: 'Hata', loss: 150 }]);
    game.showAnalysisPosition(1);
    const live = JSON.stringify(game.STATE.roomData);
    game.startAnalysisRetry();
    assert.equal(elements.get('analysis-retry-controls').hidden, false);
    assert.equal(game.tryAnalysisAlternative({ type: 'move', to: { x: 3, y: 8 } }), false);
    assert.equal(game.tryAnalysisAlternative({ type: 'wall', x: 2, y: 2, orientation: 'horizontal' }), true);
    assert.equal(JSON.stringify(game.STATE.roomData), live);
    assert.equal(game.analysisHistory()[0].state.walls.length, 0);
    game.showAnalysisPosition(1);
    assert.equal(elements.get('analysis-retry-controls').hidden, true);
});

test('engine line steps through a separate board and returns to recorded play', async () => {
    const { game, elements } = harness();
    game.startAIGame('easy');
    await flush();
    const next = structuredClone(game.STATE.roomData);
    next.boardState.p1.y = 1; next.turn = 'p2';
    game.recordAnalysisSnapshot(next);
    game.analysisHistory()[0].turn = 'p1';
    game.openMatchAnalysis();
    game.setAnalysisReports([{ bestAction: { type: 'move', to: { x: 3, y: 1 } }, label: 'En iyi', loss: 0 }]);
    game.showAnalysisPosition(1);
    const snapshot = JSON.stringify(game.analysisHistory());
    game.startAnalysisLine();
    assert.equal(elements.get('analysis-line-next').hidden, false);
    game.showAnalysisLineStep(2);
    assert.match(elements.get('analysis-detail').textContent, /2 \/ /);
    game.showAnalysisPosition(1);
    assert.equal(elements.get('analysis-line-next').hidden, true);
    assert.equal(JSON.stringify(game.analysisHistory()), snapshot);
});

test('review reveals the suggested move on the previous position and returns to the game', async () => {
    const { game, elements } = harness();
    game.startAIGame('easy');
    await flush();
    const next = structuredClone(game.STATE.roomData);
    next.boardState.p1.y = 1;
    next.turn = 'p2';
    game.recordAnalysisSnapshot(next);
    game.analysisHistory()[0].turn = 'p1';
    game.openMatchAnalysis();
    game.setAnalysisReports([{ bestAction: { type: 'move', to: { x: 3, y: 1 } }, label: 'En iyi', loss: 0, depth: 4 }]);
    game.showAnalysisPosition(1);
    assert.equal(elements.get('analysis-board').children.length, 67);
    game.toggleAnalysisPreview();
    assert.equal(elements.get('analysis-board').children.length, 66);
    assert.equal(elements.get('analysis-best').textContent, 'Oyuna dön');
    game.toggleAnalysisPreview();
    assert.equal(elements.get('analysis-board').children.length, 67);
});
