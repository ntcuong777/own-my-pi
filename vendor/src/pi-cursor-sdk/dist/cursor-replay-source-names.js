export const CURSOR_REPLAY_SOURCE_TOOL_NAMES = [
    "read",
    "grep",
    "glob",
    "ls",
    "shell",
    "edit",
    "write",
    "delete",
    "readLints",
    "updateTodos",
    "createPlan",
    "task",
    "generateImage",
    "mcp",
    "semSearch",
    "recordScreen",
    "webSearch",
    "webFetch",
];
const CURSOR_REPLAY_SOURCE_TOOL_NAME_SET = new Set(CURSOR_REPLAY_SOURCE_TOOL_NAMES);
export function isCursorReplaySourceToolName(name) {
    return CURSOR_REPLAY_SOURCE_TOOL_NAME_SET.has(name);
}
export function isCursorReplayActivitySourceName(name) {
    return name !== "generateImage" && isCursorReplaySourceToolName(name);
}
