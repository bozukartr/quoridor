// Clock checkpoints use the Firebase server time estimate, never timer tick counts.
// This is synchronization, not server-side anti-cheat validation.
export function remainingMs(room, now) {
    const clock = room.clock;
    const values = clock?.remainingMs || Object.fromEntries(
        ['p1', 'p2'].map(pid => [pid, (room.boardState?.timeRemaining?.[pid] ?? 90) * 1000])
    );
    const result = { ...values };
    if (room.status === 'active' && Number.isFinite(clock?.startedAt)) {
        result[room.turn] = Math.max(0, (result[room.turn] ?? 90000) - Math.max(0, now - clock.startedAt));
    }
    return result;
}

export function startClock(room, timestamp) {
    return { ...room, revision: (room.revision ?? 0) + 1, clock: {
        startedAt: timestamp,
        remainingMs: Object.fromEntries(['p1', 'p2'].map(pid => [pid, (room.boardState?.timeRemaining?.[pid] ?? 90) * 1000]))
    } };
}

function applyPaths(room, updates) {
    const result = structuredClone(room);
    for (const [path, value] of Object.entries(updates)) {
        const parts = path.split('/').filter(Boolean);
        // Online clocks own time; UI snapshots must never refund elapsed time.
        if (parts[0] === 'boardState' && parts[1] === 'timeRemaining') continue;
        let target = result;
        for (const key of parts.slice(0, -1)) target = target[key] ??= {};
        if (value === null) delete target[parts.at(-1)];
        else target[parts.at(-1)] = structuredClone(value);
    }
    return result;
}

export function commitTimedMove(room, { matchId, revision, pid, updates, adjustments = {}, now, timestamp }) {
    if (room === null) return null;
    if (room.status !== 'active' || room.matchId !== matchId || (room.revision ?? 0) !== revision) return undefined;
    const times = remainingMs(room, now);
    if (times[room.turn] <= 0) return finishTimeout(room, now);
    // The UI allows only the +1-wall powerup outside the player's turn.
    if (room.turn !== pid) {
        const keys = Object.keys(updates).map(key => key.replace(/^\//, ''));
        const allowed = [`boardState/${pid}/wallsLeft`, `boardState/${pid}/inventory/wall`];
        const surrenderKeys = ['status', 'boardState/winner', 'turn', `boardState/timeRemaining/${pid}`];
        const surrender = updates['/status'] === 'finished' &&
            updates['/boardState/winner'] === (pid === 'p1' ? 'p2' : 'p1') &&
            keys.every(key => surrenderKeys.includes(key)) && Object.keys(adjustments).length === 0;
        if (!surrender && (keys.length !== 2 || keys.some(key => !allowed.includes(key)))) return undefined;
    }
    const next = applyPaths(room, updates);
    for (const pid of ['p1', 'p2']) times[pid] = Math.max(0, times[pid] + (adjustments[pid] ?? 0) * 1000);
    if (times.p1 <= 0 || times.p2 <= 0) {
        next.status = 'finished';
        next.boardState.winner = times.p1 <= 0 ? 'p2' : 'p1';
    }
    next.clock = { remainingMs: times, startedAt: timestamp };
    next.boardState.timeRemaining = Object.fromEntries(['p1', 'p2'].map(pid => [pid, times[pid] / 1000]));
    next.revision = (room.revision ?? 0) + 1;
    return next;
}

export function finishTimeout(room, now) {
    if (room === null) return null;
    if (room.status !== 'active' || !room.clock) return undefined;
    const times = remainingMs(room, now);
    if (times[room.turn] > 0) return undefined;
    return { ...room, status: 'finished', revision: (room.revision ?? 0) + 1,
        clock: { remainingMs: times, startedAt: now },
        boardState: { ...room.boardState, winner: room.turn === 'p1' ? 'p2' : 'p1',
            timeRemaining: Object.fromEntries(['p1', 'p2'].map(pid => [pid, times[pid] / 1000])) }
    };
}

const SESSION_KEY = 'quoridor.match.v1';
export function saveSession(storage, session) {
    try { storage.setItem(SESSION_KEY, JSON.stringify({ ...session, savedAt: Date.now() })); } catch { /* Storage can be unavailable. */ }
}
export function readSession(storage, now = Date.now()) {
    try {
        const value = JSON.parse(storage.getItem(SESSION_KEY));
        if (!value || !/^[A-Z0-9]{4,6}$/.test(value.roomId) || !['p1','p2'].includes(value.playerId) ||
            typeof value.seatId !== 'string' || !value.seatId || typeof value.roomSessionId !== 'string' ||
            !Number.isFinite(value.savedAt) || now - value.savedAt > 86400000) return null;
        return value;
    } catch { return null; }
}
export function clearSession(storage) {
    try { storage.removeItem(SESSION_KEY); } catch { /* Best effort. */ }
}
export function canResumeRoom(session, room) {
    return !!session && !!room && room.roomSessionId === session.roomSessionId &&
        room.seats?.[session.playerId] === session.seatId && ['waiting', 'active', 'finished'].includes(room.status);
}
