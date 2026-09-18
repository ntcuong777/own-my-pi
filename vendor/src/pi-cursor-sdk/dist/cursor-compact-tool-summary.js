import { isAbsolute, relative, win32 } from "node:path";
import { asRecord, getRecord, getString } from "./cursor-record-utils.js";
import { formatDisplayPath } from "./cursor-transcript-utils.js";
function isWindowsAbsolutePath(path) {
    return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
}
export function formatCursorCompactToolPath(path, options) {
    const trimmed = path?.trim();
    if (!trimmed)
        return undefined;
    const normalized = trimmed.replace(/\\/g, "/");
    if (normalized === "~" || normalized.startsWith("~/") || /^~[^/]+(?:\/|$)/.test(normalized))
        return undefined;
    if (normalized.split("/").includes(".."))
        return undefined;
    if (/^[A-Za-z]:(?!\/)/.test(normalized))
        return undefined;
    if (isWindowsAbsolutePath(trimmed)) {
        const cwd = options.cwd;
        if (!cwd || !isWindowsAbsolutePath(cwd))
            return undefined;
        const relativePath = win32.relative(cwd, trimmed);
        if (!relativePath || relativePath.startsWith("..") || isWindowsAbsolutePath(relativePath))
            return undefined;
        return relativePath.replace(/\\/g, "/");
    }
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalized))
        return undefined;
    if (isAbsolute(trimmed)) {
        const cwd = options.cwd;
        if (!cwd)
            return undefined;
        const relativePath = relative(cwd, trimmed);
        if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath))
            return undefined;
        return relativePath.replace(/\\/g, "/");
    }
    return formatDisplayPath(normalized, options.cwd);
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
function summarizeShellTool(args, resultValue) {
    const command = getString(args, "command");
    const stdout = getString(resultValue, "stdout");
    const stderr = getString(resultValue, "stderr");
    return [command ? `$ ${command}` : "shell", stdout, stderr].filter((part) => Boolean(part)).join("\n");
}
export function summarizeCursorCompactToolCall(toolName, args, result, options) {
    if (!toolName)
        return undefined;
    const compactName = toolName.replace(/\s+/g, " ").trim() || "unknown";
    if (compactName === "shell")
        return summarizeShellTool(args, getNestedRecord(result, "value"));
    const path = formatCursorCompactToolPath(getString(args, "path"), options);
    if (path)
        return `${compactName} ${path}`;
    const query = getString(args, "query") ?? getString(args, "pattern");
    if (query)
        return `${compactName} ${query}`;
    return compactName;
}
export function summarizeCursorCompactConversationToolCall(step, options) {
    const record = asRecord(step);
    if (getString(record, "type") !== "toolCall")
        return undefined;
    const message = getRecord(record, "message");
    return summarizeCursorCompactToolCall(getString(message, "type"), getRecord(message, "args"), getRecord(message, "result"), options);
}
