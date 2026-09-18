import { createHash, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, toNamespacedPath } from "node:path";
import { loadCursorSdk } from "./cursor-sdk-runtime.js";
let sdkOperationsForTests;
export function hashCursorSessionStoreScope(scopeKey) {
    return createHash("sha256")
        .update("pi-cursor-sdk-session-store\0")
        .update(scopeKey)
        .digest("hex")
        .slice(0, 32);
}
export function buildCursorSessionStateRoot(defaultStateRoot, scopeKey, persistent) {
    const baseRoot = persistent ? defaultStateRoot : join(tmpdir(), `pi-cursor-sdk-${randomUUID()}`);
    return join(baseRoot, "pi-sessions", hashCursorSessionStoreScope(scopeKey));
}
async function getSdkOperations() {
    if (sdkOperationsForTests)
        return sdkOperationsForTests;
    const [{ getDefaultSdkStateRoot }, { SqliteLocalAgentStore }] = await Promise.all([
        loadCursorSdk(),
        import("@cursor/sdk/sqlite"),
    ]);
    return {
        getDefaultStateRoot: getDefaultSdkStateRoot,
        openSqliteStore: (options) => SqliteLocalAgentStore.open(options),
    };
}
export async function getCursorSessionStoreIdentities(cwd, scopeKey, persistent) {
    const defaultStateRoot = await (await getSdkOperations()).getDefaultStateRoot(cwd);
    return {
        defaultStore: { version: 1, stateRoot: defaultStateRoot },
        sessionStore: {
            version: 1,
            stateRoot: buildCursorSessionStateRoot(defaultStateRoot, scopeKey, persistent),
        },
    };
}
export function cursorSessionStoreIdentitiesEqual(left, right) {
    return left.version === right.version && left.stateRoot === right.stateRoot;
}
async function openOwnedCursorSessionStore(cwd, identity, removalRoot) {
    const openedIdentity = Object.freeze({ ...identity });
    let store;
    try {
        store = await (await getSdkOperations()).openSqliteStore({
            workspaceRef: cwd,
            stateRoot: toNamespacedPath(openedIdentity.stateRoot),
        });
    }
    catch (error) {
        if (removalRoot)
            await rm(removalRoot, { recursive: true, force: true }).catch(() => undefined);
        throw error;
    }
    return {
        identity: openedIdentity,
        store,
        dispose: async () => {
            try {
                await store.dispose();
            }
            finally {
                if (removalRoot)
                    await rm(removalRoot, { recursive: true, force: true });
            }
        },
    };
}
export function openCursorSessionStore(cwd, identity) {
    return openOwnedCursorSessionStore(cwd, identity);
}
export async function openCursorSessionStoreForScope(options) {
    const identities = await getCursorSessionStoreIdentities(options.cwd, options.scopeKey, options.persistent);
    const requestedResumeIdentity = options.hasResumeHandle
        ? options.resumeIdentity ?? (options.persistent ? identities.defaultStore : undefined)
        : undefined;
    const resumableIdentities = options.persistent
        ? [identities.defaultStore, identities.sessionStore]
        : [identities.sessionStore];
    const resumeIdentity = requestedResumeIdentity && resumableIdentities
        .find((identity) => cursorSessionStoreIdentitiesEqual(identity, requestedResumeIdentity));
    let resumeAttemptAllowed = options.hasResumeHandle && resumeIdentity !== undefined;
    let resumeFallback = options.persistent && options.hasResumeHandle && !resumeIdentity;
    const selectedIdentity = resumeIdentity ?? identities.sessionStore;
    const removalRoot = options.persistent ? undefined : dirname(dirname(identities.sessionStore.stateRoot));
    let sessionStore;
    try {
        sessionStore = await openOwnedCursorSessionStore(options.cwd, selectedIdentity, removalRoot);
    }
    catch (error) {
        if (!resumeIdentity || cursorSessionStoreIdentitiesEqual(resumeIdentity, identities.sessionStore))
            throw error;
        resumeAttemptAllowed = false;
        resumeFallback = true;
        sessionStore = await openOwnedCursorSessionStore(options.cwd, identities.sessionStore);
    }
    return { sessionStore, identities, resumeAttemptAllowed, resumeFallback };
}
export const __testUtils = {
    setSdkOperations(operations) {
        sdkOperationsForTests = operations;
    },
};
