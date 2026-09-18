import { cursorLiveRuns } from "./cursor-provider-live-run-drain.js";
import { CursorPartialContentEmitter } from "./cursor-partial-content-emitter.js";
import { CURSOR_TOOL_LIFECYCLE_DEFER_MS, formatCursorToolLifecycleProgressText, isCursorToolLifecycleEligible, } from "./cursor-tool-lifecycle.js";
import { getNormalizedCursorToolName } from "./cursor-tool-visibility.js";
import { getStartedToolCallFingerprint } from "./cursor-provider-turn-tool-ledger.js";
export class CursorToolLifecycleEmitter {
    liveRun;
    resolvedApiKey;
    contentEmitter;
    debugRecorder;
    hasStartedToolCall;
    isBridgeMcpToolCall;
    emittedLifecycleCallIds = new Set();
    lifecycleTimers = new Map();
    activeLifecycleFingerprintOwners = new Map();
    lifecycleFingerprintByCallId = new Map();
    activeLifecycleProgressTextOwners = new Map();
    lifecycleProgressTextByCallId = new Map();
    constructor(options) {
        this.liveRun = options.liveRun;
        this.resolvedApiKey = options.resolvedApiKey;
        this.contentEmitter = options.contentEmitter;
        this.debugRecorder = options.debugRecorder;
        this.hasStartedToolCall = options.hasStartedToolCall;
        this.isBridgeMcpToolCall = options.isBridgeMcpToolCall;
    }
    maybeSchedule(callId, toolCall) {
        if (typeof callId !== "string" || this.emittedLifecycleCallIds.has(callId))
            return;
        if (this.isBridgeMcpToolCall(toolCall))
            return;
        if (!isCursorToolLifecycleEligible(toolCall))
            return;
        const progressText = formatCursorToolLifecycleProgressText(toolCall, this.resolvedApiKey);
        if (!progressText)
            return;
        const fingerprint = getStartedToolCallFingerprint(toolCall);
        const existingOwner = this.activeLifecycleFingerprintOwners.get(fingerprint);
        if (existingOwner && existingOwner !== callId) {
            this.debugRecorder?.recordCoordinatorEvent("tool_lifecycle_skip", {
                callId,
                ownerCallId: existingOwner,
                toolName: getNormalizedCursorToolName(toolCall),
                reason: "duplicate-active-fingerprint",
            });
            return;
        }
        this.cancel(callId);
        this.activeLifecycleFingerprintOwners.set(fingerprint, callId);
        this.lifecycleFingerprintByCallId.set(callId, fingerprint);
        if (!this.activeLifecycleProgressTextOwners.has(progressText)) {
            this.activeLifecycleProgressTextOwners.set(progressText, callId);
        }
        this.lifecycleProgressTextByCallId.set(callId, progressText);
        const timer = setTimeout(() => {
            this.lifecycleTimers.delete(callId);
            if (!this.hasStartedToolCall(callId)) {
                this.clearLifecycleIdentity(callId);
                return;
            }
            if (this.emittedLifecycleCallIds.has(callId))
                return;
            const progressOwner = this.activeLifecycleProgressTextOwners.get(progressText);
            if (progressOwner && progressOwner !== callId && this.hasStartedToolCall(progressOwner)) {
                this.debugRecorder?.recordCoordinatorEvent("tool_lifecycle_skip", {
                    callId,
                    ownerCallId: progressOwner,
                    toolName: getNormalizedCursorToolName(toolCall),
                    reason: "duplicate-active-progress-text",
                });
                return;
            }
            this.activeLifecycleProgressTextOwners.set(progressText, callId);
            this.emit(callId, toolCall, progressText);
        }, CURSOR_TOOL_LIFECYCLE_DEFER_MS);
        timer.unref?.();
        this.lifecycleTimers.set(callId, timer);
    }
    cancel(callId) {
        const timer = this.lifecycleTimers.get(callId);
        if (timer) {
            clearTimeout(timer);
            this.lifecycleTimers.delete(callId);
        }
        this.clearLifecycleIdentity(callId);
    }
    clear() {
        this.emittedLifecycleCallIds.clear();
        for (const timer of this.lifecycleTimers.values())
            clearTimeout(timer);
        this.lifecycleTimers.clear();
        this.activeLifecycleFingerprintOwners.clear();
        this.lifecycleFingerprintByCallId.clear();
        this.activeLifecycleProgressTextOwners.clear();
        this.lifecycleProgressTextByCallId.clear();
    }
    clearLifecycleIdentity(callId) {
        const fingerprint = this.lifecycleFingerprintByCallId.get(callId);
        if (fingerprint && this.activeLifecycleFingerprintOwners.get(fingerprint) === callId) {
            this.activeLifecycleFingerprintOwners.delete(fingerprint);
        }
        this.lifecycleFingerprintByCallId.delete(callId);
        const progressText = this.lifecycleProgressTextByCallId.get(callId);
        if (progressText && this.activeLifecycleProgressTextOwners.get(progressText) === callId) {
            this.activeLifecycleProgressTextOwners.delete(progressText);
        }
        this.lifecycleProgressTextByCallId.delete(callId);
    }
    emit(callId, toolCall, progressText) {
        this.emittedLifecycleCallIds.add(callId);
        this.debugRecorder?.recordCoordinatorEvent("tool_lifecycle", {
            callId,
            toolName: getNormalizedCursorToolName(toolCall),
            progressText,
            liveRun: this.liveRun !== undefined,
        });
        if (this.liveRun) {
            cursorLiveRuns.queueEvent(this.liveRun, { type: "thinking-delta", text: progressText });
            return;
        }
        this.contentEmitter.appendThinkingDelta(progressText);
    }
}
export function createTurnCoordinatorContentEmitter(stream, partial) {
    return new CursorPartialContentEmitter(stream, partial, undefined, false);
}
