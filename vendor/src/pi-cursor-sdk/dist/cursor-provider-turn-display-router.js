import { cursorLiveRuns } from "./cursor-provider-live-run-drain.js";
import { truncateCursorDisplayLine } from "./cursor-display-text.js";
import { formatInactiveCursorReplayTrace } from "./cursor-native-replay-trace.js";
import { resolveNativeReplayDisposition } from "./cursor-native-replay-routing.js";
import { buildIncompleteCursorToolDisplay, formatIncompleteCursorToolTrace, } from "./cursor-incomplete-tool-visibility.js";
import { scrubPiToolDisplay, scrubSensitiveText } from "./cursor-sensitive-text.js";
import { buildCursorPiToolDisplay, formatCursorToolTranscript, getCursorCreatePlanText, } from "./cursor-tool-transcript.js";
import { getToolName } from "./cursor-transcript-utils.js";
function formatCursorToolName(toolCall) {
    return truncateCursorDisplayLine(getToolName(toolCall), 80) || "unknown";
}
export class CursorTurnDisplayRouter {
    cwd;
    resolvedApiKey;
    liveRun;
    useNativeToolReplay;
    activeToolNames;
    nativeReplayId;
    contentEmitter;
    debugRecorder;
    nativeToolDisplayCounter = 0;
    nativeToolReplayStarted = false;
    planTextCandidate;
    constructor(options) {
        this.cwd = options.cwd;
        this.resolvedApiKey = options.resolvedApiKey;
        this.liveRun = options.liveRun;
        this.useNativeToolReplay = options.useNativeToolReplay;
        this.activeToolNames = options.activeToolNames;
        this.nativeReplayId = options.nativeReplayId;
        this.contentEmitter = options.contentEmitter;
        this.debugRecorder = options.debugRecorder;
    }
    routeCompletedToolCall(toolCall, options = {}) {
        const planText = getCursorCreatePlanText(toolCall);
        if (planText)
            this.planTextCandidate = scrubSensitiveText(planText, this.resolvedApiKey);
        const transcript = scrubSensitiveText(formatCursorToolTranscript(toolCall, { cwd: this.cwd }), this.resolvedApiKey);
        const display = buildCursorPiToolDisplay(toolCall, { cwd: this.cwd });
        const disposition = resolveNativeReplayDisposition({
            toolName: display.toolName,
            useNativeToolReplay: this.useNativeToolReplay,
            activeToolNames: this.activeToolNames,
            hasLiveRun: this.liveRun !== undefined,
        });
        if (disposition === "queue_replay" && this.liveRun) {
            this.nativeToolReplayStarted = true;
            const id = `${this.nativeReplayId}-tool-${++this.nativeToolDisplayCounter}`;
            const scrubbedDisplay = scrubPiToolDisplay(display, this.resolvedApiKey);
            this.recordDisplayDecision({
                action: "queue_replay",
                disposition,
                toolName: display.toolName,
                identity: options.identity,
                source: options.source,
                transcript,
                replayToolId: id,
            });
            return { kind: "queue_replay", tool: scrubbedDisplay, replayToolId: id, disposition };
        }
        const traceText = disposition === "inactive_trace"
            ? formatInactiveCursorReplayTrace(scrubPiToolDisplay(display, this.resolvedApiKey))
            : transcript || `Cursor tool: ${formatCursorToolName(toolCall)} completed`;
        this.recordDisplayDecision({
            action: "emit_trace",
            disposition,
            toolName: display.toolName,
            identity: options.identity,
            source: options.source,
            transcript,
            traceText,
        });
        return { kind: "emit_trace", traceText, disposition };
    }
    routeIncompleteStartedToolCall(toolCall, reason) {
        const display = scrubPiToolDisplay(buildIncompleteCursorToolDisplay(toolCall, reason, { apiKey: this.resolvedApiKey }), this.resolvedApiKey);
        const disposition = resolveNativeReplayDisposition({
            toolName: display.toolName,
            useNativeToolReplay: this.useNativeToolReplay,
            activeToolNames: this.activeToolNames,
            hasLiveRun: this.liveRun !== undefined,
        });
        if (disposition === "queue_replay" && this.liveRun && reason !== "abort") {
            this.nativeToolReplayStarted = true;
            const id = `${this.nativeReplayId}-tool-${++this.nativeToolDisplayCounter}`;
            this.recordDisplayDecision({
                action: "queue_replay",
                disposition,
                toolName: display.toolName,
                source: "started",
                reason: "incomplete-started-tool-call",
                replayToolId: id,
            });
            return { kind: "queue_replay", tool: display, replayToolId: id, disposition };
        }
        const traceText = disposition === "inactive_trace"
            ? formatInactiveCursorReplayTrace(display)
            : formatIncompleteCursorToolTrace(display);
        this.recordDisplayDecision({
            action: "emit_trace",
            disposition,
            toolName: display.toolName,
            source: "started",
            reason: "incomplete-started-tool-call",
            traceText,
        });
        return { kind: "emit_trace", traceText, disposition };
    }
    emitDisplayAction(action) {
        if (action.kind === "queue_replay") {
            if (!this.liveRun)
                return;
            cursorLiveRuns.queueEvent(this.liveRun, {
                type: "tool",
                tool: { ...action.tool, id: action.replayToolId },
            });
            return;
        }
        this.emitCursorToolTrace(action.traceText);
    }
    recordIgnoreBridgeDecision(identity, toolName, source) {
        this.debugRecorder?.recordDisplayDecision({
            action: "ignore-bridge",
            toolName,
            identity,
            source,
        });
    }
    recordDuplicateSkip(toolName, options) {
        this.recordDisplayDecision({
            action: "skip-duplicate",
            toolName,
            identity: options.identity,
            source: options.source,
            reason: options.reason,
        });
    }
    recordIncompleteSkip(toolName, reason) {
        this.recordDisplayDecision({
            action: "skip-incomplete-fast-local",
            toolName,
            source: "started",
            reason,
        });
    }
    recordDisplayDecision(decision) {
        this.debugRecorder?.recordDisplayDecision(decision);
    }
    emitCursorToolTrace(text) {
        const traceText = text.endsWith("\n") ? text : `${text}\n`;
        if (this.liveRun) {
            cursorLiveRuns.queueEvent(this.liveRun, { type: "thinking-delta", text: traceText });
            cursorLiveRuns.queueEvent(this.liveRun, { type: "thinking-completed" });
            return;
        }
        this.contentEmitter.appendThinkingBlock(traceText);
    }
}
