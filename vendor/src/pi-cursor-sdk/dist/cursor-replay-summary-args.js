/**
 * Typed replay summary argument payloads shared by the presentation registry
 * and transcript replay builders.
 */
export function readCursorReplaySummaryString(args, key) {
    const value = args?.[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
export function readCursorReplaySummaryNumber(args, key) {
    const value = args?.[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
export function readCursorReplaySummaryStringArray(args, key) {
    const value = args?.[key];
    return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}
function formatReplayRecordingDurationMs(ms) {
    if (ms === undefined || !Number.isFinite(ms) || ms < 0)
        return undefined;
    if (ms < 1000)
        return `${Math.round(ms)}ms`;
    const seconds = ms / 1000;
    return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}
export function summarizeReplayPath(args) {
    return readCursorReplaySummaryString(args, "path") ?? "unknown";
}
export function summarizeReplayReadLints(args) {
    const paths = readCursorReplaySummaryStringArray(args, "paths");
    const path = readCursorReplaySummaryString(args, "path");
    const diagnosticCount = readCursorReplaySummaryNumber(args, "diagnosticCount");
    const target = paths.length > 0 ? paths.join(", ") : path;
    if (target && diagnosticCount !== undefined) {
        return `${diagnosticCount} diagnostic${diagnosticCount === 1 ? "" : "s"} in ${target}`;
    }
    return target;
}
export function summarizeReplayTodoCount(args) {
    const totalCount = readCursorReplaySummaryNumber(args, "totalCount");
    const completedCount = readCursorReplaySummaryNumber(args, "completedCount");
    const inProgressCount = readCursorReplaySummaryNumber(args, "inProgressCount");
    const pendingCount = readCursorReplaySummaryNumber(args, "pendingCount");
    if (totalCount !== undefined && completedCount !== undefined) {
        const parts = [`${completedCount}/${totalCount} completed`];
        if (inProgressCount && inProgressCount > 0)
            parts.push(`${inProgressCount} in progress`);
        if (pendingCount && pendingCount > 0)
            parts.push(`${pendingCount} pending`);
        return parts.join(", ");
    }
    return totalCount !== undefined ? `${totalCount} item${totalCount === 1 ? "" : "s"}` : undefined;
}
export function summarizeReplayPlan(args) {
    return readCursorReplaySummaryString(args, "planTitle") ?? summarizeReplayTodoCount(args);
}
export function summarizeReplayTask(args) {
    const description = readCursorReplaySummaryString(args, "description");
    const preview = readCursorReplaySummaryString(args, "preview");
    const subagentName = readCursorReplaySummaryString(args, "subagentName");
    const subagentKind = readCursorReplaySummaryString(args, "subagentKind");
    const model = readCursorReplaySummaryString(args, "model");
    const agentId = readCursorReplaySummaryString(args, "agentId");
    const metadataParts = [
        subagentKind,
        model,
        agentId ? `ID: ${agentId}` : undefined,
        args?.isBackground === true ? "backgrounded" : undefined,
    ].filter((part) => Boolean(part));
    const subjectParts = [description].filter((part) => Boolean(part));
    const subject = subjectParts.length > 0 ? subjectParts.join(" · ") : undefined;
    const head = metadataParts.length > 0 ? [subject, ...metadataParts].filter(Boolean).join(" · ") : subject;
    if (metadataParts.length > 0)
        return head;
    if (head && preview && preview !== description && preview !== subagentName)
        return `${head}: ${preview}`;
    return head ?? preview;
}
export function summarizeReplayMcp(args) {
    const toolName = readCursorReplaySummaryString(args, "toolName") ?? "mcp";
    const preview = readCursorReplaySummaryString(args, "preview");
    return preview && preview !== toolName ? `${toolName} · ${preview}` : toolName;
}
export function summarizeReplayRecordScreen(args) {
    const path = readCursorReplaySummaryString(args, "path");
    const duration = formatReplayRecordingDurationMs(readCursorReplaySummaryNumber(args, "recordingDurationMs"));
    if (path && duration)
        return `${path} · ${duration}`;
    return path ?? readCursorReplaySummaryString(args, "mode");
}
export function formatReplaySemSearchQuery(args) {
    const query = readCursorReplaySummaryString(args, "query");
    if (!query)
        return undefined;
    const targetDirectories = readCursorReplaySummaryStringArray(args, "targetDirectories");
    const dirHint = targetDirectories.length > 0 ? ` (${targetDirectories.length} dir${targetDirectories.length === 1 ? "" : "s"})` : "";
    return `${query}${dirHint}`;
}
export function summarizeReplayGenericActivity(args) {
    return (readCursorReplaySummaryString(args, "path")
        ?? readCursorReplaySummaryString(args, "toolName")
        ?? formatReplaySemSearchQuery(args));
}
export function withActivitySummaryFallback(buildSummary) {
    return (args) => readCursorReplaySummaryString(args, "activitySummary") ?? buildSummary(args);
}
