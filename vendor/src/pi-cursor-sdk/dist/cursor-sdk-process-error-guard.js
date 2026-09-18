import { classifyCursorConnectError, isCursorSdkAbortConnectError, isCursorSdkConnectionStalledError } from "./cursor-provider-errors.js";
// Cursor SDK controlled-exec tasks can reject after their originating provider turn
// has ended. The exact closed-writable failure is therefore session-scoped; existing
// ConnectRPC suppression remains scoped to active provider turns.
const activeProviderTurns = new Set();
const activeSessions = new Set();
let activeLifecycleSessionGuard;
let originalProcessEmit;
let cursorProcessEmit;
let bunUnhandledRejectionListenerInstalled = false;
function hasActiveGuard() {
    return activeProviderTurns.size > 0 || activeSessions.size > 0;
}
function hasActiveAbortSuppression() {
    for (const turn of activeProviderTurns) {
        if (turn.suppressAbortErrors)
            return true;
    }
    return false;
}
function isCursorProvenance(source) {
    return source === "cursor-sdk-stack" || source === "cursor-extension-connect-stack" || source === "cursor-backend-details";
}
function isCursorSdkWriteIterableClosedError(error) {
    return (error instanceof Error &&
        error.name === "WriteIterableClosedError" &&
        error.message === "WritableIterable is closed" &&
        /(?:^|[\\/])node_modules[\\/]@cursor[\\/]sdk[\\/]dist[\\/]/.test(error.stack ?? ""));
}
// The Cursor SDK aborts an in-flight controlled-exec turn via its internal
// `AbortController.abort()` (user interrupt or stall-detector cancellation),
// which surfaces as a raw `DOMException [AbortError]` rather than a
// `ConnectError`. `classifyCursorConnectError` returns undefined for it, so it
// otherwise falls through the emit patch and terminates the process. A
// DOMException is not `instanceof Error`, so match structurally on the
// `AbortError` name plus the same `@cursor/sdk/dist` stack provenance the
// WriteIterableClosedError recognizer uses, keeping unrelated AbortErrors fatal.
function isCursorSdkAbortError(error) {
    if (typeof error !== "object" || error === null)
        return false;
    const { name, stack } = error;
    return (name === "AbortError" &&
        typeof stack === "string" &&
        /(?:^|[\\/])node_modules[\\/]@cursor[\\/]sdk[\\/]dist[\\/]/.test(stack));
}
// The exact observed incident: the Cursor SDK 1.0.23 local shell executor writes a
// spawned child's stdin without a stream 'error' listener, so a child exiting while
// a write is in flight surfaces a raw `write EPIPE` uncaught exception whose stack
// is exactly the single async pipe-write completion frame. Installed 1.0.27 attaches
// a no-op `error` listener before that write; keep this guard as defense in depth.
// Pi's own piped-stdout or dead-terminal EPIPE normally surfaces through the
// synchronous write-dispatch path with multiple frames (afterWriteDispatched /
// Socket._writeGeneric) and must stay fatal per Unix convention, so anything beyond
// this one-frame contract is rejected.
const OBSERVED_CLOSED_PIPE_STACK_FRAME = /^\s+at WriteWrap\.onWriteComplete \[as oncomplete\] \(node:internal\/stream_base_commons:\d+:\d+\)$/;
function isObservedLocalTransportClosedPipeWriteError(error) {
    if (!(error instanceof Error) || error.name !== "Error")
        return false;
    const { code, syscall } = error;
    if (code !== "EPIPE" || syscall !== "write" || !error.message.startsWith("write EPIPE"))
        return false;
    const frames = (error.stack ?? "").split("\n").filter((line) => /^\s+at /.test(line));
    return frames.length === 1 && OBSERVED_CLOSED_PIPE_STACK_FRAME.test(frames[0] ?? "");
}
// Contained only while a provider turn that declared a local transport is active;
// each contained turn invalidates its own session-agent scope for recreation.
function containLocalTransportClosedPipeError() {
    let contained = false;
    for (const turn of [...activeProviderTurns]) {
        if (!turn.onLocalTransportClosedPipe)
            continue;
        contained = true;
        try {
            turn.onLocalTransportClosedPipe();
        }
        catch {
            // stale-agent invalidation must not throw inside process error handling
        }
    }
    return contained;
}
function shouldSuppressProcessError(event, args) {
    if (event !== "uncaughtException" && event !== "unhandledRejection")
        return false;
    const error = args[0];
    if (isObservedLocalTransportClosedPipeWriteError(error)) {
        return containLocalTransportClosedPipeError();
    }
    if (isCursorSdkWriteIterableClosedError(error))
        return activeSessions.size > 0;
    // SDK stall timers and inter-turn teardown aborts never call suppressAbortErrors();
    // any active provider turn or session is enough — stack provenance already gates SDK-only AbortErrors.
    if (isCursorSdkAbortError(error))
        return hasActiveGuard();
    // RetriableError "Connection stalled" / "Connection stalled repeatedly" is not a ConnectError; suppress during active turns only.
    if (isCursorSdkConnectionStalledError(error))
        return activeProviderTurns.size > 0;
    const classification = classifyCursorConnectError(error);
    if (!classification)
        return false;
    if (classification.kind === "abort")
        return hasActiveAbortSuppression();
    if (activeProviderTurns.size === 0)
        return false;
    if (classification.kind === "network")
        return isCursorProvenance(classification.source) || classification.source === "connect-node-stack";
    return isCursorProvenance(classification.source);
}
function installProcessEmitPatch() {
    if (cursorProcessEmit) {
        if (process.emit === cursorProcessEmit)
            return;
        if (process.emit !== originalProcessEmit)
            return;
        cursorProcessEmit = undefined;
        originalProcessEmit = undefined;
    }
    const forwardEmit = process.emit;
    originalProcessEmit = forwardEmit;
    cursorProcessEmit = function patchedCursorSdkProcessErrorEmit(event, ...args) {
        if (shouldSuppressProcessError(event, args))
            return true;
        return forwardEmit.call(this, event, ...args);
    };
    process.emit = cursorProcessEmit;
}
function isBunRuntime() {
    return typeof process.versions.bun === "string";
}
function handleBunUnhandledRejection(error) {
    if (shouldSuppressProcessError("unhandledRejection", [error]))
        return;
    // Without another rejection listener, retain Bun's default fatal behavior.
    if (process.listenerCount("unhandledRejection") === 1)
        throw error;
}
function installBunUnhandledRejectionListener() {
    if (!isBunRuntime() || bunUnhandledRejectionListenerInstalled)
        return;
    process.prependListener("unhandledRejection", handleBunUnhandledRejection);
    bunUnhandledRejectionListenerInstalled = true;
}
function uninstallBunUnhandledRejectionListenerIfIdle() {
    if (hasActiveGuard() || !bunUnhandledRejectionListenerInstalled)
        return;
    process.off("unhandledRejection", handleBunUnhandledRejection);
    bunUnhandledRejectionListenerInstalled = false;
}
function uninstallProcessHooksIfIdle() {
    if (hasActiveGuard())
        return;
    uninstallBunUnhandledRejectionListenerIfIdle();
    if (!originalProcessEmit || !cursorProcessEmit || process.emit !== cursorProcessEmit)
        return;
    process.emit = originalProcessEmit;
    originalProcessEmit = undefined;
    cursorProcessEmit = undefined;
}
function installProcessHooks() {
    installProcessEmitPatch();
    installBunUnhandledRejectionListener();
}
export const __testUtils = {
    activeProviderTurnCount: () => activeProviderTurns.size,
    activeSessionCount: () => activeSessions.size,
    resetLifecycleSessionGuard() {
        activeLifecycleSessionGuard?.dispose();
        activeLifecycleSessionGuard = undefined;
    },
};
export { isCursorSdkAbortConnectError };
export function installCursorSdkProcessErrorGuard() {
    const token = { suppressAbortErrors: false };
    activeProviderTurns.add(token);
    installProcessHooks();
    let disposed = false;
    return {
        suppressAbortErrors() {
            if (disposed)
                return;
            token.suppressAbortErrors = true;
        },
        containLocalTransportClosedPipe(onClosedPipe) {
            if (disposed)
                return;
            token.onLocalTransportClosedPipe = onClosedPipe;
        },
        dispose() {
            if (disposed)
                return;
            disposed = true;
            activeProviderTurns.delete(token);
            uninstallProcessHooksIfIdle();
        },
    };
}
export function installCursorSdkSessionProcessErrorGuard() {
    const token = {};
    activeSessions.add(token);
    installProcessHooks();
    let disposed = false;
    return {
        dispose() {
            if (disposed)
                return;
            disposed = true;
            activeSessions.delete(token);
            uninstallProcessHooksIfIdle();
        },
    };
}
export function registerCursorSdkSessionProcessErrorGuard(pi) {
    pi.on("session_start", () => {
        activeLifecycleSessionGuard?.dispose();
        activeLifecycleSessionGuard = installCursorSdkSessionProcessErrorGuard();
    });
    pi.on("session_shutdown", () => {
        activeLifecycleSessionGuard?.dispose();
        activeLifecycleSessionGuard = undefined;
    });
}
