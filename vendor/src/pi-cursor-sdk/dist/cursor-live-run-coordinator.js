import { getCursorConversationMessages } from "./cursor-pi-context.js";
import { consumeCursorLiveToolResults, createCursorLiveRunAccountingState, recordCursorLiveSdkTurnEnded, takeCursorLiveSdkTurnUsage, takeCursorLiveTurnInputTokens, } from "./cursor-live-run-accounting.js";
import { getCursorSessionScopeKey } from "./cursor-session-scope.js";
import { installCursorSdkProcessErrorGuard } from "./cursor-sdk-process-error-guard.js";
export class CursorLiveRunAbortError extends Error {
    constructor() {
        super("aborted");
        this.name = "CursorLiveRunAbortError";
    }
}
function isPendingBridgeToolRequest(run, request) {
    const bridgeRun = [run.bridgeRun, run.sessionBridgeRun].find((candidate) => candidate?.id === request.runId);
    return bridgeRun?.hasPendingPiToolCallId(request.piToolCallId) === true;
}
async function cancelCursorLiveSdkRun(run) {
    if (!run.sdkRun)
        return;
    const guard = installCursorSdkProcessErrorGuard();
    guard.suppressAbortErrors();
    try {
        await run.sdkRun.cancel();
    }
    finally {
        guard.dispose();
    }
}
export function hasTrailingUserMessagesAfterToolResults(context) {
    const messages = getCursorConversationMessages(context);
    let index = messages.length - 1;
    let sawTrailingUser = false;
    while (index >= 0 && messages[index]?.role === "user") {
        sawTrailingUser = true;
        index -= 1;
    }
    if (!sawTrailingUser)
        return false;
    let sawToolResult = false;
    while (index >= 0 && messages[index]?.role === "toolResult") {
        sawToolResult = true;
        index -= 1;
    }
    return sawToolResult;
}
export function matchesCursorLiveRunToolResult(run, message, getReplayId) {
    const replayId = getReplayId(message.toolCallId);
    if (replayId)
        return replayId === run.id;
    return run.bridgeRun?.hasPendingPiToolCallId(message.toolCallId) ?? false;
}
function isSuccessfulCursorLiveRun(run) {
    return run.done && !run.cancelled && !run.errorMessage;
}
export function createCursorLiveRunCoordinator(deps) {
    const pendingRuns = new Map();
    const pendingRunIdsByScopeKey = new Map();
    const privateStates = new WeakMap();
    const getScopeKey = deps.getScopeKey ?? getCursorSessionScopeKey;
    function getPrivateState(run) {
        let state = privateStates.get(run);
        if (!state) {
            state = {
                waiters: new Set(),
                idleDisposeRequested: false,
                leased: false,
                leaseQueue: [],
            };
            privateStates.set(run, state);
        }
        return state;
    }
    function getUndisposed(runId) {
        if (!runId)
            return undefined;
        const run = pendingRuns.get(runId);
        if (!run || run.disposed)
            return undefined;
        return run;
    }
    function clearIdleDisposeTimer(run) {
        const state = getPrivateState(run);
        if (!state.idleDisposeTimer)
            return;
        clearTimeout(state.idleDisposeTimer);
        state.idleDisposeTimer = undefined;
    }
    function notifyProgress(run) {
        const state = getPrivateState(run);
        const waiters = [...state.waiters];
        state.waiters.clear();
        for (const waiter of waiters) {
            if (waiter.onAbort)
                waiter.signal?.removeEventListener("abort", waiter.onAbort);
            waiter.resolve();
        }
    }
    function removeLeaseWaiter(state, waiter) {
        const index = state.leaseQueue.indexOf(waiter);
        if (index >= 0)
            state.leaseQueue.splice(index, 1);
    }
    function grantNextLeaseOrUnlock(run) {
        const state = getPrivateState(run);
        while (state.leaseQueue.length > 0) {
            const next = state.leaseQueue.shift();
            if (!next)
                continue;
            if (next.onAbort)
                next.signal?.removeEventListener("abort", next.onAbort);
            next.resolve();
            return;
        }
        state.leased = false;
        if (state.idleDisposeRequested && !run.disposed) {
            coordinator.requestIdleDispose(run);
        }
    }
    async function acquireLease(run, signal) {
        if (signal?.aborted)
            throw new CursorLiveRunAbortError();
        const state = getPrivateState(run);
        if (!state.leased) {
            state.leased = true;
            return;
        }
        await new Promise((resolve, reject) => {
            const waiter = { resolve, reject, signal };
            const onAbort = () => {
                removeLeaseWaiter(state, waiter);
                reject(new CursorLiveRunAbortError());
            };
            waiter.onAbort = onAbort;
            state.leaseQueue.push(waiter);
            if (signal?.aborted) {
                onAbort();
                return;
            }
            signal?.addEventListener("abort", onAbort, { once: true });
        });
    }
    function unregister(run) {
        pendingRuns.delete(run.id);
        const scopeKey = run.sessionAgentScopeKey;
        if (pendingRunIdsByScopeKey.get(scopeKey) === run.id) {
            pendingRunIdsByScopeKey.delete(scopeKey);
        }
    }
    const coordinator = {
        start(params) {
            const sessionAgentScopeKey = params.sessionAgentScopeKey ?? getScopeKey();
            const run = {
                id: params.id,
                agent: params.agent,
                bridgeRun: params.bridgeRun,
                sessionBridgeRun: params.sessionBridgeRun,
                sessionAgentScopeKey,
                accounting: createCursorLiveRunAccountingState(params.promptInputTokens),
                pendingEvents: [],
                textDeltas: params.textDeltas ?? [],
                emittedText: "",
                recordedToolDisplayIds: [],
                done: false,
                cancelled: false,
                disposed: false,
                chainUserInputAfterCompletion: false,
                debugRecorder: params.debugRecorder,
            };
            privateStates.set(run, {
                waiters: new Set(),
                idleDisposeRequested: false,
                leased: false,
                leaseQueue: [],
            });
            pendingRuns.set(run.id, run);
            pendingRunIdsByScopeKey.set(sessionAgentScopeKey, run.id);
            return run;
        },
        attachSdkRun(run, sdkRun) {
            if (run.disposed)
                return;
            run.sdkRun = sdkRun;
        },
        markFinished(run, finalText) {
            if (run.disposed)
                return;
            run.finalText = finalText;
            run.cancelled = false;
            run.done = true;
            notifyProgress(run);
            coordinator.requestIdleDispose(run);
        },
        markCancelled(run, abortMessage) {
            if (run.disposed)
                return;
            run.cancelled = true;
            run.abortMessage = abortMessage;
            run.done = true;
            notifyProgress(run);
            coordinator.requestIdleDispose(run);
        },
        markError(run, errorMessage) {
            if (run.disposed)
                return;
            run.errorMessage = errorMessage;
            run.done = true;
            notifyProgress(run);
            coordinator.requestIdleDispose(run);
        },
        recordSdkTurnEnded(run, usage) {
            if (run.disposed)
                return;
            if (run.ignoreFutureSdkTurnUsage) {
                run.accounting = { ...run.accounting, sdkTurnEnded: false, sdkTurnUsage: undefined };
                notifyProgress(run);
                return;
            }
            run.accounting = recordCursorLiveSdkTurnEnded(run.accounting, usage);
            notifyProgress(run);
        },
        ignoreFutureSdkTurnUsage(run) {
            if (!run.disposed)
                run.ignoreFutureSdkTurnUsage = true;
        },
        hasSdkTurnEnded(run) {
            return run.accounting.sdkTurnEnded;
        },
        queueEvent(run, event) {
            if (run.disposed)
                return;
            run.pendingEvents.push(event);
            run.debugRecorder?.recordLiveRunEvent(event);
            notifyProgress(run);
        },
        peekEvent(run) {
            return run.pendingEvents[0];
        },
        shiftEvent(run) {
            return run.pendingEvents.shift();
        },
        collectNativeToolBatch(run) {
            const tools = [];
            while (run.pendingEvents[0]?.type === "tool") {
                const event = run.pendingEvents.shift();
                if (event?.type === "tool")
                    tools.push(event.tool);
            }
            return tools;
        },
        collectBridgeToolBatch(run) {
            const requests = [];
            while (run.pendingEvents[0]?.type === "bridge-tool") {
                const event = run.pendingEvents.shift();
                if (event?.type === "bridge-tool" && isPendingBridgeToolRequest(run, event.request)) {
                    requests.push(event.request);
                }
            }
            return requests;
        },
        consumeToolResults(run, context, getReplayId) {
            const consumed = consumeCursorLiveToolResults(run.accounting, context, (toolResult) => matchesCursorLiveRunToolResult(run, toolResult, getReplayId));
            run.accounting = consumed.state;
            return consumed;
        },
        takeTurnInputTokens(run, toolResultInputTokens) {
            const taken = takeCursorLiveTurnInputTokens(run.accounting, toolResultInputTokens);
            run.accounting = taken.state;
            return taken.sessionInputTokens;
        },
        takeSdkTurnUsage(run) {
            const taken = takeCursorLiveSdkTurnUsage(run.accounting);
            run.accounting = taken.state;
            return taken.sdkTurnUsage;
        },
        getPendingFromContext(context, getReplayId) {
            const messages = getCursorConversationMessages(context);
            let index = messages.length - 1;
            while (index >= 0 && messages[index]?.role === "user") {
                index -= 1;
            }
            for (; index >= 0; index -= 1) {
                const message = messages[index];
                if (message.role !== "toolResult")
                    break;
                const replayId = getReplayId(message.toolCallId);
                if (replayId) {
                    const replayRun = getUndisposed(replayId);
                    if (replayRun)
                        return replayRun;
                }
                for (const run of pendingRuns.values()) {
                    if (run.disposed)
                        continue;
                    if (run.bridgeRun?.hasPendingPiToolCallId(message.toolCallId))
                        return run;
                }
            }
            return undefined;
        },
        getActiveForScope(scopeKey = getScopeKey()) {
            return getUndisposed(pendingRunIdsByScopeKey.get(scopeKey));
        },
        isReady(run) {
            return run.disposed || run.pendingEvents.length > 0 || run.done || run.cancelled || run.errorMessage !== undefined;
        },
        async waitForProgress(run, signal) {
            if (signal?.aborted)
                throw new CursorLiveRunAbortError();
            if (coordinator.isReady(run))
                return;
            await new Promise((resolve, reject) => {
                const state = getPrivateState(run);
                const waiter = { resolve, reject, signal };
                const cleanup = () => {
                    state.waiters.delete(waiter);
                    if (waiter.onAbort)
                        signal?.removeEventListener("abort", waiter.onAbort);
                };
                const onAbort = () => {
                    cleanup();
                    reject(new CursorLiveRunAbortError());
                };
                waiter.onAbort = onAbort;
                waiter.resolve = () => {
                    cleanup();
                    resolve();
                };
                state.waiters.add(waiter);
                if (signal?.aborted) {
                    onAbort();
                    return;
                }
                signal?.addEventListener("abort", onAbort, { once: true });
            });
        },
        async withRunLease(run, signal, body) {
            await acquireLease(run, signal);
            clearIdleDisposeTimer(run);
            try {
                if (signal?.aborted)
                    throw new CursorLiveRunAbortError();
                return await body();
            }
            finally {
                grantNextLeaseOrUnlock(run);
            }
        },
        requestIdleDispose(run) {
            if (run.disposed)
                return;
            const state = getPrivateState(run);
            clearIdleDisposeTimer(run);
            state.idleDisposeRequested = true;
            if (state.leased || state.leaseQueue.length > 0)
                return;
            state.idleDisposeRequested = false;
            state.idleDisposeTimer = setTimeout(() => {
                void coordinator.release(run).catch(() => {
                    // Idle dispose must not leave release failures as unhandled rejections.
                });
            }, deps.getIdleDisposeMs());
            state.idleDisposeTimer.unref?.();
        },
        async release(run) {
            const state = getPrivateState(run);
            if (state.releasing)
                return state.releasing;
            state.releasing = (async () => {
                if (run.disposed)
                    return;
                const abandoned = !isSuccessfulCursorLiveRun(run);
                run.disposed = true;
                unregister(run);
                clearIdleDisposeTimer(run);
                state.idleDisposeRequested = false;
                notifyProgress(run);
                run.bridgeRun?.cancel("Cursor live run released");
                for (const toolDisplayId of run.recordedToolDisplayIds)
                    deps.deleteNativeToolDisplay(toolDisplayId);
                run.recordedToolDisplayIds = [];
                if (run.sessionBridgeRun) {
                    run.sessionBridgeRun.setOnToolRequest(undefined);
                }
                if (run.bridgeRun && run.bridgeRun !== run.sessionBridgeRun) {
                    try {
                        await run.bridgeRun.dispose();
                    }
                    catch {
                        // bridge disposal failure should not mask the provider result
                    }
                }
                if (abandoned) {
                    if (!run.done) {
                        try {
                            await cancelCursorLiveSdkRun(run);
                        }
                        catch {
                            // cancellation failure should not block session-agent abandonment
                        }
                    }
                    await deps.abandonSessionAgent(run.sessionAgentScopeKey);
                }
            })();
            return state.releasing;
        },
        count() {
            return pendingRuns.size;
        },
    };
    return coordinator;
}
