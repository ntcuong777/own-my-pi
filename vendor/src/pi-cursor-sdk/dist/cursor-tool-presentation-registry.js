/**
 * Canonical Cursor tool presentation metadata.
 * Names, labels, visibility, replay, lifecycle, web remapping, and alias normalization
 * derive from this registry — do not duplicate tool lists in sibling modules.
 */
import { formatReplaySemSearchQuery, readCursorReplaySummaryString, summarizeReplayGenericActivity, summarizeReplayMcp, summarizeReplayPath, summarizeReplayPlan, summarizeReplayReadLints, summarizeReplayRecordScreen, summarizeReplayTask, summarizeReplayTodoCount, withActivitySummaryFallback, } from "./cursor-replay-summary-args.js";
import { truncateCursorDisplayLine } from "./cursor-display-text.js";
import { getCursorTaskActivityTitle } from "./cursor-task-presentation.js";
import { buildCreatePlanReplaySummaryArgs, buildDeleteReplayDetailFields, buildDeleteReplaySummaryArgs, buildGenerateImageReplayDetailFields, buildGenerateImageReplaySummaryArgs, buildMcpReplaySummaryArgs, buildReadLintsReplaySummaryArgs, buildRecordScreenReplaySummaryArgs, buildSemSearchReplaySummaryArgs, buildTaskReplaySummaryArgs, buildTodoReplaySummaryArgs, buildWebFetchReplaySummaryArgs, buildWebSearchReplaySummaryArgs, } from "./cursor-replay-activity-builders.js";
import { CURSOR_REPLAY_SOURCE_TOOL_NAMES } from "./cursor-replay-source-names.js";
export const CURSOR_REPLAY_ACTIVITY_TOOL_NAME = "cursor";
const EMPTY_REPLAY_DETAIL_FIELDS = () => ({});
const COLLAPSED_REPLAY_DETAIL_FIELDS = () => ({ collapseDetailsByDefault: true });
const WEB_SEARCH_NAME_PATTERN = /^(?:web[-_ ]?search|search[-_ ]?web|websearch|browser[-_ ]?search)$/i;
const WEB_FETCH_NAME_PATTERN = /^(?:web[-_ ]?fetch|fetch[-_ ]?web|webfetch|browser[-_ ]?fetch|fetch[-_ ]?url)$/i;
export const CURSOR_TOOL_PRESENTATION_SPECS = [
    {
        normalizedName: "read",
        nameAliases: ["read_file"],
        displayLabel: "read",
        visibility: { incompleteTitle: "Cursor read", fastLocalDiscovery: true },
    },
    {
        normalizedName: "grep",
        nameAliases: ["grep_search", "search"],
        displayLabel: "grep",
        visibility: { incompleteTitle: "Cursor grep", fastLocalDiscovery: true },
    },
    {
        normalizedName: "glob",
        nameAliases: ["file_search"],
        displayLabel: "glob",
        visibility: { incompleteTitle: "Cursor find", fastLocalDiscovery: true },
    },
    {
        normalizedName: "ls",
        nameAliases: ["list_dir"],
        displayLabel: "ls",
        visibility: { incompleteTitle: "Cursor ls", fastLocalDiscovery: true },
    },
    {
        normalizedName: "shell",
        nameAliases: ["run_terminal_cmd", "terminal", "bash"],
        displayLabel: "shell",
        visibility: {
            incompleteTitle: "Cursor shell",
            lifecycleTitle: "Cursor shell",
            lifecycleEligible: true,
        },
        lifecycleLabelKind: "shell",
    },
    {
        normalizedName: "edit",
        nameAliases: [
            "strreplace",
            "str_replace",
            "str-replace",
            "edit_file",
            "editfile",
            "edit_notebook",
            "editnotebook",
            "notebook_edit",
            "notebookedit",
        ],
        displayLabel: "Cursor edit",
        visibility: {},
        replayCallSummary: withActivitySummaryFallback(summarizeReplayPath),
    },
    {
        normalizedName: "write",
        nameAliases: ["write_file", "writefile"],
        displayLabel: "Cursor write",
        visibility: {},
        replayCallSummary: withActivitySummaryFallback(summarizeReplayPath),
    },
    {
        normalizedName: "delete",
        displayLabel: "Cursor delete",
        visibility: {},
        replayCallSummary: withActivitySummaryFallback(summarizeReplayPath),
        activityReplay: {
            buildActivityArgs: buildDeleteReplaySummaryArgs,
            buildDetails: buildDeleteReplayDetailFields,
        },
    },
    {
        normalizedName: "readLints",
        displayLabel: "Cursor diagnostics",
        visibility: {},
        replayCallSummary: withActivitySummaryFallback(summarizeReplayReadLints),
        activityReplay: {
            buildActivityArgs: buildReadLintsReplaySummaryArgs,
            buildDetails: EMPTY_REPLAY_DETAIL_FIELDS,
        },
    },
    {
        normalizedName: "updateTodos",
        displayLabel: "Cursor todos",
        visibility: { lifecycleEligible: true },
        lifecycleLabelKind: "updateTodos",
        replayCallSummary: withActivitySummaryFallback(summarizeReplayTodoCount),
        activityReplay: {
            buildActivityArgs: ({ args, result }) => buildTodoReplaySummaryArgs(args, result),
            buildDetails: EMPTY_REPLAY_DETAIL_FIELDS,
        },
    },
    {
        normalizedName: "createPlan",
        displayLabel: "Cursor plan",
        visibility: { lifecycleEligible: true },
        lifecycleLabelKind: "createPlan",
        replayCallSummary: withActivitySummaryFallback(summarizeReplayPlan),
        activityReplay: {
            buildActivityArgs: buildCreatePlanReplaySummaryArgs,
            buildDetails: EMPTY_REPLAY_DETAIL_FIELDS,
        },
    },
    {
        normalizedName: "task",
        displayLabel: "Cursor subagent",
        getActivityTitle: getCursorTaskActivityTitle,
        visibility: { lifecycleEligible: true },
        replayDisplay: { showCollapsedExpandHint: true },
        lifecycleLabelKind: "task",
        replayCallSummary: withActivitySummaryFallback(summarizeReplayTask),
        activityReplay: {
            buildActivityArgs: buildTaskReplaySummaryArgs,
            buildDetails: EMPTY_REPLAY_DETAIL_FIELDS,
        },
    },
    {
        normalizedName: "generateImage",
        displayLabel: "Cursor image generation",
        visibility: { lifecycleEligible: true },
        lifecycleLabelKind: "generateImage",
        replayCallSummary: withActivitySummaryFallback((args) => readCursorReplaySummaryString(args, "path") ?? readCursorReplaySummaryString(args, "prompt")),
        generateImageReplay: {
            buildActivityArgs: buildGenerateImageReplaySummaryArgs,
            buildDetails: buildGenerateImageReplayDetailFields,
        },
    },
    {
        normalizedName: "mcp",
        displayLabel: "Cursor MCP",
        visibility: { lifecycleEligible: true },
        lifecycleLabelKind: "mcp",
        replayCallSummary: withActivitySummaryFallback(summarizeReplayMcp),
        activityReplay: {
            buildActivityArgs: buildMcpReplaySummaryArgs,
            buildDetails: EMPTY_REPLAY_DETAIL_FIELDS,
        },
    },
    {
        normalizedName: "semSearch",
        displayLabel: "Cursor semantic search",
        visibility: { lifecycleEligible: true },
        lifecycleLabelKind: "semSearch",
        replayCallSummary: withActivitySummaryFallback(formatReplaySemSearchQuery),
        activityReplay: {
            buildActivityArgs: buildSemSearchReplaySummaryArgs,
            buildDetails: EMPTY_REPLAY_DETAIL_FIELDS,
        },
    },
    {
        normalizedName: "recordScreen",
        displayLabel: "Cursor screen recording",
        visibility: { lifecycleEligible: true },
        lifecycleLabelKind: "recordScreen",
        replayCallSummary: withActivitySummaryFallback(summarizeReplayRecordScreen),
        activityReplay: {
            buildActivityArgs: buildRecordScreenReplaySummaryArgs,
            buildDetails: EMPTY_REPLAY_DETAIL_FIELDS,
        },
    },
    {
        normalizedName: "webSearch",
        nameAliases: ["websearch", "web_search", "web-search"],
        displayLabel: "Cursor web search",
        visibility: { lifecycleEligible: true },
        webKind: "webSearch",
        webNamePatterns: [WEB_SEARCH_NAME_PATTERN],
        lifecycleLabelKind: "webSearch",
        replayCallSummary: withActivitySummaryFallback((args) => readCursorReplaySummaryString(args, "query")),
        activityReplay: {
            buildActivityArgs: buildWebSearchReplaySummaryArgs,
            buildDetails: COLLAPSED_REPLAY_DETAIL_FIELDS,
        },
    },
    {
        normalizedName: "webFetch",
        nameAliases: ["webfetch", "web_fetch", "web-fetch"],
        displayLabel: "Cursor web fetch",
        visibility: { lifecycleEligible: true },
        webKind: "webFetch",
        webNamePatterns: [WEB_FETCH_NAME_PATTERN],
        lifecycleLabelKind: "webFetch",
        replayCallSummary: withActivitySummaryFallback((args) => readCursorReplaySummaryString(args, "url")),
        activityReplay: {
            buildActivityArgs: buildWebFetchReplaySummaryArgs,
            buildDetails: COLLAPSED_REPLAY_DETAIL_FIELDS,
        },
    },
];
function hasNeutralActivityTitle(spec) {
    return Boolean(spec.activityReplay || spec.generateImageReplay || spec.normalizedName === "edit" || spec.normalizedName === "write");
}
const SPECS_BY_NORMALIZED_NAME = new Map(CURSOR_TOOL_PRESENTATION_SPECS.map((spec) => [spec.normalizedName, spec]));
const SPECS_BY_NORMALIZED_KEY = new Map(CURSOR_TOOL_PRESENTATION_SPECS.map((spec) => [spec.normalizedName.toLowerCase(), spec]));
const ALIAS_TO_NORMALIZED_NAME = new Map(CURSOR_TOOL_PRESENTATION_SPECS.flatMap((spec) => {
    const aliases = "nameAliases" in spec ? spec.nameAliases : undefined;
    return (aliases ?? []).map((alias) => [alias.toLowerCase(), spec.normalizedName]);
}));
const WEB_KIND_BY_PATTERN = CURSOR_TOOL_PRESENTATION_SPECS.flatMap((spec) => {
    if (!("webKind" in spec) || !("webNamePatterns" in spec))
        return [];
    const { webKind, webNamePatterns } = spec;
    if (!webKind || !webNamePatterns)
        return [];
    return webNamePatterns.map((pattern) => ({ pattern, webKind }));
});
export const CURSOR_KNOWN_NORMALIZED_TOOL_NAMES = CURSOR_REPLAY_SOURCE_TOOL_NAMES;
export function getCursorToolPresentationSpec(name) {
    const trimmed = name.trim();
    if (!trimmed)
        return undefined;
    return SPECS_BY_NORMALIZED_NAME.get(trimmed) ?? SPECS_BY_NORMALIZED_KEY.get(trimmed.toLowerCase());
}
export function normalizeCursorToolName(name) {
    const normalized = name.replace(/\s+/g, " ").trim();
    if (!normalized)
        return "unknown";
    const aliasTarget = ALIAS_TO_NORMALIZED_NAME.get(normalized.toLowerCase());
    if (aliasTarget)
        return aliasTarget;
    const spec = getCursorToolPresentationSpec(normalized);
    if (spec)
        return spec.normalizedName;
    return normalized;
}
export function classifyCursorWebToolKind(name) {
    if (!name)
        return undefined;
    const normalized = name.replace(/\s+/g, " ").trim().toLowerCase();
    for (const { pattern, webKind } of WEB_KIND_BY_PATTERN) {
        if (pattern.test(normalized))
            return webKind;
    }
    const spec = getCursorToolPresentationSpec(name);
    return spec?.webKind;
}
export function isCursorReplayToolName(toolName) {
    return toolName === CURSOR_REPLAY_ACTIVITY_TOOL_NAME;
}
export function isExcludedFromCursorBridgeExposure(toolName) {
    return toolName === CURSOR_REPLAY_ACTIVITY_TOOL_NAME;
}
export function getCursorReplayPromptLabel(toolName) {
    return toolName === CURSOR_REPLAY_ACTIVITY_TOOL_NAME ? "Cursor activity" : toolName;
}
export function getCursorReplayActivityTitle(toolName) {
    const spec = getCursorToolPresentationSpec(toolName);
    if (!spec || !hasNeutralActivityTitle(spec))
        return undefined;
    return spec.getActivityTitle?.() ?? spec.displayLabel;
}
function buildCursorGenericActivityTitle(displayName) {
    if (!displayName || displayName === "unknown")
        return "Cursor tool";
    return `Cursor ${truncateCursorDisplayLine(displayName, 120)}`;
}
/** Canonical activity title: registry label when known, otherwise neutral fallback. */
export function getCursorToolActivityTitle(toolName) {
    const normalized = normalizeCursorToolName(toolName);
    const known = getCursorReplayActivityTitle(normalized);
    if (known)
        return known;
    const label = toolName.trim() || normalized;
    return buildCursorGenericActivityTitle(label);
}
function getCursorToolPresentationSpecByNormalizedKey(normalizedKey) {
    return SPECS_BY_NORMALIZED_KEY.get(normalizedKey.toLowerCase());
}
export function getCursorToolVisibilityPolicy(normalizedKey) {
    return getCursorToolPresentationSpecByNormalizedKey(normalizedKey)?.visibility;
}
export function getCursorToolLifecycleLabelKind(normalizedKey) {
    return getCursorToolPresentationSpecByNormalizedKey(normalizedKey)?.lifecycleLabelKind;
}
export function getCursorToolActivityReplaySpec(normalizedKey) {
    return getCursorToolPresentationSpecByNormalizedKey(normalizedKey)?.activityReplay;
}
export function getCursorToolGenerateImageReplaySpec(normalizedKey) {
    return getCursorToolPresentationSpecByNormalizedKey(normalizedKey)?.generateImageReplay;
}
export function shouldShowCursorReplayCollapsedExpandHint(normalizedKey) {
    if (!normalizedKey)
        return false;
    return getCursorToolPresentationSpecByNormalizedKey(normalizedKey)?.replayDisplay?.showCollapsedExpandHint === true;
}
export function getCursorReplayCallSummary(toolName, args) {
    if (toolName === CURSOR_REPLAY_ACTIVITY_TOOL_NAME) {
        return readCursorReplaySummaryString(args, "activitySummary") ?? summarizeReplayGenericActivity(args);
    }
    return getCursorToolPresentationSpec(toolName)?.replayCallSummary?.(args);
}
