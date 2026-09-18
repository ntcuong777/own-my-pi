import { getToolArgs, getToolName } from "./cursor-transcript-utils.js";
export class CursorToolCompletionLedger {
    startedToolCalls = new Map();
    bridgeStartedToolCallIds = new Set();
    completedToolIdentities = new Set();
    completedStartedToolFingerprints = new Set();
    completedFallbackToolFingerprints = new Set();
    getStartedToolCall(callId) {
        return this.startedToolCalls.get(callId);
    }
    hasStartedToolCall(callId) {
        return this.startedToolCalls.has(callId);
    }
    registerStartedToolCall(callId, toolCall) {
        this.startedToolCalls.set(callId, toolCall);
    }
    markBridgeStarted(callId) {
        this.bridgeStartedToolCallIds.add(callId);
    }
    takeBridgeStartedCallId(callId) {
        if (!this.bridgeStartedToolCallIds.has(callId))
            return undefined;
        this.bridgeStartedToolCallIds.delete(callId);
        return callId;
    }
    clearStartedToolCall(callId) {
        this.startedToolCalls.delete(callId);
        this.bridgeStartedToolCallIds.delete(callId);
    }
    removeStartedToolCallForStep(toolCall, stepId) {
        if (typeof stepId === "string" && this.startedToolCalls.has(stepId)) {
            this.clearStartedToolCall(stepId);
            return stepId;
        }
        const fingerprint = getStartedToolCallFingerprint(toolCall);
        for (const [callId, startedToolCall] of this.startedToolCalls) {
            if (getStartedToolCallFingerprint(startedToolCall) !== fingerprint)
                continue;
            this.clearStartedToolCall(callId);
            return callId;
        }
        return undefined;
    }
    recordCompletedIdentity(identity) {
        this.completedToolIdentities.add(identity);
    }
    shouldSkipDuplicateCompletion(input) {
        if (input.identity && this.completedToolIdentities.has(input.identity)) {
            return "identity-already-completed";
        }
        if (input.source === "started") {
            if (this.completedFallbackToolFingerprints.has(input.fingerprint)) {
                return "fallback-fingerprint-already-completed";
            }
            return undefined;
        }
        if (this.completedStartedToolFingerprints.has(input.fingerprint) ||
            this.completedFallbackToolFingerprints.has(input.fingerprint)) {
            return "fingerprint-already-completed";
        }
        return undefined;
    }
    recordCompletedTool(input) {
        if (input.identity)
            this.completedToolIdentities.add(input.identity);
        if (input.source === "started") {
            this.completedStartedToolFingerprints.add(input.fingerprint);
        }
        else {
            this.completedFallbackToolFingerprints.add(input.fingerprint);
        }
    }
    clear() {
        this.startedToolCalls.clear();
        this.bridgeStartedToolCallIds.clear();
        this.completedToolIdentities.clear();
        this.completedStartedToolFingerprints.clear();
        this.completedFallbackToolFingerprints.clear();
    }
    /** Exposed for incomplete-tool discard iteration. */
    startedToolCallEntries() {
        return this.startedToolCalls.entries();
    }
    clearStartedToolCalls() {
        this.startedToolCalls.clear();
        this.bridgeStartedToolCallIds.clear();
    }
}
export function getToolFingerprint(value) {
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
}
export function getStartedToolCallFingerprint(toolCall) {
    return getToolFingerprint({ toolName: getToolName(toolCall), args: getToolArgs(toolCall) });
}
