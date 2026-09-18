import { CURSOR_REPLAY_ACTIVITY_TOOL_NAME } from "./cursor-tool-presentation-registry.js";
export const CURSOR_MODEL_ACTIVE_REPLAY_TOOL_NAMES = [CURSOR_REPLAY_ACTIVITY_TOOL_NAME];
export const CURSOR_REPLAY_TOOL_NAMES = [CURSOR_REPLAY_ACTIVITY_TOOL_NAME];
export const BUILTIN_NATIVE_CURSOR_TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"];
export const NATIVE_CURSOR_TOOL_NAMES = [
    ...BUILTIN_NATIVE_CURSOR_TOOL_NAMES,
    ...CURSOR_REPLAY_TOOL_NAMES,
];
export function isNativeCursorToolName(toolName) {
    return NATIVE_CURSOR_TOOL_NAMES.some((nativeToolName) => nativeToolName === toolName);
}
