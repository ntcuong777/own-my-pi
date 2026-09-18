import { asRecord, getBoolean, getNumber, getString } from "./cursor-record-utils.js";
import { isCursorReplayActivitySourceName } from "./cursor-replay-source-names.js";
/**
 * Sentinel source tool name for activity cards whose SDK name is not a known registry entry.
 * Display identity lives in `title` and replay args.
 */
export const CURSOR_REPLAY_UNREGISTERED_ACTIVITY_TOOL_NAME = "unregisteredActivity";
function readSourceToolName(record) {
    const sourceToolName = getString(record, "sourceToolName");
    return sourceToolName?.trim() ? sourceToolName.trim() : undefined;
}
function readVariant(record) {
    const variant = getString(record, "variant");
    return variant?.trim() ? variant.trim() : undefined;
}
function parseCursorReplayNativeEditDetails(record) {
    return {
        variant: "nativeEdit",
        path: getString(record, "path"),
        linesAdded: getNumber(record, "linesAdded"),
        linesRemoved: getNumber(record, "linesRemoved"),
        diffString: getString(record, "diffString"),
        diff: getString(record, "diff"),
        firstChangedLine: getNumber(record, "firstChangedLine"),
        summary: getString(record, "summary"),
        expandedText: getString(record, "expandedText"),
    };
}
function parseCursorReplayNativeWriteDetails(record) {
    return {
        variant: "nativeWrite",
        path: getString(record, "path"),
        linesCreated: getNumber(record, "linesCreated"),
        fileSize: getNumber(record, "fileSize"),
        fileContentAfterWrite: getString(record, "fileContentAfterWrite"),
        expandedText: getString(record, "expandedText"),
        summary: getString(record, "summary"),
    };
}
function parseCursorReplayGenerateImageDetails(record) {
    const collapseDetailsByDefault = getBoolean(record, "collapseDetailsByDefault");
    return {
        variant: "generateImage",
        imagePath: getString(record, "imagePath"),
        imageDisplayPath: getString(record, "imageDisplayPath"),
        imageMimeType: getString(record, "imageMimeType"),
        summary: getString(record, "summary"),
        expandedText: getString(record, "expandedText"),
        ...(collapseDetailsByDefault !== undefined ? { collapseDetailsByDefault } : {}),
    };
}
function parseCursorReplayActivityDetails(record, sourceToolName, title) {
    return {
        variant: "activity",
        sourceToolName,
        title,
        summary: getString(record, "summary"),
        expandedText: getString(record, "expandedText"),
        collapseDetailsByDefault: getBoolean(record, "collapseDetailsByDefault"),
        path: getString(record, "path"),
        fileSize: getNumber(record, "fileSize"),
        diffString: getString(record, "diffString"),
        diff: getString(record, "diff"),
        linesAdded: getNumber(record, "linesAdded"),
        linesRemoved: getNumber(record, "linesRemoved"),
        fileContentAfterWrite: getString(record, "fileContentAfterWrite"),
    };
}
function brandCursorReplayUnknownSourceToolName(sourceToolName) {
    return sourceToolName;
}
function parseCursorReplayGenericFallbackDetails(record, sourceToolName) {
    return {
        variant: "genericFallback",
        sourceToolName: brandCursorReplayUnknownSourceToolName(sourceToolName),
        summary: getString(record, "summary"),
        expandedText: getString(record, "expandedText"),
    };
}
function isCursorReplayActivitySourceToolName(name) {
    if (name === CURSOR_REPLAY_UNREGISTERED_ACTIVITY_TOOL_NAME)
        return true;
    if (name === "generateImage")
        return false;
    return isCursorReplayActivitySourceName(name);
}
function resolveParseActivitySourceToolName(sourceToolName) {
    return isCursorReplayActivitySourceToolName(sourceToolName)
        ? sourceToolName
        : CURSOR_REPLAY_UNREGISTERED_ACTIVITY_TOOL_NAME;
}
/** Maps incomplete or non-activity replay source names onto activity-card source tool names. */
export function resolveIncompleteReplayActivitySourceToolName(sourceToolName) {
    if (sourceToolName === "generateImage")
        return CURSOR_REPLAY_UNREGISTERED_ACTIVITY_TOOL_NAME;
    return resolveParseActivitySourceToolName(sourceToolName);
}
function parseActivityVariantDetails(record) {
    const title = getString(record, "title")?.trim();
    if (!title)
        return undefined;
    return parseCursorReplayActivityDetails(record, resolveParseActivitySourceToolName(readSourceToolName(record) ?? CURSOR_REPLAY_UNREGISTERED_ACTIVITY_TOOL_NAME), title);
}
export function parseCursorReplayToolDetails(value) {
    const record = asRecord(value);
    if (!record)
        return undefined;
    switch (readVariant(record)) {
        case "nativeEdit":
            return parseCursorReplayNativeEditDetails(record);
        case "nativeWrite":
            return parseCursorReplayNativeWriteDetails(record);
        case "generateImage":
            return parseCursorReplayGenerateImageDetails(record);
        case "activity":
            return parseActivityVariantDetails(record);
        case "genericFallback":
            return parseCursorReplayGenericFallbackDetails(record, readSourceToolName(record) ?? "tool");
        default:
            return undefined;
    }
}
export function assembleCursorReplayActivityDetails(sourceToolName, title, fields, contentText, isError, activitySummary) {
    const summary = isError ? fields.summary : (fields.summary ?? activitySummary);
    return {
        variant: "activity",
        sourceToolName,
        title,
        summary,
        expandedText: fields.expandedText ?? contentText,
        ...(fields.collapseDetailsByDefault !== undefined ? { collapseDetailsByDefault: fields.collapseDetailsByDefault } : {}),
        ...(fields.path !== undefined ? { path: fields.path } : {}),
        ...(fields.fileSize !== undefined ? { fileSize: fields.fileSize } : {}),
        ...(fields.diffString !== undefined ? { diffString: fields.diffString } : {}),
        ...(fields.diff !== undefined ? { diff: fields.diff } : {}),
        ...(fields.linesAdded !== undefined ? { linesAdded: fields.linesAdded } : {}),
        ...(fields.linesRemoved !== undefined ? { linesRemoved: fields.linesRemoved } : {}),
        ...(fields.fileContentAfterWrite !== undefined ? { fileContentAfterWrite: fields.fileContentAfterWrite } : {}),
    };
}
export const CURSOR_REPLAY_GENERATE_IMAGE_RESULT_TITLE = "Cursor image generation";
export function assembleCursorReplayGenerateImageDetails(fields, contentText, isError, activitySummary) {
    const summary = isError ? fields.summary : (fields.summary ?? activitySummary);
    return {
        variant: "generateImage",
        imagePath: fields.imagePath,
        imageDisplayPath: fields.imageDisplayPath,
        imageMimeType: fields.imageMimeType,
        summary,
        expandedText: fields.expandedText ?? contentText,
    };
}
export function isCursorReplayNativeEditDetails(details) {
    return details.variant === "nativeEdit";
}
export function isCursorReplayNativeWriteDetails(details) {
    return details.variant === "nativeWrite";
}
export function isCursorReplayGenerateImageDetails(details) {
    return details.variant === "generateImage";
}
export function isCursorReplayActivityDetails(details) {
    return details.variant === "activity";
}
export function isCursorReplayGenericFallbackDetails(details) {
    return details.variant === "genericFallback";
}
