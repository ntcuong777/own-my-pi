import { asRecord, getArray, getNumber, getString } from "./cursor-record-utils.js";
import { firstNonEmptyLine, formatDisplayPath, truncateArg } from "./cursor-transcript-utils.js";
import { collectTaskText, getGenerateImageDisplayPath, getGenerateImagePath, readMcpDisplayResult, getReadLintDiagnostics, getReadLintPaths, getTodoItems, getTodoTotalCount, inferImageMimeType, } from "./cursor-tool-result-display-readers.js";
import { extractWebFetchTarget, extractWebSearchQuery } from "./cursor-web-tool-args.js";
import { formatCursorTaskAgentId, formatCursorTaskKind, getCursorTaskDescription, getCursorTaskPresentationMode, readCursorTaskMetadata } from "./cursor-task-presentation.js";
export function buildDeleteReplaySummaryArgs({ args, options }) {
    const displayPath = typeof args.path === "string" ? formatDisplayPath(args.path, options.cwd) : undefined;
    return displayPath ? { path: displayPath } : {};
}
export function buildDeleteReplayDetailFields({ args, result, options }) {
    const displayPath = typeof args.path === "string" ? formatDisplayPath(args.path, options.cwd) : undefined;
    const value = asRecord(result.value);
    return {
        path: displayPath,
        fileSize: getNumber(value, "fileSize"),
    };
}
export function buildReadLintsReplaySummaryArgs({ args, result, options, }) {
    const paths = getReadLintPaths(args, result, options);
    const diagnosticCount = getReadLintDiagnostics(result, options).length;
    return {
        ...(paths.length > 0 ? { paths } : {}),
        ...(paths.length === 1 ? { path: paths[0] } : {}),
        ...(paths.length > 0 ? { diagnosticCount } : {}),
    };
}
export function buildTodoReplaySummaryArgs(args, result) {
    const todos = getTodoItems(args, result);
    const totalCount = getTodoTotalCount(args, result, todos);
    const completedCount = todos.filter((todo) => todo.status === "completed").length;
    const inProgressCount = todos.filter((todo) => todo.status === "inProgress").length;
    const pendingCount = todos.filter((todo) => todo.status === "pending").length;
    return todos.length > 0
        ? { totalCount, completedCount, inProgressCount, pendingCount }
        : { totalCount };
}
export function buildCreatePlanReplaySummaryArgs({ args, result }) {
    const plan = getString(args, "plan") ?? getString(asRecord(result.value) ?? {}, "plan");
    const planTitle = plan ? firstNonEmptyLine(plan) : undefined;
    return {
        ...buildTodoReplaySummaryArgs(args, result),
        ...(planTitle ? { planTitle: truncateArg(planTitle) } : {}),
    };
}
export function buildTaskReplaySummaryArgs({ args, result, options }) {
    const description = getCursorTaskDescription(args, result.value);
    const preview = firstNonEmptyLine(collectTaskText(result, options));
    const metadata = readCursorTaskMetadata(args, result.value);
    const displayAgentId = formatCursorTaskAgentId(metadata.agentId);
    const includeMetadata = getCursorTaskPresentationMode() === "subagent-meta";
    return {
        description: truncateArg(description),
        ...(preview ? { preview: truncateArg(preview) } : {}),
        ...(includeMetadata && metadata.subagentName ? { subagentName: truncateArg(metadata.subagentName) } : {}),
        ...(includeMetadata && metadata.subagentKind ? { subagentKind: truncateArg(formatCursorTaskKind(metadata.subagentKind) ?? metadata.subagentKind) } : {}),
        ...(includeMetadata && metadata.model ? { model: truncateArg(metadata.model) } : {}),
        ...(includeMetadata && displayAgentId ? { agentId: truncateArg(displayAgentId) } : {}),
        ...(includeMetadata && metadata.isBackground === true ? { isBackground: true } : {}),
    };
}
export function buildGenerateImageReplaySummaryArgs({ args, result, options, }) {
    const prompt = getString(args, "prompt") ?? getString(args, "description") ?? "image";
    const imageDisplayPath = getGenerateImageDisplayPath(args, result, options);
    return {
        prompt: truncateArg(prompt),
        ...(imageDisplayPath ? { path: imageDisplayPath } : {}),
    };
}
export function buildMcpReplaySummaryArgs({ args, result }) {
    const toolName = getString(args, "toolName") ?? "mcp";
    const preview = readMcpDisplayResult(result).preview;
    return {
        toolName: truncateArg(toolName),
        ...(preview ? { preview } : {}),
    };
}
export function buildSemSearchReplaySummaryArgs({ args }) {
    const query = getString(args, "query") ?? "semantic search";
    const targetDirectories = (getArray(args, "targetDirectories") ?? []).filter((entry) => typeof entry === "string");
    return {
        query: truncateArg(query),
        ...(targetDirectories.length > 0 ? { targetDirectories } : {}),
    };
}
export function buildRecordScreenReplaySummaryArgs({ args, result, options, }) {
    const mode = getString(args, "mode");
    const value = asRecord(result.value) ?? {};
    const path = getString(value, "path");
    const recordingDurationMs = getNumber(value, "recordingDurationMs");
    return {
        ...(mode ? { mode } : {}),
        ...(path ? { path: formatDisplayPath(path, options.cwd) } : {}),
        ...(recordingDurationMs !== undefined ? { recordingDurationMs } : {}),
    };
}
export function buildWebSearchReplaySummaryArgs({ args }) {
    const query = extractWebSearchQuery(args);
    return query ? { query: truncateArg(query) } : {};
}
export function buildWebFetchReplaySummaryArgs({ args }) {
    const url = extractWebFetchTarget(args);
    return url ? { url: truncateArg(url) } : {};
}
export function buildGenerateImageReplayDetailFields(context, contentText) {
    const { args, result, options } = context;
    const imagePath = getGenerateImagePath(args, result);
    const imageDisplayPath = getGenerateImageDisplayPath(args, result, options);
    return {
        imagePath,
        imageDisplayPath,
        imageMimeType: inferImageMimeType(imagePath),
        expandedText: contentText,
    };
}
