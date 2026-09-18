import { asRecord, getArray, getNumber, getRecord, getString, stringifyUnknown } from "./cursor-record-utils.js";
import { summarizeCursorCompactConversationToolCall } from "./cursor-compact-tool-summary.js";
import { scrubSensitiveText } from "./cursor-sensitive-text.js";
import { firstNonEmptyLine, formatDisplayPath, truncateArg } from "./cursor-transcript-utils.js";
export function getReadLintPaths(args, result, options) {
    const explicitPaths = Array.isArray(args.paths)
        ? args.paths.filter((entry) => typeof entry === "string")
        : typeof args.path === "string"
            ? [args.path]
            : [];
    const resultPaths = (getArray(asRecord(result.value), "fileDiagnostics") ?? [])
        .map((file) => getString(asRecord(file), "path"))
        .filter((entry) => Boolean(entry));
    return [...new Set([...explicitPaths, ...resultPaths].map((entry) => formatDisplayPath(entry, options.cwd)))];
}
export function getReadLintDiagnostics(result, options) {
    const value = asRecord(result.value);
    const files = getArray(value, "fileDiagnostics") ?? [];
    const lines = [];
    for (const file of files) {
        const fileRecord = asRecord(file);
        const pathValue = getString(fileRecord, "path");
        const path = pathValue ? formatDisplayPath(pathValue, options.cwd) : "unknown";
        const diagnostics = getArray(fileRecord, "diagnostics") ?? [];
        for (const diagnostic of diagnostics) {
            const diagnosticRecord = asRecord(diagnostic);
            const severity = getString(diagnosticRecord, "severity") ?? "diagnostic";
            const message = getString(diagnosticRecord, "message") ?? "";
            const source = getString(diagnosticRecord, "source");
            lines.push(`${path}: ${severity}${source ? ` ${source}` : ""}: ${message}`);
        }
    }
    return lines;
}
export function getTodoItems(args, result) {
    const value = asRecord(result.value);
    const rawTodos = getArray(value, "todos") ?? getArray(args, "todos") ?? [];
    const todos = [];
    for (const todo of rawTodos) {
        const record = asRecord(todo);
        const content = getString(record, "content");
        if (!content)
            continue;
        const status = getString(record, "status");
        todos.push(status ? { content, status } : { content });
    }
    return todos;
}
export function getTodoTotalCount(args, result, todos) {
    return getNumber(asRecord(result.value), "totalCount") ?? getNumber(args, "totalCount") ?? todos.length;
}
function getNestedRecord(record, ...keys) {
    let current = record;
    for (const key of keys) {
        current = getRecord(current, key);
        if (!current)
            return undefined;
    }
    return current;
}
function readConversationStepAssistantText(step) {
    const record = asRecord(step);
    const legacyText = getString(getRecord(record, "assistantMessage"), "text");
    if (legacyText)
        return legacyText;
    if (getString(record, "type") !== "assistantMessage")
        return undefined;
    return getString(getRecord(record, "message"), "text");
}
export function collectTaskText(result, options = {}) {
    const value = asRecord(result.value);
    const success = getNestedRecord(value, "result", "success");
    const command = getString(success, "command");
    const stdout = getString(success, "stdout");
    const interleavedOutput = getString(success, "interleavedOutput");
    const conversationParts = (getArray(value, "conversationSteps") ?? [])
        .map((step) => summarizeCursorCompactConversationToolCall(step, options) ?? readConversationStepAssistantText(step))
        .filter((entry) => Boolean(entry));
    const parts = [command ? `$ ${command}` : undefined, stdout || interleavedOutput, ...conversationParts].filter((part) => Boolean(part));
    return parts.join("\n");
}
export function getGenerateImagePath(args, result) {
    const value = asRecord(result.value);
    return getString(value, "filePath") ?? getString(args, "filePath") ?? getString(args, "path");
}
export function getGenerateImageDisplayPath(args, result, options) {
    const path = getGenerateImagePath(args, result);
    return path ? formatDisplayPath(path, options.cwd) : undefined;
}
export function inferImageMimeType(path) {
    const lower = path?.toLowerCase();
    if (!lower)
        return undefined;
    if (lower.endsWith(".png"))
        return "image/png";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg"))
        return "image/jpeg";
    if (lower.endsWith(".gif"))
        return "image/gif";
    if (lower.endsWith(".webp"))
        return "image/webp";
    return undefined;
}
function getMcpContentText(entry) {
    const record = asRecord(entry);
    const directText = getString(record, "text");
    if (directText)
        return directText;
    const nestedText = getRecord(record, "text");
    return getString(nestedText, "text");
}
function describeNonTextMcpContent(entry) {
    const record = asRecord(entry);
    const type = getString(record, "type") ?? "content";
    if (type === "image") {
        const mimeType = getString(record, "mimeType") ?? getString(record, "mime") ?? getString(record, "mediaType");
        return `[image${mimeType ? ` ${mimeType}` : ""} omitted]`;
    }
    if (type === "audio")
        return "[audio omitted]";
    if (type === "resource")
        return "[resource omitted]";
    return `[${type} omitted]`;
}
export function readMcpDisplayResult(result) {
    if (result.status === "error") {
        return { isToolError: false, text: "", nonTextSummary: "", body: "" };
    }
    const value = asRecord(result.value);
    const isToolError = value?.isError === true;
    const content = getArray(value, "content") ?? [];
    const textParts = [];
    const nonTextParts = [];
    let preview;
    for (const entry of content) {
        const text = getMcpContentText(entry);
        if (text) {
            textParts.push(text);
            const line = firstNonEmptyLine(text);
            if (!preview && line)
                preview = truncateArg(scrubSensitiveText(line), 120);
            continue;
        }
        nonTextParts.push(describeNonTextMcpContent(entry));
    }
    if (!preview)
        preview = nonTextParts[0];
    const text = textParts.join("\n");
    const nonTextSummary = nonTextParts.join("\n");
    const body = text || nonTextSummary || scrubSensitiveText(stringifyUnknown(result.value), undefined);
    return {
        isToolError,
        text,
        nonTextSummary,
        body: `${isToolError ? "[tool error]\n" : ""}${body}`.trim(),
        ...(preview ? { preview } : {}),
    };
}
