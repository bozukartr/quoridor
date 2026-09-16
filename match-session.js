// Shared lifecycle and transaction reducers. No browser/Firebase dependencies.
export function resetMatchState(state, data, now = Date.now()) {
    state.matchId = data.matchId ?? null;
    state.statsRecorded = false;
    state.ghostMode = false;
    state.startTime = now;
    state.moveCount = 0;
    state.powerupCount = 0;
    state.powerupUsage = {};
    state.usedPowerupsInTurn = new Set();
    state.currentTurn = null;
    state.isMyTurn = false;
    state.aiThinking = false;
    state.wallHintShown = false;
    state.drag = null;
    state.activeEffects = structuredClone(data.boardState?.activeEffects ?? { p1: {}, p2: {} });
    state.frozenPlayer = data.boardState?.frozenPlayer ?? null;
    state.timeRemaining = { ...(data.boardState?.timeRemaining ?? { p1: 90, p2: 90 }) };
}

export function claimSecondPlayer(room, username) {
    // Firebase can initially invoke the updater with an empty local cache.
    // Returning null lets it compare with the server and retry with current data.
    if (room === null) return null;
    if (room.status !== 'waiting' || room.p2) return undefined;
    return { ...room, p2: username, status: 'active' };
}

export function rematchRoom(room, expectedMatchId, newMatchId, boardState, turn) {
    if (room === null) return null;
    if ((room.matchId ?? null) !== expectedMatchId) return undefined;
    if (room.status !== 'finished') return undefined;
    return { ...room, matchId: newMatchId, turn, status: 'active', boardState };
}
