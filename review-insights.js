import { distanceToGoal, goalRowFor } from './ai.js';
import { evaluatePosition, winChance } from './analysis-engine.js';

export function reviewTrend(history, pid) {
    return history.map(entry => winChance(evaluatePosition(entry.state, pid)));
}

export function reviewSummary(reports, history, pid) {
    const result = { best: 0, good: 0, mistakes: 0, critical: 0, reviewed: 0 };
    reports.forEach((report, index) => {
        if (!report || history[index]?.turn !== pid) return;
        result.reviewed++;
        if (report.label === 'En iyi') result.best++;
        else if (report.label === 'İyi') result.good++;
        else result.mistakes++;
    });
    result.critical = reports.filter(report => report && (report.label === 'Hata' || report.label === 'Büyük hata')).length;
    return result;
}

export function keyMoveIndexes(reports) {
    return reports.flatMap((report, index) => report && (
        report.label === 'Hata' || report.label === 'Büyük hata' ||
        (report.label === 'En iyi' && report.afterChance - report.beforeChance >= 20)
    ) ? [index + 1] : []);
}

export function describePosition(before, after, pid) {
    const foe = pid === 'p1' ? 'p2' : 'p1';
    const ownGoal = goalRowFor(pid, before.rows);
    const foeGoal = goalRowFor(foe, before.rows);
    const distance = (state, player, goal) => distanceToGoal(state, state.players[player].x, state.players[player].y, goal);
    const ownChange = distance(after, pid, ownGoal) - distance(before, pid, ownGoal);
    const foeChange = distance(after, foe, foeGoal) - distance(before, foe, foeGoal);
    if (after.players[pid].y === ownGoal) return 'Hedef satıra ulaştın.';
    if (foeChange > 0 && foeChange > ownChange) return `Rakibin en kısa yolu ${foeChange} adım uzadı.`;
    if (ownChange < 0) return `Hedefe olan en kısa yolun ${-ownChange} adım kısaldı.`;
    if (ownChange > 0) return `Hedefe olan yolun ${ownChange} adım uzadı.`;
    return 'Konumun genel dengesini ve motor önerisini karşılaştır.';
}
