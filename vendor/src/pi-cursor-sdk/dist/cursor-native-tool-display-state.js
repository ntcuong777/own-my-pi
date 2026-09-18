import { parseOptionalEnvBoolean } from "./cursor-env-boolean.js";
export const NATIVE_CURSOR_TOOL_DISPLAY_ENV = "PI_CURSOR_NATIVE_TOOL_DISPLAY";
export const NATIVE_CURSOR_TOOL_REGISTRATION_ENV = "PI_CURSOR_REGISTER_NATIVE_TOOLS";
export const registeredNativeToolNames = new Set();
export const skippedNativeToolNames = new Set();
export const nativeToolResults = new Map();
let nativeToolDisplayRuntimeRequested = false;
export function readBooleanEnv(name, env = process.env) {
    return parseOptionalEnvBoolean(env[name]);
}
export function isCursorNativeToolDisplayRequested(mode) {
    const override = readBooleanEnv(NATIVE_CURSOR_TOOL_DISPLAY_ENV);
    if (override !== undefined)
        return override;
    if (mode)
        return mode === "tui" || mode === "json" || mode === "rpc";
    return process.stdout.isTTY === true;
}
export function isCursorNativeToolRegistrationRequested(mode) {
    return mode !== "print" && readBooleanEnv(NATIVE_CURSOR_TOOL_REGISTRATION_ENV) !== false && isCursorNativeToolDisplayRequested(mode);
}
export function setCursorNativeToolDisplayRuntimeRequested(requested) {
    nativeToolDisplayRuntimeRequested = requested;
}
export function isCursorNativeToolDisplayEnabled() {
    return registeredNativeToolNames.size > 0;
}
export function isCursorNativeToolDisplayRuntimeEnabled() {
    return nativeToolDisplayRuntimeRequested && readBooleanEnv(NATIVE_CURSOR_TOOL_DISPLAY_ENV) !== false && registeredNativeToolNames.size > 0;
}
export function canRenderCursorToolNatively(toolName) {
    return registeredNativeToolNames.has(toolName);
}
export function isRegisteredCursorNativeToolName(toolName) {
    return registeredNativeToolNames.has(toolName);
}
export function recordCursorNativeToolDisplay(item) {
    if (!canRenderCursorToolNatively(item.toolName))
        return false;
    nativeToolResults.set(item.id, item);
    return true;
}
export function deleteCursorNativeToolDisplay(id) {
    nativeToolResults.delete(id);
}
export function consumeCursorNativeToolDisplay(id) {
    const item = nativeToolResults.get(id);
    if (item)
        nativeToolResults.delete(id);
    return item;
}
export function isCursorReplayToolCallId(toolCallId) {
    return toolCallId.startsWith("cursor-replay-");
}
export function isCursorFileMutationToolName(toolName) {
    return toolName === "edit" || toolName === "write";
}
export const __testUtils = {
    nativeToolResultCount: () => nativeToolResults.size,
    registerNativeToolNameForTests(toolName) {
        nativeToolDisplayRuntimeRequested = true;
        registeredNativeToolNames.add(toolName);
    },
    reset() {
        nativeToolDisplayRuntimeRequested = false;
        registeredNativeToolNames.clear();
        skippedNativeToolNames.clear();
        nativeToolResults.clear();
    },
};
