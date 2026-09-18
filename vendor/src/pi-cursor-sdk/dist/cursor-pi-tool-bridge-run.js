import { randomUUID } from "node:crypto";
import { Server as McpProtocolServer } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { bridgeToolExecutionAbortTracker } from "./cursor-pi-tool-bridge-abort.js";
import { MCP_ENDPOINT_ROOT, MCP_SERVER_NAME } from "./cursor-pi-tool-bridge-constants.js";
import { writeCursorPiToolBridgeDiagnostic, } from "./cursor-pi-tool-bridge-diagnostics.js";
import { resolveCursorPiToolBridgeCallTimeoutMs } from "./cursor-pi-tool-bridge-env.js";
import { asToolResultMessage, containsKnownMcpToolName, convertPiContentToMcpContent, normalizeMcpArgs, snapshotToolToMcpTool, waitForProtocolFlush, } from "./cursor-pi-tool-bridge-mcp.js";
import { asRecord, getFirstStringByKeys } from "./cursor-record-utils.js";
const MCP_SERVER_VERSION = "0.1.0";
export class CursorPiToolBridgeRunImpl {
    id;
    enabled;
    snapshot;
    mcpServers;
    registry;
    env;
    endpointPath;
    callTimeoutMs;
    knownMcpToolNames;
    knownCursorMcpCallIds = new Set();
    queuedRequests = [];
    pendingByPiToolCallId = new Map();
    pendingByBridgeCallId = new Map();
    pendingByCursorMcpCallId = new Map();
    onToolRequest;
    debugRecorder;
    liveRunHandlerDetached = false;
    mcpServer;
    mcpTransport;
    toolCallCounter = 0;
    disposed = false;
    constructor(registry, env, snapshot, enabled, options = {}) {
        this.registry = registry;
        this.env = env;
        this.snapshot = snapshot;
        this.enabled = enabled;
        this.onToolRequest = options.onToolRequest;
        this.debugRecorder = options.debugRecorder;
        this.id = `cursor-pi-bridge-run-${randomUUID()}`;
        this.endpointPath = `${MCP_ENDPOINT_ROOT}/${randomUUID()}/mcp`;
        this.callTimeoutMs = resolveCursorPiToolBridgeCallTimeoutMs(env);
        this.knownMcpToolNames = new Set(snapshot.tools.map((tool) => tool.mcpToolName));
    }
    async start() {
        if (!this.enabled)
            return;
        await this.createMcpServer();
        const endpointUrl = await this.registry.registerRun(this.endpointPath, this);
        this.mcpServers = { [MCP_SERVER_NAME]: { type: "http", url: endpointUrl } };
    }
    emitStartDiagnostics(bridgeEnabled) {
        const base = this.lifecycleDiagnosticFields();
        this.emitDiagnostic({ event: "run_created", ...base });
        if (!this.enabled) {
            this.emitDiagnostic({
                event: "run_skipped",
                ...base,
                reason: bridgeEnabled ? "no_exposed_tools" : "disabled",
            });
            return;
        }
        this.emitDiagnostic({
            event: "tools_exposed",
            ...base,
            pairs: this.snapshot.tools.map((tool) => ({
                piToolName: tool.piToolName,
                mcpToolName: tool.mcpToolName,
            })),
        });
    }
    async handleHttpRequest(req, res) {
        if (this.disposed || !this.mcpTransport) {
            res.writeHead(410, { "content-type": "application/json" }).end(JSON.stringify({ error: "Cursor pi tool bridge run is disposed" }));
            return;
        }
        await this.mcpTransport.handleRequest(req, res);
    }
    takeQueuedToolRequests() {
        return this.queuedRequests.splice(0);
    }
    setOnToolRequest(handler) {
        if (!handler) {
            this.liveRunHandlerDetached = true;
            this.rejectQueuedToolRequestsWithoutHandler("Cursor pi tool bridge has no active live run");
        }
        else {
            this.liveRunHandlerDetached = false;
        }
        this.onToolRequest = handler;
        if (handler) {
            for (const request of this.queuedRequests.splice(0)) {
                const pending = this.pendingByPiToolCallId.get(request.piToolCallId);
                if (pending)
                    this.dispatchPendingToolRequest(pending, handler);
            }
        }
    }
    setDebugRecorder(recorder) {
        this.debugRecorder = recorder;
    }
    recordBridgeRaw(payload) {
        try {
            this.debugRecorder?.recordBridgeRaw(payload);
        }
        catch {
            // Debug capture must never block or strand a bridge call.
        }
    }
    async resolveToolResults(toolResults) {
        let resolvedCount = 0;
        for (const toolResult of toolResults) {
            const pending = this.pendingByPiToolCallId.get(toolResult.toolCallId);
            if (!pending || pending.settled)
                continue;
            this.resolvePending(pending, {
                content: convertPiContentToMcpContent(toolResult.content),
                isError: toolResult.isError || undefined,
            });
            resolvedCount += 1;
        }
        if (resolvedCount > 0)
            await waitForProtocolFlush();
    }
    async resolveToolResultsFromContext(context) {
        await this.resolveToolResults(context.messages.map(asToolResultMessage).filter((message) => message !== undefined));
    }
    hasPendingPiToolCallId(piToolCallId) {
        return this.pendingByPiToolCallId.has(piToolCallId);
    }
    cancelPendingPiToolCallId(piToolCallId, reason) {
        const pending = this.pendingByPiToolCallId.get(piToolCallId);
        if (!pending)
            return false;
        this.rejectPending(pending, new Error(reason), "cancelled");
        return true;
    }
    isBridgeMcpToolCall(toolCall) {
        const record = asRecord(toolCall);
        if (!record)
            return false;
        const toolName = getFirstStringByKeys(record, ["name", "toolName", "mcpToolName"], { nonEmpty: true });
        if (toolName && this.knownMcpToolNames.has(toolName))
            return true;
        const isMcpEnvelope = toolName === "mcp" || toolName === MCP_SERVER_NAME;
        const cursorMcpCallId = getFirstStringByKeys(record, ["call_id", "callId", "id", "toolCallId", "requestId"], { nonEmpty: true });
        if (cursorMcpCallId && this.knownCursorMcpCallIds.has(cursorMcpCallId) && isMcpEnvelope)
            return true;
        if (containsKnownMcpToolName(toolCall, this.knownMcpToolNames))
            return true;
        return false;
    }
    cancel(reason) {
        const error = new Error(reason);
        const pendingCount = this.pendingCount();
        const queuedCount = this.queuedRequests.length;
        if (pendingCount > 0 || queuedCount > 0) {
            this.emitDiagnostic({
                event: "run_cancelled",
                ...this.lifecycleDiagnosticFields(pendingCount),
                queuedCount,
                cancelledRequestCount: pendingCount,
            });
        }
        this.queuedRequests.splice(0);
        for (const pending of [...this.pendingByBridgeCallId.values()]) {
            this.rejectAndAbortPending(pending, error, "cancelled");
        }
    }
    async dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.cancel("Cursor pi tool bridge run disposed");
        await waitForProtocolFlush();
        await Promise.allSettled([
            this.mcpTransport?.close(),
            this.mcpServer?.close(),
        ]);
        await this.registry.unregisterRun(this.endpointPath, this);
        this.emitDiagnostic({
            event: "run_disposed",
            ...this.lifecycleDiagnosticFields(),
        });
    }
    async createMcpServer() {
        const server = new McpProtocolServer({ name: "pi-cursor-sdk-tool-bridge", version: MCP_SERVER_VERSION }, { capabilities: { tools: {} } });
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: randomUUID,
        });
        server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: this.snapshot.tools.map(snapshotToolToMcpTool),
        }));
        server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
            return this.enqueueToolRequest(request.params.name, request.params.arguments, String(extra.requestId), extra.signal);
        });
        this.mcpServer = server;
        this.mcpTransport = transport;
        await server.connect(transport);
    }
    enqueueToolRequest(mcpToolName, argsValue, cursorMcpCallId, signal) {
        const piToolName = this.snapshot.mcpToolNameToPiToolName.get(mcpToolName);
        if (!piToolName) {
            return Promise.resolve({
                content: [{ type: "text", text: `Unknown pi bridge tool: ${mcpToolName}` }],
                isError: true,
            });
        }
        if (this.disposed)
            return Promise.reject(new Error("Cursor pi tool bridge run is disposed"));
        this.toolCallCounter += 1;
        const bridgeCallId = `${this.id}-bridge-${this.toolCallCounter}`;
        const request = {
            runId: this.id,
            bridgeCallId,
            cursorMcpCallId,
            piToolCallId: `${this.id}-tool-${this.toolCallCounter}`,
            piToolName,
            mcpToolName,
            args: normalizeMcpArgs(argsValue),
        };
        return new Promise((resolve, reject) => {
            const pending = {
                request,
                resolve,
                reject,
                signal,
                settled: false,
            };
            pending.onAbort = () => {
                this.rejectAndAbortPending(pending, new Error("Cursor MCP bridge tool request was aborted"), "cancelled");
            };
            if (signal?.aborted) {
                pending.onAbort();
                return;
            }
            signal?.addEventListener("abort", pending.onAbort, { once: true });
            this.pendingByPiToolCallId.set(request.piToolCallId, pending);
            this.pendingByBridgeCallId.set(request.bridgeCallId, pending);
            this.pendingByCursorMcpCallId.set(cursorMcpCallId, pending);
            this.knownCursorMcpCallIds.add(cursorMcpCallId);
            pending.timeout = setTimeout(() => {
                const reason = `Cursor pi bridge CallTool timed out after ${this.callTimeoutMs} ms`;
                this.rejectAndAbortPending(pending, new Error(reason));
            }, this.callTimeoutMs);
            pending.timeout.unref?.();
            if (!this.onToolRequest) {
                if (this.liveRunHandlerDetached) {
                    this.rejectPending(pending, new Error("Cursor pi tool bridge has no active live run"), "cancelled");
                    return;
                }
                this.queuedRequests.push(request);
                this.emitRequestQueuedDiagnostic(request);
                this.recordBridgeRaw({ kind: "queued", request });
                return;
            }
            this.emitRequestQueuedDiagnostic(request);
            this.recordBridgeRaw({ kind: "queued", request });
            this.dispatchPendingToolRequest(pending, this.onToolRequest);
        });
    }
    dispatchPendingToolRequest(pending, handler) {
        try {
            handler(pending.request);
        }
        catch (error) {
            this.rejectPending(pending, error instanceof Error ? error : new Error(String(error)), "error");
        }
    }
    rejectQueuedToolRequestsWithoutHandler(reason) {
        while (this.queuedRequests.length > 0) {
            const request = this.queuedRequests.shift();
            const pending = this.pendingByPiToolCallId.get(request.piToolCallId);
            if (pending)
                this.rejectPending(pending, new Error(reason), "cancelled");
        }
    }
    resolvePending(pending, result) {
        if (pending.settled)
            return;
        pending.settled = true;
        this.removePending(pending);
        this.emitRequestResolvedDiagnostic(pending.request, result.isError === true);
        this.recordBridgeRaw({ kind: "resolved", request: pending.request, result });
        pending.resolve(result);
    }
    rejectPending(pending, error, kind = "error") {
        if (pending.settled)
            return false;
        pending.settled = true;
        this.removePending(pending);
        this.emitRequestRejectedDiagnostic(pending.request, kind);
        this.recordBridgeRaw({
            kind: "rejected",
            request: pending.request,
            error: error.message,
            rejectionKind: kind,
        });
        pending.reject(error);
        return true;
    }
    rejectAndAbortPending(pending, error, kind = "error") {
        if (this.rejectPending(pending, error, kind)) {
            bridgeToolExecutionAbortTracker.abort(pending.request.piToolCallId, error.message);
        }
    }
    lifecycleDiagnosticFields(pendingCount = this.pendingCount()) {
        return {
            runId: this.id,
            enabled: this.enabled,
            exposedToolCount: this.snapshot.tools.length,
            pendingCount,
        };
    }
    requestDiagnosticFields(request) {
        return {
            runId: this.id,
            bridgeCallId: request.bridgeCallId,
            cursorMcpCallId: request.cursorMcpCallId,
            piToolCallId: request.piToolCallId,
            mcpToolName: request.mcpToolName,
            piToolName: request.piToolName,
            pendingCount: this.pendingCount(),
        };
    }
    emitRequestQueuedDiagnostic(request) {
        this.emitDiagnostic({ event: "request_queued", ...this.requestDiagnosticFields(request) });
    }
    emitRequestResolvedDiagnostic(request, isError) {
        this.emitDiagnostic({ event: "request_resolved", ...this.requestDiagnosticFields(request), isError });
    }
    emitRequestRejectedDiagnostic(request, rejectionKind) {
        this.emitDiagnostic({ event: "request_rejected", ...this.requestDiagnosticFields(request), rejectionKind });
    }
    emitDiagnostic(event) {
        writeCursorPiToolBridgeDiagnostic(this.env, event, this.debugRecorder);
    }
    pendingCount() {
        return this.pendingByBridgeCallId.size;
    }
    removePending(pending) {
        if (pending.onAbort)
            pending.signal?.removeEventListener("abort", pending.onAbort);
        if (pending.timeout)
            clearTimeout(pending.timeout);
        this.pendingByPiToolCallId.delete(pending.request.piToolCallId);
        this.pendingByBridgeCallId.delete(pending.request.bridgeCallId);
        if (pending.request.cursorMcpCallId)
            this.pendingByCursorMcpCallId.delete(pending.request.cursorMcpCallId);
        const queuedIndex = this.queuedRequests.findIndex((request) => request.bridgeCallId === pending.request.bridgeCallId);
        if (queuedIndex >= 0)
            this.queuedRequests.splice(queuedIndex, 1);
    }
}
