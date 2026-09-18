import { appendFileSync } from "node:fs";
import { stableNameHash } from "./cursor-pi-tool-bridge-mcp.js";
import { parseEnvBoolean } from "./cursor-env-boolean.js";
export const CURSOR_PI_TOOL_BRIDGE_DEBUG_ENV = "PI_CURSOR_PI_TOOL_BRIDGE_DEBUG";
export const CURSOR_PI_TOOL_BRIDGE_DEBUG_FILE_ENV = "PI_CURSOR_PI_TOOL_BRIDGE_DEBUG_FILE";
export const CURSOR_PI_TOOL_BRIDGE_DIAGNOSTIC_PREFIX = "[pi-cursor-sdk:bridge]";
export function resolveCursorPiToolBridgeDebugEnabled(env = process.env) {
    return parseEnvBoolean(env[CURSOR_PI_TOOL_BRIDGE_DEBUG_ENV], false);
}
function createCursorMcpCallDiagnosticId(cursorMcpCallId) {
    return cursorMcpCallId ? `cursor-mcp-call-${stableNameHash(cursorMcpCallId)}` : undefined;
}
function assertNeverDiagnosticEvent(_event) {
    throw new Error("Unhandled Cursor pi tool bridge diagnostic event");
}
export function serializeCursorPiToolBridgeDiagnostic(event) {
    switch (event.event) {
        case "run_created":
            return {
                event: event.event,
                runId: event.runId,
                enabled: event.enabled,
                exposedToolCount: event.exposedToolCount,
                pendingCount: event.pendingCount,
            };
        case "run_skipped":
            return {
                event: event.event,
                runId: event.runId,
                enabled: event.enabled,
                exposedToolCount: event.exposedToolCount,
                pendingCount: event.pendingCount,
                reason: event.reason,
            };
        case "tools_exposed":
            return {
                event: event.event,
                runId: event.runId,
                enabled: event.enabled,
                exposedToolCount: event.exposedToolCount,
                pendingCount: event.pendingCount,
                pairs: event.pairs.map((pair) => ({ piToolName: pair.piToolName, mcpToolName: pair.mcpToolName })),
            };
        case "run_cancelled":
            return {
                event: event.event,
                runId: event.runId,
                enabled: event.enabled,
                exposedToolCount: event.exposedToolCount,
                pendingCount: event.pendingCount,
                queuedCount: event.queuedCount,
                cancelledRequestCount: event.cancelledRequestCount,
            };
        case "run_disposed":
            return {
                event: event.event,
                runId: event.runId,
                enabled: event.enabled,
                exposedToolCount: event.exposedToolCount,
                pendingCount: event.pendingCount,
            };
        case "request_queued":
            return {
                event: event.event,
                runId: event.runId,
                bridgeCallId: event.bridgeCallId,
                cursorMcpCallId: createCursorMcpCallDiagnosticId(event.cursorMcpCallId),
                piToolCallId: event.piToolCallId,
                mcpToolName: event.mcpToolName,
                piToolName: event.piToolName,
                pendingCount: event.pendingCount,
            };
        case "request_resolved":
            return {
                event: event.event,
                runId: event.runId,
                bridgeCallId: event.bridgeCallId,
                cursorMcpCallId: createCursorMcpCallDiagnosticId(event.cursorMcpCallId),
                piToolCallId: event.piToolCallId,
                mcpToolName: event.mcpToolName,
                piToolName: event.piToolName,
                pendingCount: event.pendingCount,
                isError: event.isError,
            };
        case "request_rejected":
            return {
                event: event.event,
                runId: event.runId,
                bridgeCallId: event.bridgeCallId,
                cursorMcpCallId: createCursorMcpCallDiagnosticId(event.cursorMcpCallId),
                piToolCallId: event.piToolCallId,
                mcpToolName: event.mcpToolName,
                piToolName: event.piToolName,
                pendingCount: event.pendingCount,
                rejectionKind: event.rejectionKind,
            };
    }
    return assertNeverDiagnosticEvent(event);
}
export function writeCursorPiToolBridgeDiagnostic(env, event, debugRecorder) {
    try {
        debugRecorder?.recordBridgeDiagnostic(event);
    }
    catch {
        // Diagnostics must never affect bridge execution.
    }
    const serialized = serializeCursorPiToolBridgeDiagnostic(event);
    const debugFile = env[CURSOR_PI_TOOL_BRIDGE_DEBUG_FILE_ENV];
    if (debugFile) {
        try {
            appendFileSync(debugFile, `${JSON.stringify(serialized)}\n`);
        }
        catch {
            // Diagnostics must never affect bridge execution.
        }
    }
    if (!resolveCursorPiToolBridgeDebugEnabled(env))
        return;
    try {
        process.stderr.write(`${CURSOR_PI_TOOL_BRIDGE_DIAGNOSTIC_PREFIX} ${JSON.stringify(serialized)}\n`);
    }
    catch {
        // Diagnostics must never affect bridge execution.
    }
}
