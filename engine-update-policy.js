// Shared gate for future scheduled engine training and promotion jobs.
// Promotion count resets at the time a new engine version is published.
export const MIN_NEW_COMPLETED_MATCHES = 20;

export function countNewCompletedMatches(matches, { promotedAt = 0, rulesVersion } = {}) {
    const unique = new Set();
    for (const match of matches || []) {
        if (!match || typeof match.matchId !== 'string' || !match.matchId.trim()) continue;
        if (match.status !== 'finished' || !['p1', 'p2'].includes(match.winner)) continue;
        if (!Number.isFinite(match.completedAt) || match.completedAt <= promotedAt) continue;
        if (rulesVersion !== undefined && match.rulesVersion !== rulesVersion) continue;
        unique.add(match.matchId);
    }
    return unique.size;
}

export function engineUpdateEligibility(matches, options = {}) {
    const completed = countNewCompletedMatches(matches, options);
    return {
        eligible: completed >= MIN_NEW_COMPLETED_MATCHES,
        completed,
        required: MIN_NEW_COMPLETED_MATCHES,
        remaining: Math.max(0, MIN_NEW_COMPLETED_MATCHES - completed)
    };
}
