import { classifyMove } from './analysis-engine.js';

self.onmessage = event => {
    const { before, after, pid, index, run } = event.data;
    try {
        const result = classifyMove(before, after, pid, null, { depth: 4, maxNodes: 2500 });
        self.postMessage({ index, run, result });
    } catch (error) {
        self.postMessage({ index, run, error: error.message });
    }
};
