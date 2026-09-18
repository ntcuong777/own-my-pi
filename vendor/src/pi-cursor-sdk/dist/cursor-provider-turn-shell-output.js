import { asRecord, getField, hasUsableText } from "./cursor-record-utils.js";
import { scrubSensitiveText } from "./cursor-sensitive-text.js";
import { truncateCursorDisplayLine } from "./cursor-display-text.js";
import { classifyCursorToolVisibility } from "./cursor-tool-visibility.js";
const SHELL_OUTPUT_PROGRESS_MAX_DELTAS_PER_CALL = 3;
export function isCursorShellToolCall(toolCall) {
    return classifyCursorToolVisibility(toolCall).normalizedKey === "shell";
}
export function getCursorShellOutputDelta(update) {
    if (update.type !== "shell-output-delta")
        return undefined;
    const event = getField(update, "event");
    const eventCase = getField(event, "case");
    if (eventCase !== "stdout" && eventCase !== "stderr")
        return undefined;
    const value = getField(event, "value");
    const data = getField(value, "data");
    if (typeof data !== "string" || data.length === 0)
        return undefined;
    return { stream: eventCase, data };
}
function getCursorShellOutputProgressPreview(data) {
    return data
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0);
}
export function formatCursorShellOutputProgressText(progress, apiKey) {
    const preview = getCursorShellOutputProgressPreview(progress.data);
    if (!preview)
        return undefined;
    return `Cursor shell ${progress.stream}: ${truncateCursorDisplayLine(scrubSensitiveText(preview, apiKey), 160)}\n`;
}
export function mergeShellOutputDeltasIntoCursorToolCall(toolCall, deltas) {
    if (!deltas)
        return toolCall;
    const stdout = deltas.stdout.join("");
    const stderr = deltas.stderr.join("");
    if (!hasUsableText(stdout) && !hasUsableText(stderr))
        return toolCall;
    const toolRecord = asRecord(toolCall);
    const result = getField(toolRecord, "result");
    const resultRecord = asRecord(result);
    if (!toolRecord || !resultRecord || resultRecord.status !== "success")
        return toolCall;
    const value = getField(resultRecord, "value");
    const valueRecord = asRecord(value);
    const completedStdout = getField(valueRecord, "stdout");
    const completedStderr = getField(valueRecord, "stderr");
    if (hasUsableText(typeof completedStdout === "string" ? completedStdout : undefined))
        return toolCall;
    if (hasUsableText(typeof completedStderr === "string" ? completedStderr : undefined))
        return toolCall;
    return {
        ...toolRecord,
        result: {
            ...resultRecord,
            value: {
                ...(valueRecord ?? {}),
                stdout,
                stderr,
            },
        },
    };
}
export class CursorShellOutputTracker {
    activeShellCallIds = new Set();
    ambiguousShellOutputCallIds = new Set();
    shellOutputDeltasByCallId = new Map();
    shellOutputProgressCountsByCallId = new Map();
    onShellToolStarted(callId) {
        this.activeShellCallIds.add(callId);
    }
    onShellToolCleared(callId) {
        this.activeShellCallIds.delete(callId);
        this.ambiguousShellOutputCallIds.delete(callId);
        this.shellOutputProgressCountsByCallId.delete(callId);
    }
    appendShellOutputDelta(delta) {
        if (this.activeShellCallIds.size !== 1) {
            for (const activeCallId of this.activeShellCallIds) {
                this.ambiguousShellOutputCallIds.add(activeCallId);
                this.shellOutputDeltasByCallId.delete(activeCallId);
                this.shellOutputProgressCountsByCallId.delete(activeCallId);
            }
            return undefined;
        }
        const [callId] = this.activeShellCallIds;
        if (!callId || this.ambiguousShellOutputCallIds.has(callId))
            return undefined;
        let deltas = this.shellOutputDeltasByCallId.get(callId);
        if (!deltas) {
            deltas = { stdout: [], stderr: [] };
            this.shellOutputDeltasByCallId.set(callId, deltas);
        }
        deltas[delta.stream].push(delta.data);
        if (!getCursorShellOutputProgressPreview(delta.data))
            return undefined;
        const progressCount = this.shellOutputProgressCountsByCallId.get(callId) ?? 0;
        if (progressCount >= SHELL_OUTPUT_PROGRESS_MAX_DELTAS_PER_CALL)
            return undefined;
        this.shellOutputProgressCountsByCallId.set(callId, progressCount + 1);
        return { ...delta, callId };
    }
    takeDeltasForCall(callId) {
        const deltas = this.shellOutputDeltasByCallId.get(callId);
        this.shellOutputDeltasByCallId.delete(callId);
        this.shellOutputProgressCountsByCallId.delete(callId);
        return deltas;
    }
    clear() {
        this.activeShellCallIds.clear();
        this.ambiguousShellOutputCallIds.clear();
        this.shellOutputDeltasByCallId.clear();
        this.shellOutputProgressCountsByCallId.clear();
    }
}
