import { asRecord, getBoolean, getRecord, getString } from "./cursor-record-utils.js";
export const CURSOR_TASK_PRESENTATION_ENV = "PI_CURSOR_TASK_PRESENTATION";
const VALID_CURSOR_TASK_PRESENTATION_MODES = new Set([
    "task",
    "subagent",
    "subagent-meta",
]);
export function getCursorTaskPresentationMode(env = process.env) {
    const raw = env[CURSOR_TASK_PRESENTATION_ENV]?.trim();
    return raw && VALID_CURSOR_TASK_PRESENTATION_MODES.has(raw)
        ? raw
        : "subagent-meta";
}
export function getCursorTaskDescription(args, resultValue) {
    return getString(args, "description") ?? getString(asRecord(resultValue), "description") ?? "task";
}
export function readCursorTaskMetadata(args, resultValue) {
    const subagentType = getRecord(args, "subagentType");
    const result = asRecord(resultValue);
    return {
        description: getCursorTaskDescription(args, resultValue),
        subagentKind: getString(subagentType, "kind"),
        subagentName: getString(subagentType, "name"),
        model: getString(args, "model"),
        agentId: getString(args, "agentId") ?? getString(result, "agentId"),
        isBackground: getBoolean(result, "isBackground"),
    };
}
function cleanMetadataValue(value) {
    const trimmed = value?.trim();
    return trimmed || undefined;
}
export function getCursorTaskActivityTitle() {
    return getCursorTaskPresentationMode() === "task" ? "Cursor task" : "Cursor subagent";
}
export function getCursorTaskTranscriptHeader(args, resultValue) {
    const metadata = readCursorTaskMetadata(args, resultValue);
    const description = cleanMetadataValue(metadata.description) ?? "task";
    const mode = getCursorTaskPresentationMode();
    if (mode === "task")
        return `task ${description}`;
    if (mode === "subagent-meta") {
        const subagentName = cleanMetadataValue(metadata.subagentName);
        return subagentName ? `subagent ${subagentName} ${description}` : `subagent ${description}`;
    }
    return `subagent ${description}`;
}
export function formatCursorTaskKind(value) {
    const cleaned = cleanMetadataValue(value);
    if (!cleaned)
        return undefined;
    return cleaned.slice(0, 1).toUpperCase() + cleaned.slice(1);
}
export function formatCursorTaskAgentId(value) {
    const cleaned = cleanMetadataValue(value);
    if (!cleaned || !/^[A-Za-z0-9_.:-]+$/.test(cleaned))
        return undefined;
    return cleaned.length > 12 ? cleaned.slice(0, 8) : cleaned;
}
