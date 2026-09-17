// Late SDK results must never open an ad after navigation has resumed.
export async function within(promise, milliseconds, fallback = false) {
    let timer;
    try {
        return await Promise.race([
            promise,
            new Promise(resolve => { timer = setTimeout(() => resolve(fallback), milliseconds); }),
        ]);
    } finally { clearTimeout(timer); }
}
