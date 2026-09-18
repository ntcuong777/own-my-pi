import { createHash } from "node:crypto";
import { copyFileSync, existsSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serializeCursorPiToolBridgeDiagnostic } from "./cursor-pi-tool-bridge-diagnostics.js";
import { asRecord } from "./cursor-record-utils.js";
import { getCursorSessionFile } from "./cursor-session-scope.js";
import { parseEnvBoolean } from "./cursor-env-boolean.js";
import { ARTIFACTS, CURSOR_SDK_EVENT_DEBUG_ENV, CURSOR_SDK_EVENT_DEBUG_LOG_PREFIX, CURSOR_SDK_EVENT_DEBUG_STDERR_ENV, SESSION_MANIFEST, SESSION_PI_SESSION_SNAPSHOT, } from "./cursor-sdk-event-debug-constants.js";
import { allocateCursorSdkEventDebugTurn, resetCursorSdkEventDebugSessionStateForTests, slugSessionKey, updateCursorSdkEventDebugSessionManifest, } from "./cursor-sdk-event-debug-session.js";
export { CURSOR_SDK_EVENT_DEBUG_DIR_ENV, CURSOR_SDK_EVENT_DEBUG_ENV, CURSOR_SDK_EVENT_DEBUG_LOG_PREFIX, CURSOR_SDK_EVENT_DEBUG_RUN_DIR_ENV, CURSOR_SDK_EVENT_DEBUG_SESSION_DIR_ENV, CURSOR_SDK_EVENT_DEBUG_STDERR_ENV, resolveCursorSdkEventDebugBaseDir, } from "./cursor-sdk-event-debug-constants.js";
const MAX_CURSOR_SDK_EVENT_DEBUG_JSONL_BYTES = 2 * 1024 * 1024;
function eventType(value) {
    const record = asRecord(value);
    if (typeof record?.type === "string")
        return record.type;
    if (typeof record?.event === "string")
        return record.event;
    if (typeof record?.kind === "string")
        return record.kind;
    return "unknown";
}
function resolveCursorSdkEventDebugStderrEnabled(env = process.env) {
    return parseEnvBoolean(env[CURSOR_SDK_EVENT_DEBUG_STDERR_ENV], false);
}
function isNodeErrorWithCode(error, code) {
    return asRecord(error)?.code === code;
}
function snapshotCursorSdkEventDebugRecord(record) {
    try {
        return structuredClone(record);
    }
    catch {
        try {
            return JSON.parse(JSON.stringify(record));
        }
        catch {
            return record;
        }
    }
}
function serializeCursorSdkEventDebugRecord(record) {
    try {
        const seen = new WeakSet();
        return JSON.stringify(snapshotCursorSdkEventDebugRecord(record), (_key, value) => {
            if (typeof value === "bigint")
                return value.toString();
            if (value && typeof value === "object") {
                if (seen.has(value))
                    return "[Circular]";
                seen.add(value);
            }
            return value;
        }) ?? JSON.stringify({ type: "artifact_serialization_error" });
    }
    catch {
        return JSON.stringify({ type: "artifact_serialization_error" });
    }
}
export function resolveCursorSdkEventDebugEnabled(env = process.env) {
    return parseEnvBoolean(env[CURSOR_SDK_EVENT_DEBUG_ENV], false);
}
export const DISCARDED_INCOMPLETE_TOOL_CALL_REASON = "no-completion-at-run-end";
export function hashCursorSdkCallId(callId) {
    return createHash("sha256").update(callId).digest("hex").slice(0, 8);
}
export function serializeDiscardedIncompleteStartedToolCall(record) {
    return {
        event: "discarded-incomplete-started-tool-call",
        toolName: record.toolName,
        callIdHash: hashCursorSdkCallId(record.callId),
        reason: record.reason ?? DISCARDED_INCOMPLETE_TOOL_CALL_REASON,
    };
}
export function recordDiscardedIncompleteStartedToolCall(recorder, env, record) {
    if (!recorder && !resolveCursorSdkEventDebugEnabled(env))
        return;
    try {
        const payload = serializeDiscardedIncompleteStartedToolCall(record);
        recorder?.recordCoordinatorEvent("discarded-incomplete-started-tool-call", payload);
        if (resolveCursorSdkEventDebugStderrEnabled(env) && resolveCursorSdkEventDebugEnabled(env)) {
            process.stderr.write(`${CURSOR_SDK_EVENT_DEBUG_LOG_PREFIX} ${JSON.stringify(payload)}\n`);
        }
    }
    catch {
        // Debug logging must never affect provider execution.
    }
}
export function attachCursorSdkEventDebugPiStreamTap(stream, sinkRef) {
    if (!resolveCursorSdkEventDebugEnabled())
        return;
    const originalPush = stream.push.bind(stream);
    stream.push = (event) => {
        try {
            sinkRef.current?.recordPiStreamEvent(event);
        }
        catch {
            // Debug capture must never block the underlying stream.
        }
        return originalPush(event);
    };
}
export class CursorSdkEventDebugSink {
    artifactDir;
    sessionDir;
    turn;
    sessionKey;
    pinnedRun;
    env;
    startedAt = Date.now();
    counts = {
        onDelta: {},
        onStep: {},
        stream: {},
        piStream: {},
        provider: {},
        liveRun: {},
        bridge: {},
        bridgeRaw: {},
        displayDecisions: {},
        coordinator: {},
        drain: {},
        timeline: {},
        errors: 0,
    };
    metadata;
    jsonlBuffers = new Map();
    jsonlBufferBytes = new Map();
    truncatedJsonlFiles = new Set();
    finalized = false;
    finalizationPromise;
    waitResultRecorded = false;
    streamCapturePromise;
    streamCaptureErrors = [];
    static maybeCreate(options) {
        const env = options.env ?? process.env;
        if (!resolveCursorSdkEventDebugEnabled(env))
            return undefined;
        const allocation = allocateCursorSdkEventDebugTurn(options.cwd, env);
        return new CursorSdkEventDebugSink(allocation, options, env);
    }
    constructor(allocation, options, env) {
        this.artifactDir = allocation.artifactDir;
        this.sessionDir = allocation.sessionDir;
        this.turn = allocation.turn;
        this.sessionKey = allocation.sessionKey;
        this.pinnedRun = allocation.pinnedRun;
        this.env = env;
        this.metadata = {
            capturedAt: new Date().toISOString(),
            modelId: options.modelId,
            provider: options.provider,
            cwd: options.cwd,
            sessionDir: allocation.sessionDir,
            sessionKey: allocation.sessionKey,
            sessionFile: getCursorSessionFile(),
            turn: allocation.turn,
            pinnedRun: allocation.pinnedRun,
            artifacts: ARTIFACTS,
            warnings: [
                "Raw artifact files may contain local paths, project text, tool args/results, or secrets from the workspace. Do not commit or share them.",
            ],
        };
        this.clearKnownArtifactFiles();
        writeFileSync(join(this.artifactDir, ARTIFACTS.metadata), `${JSON.stringify(this.metadata, null, 2)}\n`);
    }
    recordProviderMeta(meta) {
        this.metadata = {
            ...this.metadata,
            providerMeta: meta,
        };
        writeFileSync(join(this.artifactDir, ARTIFACTS.metadata), `${JSON.stringify(this.metadata, null, 2)}\n`);
    }
    recordSendMeta(meta) {
        this.metadata = {
            ...this.metadata,
            send: meta,
        };
        writeFileSync(join(this.artifactDir, ARTIFACTS.metadata), `${JSON.stringify(this.metadata, null, 2)}\n`);
    }
    recordSendPayload(payload) {
        writeFileSync(join(this.artifactDir, ARTIFACTS.sendPayload), `${JSON.stringify(payload, null, 2)}\n`);
    }
    recordContextSnapshot(context) {
        writeFileSync(join(this.artifactDir, ARTIFACTS.contextSnapshot), `${JSON.stringify(context, null, 2)}\n`);
    }
    recordRunMeta(meta) {
        this.metadata = {
            ...this.metadata,
            run: meta,
        };
        writeFileSync(join(this.artifactDir, ARTIFACTS.metadata), `${JSON.stringify(this.metadata, null, 2)}\n`);
    }
    recordOnDelta(update) {
        this.appendJsonl(ARTIFACTS.onDelta, "update", update, this.counts.onDelta);
    }
    recordOnStep(step) {
        this.appendJsonl(ARTIFACTS.onStep, "step", step, this.counts.onStep);
    }
    recordStreamEvent(event) {
        this.appendJsonl(ARTIFACTS.streamEvents, "event", event, this.counts.stream);
    }
    recordPiStreamEvent(event) {
        this.appendJsonl(ARTIFACTS.piStreamEvents, "event", event, this.counts.piStream);
    }
    recordProviderEvent(phase, payload) {
        this.appendProviderJsonl(phase, payload);
    }
    recordLiveRunEvent(event) {
        this.appendJsonl(ARTIFACTS.liveRunEvents, "event", event, this.counts.liveRun);
    }
    recordBridgeDiagnostic(event) {
        const serialized = serializeCursorPiToolBridgeDiagnostic(event);
        this.appendJsonl(ARTIFACTS.bridgeEvents, "event", serialized, this.counts.bridge, String(serialized.event));
    }
    recordBridgeRaw(payload) {
        this.appendJsonl(ARTIFACTS.bridgeRaw, "bridgeRaw", payload, this.counts.bridgeRaw, payload.kind);
    }
    recordDisplayDecision(decision) {
        this.appendJsonl(ARTIFACTS.displayDecisions, "decision", decision, this.counts.displayDecisions, decision.action);
    }
    recordCoordinatorEvent(phase, payload) {
        this.appendCoordinatorJsonl(phase, payload);
    }
    recordDrainEvent(phase, payload) {
        this.appendDrainJsonl(phase, payload);
    }
    recordFinalPartial(partial) {
        writeFileSync(join(this.artifactDir, ARTIFACTS.finalPartial), `${JSON.stringify(partial, null, 2)}\n`);
        this.recordTimeline("finalPartial", "snapshot", partial);
    }
    recordError(label, error) {
        this.counts.errors += 1;
        const payload = {
            label,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            value: error,
        };
        this.appendJsonl(ARTIFACTS.errors, "error", payload, { [label]: 1 }, label);
    }
    attachRunStream(run) {
        const sdkRun = run;
        if (typeof sdkRun.stream !== "function") {
            this.recordProviderEvent("run_stream_unavailable", { runId: sdkRun.id, requestId: sdkRun.requestId });
            return;
        }
        this.streamCapturePromise = (async () => {
            try {
                for await (const event of sdkRun.stream()) {
                    this.recordStreamEvent(event);
                }
            }
            catch (error) {
                this.streamCaptureErrors.push(error);
                this.recordError("run_stream", error);
            }
        })();
    }
    async captureRunArtifacts(run) {
        const sdkRun = run;
        if (this.streamCapturePromise) {
            await this.streamCapturePromise.catch(() => undefined);
        }
        if (typeof sdkRun.conversation === "function" && sdkRun.supports?.("conversation")) {
            try {
                const conversation = await sdkRun.conversation();
                writeFileSync(join(this.artifactDir, ARTIFACTS.conversation), `${JSON.stringify(conversation, null, 2)}\n`);
                this.recordProviderEvent("conversation_captured", { supported: true });
            }
            catch (error) {
                this.recordError("conversation", error);
            }
        }
        else {
            writeFileSync(join(this.artifactDir, ARTIFACTS.conversation), `${JSON.stringify({
                skipped: true,
                reason: sdkRun.unsupportedReason?.("conversation") ?? "conversation unsupported",
            }, null, 2)}\n`);
        }
    }
    recordWaitResult(result) {
        if (this.waitResultRecorded)
            return;
        this.waitResultRecorded = true;
        writeFileSync(join(this.artifactDir, ARTIFACTS.waitResult), `${JSON.stringify(result, null, 2)}\n`);
    }
    capturePiSessionSnapshot() {
        const sessionFile = getCursorSessionFile();
        if (!sessionFile) {
            return { copied: false, reason: "session file unknown" };
        }
        if (!existsSync(sessionFile)) {
            return { copied: false, sessionFile, reason: "session file not found at debug finalization" };
        }
        try {
            copyFileSync(sessionFile, join(this.artifactDir, ARTIFACTS.piSessionSnapshot));
            if (this.sessionDir) {
                copyFileSync(sessionFile, join(this.sessionDir, SESSION_PI_SESSION_SNAPSHOT));
            }
            this.recordTimeline("piSession", "snapshot", { sessionFile, artifact: ARTIFACTS.piSessionSnapshot });
            return { copied: true, sessionFile };
        }
        catch (error) {
            if (isNodeErrorWithCode(error, "ENOENT")) {
                return { copied: false, sessionFile, reason: "session file not found at debug finalization" };
            }
            this.recordError("pi_session_snapshot", error);
            return {
                copied: false,
                sessionFile,
                reason: error instanceof Error ? error.message : String(error),
            };
        }
    }
    updateSessionManifest(summary) {
        if (this.pinnedRun || !this.sessionDir || this.turn === undefined)
            return;
        updateCursorSdkEventDebugSessionManifest(this.sessionDir, this.artifactDir, summary);
    }
    clearKnownArtifactFiles() {
        for (const fileName of Object.values(ARTIFACTS)) {
            try {
                unlinkSync(join(this.artifactDir, fileName));
            }
            catch {
                // Ignore missing prior artifacts when reusing a pinned run directory.
            }
        }
    }
    async finalize() {
        this.finalizationPromise ??= this.finalizeOnce();
        await this.finalizationPromise;
    }
    async finalizeOnce() {
        if (this.finalized)
            return;
        if (this.streamCapturePromise) {
            await this.streamCapturePromise.catch(() => undefined);
        }
        const piSessionSnapshot = this.capturePiSessionSnapshot();
        const summary = {
            artifactDir: this.artifactDir,
            sessionDir: this.sessionDir,
            sessionKey: this.sessionKey,
            sessionFile: getCursorSessionFile(),
            turn: this.turn,
            elapsedMs: Date.now() - this.startedAt,
            counts: {
                onDelta: { ...this.counts.onDelta },
                onStep: { ...this.counts.onStep },
                stream: { ...this.counts.stream },
                piStream: { ...this.counts.piStream },
                provider: { ...this.counts.provider },
                liveRun: { ...this.counts.liveRun },
                bridge: { ...this.counts.bridge },
                bridgeRaw: { ...this.counts.bridgeRaw },
                displayDecisions: { ...this.counts.displayDecisions },
                coordinator: { ...this.counts.coordinator },
                drain: { ...this.counts.drain },
                timeline: { ...this.counts.timeline },
                errors: this.counts.errors,
            },
            piSessionSnapshot,
            artifacts: Object.fromEntries(Object.entries(ARTIFACTS).map(([key, name]) => [key, join(this.artifactDir, name)])),
            waitResultRecorded: this.waitResultRecorded,
            streamCaptureErrors: this.streamCaptureErrors.map((error) => error instanceof Error ? error.message : String(error)),
            jsonlByteLimit: MAX_CURSOR_SDK_EVENT_DEBUG_JSONL_BYTES,
            truncatedJsonlFiles: [...this.truncatedJsonlFiles].sort(),
        };
        this.flushJsonlBuffers();
        writeFileSync(join(this.artifactDir, ARTIFACTS.summary), `${JSON.stringify(summary, null, 2)}\n`);
        this.updateSessionManifest(summary);
        if (resolveCursorSdkEventDebugStderrEnabled(this.env)) {
            process.stderr.write(`${CURSOR_SDK_EVENT_DEBUG_LOG_PREFIX} ${JSON.stringify(summary)}\n`);
        }
        this.finalized = true;
    }
    appendProviderJsonl(phase, payload) {
        const elapsedMs = Date.now() - this.startedAt;
        const record = { ts: new Date().toISOString(), elapsedMs, turn: this.turn, phase, payload };
        this.bufferJsonl(ARTIFACTS.providerEvents, record);
        this.counts.provider[phase] = (this.counts.provider[phase] ?? 0) + 1;
        this.recordTimeline("provider", phase, payload);
    }
    appendCoordinatorJsonl(phase, payload) {
        const elapsedMs = Date.now() - this.startedAt;
        const record = { ts: new Date().toISOString(), elapsedMs, turn: this.turn, phase, payload };
        this.bufferJsonl(ARTIFACTS.coordinatorEvents, record);
        this.counts.coordinator[phase] = (this.counts.coordinator[phase] ?? 0) + 1;
        this.recordTimeline("coordinator", phase, payload);
    }
    appendDrainJsonl(phase, payload) {
        const elapsedMs = Date.now() - this.startedAt;
        const record = { ts: new Date().toISOString(), elapsedMs, turn: this.turn, phase, payload };
        this.bufferJsonl(ARTIFACTS.drainEvents, record);
        this.counts.drain[phase] = (this.counts.drain[phase] ?? 0) + 1;
        this.recordTimeline("drain", phase, payload);
    }
    recordTimeline(layer, kind, payload) {
        const elapsedMs = Date.now() - this.startedAt;
        const record = {
            ts: new Date().toISOString(),
            elapsedMs,
            turn: this.turn,
            layer,
            kind,
            payload,
        };
        this.bufferJsonl(ARTIFACTS.timeline, record);
        const timelineKey = `${layer}:${kind}`;
        this.counts.timeline[timelineKey] = (this.counts.timeline[timelineKey] ?? 0) + 1;
    }
    appendJsonl(fileName, recordKey, value, counts, countKey) {
        const elapsedMs = Date.now() - this.startedAt;
        const record = {
            ts: new Date().toISOString(),
            elapsedMs,
            turn: this.turn,
            [recordKey]: value,
        };
        this.bufferJsonl(fileName, record);
        const type = countKey ?? eventType(value);
        counts[type] = (counts[type] ?? 0) + 1;
        const layer = fileName.replace(/\.jsonl$/, "");
        this.recordTimeline(layer, type, value);
    }
    bufferJsonl(fileName, record) {
        if (this.finalized || this.truncatedJsonlFiles.has(fileName))
            return;
        const line = `${serializeCursorSdkEventDebugRecord(record)}\n`;
        const marker = `${JSON.stringify({ type: "artifact_truncated", limitBytes: MAX_CURSOR_SDK_EVENT_DEBUG_JSONL_BYTES })}\n`;
        const usedBytes = this.jsonlBufferBytes.get(fileName) ?? 0;
        const lineBytes = Buffer.byteLength(line);
        const markerBytes = Buffer.byteLength(marker);
        const records = this.jsonlBuffers.get(fileName) ?? [];
        if (usedBytes + lineBytes > MAX_CURSOR_SDK_EVENT_DEBUG_JSONL_BYTES - markerBytes) {
            records.push(marker);
            this.jsonlBuffers.set(fileName, records);
            this.jsonlBufferBytes.set(fileName, usedBytes + markerBytes);
            this.truncatedJsonlFiles.add(fileName);
            return;
        }
        records.push(line);
        this.jsonlBuffers.set(fileName, records);
        this.jsonlBufferBytes.set(fileName, usedBytes + lineBytes);
    }
    flushJsonlBuffers() {
        for (const [fileName, records] of this.jsonlBuffers) {
            writeFileSync(join(this.artifactDir, fileName), records.join(""));
        }
        this.jsonlBuffers.clear();
        this.jsonlBufferBytes.clear();
    }
}
export const __testUtils = {
    ARTIFACTS,
    SESSION_MANIFEST,
    MAX_CURSOR_SDK_EVENT_DEBUG_JSONL_BYTES,
    slugSessionKey,
    resetSessionDebugState: resetCursorSdkEventDebugSessionStateForTests,
};
