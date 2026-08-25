// local-room.js — Tek kişilik mod için Firebase oda düğümünün yerel karşılığı.
// set / update / onValue davranışı Firebase Realtime Database ile aynı şekilde
// çalışır, böylece oyun mantığı (sendMove, listenGameLoop, resetRoom) çevrimiçi
// modda olduğu gibi değişmeden kullanılabilir.

function clone(value) {
    if (value === null || typeof value !== 'object') return value;
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

export class LocalRoom {
    constructor(initialData = {}) {
        this._data = clone(initialData);
        this._listeners = new Set();
        this._notifyQueued = false;
    }

    val() {
        return clone(this._data);
    }

    set(data) {
        this._data = clone(data);
        this._notify();
    }

    /**
     * Firebase'in çok yollu güncellemesi: { '/boardState/p1/x': 3, '/turn': 'p2' }
     * Değer null ise anahtar silinir.
     */
    update(updates) {
        for (const rawPath of Object.keys(updates)) {
            const parts = rawPath.split('/').filter(Boolean);
            if (parts.length === 0) continue;

            let node = this._data;
            for (let i = 0; i < parts.length - 1; i++) {
                const key = parts[i];
                if (node[key] === null || typeof node[key] !== 'object') node[key] = {};
                node = node[key];
            }
            const leaf = parts[parts.length - 1];
            const value = updates[rawPath];
            if (value === null || value === undefined) delete node[leaf];
            else node[leaf] = clone(value);
        }
        this._notify();
    }

    /** Firebase onValue ile aynı imza: callback(snapshot), geri dönüş = unsubscribe. */
    onValue(callback) {
        this._listeners.add(callback);
        const snapshot = { val: () => this.val() };
        // Firebase de ilk anlık görüntüyü asenkron gönderir.
        Promise.resolve().then(() => {
            if (this._listeners.has(callback)) callback(snapshot);
        });
        return () => this._listeners.delete(callback);
    }

    _notify() {
        if (this._notifyQueued) return;
        this._notifyQueued = true;
        Promise.resolve().then(() => {
            this._notifyQueued = false;
            const snapshot = { val: () => this.val() };
            this._listeners.forEach(cb => cb(snapshot));
        });
    }

    destroy() {
        this._listeners.clear();
    }
}
