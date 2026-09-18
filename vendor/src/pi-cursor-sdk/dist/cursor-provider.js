import { createAssistantMessageEventStream, } from "@earendil-works/pi-ai";
import { cursorLiveRuns, DEFAULT_CURSOR_NATIVE_REPLAY_IDLE_DISPOSE_MS, getPendingCursorLiveRun, hasTrailingUserMessagesAfterToolResults, releaseAllPendingCursorLiveRunsForTests, resetCursorNativeReplayIdleDisposeMs, setCursorNativeReplayIdleDisposeMs, } from "./cursor-provider-live-run-drain.js";
import { disposeAllSessionCursorAgents } from "./cursor-session-agent.js";
import { attachCursorSdkEventDebugPiStreamTap } from "./cursor-sdk-event-debug.js";
import { installCursorSdkProcessErrorGuard } from "./cursor-sdk-process-error-guard.js";
import { sanitizeCursorProviderError } from "./cursor-provider-errors.js";
import { resolveCursorApiKey } from "./cursor-api-key.js";
import { CursorProviderTurnRunner } from "./cursor-provider-turn-runner.js";
import { getCursorSessionScopeKey } from "./cursor-session-scope.js";
import { runExclusiveCursorSessionTurn, __testUtils as cursorSessionTurnQueueTestUtils } from "./cursor-session-turn-queue.js";
function makeInitialMessage(model) {
    return {
        role: "assistant",
        content: [],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
    };
}
export function streamCursor(model, context, options) {
    const stream = createAssistantMessageEventStream();
    const sdkEventDebugRef = {};
    attachCursorSdkEventDebugPiStreamTap(stream, sdkEventDebugRef);
    (async () => {
        const partial = makeInitialMessage(model);
        const runner = new CursorProviderTurnRunner({
            model,
            context,
            stream,
            partial,
            options,
            sdkEventDebugRef,
        });
        try {
            stream.push({ type: "start", partial });
            await runExclusiveCursorSessionTurn(getCursorSessionScopeKey(), () => runner.run(installCursorSdkProcessErrorGuard()), options?.signal);
        }
        catch (error) {
            await runner.handleOuterCatch(error);
        }
        stream.end();
    })().catch((error) => {
        const partial = makeInitialMessage(model);
        partial.stopReason = "error";
        partial.errorMessage = sanitizeCursorProviderError(error, resolveCursorApiKey(options?.apiKey));
        stream.push({ type: "error", reason: "error", error: partial });
        stream.end();
    });
    return stream;
}
export const __testUtils = {
    DEFAULT_CURSOR_NATIVE_REPLAY_IDLE_DISPOSE_MS,
    pendingCursorNativeRunCount: cursorLiveRuns.count,
    getPendingCursorLiveRun,
    getActiveCursorLiveRunForScope: cursorLiveRuns.getActiveForScope,
    hasTrailingUserMessagesAfterToolResults,
    setCursorNativeReplayIdleDisposeMs,
    resetCursorNativeReplayIdleDisposeMs,
    releaseAllPendingCursorLiveRunsForTests,
    resetSessionCursorAgents: () => disposeAllSessionCursorAgents(),
    resetSessionTurnQueue: cursorSessionTurnQueueTestUtils.reset,
};
