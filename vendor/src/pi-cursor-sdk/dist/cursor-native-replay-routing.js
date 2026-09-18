import { canRenderCursorToolNatively } from "./cursor-native-tool-display-state.js";
import { getActiveContextToolNames } from "./cursor-context-tools.js";
export function isNativeToolActiveInContext(toolName, activeToolNames) {
    return activeToolNames === undefined || activeToolNames.has(toolName);
}
/**
 * Canonical native replay routing for coordinator and live-run drain.
 * Extension resync (pi active tools) is separate; this uses context.tools snapshot only.
 */
export function resolveNativeReplayDisposition(input) {
    if (!input.useNativeToolReplay || !canRenderCursorToolNatively(input.toolName)) {
        return "transcript_trace";
    }
    if (isNativeToolActiveInContext(input.toolName, input.activeToolNames) && input.hasLiveRun) {
        return "queue_replay";
    }
    if (!isNativeToolActiveInContext(input.toolName, input.activeToolNames)) {
        return "inactive_trace";
    }
    return "transcript_trace";
}
export function partitionNativeToolsByActiveContext(context, tools) {
    const activeToolNames = getActiveContextToolNames(context);
    if (!activeToolNames)
        return { active: [...tools], inactive: [] };
    const active = [];
    const inactive = [];
    for (const tool of tools) {
        if (activeToolNames.has(tool.toolName))
            active.push(tool);
        else
            inactive.push(tool);
    }
    return { active, inactive };
}
