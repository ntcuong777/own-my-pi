import { CursorLiveRunAbortError } from "./cursor-live-run-coordinator.js";
const turnQueuesByScope = new Map();
async function waitForPreviousTurn(previous, signal) {
    if (!signal) {
        await previous.catch(() => undefined);
        return;
    }
    if (signal.aborted)
        throw new CursorLiveRunAbortError();
    await new Promise((resolve, reject) => {
        const onAbort = () => {
            reject(new CursorLiveRunAbortError());
        };
        signal.addEventListener("abort", onAbort, { once: true });
        previous.catch(() => undefined).then(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        });
    });
}
export async function runExclusiveCursorSessionTurn(scopeKey, body, signal) {
    const previous = turnQueuesByScope.get(scopeKey);
    let releaseCurrent;
    const current = new Promise((resolve) => {
        releaseCurrent = resolve;
    });
    const tail = (previous ?? Promise.resolve()).catch(() => undefined).then(() => current);
    turnQueuesByScope.set(scopeKey, tail);
    void tail.finally(() => {
        if (turnQueuesByScope.get(scopeKey) === tail) {
            turnQueuesByScope.delete(scopeKey);
        }
    });
    try {
        if (previous)
            await waitForPreviousTurn(previous, signal);
        return await body();
    }
    finally {
        releaseCurrent();
    }
}
export const __testUtils = {
    reset() {
        turnQueuesByScope.clear();
    },
    count() {
        return turnQueuesByScope.size;
    },
};
