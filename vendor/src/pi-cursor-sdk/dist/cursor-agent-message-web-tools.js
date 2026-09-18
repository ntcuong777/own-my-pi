import { asRecord, getArray, getString } from "./cursor-record-utils.js";
import { stringifyUnknown } from "./cursor-transcript-utils.js";
import { loadCursorSdk } from "./cursor-sdk-runtime.js";
const CURSOR_AGENT_MESSAGE_PAGE_LIMIT = 8;
function getOneofCaseValue(value, caseName) {
    const record = asRecord(value);
    if (!record)
        return undefined;
    if (record.case === caseName)
        return record.value;
    return record[caseName];
}
async function hasCursorAgentMessageAt(agentId, cwd, offset, store) {
    const { Agent } = await loadCursorSdk();
    const messages = await Agent.messages.list(agentId, {
        runtime: "local",
        cwd,
        ...(store ? { store } : {}),
        limit: 1,
        offset,
    });
    return messages.length > 0;
}
export async function countCursorAgentMessages(agentId, cwd, store) {
    let high = 1;
    while (await hasCursorAgentMessageAt(agentId, cwd, high, store)) {
        high *= 2;
    }
    let low = 0;
    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (await hasCursorAgentMessageAt(agentId, cwd, mid, store))
            low = mid + 1;
        else
            high = mid;
    }
    return low;
}
export async function loadCursorTranscriptWebToolCallsAfterOffset(options) {
    if (options.offset === undefined)
        return [];
    const { Agent } = await loadCursorSdk();
    const messages = await Agent.messages.list(options.agentId, {
        runtime: "local",
        cwd: options.cwd,
        ...(options.store ? { store: options.store } : {}),
        limit: CURSOR_AGENT_MESSAGE_PAGE_LIMIT,
        offset: options.offset,
    });
    return collectCursorTranscriptWebToolCalls(messages);
}
export function collectCursorTranscriptWebToolCalls(messages) {
    const toolCalls = [];
    for (const [messageIndex, message] of messages.entries()) {
        const messageId = message.uuid || `${message.agent_id || "cursor-agent"}:${messageIndex}`;
        const steps = getAgentConversationSteps(message.message);
        for (const [stepIndex, step] of steps.entries()) {
            const webTool = getStepWebToolPayload(step);
            if (!webTool)
                continue;
            const converted = convertCursorTranscriptWebTool(webTool);
            if (!converted)
                continue;
            const args = asRecord(converted.args);
            const toolCallId = getString(args, "toolCallId") ?? getString(args, "tool_call_id") ?? `${stepIndex}`;
            toolCalls.push({
                identity: `cursor-transcript:${messageId}:${webTool.kind}:${toolCallId}`,
                toolCall: converted,
            });
        }
    }
    return toolCalls;
}
function getAgentConversationSteps(message) {
    const record = asRecord(message);
    const turn = getOneofCaseValue(record?.turn, "agentConversationTurn") ?? record?.agentConversationTurn;
    return getArray(asRecord(turn), "steps") ?? [];
}
function getStepToolCall(step) {
    const stepRecord = asRecord(step);
    const message = asRecord(stepRecord?.message);
    return getOneofCaseValue(message, "toolCall") ?? stepRecord?.toolCall ?? message?.toolCall;
}
function getStepWebToolPayload(step) {
    const toolCall = getStepToolCall(step);
    const toolCallRecord = asRecord(toolCall);
    const tool = toolCallRecord?.tool;
    const webSearchPayload = getOneofCaseValue(tool, "webSearchToolCall") ??
        getOneofCaseValue(toolCall, "webSearchToolCall") ??
        toolCallRecord?.webSearchToolCall;
    if (webSearchPayload)
        return { kind: "webSearch", payload: webSearchPayload };
    const webFetchPayload = getOneofCaseValue(tool, "webFetchToolCall") ??
        getOneofCaseValue(toolCall, "webFetchToolCall") ??
        toolCallRecord?.webFetchToolCall;
    if (webFetchPayload)
        return { kind: "webFetch", payload: webFetchPayload };
    return undefined;
}
function convertCursorTranscriptWebTool(webTool) {
    const payload = asRecord(webTool.payload);
    if (!payload)
        return undefined;
    const rawArgs = asRecord(payload.args) ?? {};
    const args = normalizeWebToolArgs(webTool.kind, rawArgs);
    const result = normalizeWebToolResult(payload.result);
    if (!result)
        return undefined;
    return {
        name: webTool.kind,
        args,
        result,
    };
}
function normalizeWebToolArgs(kind, rawArgs) {
    const args = { ...rawArgs };
    if (kind === "webSearch") {
        const query = getString(args, "searchTerm") ?? getString(args, "search_term") ?? getString(args, "query") ?? getString(args, "q");
        if (query && !args.searchTerm)
            args.searchTerm = query;
        return args;
    }
    const url = getString(args, "url") ?? getString(args, "uri") ?? getString(args, "href");
    if (url && !args.url)
        args.url = url;
    return args;
}
function normalizeWebToolResult(result) {
    if (result === undefined)
        return undefined;
    const success = getTranscriptResultCase(result, "success");
    if (success !== undefined) {
        return {
            status: "success",
            value: { content: [{ type: "text", text: transcriptWebSuccessText(success) }] },
        };
    }
    const error = getTranscriptResultCase(result, "error");
    if (error !== undefined)
        return { status: "error", error };
    return {
        status: "success",
        value: { content: [{ type: "text", text: transcriptWebSuccessText(result) }] },
    };
}
function getTranscriptResultCase(result, caseName) {
    const record = asRecord(result);
    return getOneofCaseValue(record?.result, caseName) ?? record?.[caseName];
}
function transcriptWebSuccessText(success) {
    const successRecord = asRecord(success);
    const references = getArray(successRecord, "references");
    const chunks = references
        ?.map((reference) => getString(asRecord(reference), "chunk"))
        .filter((chunk) => Boolean(chunk?.trim()));
    if (chunks && chunks.length > 0)
        return chunks.join("\n\n");
    const content = getArray(successRecord, "content");
    const text = content
        ?.map((entry) => getString(asRecord(entry), "text"))
        .filter((entry) => Boolean(entry?.trim()));
    if (text && text.length > 0)
        return text.join("\n");
    return stringifyUnknown(success).trim() || "Cursor web activity completed.";
}
