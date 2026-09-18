import { arePiToolsDisabled } from "./cursor-active-tools.js";
import { CURSOR_MODEL_ACTIVE_REPLAY_TOOL_NAMES, isNativeCursorToolName, NATIVE_CURSOR_TOOL_NAMES, } from "./cursor-native-tool-names.js";
import { isCursorModel } from "./cursor-model.js";
import { registerCursorModelLifecycle } from "./cursor-model-lifecycle.js";
import { isCursorNativeToolDisplayRequested, isCursorNativeToolRegistrationRequested, NATIVE_CURSOR_TOOL_DISPLAY_ENV, readBooleanEnv, registeredNativeToolNames, setCursorNativeToolDisplayRuntimeRequested, skippedNativeToolNames, } from "./cursor-native-tool-display-state.js";
import { isCursorReplayToolName } from "./cursor-tool-presentation-registry.js";
import { registerNativeCursorTool } from "./cursor-native-tool-display-tools.js";
export const CURSOR_CORE_PI_REPLAY_TOOL_NAMES = ["read", "bash", "edit", "write"];
const CORE_PI_TOOL_NAMES = new Set(CURSOR_CORE_PI_REPLAY_TOOL_NAMES);
function isCursorCorePiReplayToolName(toolName) {
    return CORE_PI_TOOL_NAMES.has(toolName);
}
function hasNonBuiltinTool(pi, toolName) {
    const existingTool = pi.getAllTools().find((tool) => tool.name === toolName);
    return existingTool !== undefined && existingTool.sourceInfo.source !== "builtin";
}
function registerNativeCursorToolsFromSet(pi, toolNames) {
    const newlySkippedToolNames = [];
    for (const toolName of toolNames) {
        if (registeredNativeToolNames.has(toolName) || skippedNativeToolNames.has(toolName))
            continue;
        if (hasNonBuiltinTool(pi, toolName)) {
            skippedNativeToolNames.add(toolName);
            newlySkippedToolNames.push(toolName);
            continue;
        }
        registerNativeCursorTool(pi, toolName);
        registeredNativeToolNames.add(toolName);
    }
    return newlySkippedToolNames;
}
function notifySkippedNativeCursorToolsIfNeeded(ctx, skippedToolNames) {
    if (skippedToolNames.length === 0 || readBooleanEnv(NATIVE_CURSOR_TOOL_DISPLAY_ENV) !== true || ctx.mode !== "tui")
        return;
    ctx.ui.notify(`Cursor native tool replay skipped for ${skippedToolNames.join(", ")} because another extension already provides ${skippedToolNames.length === 1 ? "that tool" : "those tools"}. Cursor will use scrubbed activity transcripts for skipped tools.`, "warning");
}
function hasAttemptedNativeCursorToolRegistration() {
    return registeredNativeToolNames.size > 0 || skippedNativeToolNames.size > 0;
}
function removeRegisteredNonCoreNativeCursorTools(pi) {
    if (registeredNativeToolNames.size === 0)
        return;
    const activeToolNames = new Set(pi.getActiveTools());
    let changed = false;
    for (const toolName of registeredNativeToolNames) {
        if (isCursorCorePiReplayToolName(toolName))
            continue;
        if (!activeToolNames.delete(toolName))
            continue;
        changed = true;
    }
    if (changed)
        pi.setActiveTools([...activeToolNames]);
}
export function syncRegisteredNativeCursorToolsForModel(pi, model) {
    if (registeredNativeToolNames.size === 0)
        return;
    if (!isCursorModel(model)) {
        removeRegisteredNonCoreNativeCursorTools(pi);
        return;
    }
    if (arePiToolsDisabled(pi))
        return;
    const activeToolNames = new Set(pi.getActiveTools());
    let changed = false;
    for (const toolName of registeredNativeToolNames) {
        if (isCursorReplayToolName(toolName) && !CURSOR_MODEL_ACTIVE_REPLAY_TOOL_NAMES.some((activeReplayToolName) => activeReplayToolName === toolName))
            continue;
        if (activeToolNames.has(toolName))
            continue;
        activeToolNames.add(toolName);
        changed = true;
    }
    if (changed)
        pi.setActiveTools([...activeToolNames]);
}
function ensureNativeCursorToolsRegisteredForModel(pi, ctx) {
    if (!isCursorModel(ctx.model) || hasAttemptedNativeCursorToolRegistration())
        return;
    const nonCoreToolNames = NATIVE_CURSOR_TOOL_NAMES.filter((toolName) => !isCursorCorePiReplayToolName(toolName));
    const skippedToolNames = [
        ...registerNativeCursorToolsFromSet(pi, nonCoreToolNames),
        ...registerNativeCursorToolsFromSet(pi, CURSOR_CORE_PI_REPLAY_TOOL_NAMES),
    ];
    notifySkippedNativeCursorToolsIfNeeded(ctx, skippedToolNames);
}
function ensureThenSyncNativeCursorToolsForModel(pi, ctx) {
    const requested = isCursorNativeToolRegistrationRequested(ctx.mode);
    setCursorNativeToolDisplayRuntimeRequested(requested);
    if (!requested) {
        removeRegisteredNonCoreNativeCursorTools(pi);
        return;
    }
    ensureNativeCursorToolsRegisteredForModel(pi, ctx);
    syncRegisteredNativeCursorToolsForModel(pi, ctx.model);
}
export function registerCursorNativeToolDisplay(pi) {
    registerCursorModelLifecycle(pi, (ctx) => {
        ensureThenSyncNativeCursorToolsForModel(pi, ctx);
    });
}
export { isNativeCursorToolName, isCursorNativeToolDisplayRequested };
