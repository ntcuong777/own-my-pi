import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { getLanguageFromPath, highlightCode, keyHint } from "@earendil-works/pi-coding-agent";
import { Image, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { resolveCursorEditDiff } from "./cursor-edit-diff.js";
import { inferImageMimeType } from "./cursor-tool-result-display-readers.js";
import { LOCAL_READ_PREVIEW_NOTICE, isLocalReadPreviewContent } from "./cursor-transcript-utils.js";
import { CURSOR_REPLAY_ACTIVITY_TOOL_NAME, getCursorReplayCallSummary, shouldShowCursorReplayCollapsedExpandHint, } from "./cursor-tool-presentation-registry.js";
import { CURSOR_REPLAY_GENERATE_IMAGE_RESULT_TITLE, isCursorReplayGenerateImageDetails, isCursorReplayActivityDetails, parseCursorReplayToolDetails, } from "./cursor-replay-tool-details.js";
export { isCursorReplayNativeEditDetails, isCursorReplayGenerateImageDetails, isCursorReplayActivityDetails, isCursorReplayNativeWriteDetails, parseCursorReplayToolDetails, } from "./cursor-replay-tool-details.js";
export const CURSOR_REPLAY_COLLAPSED_PREVIEW_LINES = 8;
export const CURSOR_REPLAY_PREVIEW_MAX_CHARS = 4000;
export const CURSOR_REPLAY_PREVIEW_MAX_LINE_CHARS = 240;
const CURSOR_REPLAY_HIGHLIGHT_MAX_CHARS = 12000;
export const cursorReplayToolSchema = Type.Object({}, { additionalProperties: true });
function readImageFileForReplay(path) {
    if (!path)
        return undefined;
    try {
        const stat = statSync(path);
        if (!stat.isFile() || stat.size <= 0 || stat.size > 25 * 1024 * 1024)
            return undefined;
        return readFileSync(path).toString("base64");
    }
    catch {
        return undefined;
    }
}
function buildImageReplayComponent(text, imageData, mimeType, filename, theme) {
    const textComponent = new Text(text, 0, 0);
    const imageComponent = new Image(imageData, mimeType, { fallbackColor: (value) => theme.fg("muted", value) }, { filename, maxWidthCells: 40, maxHeightCells: 16 });
    return {
        render(width) {
            return [...textComponent.render(width), ...imageComponent.render(width)];
        },
        invalidate() {
            textComponent.invalidate();
            imageComponent.invalidate();
        },
    };
}
export function getCursorReplayPath(args, details) {
    const argPath = args?.path;
    return details?.path ?? (typeof argPath === "string" && argPath.trim() ? argPath : "unknown");
}
function parseUnifiedDiffHunkHeader(line) {
    const match = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(line);
    if (!match)
        return undefined;
    return { oldLine: Number(match[1]), newLine: Number(match[2]) };
}
function replaceCursorReplayTabs(text) {
    return text.replace(/\t/g, "   ");
}
function truncateCursorReplayLine(text, maxChars = CURSOR_REPLAY_PREVIEW_MAX_LINE_CHARS) {
    return text.length > maxChars ? `${text.slice(0, Math.max(maxChars - 1, 0))}…` : text;
}
function sliceCursorReplayPreview(text, maxLines, maxChars = CURSOR_REPLAY_PREVIEW_MAX_CHARS) {
    const lines = text.split("\n");
    const visible = [];
    let usedChars = 0;
    let omittedChars = 0;
    for (const line of lines) {
        if (visible.length >= maxLines) {
            omittedChars += line.length + 1;
            continue;
        }
        const normalizedLine = replaceCursorReplayTabs(line);
        const lineBudget = Math.max(Math.min(CURSOR_REPLAY_PREVIEW_MAX_LINE_CHARS, maxChars - usedChars), 0);
        if (lineBudget <= 0) {
            omittedChars += normalizedLine.length + 1;
            continue;
        }
        const truncatedLine = truncateCursorReplayLine(normalizedLine, lineBudget);
        visible.push(truncatedLine);
        usedChars += truncatedLine.length + 1;
        omittedChars += Math.max(normalizedLine.length - truncatedLine.length, 0);
    }
    return {
        text: visible.join("\n"),
        omittedLines: Math.max(lines.length - visible.length, 0),
        omittedChars,
    };
}
function formatCursorReplayOmission(slice) {
    const parts = [];
    if (slice.omittedLines > 0)
        parts.push(`${slice.omittedLines} more lines`);
    if (slice.omittedChars > 0)
        parts.push(`${slice.omittedChars} more chars`);
    return parts.length > 0 ? `... (${parts.join(", ")} truncated)` : undefined;
}
function formatCursorReplayDiffLine(prefix, lineNumber, content, theme) {
    const rendered = `${prefix}${lineNumber} ${truncateCursorReplayLine(replaceCursorReplayTabs(content))}`;
    if (prefix === "+")
        return theme.fg("toolDiffAdded", rendered);
    if (prefix === "-")
        return theme.fg("toolDiffRemoved", rendered);
    return theme.fg("toolDiffContext", rendered);
}
export function formatCursorReplayDiff(diff, theme, maxLines) {
    const lines = diff.split("\n");
    const oldFileIsNull = lines.some((line) => line === "--- /dev/null");
    const newFileIsNull = lines.some((line) => line === "+++ /dev/null");
    const rendered = [];
    let oldLine = 1;
    let newLine = 1;
    for (const line of lines) {
        if (!line || line.startsWith("--- ") || line.startsWith("+++ "))
            continue;
        const hunk = parseUnifiedDiffHunkHeader(line);
        if (hunk) {
            oldLine = hunk.oldLine;
            newLine = hunk.newLine;
            continue;
        }
        if (line.startsWith("+")) {
            if (newFileIsNull)
                continue;
            rendered.push(formatCursorReplayDiffLine("+", newLine, line.slice(1), theme));
            newLine += 1;
        }
        else if (line.startsWith("-")) {
            if (oldFileIsNull && line === "-")
                continue;
            rendered.push(formatCursorReplayDiffLine("-", oldLine, line.slice(1), theme));
            oldLine += 1;
        }
        else if (line.startsWith(" ")) {
            rendered.push(formatCursorReplayDiffLine(" ", newLine, line.slice(1), theme));
            oldLine += 1;
            newLine += 1;
        }
        else {
            rendered.push(theme.fg("toolDiffContext", replaceCursorReplayTabs(line)));
        }
    }
    const visible = rendered.slice(0, maxLines);
    if (rendered.length > maxLines)
        visible.push(theme.fg("muted", `... (${rendered.length - maxLines} more diff lines hidden)`));
    return visible.join("\n");
}
function stripCursorReplayHeader(text) {
    const lines = text.trimEnd().split("\n");
    return lines.length > 2 && lines[1]?.trim() === "" ? lines.slice(2).join("\n") : lines.join("\n");
}
function formatMutedBlock(text, theme) {
    return text.split("\n").map((line) => theme.fg("muted", line)).join("\n");
}
function hasUnifiedDiffHunk(text) {
    return text.split("\n").some((line) => Boolean(parseUnifiedDiffHunkHeader(line)));
}
/** First unified-diff marker (`---`/`+++`/`@@`) so collapsed previews budget diff lines, not transcript preamble. */
function extractUnifiedDiffSection(text) {
    const lines = text.split("\n");
    const markerIndex = lines.findIndex((line) => line.startsWith("--- ") || line.startsWith("+++ "));
    const hunkIndex = lines.findIndex((line) => Boolean(parseUnifiedDiffHunkHeader(line)));
    const start = markerIndex >= 0 ? markerIndex : hunkIndex;
    if (start < 0)
        return undefined;
    return lines.slice(start).join("\n");
}
function formatCursorReplayActivityDiffPreview(text, theme, maxLines, stripHeader) {
    const body = (stripHeader ? stripCursorReplayHeader(text) : text).trimEnd();
    const diffSection = body ? extractUnifiedDiffSection(body) : undefined;
    if (!diffSection || !hasUnifiedDiffHunk(diffSection))
        return undefined;
    // Fallback for unstructured activity details that carry a unified diff only in expanded text.
    // All actual diff coloring lives in the single `formatCursorReplayDiff` renderer.
    return formatCursorReplayDiff(diffSection, theme, maxLines);
}
function formatCursorReplayActivityEditPreview(details, text, theme, maxLines, stripHeader) {
    const structuredDiff = details.diffString ?? details.diff;
    if (structuredDiff) {
        return formatCursorReplayDiff(structuredDiff, theme, maxLines);
    }
    const diffPreview = formatCursorReplayActivityDiffPreview(text, theme, maxLines, stripHeader);
    if (diffPreview)
        return diffPreview;
    return stripHeader ? formatCursorReplayPreview(text, theme, maxLines, true) : formatMutedBlock(text, theme);
}
function formatCursorReplayActivityWritePreview(details, text, theme, maxLines, stripHeader) {
    const structuredDiff = details.diffString ?? details.diff;
    if (structuredDiff) {
        return formatCursorReplayDiff(structuredDiff, theme, maxLines);
    }
    if (details.fileContentAfterWrite) {
        return formatCursorReplayFilePreview(details.fileContentAfterWrite, details.path, theme, maxLines, false);
    }
    const diffPreview = formatCursorReplayActivityDiffPreview(text, theme, maxLines, stripHeader);
    if (diffPreview)
        return diffPreview;
    return stripHeader ? formatCursorReplayPreview(text, theme, maxLines, true) : formatMutedBlock(text, theme);
}
function formatCursorReplayActivityPreview(details, text, theme, maxLines, stripHeader) {
    if (details.sourceToolName === "edit") {
        return formatCursorReplayActivityEditPreview(details, text, theme, maxLines, stripHeader);
    }
    if (details.sourceToolName === "write") {
        return formatCursorReplayActivityWritePreview(details, text, theme, maxLines, stripHeader);
    }
    return stripHeader ? formatCursorReplayPreview(text, theme, maxLines, true) : formatMutedBlock(text, theme);
}
export function formatCursorReplayPreview(text, theme, maxLines = CURSOR_REPLAY_COLLAPSED_PREVIEW_LINES, stripHeader = true) {
    const body = (stripHeader ? stripCursorReplayHeader(text) : text).trimEnd();
    if (!body)
        return undefined;
    const slice = sliceCursorReplayPreview(body, maxLines);
    const omission = formatCursorReplayOmission(slice);
    const preview = omission ? `${slice.text}\n${omission}` : slice.text;
    return formatMutedBlock(preview, theme);
}
function safeHighlightCursorReplayCode(text, path) {
    const lang = path ? getLanguageFromPath(path) : undefined;
    if (!lang)
        return undefined;
    try {
        return highlightCode(replaceCursorReplayTabs(text), lang);
    }
    catch {
        return undefined;
    }
}
export function formatCursorReplayFilePreview(text, path, theme, maxLines = CURSOR_REPLAY_COLLAPSED_PREVIEW_LINES, stripHeader = true) {
    const body = (stripHeader ? stripCursorReplayHeader(text) : text).trimEnd();
    if (!body)
        return undefined;
    const slice = sliceCursorReplayPreview(body, maxLines);
    const highlightedLines = slice.text.length <= CURSOR_REPLAY_HIGHLIGHT_MAX_CHARS ? safeHighlightCursorReplayCode(slice.text, path) : undefined;
    const renderedLines = highlightedLines ?? slice.text.split("\n").map((line) => theme.fg("toolOutput", line));
    const omission = formatCursorReplayOmission(slice);
    if (omission)
        renderedLines.push(theme.fg("muted", omission));
    return renderedLines.join("\n");
}
function getCursorReplayCardTitle(toolName, args) {
    if (toolName === CURSOR_REPLAY_ACTIVITY_TOOL_NAME && typeof args?.activityTitle === "string" && args.activityTitle.trim()) {
        return args.activityTitle.trim();
    }
    return "Cursor activity";
}
export function renderCursorReplayCall(toolName, args, theme, isPartial) {
    if (!isPartial)
        return new Text("", 0, 0);
    let text = theme.fg("toolTitle", theme.bold(`${getCursorReplayCardTitle(toolName, args)} `));
    const summary = getCursorReplayCallSummary(toolName, args);
    if (summary)
        text += theme.fg("accent", summary);
    return new Text(text.trimEnd(), 0, 0);
}
function countDisplayLines(text) {
    const withoutFinalNewline = text.endsWith("\n") ? text.slice(0, -1) : text;
    return withoutFinalNewline ? withoutFinalNewline.split("\n").length : 0;
}
export function renderNativeLookingCursorFileMutationCall(toolName, args, theme, isPartial) {
    if (!isPartial)
        return new Text("", 0, 0);
    let text = theme.fg("toolTitle", theme.bold(`${toolName} `));
    const path = typeof args?.path === "string" && args.path.trim() ? args.path : "unknown";
    text += theme.fg("accent", path);
    if (toolName === "write" && typeof args?.content === "string" && args.content.length > 0) {
        const lineCount = countDisplayLines(args.content);
        text += theme.fg("dim", ` (${pluralize(lineCount, "line")})`);
    }
    return new Text(text.trimEnd(), 0, 0);
}
function pluralize(count, noun) {
    return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
function getCursorEditDiff(details) {
    return resolveCursorEditDiff(details);
}
function hasCursorEditChanges(details) {
    return Boolean(getCursorEditDiff(details)) || Boolean(details.linesAdded) || Boolean(details.linesRemoved);
}
function classifyCursorEditOperation(details) {
    if (!hasCursorEditChanges(details))
        return "unchanged";
    const diff = getCursorEditDiff(details);
    if (diff?.startsWith("--- /dev/null"))
        return "created";
    if (diff?.includes("\n+++ /dev/null"))
        return "deleted";
    return "updated";
}
function formatCursorEditSummary(details) {
    const operation = classifyCursorEditOperation(details);
    if (operation === "unchanged")
        return "no changes needed";
    if (operation === "created" && details.linesAdded !== undefined)
        return `created ${pluralize(details.linesAdded, "line")}`;
    if (operation === "deleted" && details.linesRemoved !== undefined)
        return `deleted ${pluralize(details.linesRemoved, "line")}`;
    const parts = [
        details.linesAdded ? `added ${pluralize(details.linesAdded, "line")}` : undefined,
        details.linesRemoved ? `removed ${pluralize(details.linesRemoved, "line")}` : undefined,
    ].filter((part) => Boolean(part));
    return parts.length > 0 ? parts.join(", ") : "updated file";
}
function firstContentText(result) {
    const content = result.content[0];
    return content?.type === "text" ? content.text : "";
}
function hasCursorReplayDisplayTitle(details) {
    if (!details)
        return false;
    return isCursorReplayActivityDetails(details) || isCursorReplayGenerateImageDetails(details);
}
function formatCursorReplayExpandHint() {
    try {
        return keyHint("app.tools.expand", "to expand");
    }
    catch {
        return "Ctrl+O to expand";
    }
}
function renderExpandableCursorReplayResult(title, details, result, options, theme, context, isError) {
    const text = firstContentText(result);
    const summary = details.summary ?? text.split("\n").find((line) => line.trim()) ?? "completed";
    const expandedText = details.expandedText ?? (text.includes("\n") ? text : undefined);
    const showExpandHint = expandedText && !options.expanded && shouldShowCursorReplayCollapsedExpandHint(details.sourceToolName);
    const expandHint = showExpandHint ? theme.fg("dim", ` (${formatCursorReplayExpandHint()})`) : "";
    let rendered = `${theme.fg("toolTitle", theme.bold(title))} ${theme.fg(isError ? "error" : "success", summary)}${expandHint}`;
    if (expandedText && (options.expanded || !details.collapseDetailsByDefault)) {
        const preview = formatCursorReplayActivityPreview(details, expandedText, theme, options.expanded ? Number.POSITIVE_INFINITY : CURSOR_REPLAY_COLLAPSED_PREVIEW_LINES, !options.expanded);
        if (preview)
            rendered += `\n${preview}`;
    }
    if (details.imagePath && !isError && context.showImages) {
        const imageData = readImageFileForReplay(details.imagePath);
        const mimeType = details.imageMimeType ?? inferImageMimeType(details.imagePath);
        if (imageData && mimeType)
            return buildImageReplayComponent(rendered, imageData, mimeType, basename(details.imagePath ?? "generated-image"), theme);
    }
    return new Text(rendered, 0, 0);
}
function renderCursorReplayEditResult(details, options, theme) {
    const summary = formatCursorEditSummary(details);
    let rendered = `${theme.fg("toolTitle", theme.bold("edit"))} ${theme.fg("accent", getCursorReplayPath(undefined, details))} ${theme.fg("success", summary)}`;
    const diff = getCursorEditDiff(details);
    if (diff)
        rendered += `\n${formatCursorReplayDiff(diff, theme, options.expanded ? 40 : CURSOR_REPLAY_COLLAPSED_PREVIEW_LINES)}`;
    return new Text(rendered, 0, 0);
}
function renderCursorReplayWriteResult(details, result, theme) {
    const text = firstContentText(result);
    const parts = [
        details.linesCreated !== undefined ? `${details.linesCreated} line${details.linesCreated === 1 ? "" : "s"}` : undefined,
        details.fileSize !== undefined ? `${details.fileSize} bytes` : undefined,
    ].filter(Boolean);
    const summary = parts.length > 0 ? parts.join(", ") : "written";
    let rendered = `${theme.fg("toolTitle", theme.bold("write"))} ${theme.fg("accent", getCursorReplayPath(undefined, details))} ${theme.fg("success", summary)}`;
    const previewSource = details.fileContentAfterWrite ?? details.expandedText ?? text;
    const preview = formatCursorReplayFilePreview(previewSource, getCursorReplayPath(undefined, details), theme, CURSOR_REPLAY_COLLAPSED_PREVIEW_LINES, details.fileContentAfterWrite === undefined);
    if (preview)
        rendered += `\n${preview}`;
    return new Text(rendered, 0, 0);
}
function renderCursorGenerateImageResult(details, result, options, theme, context, isError) {
    const title = CURSOR_REPLAY_GENERATE_IMAGE_RESULT_TITLE;
    return renderExpandableCursorReplayResult(title, details, result, options, theme, context, isError);
}
function renderCursorReplayDetails(details, result, options, theme, context, isError, text) {
    switch (details.variant) {
        case "nativeEdit":
            return renderCursorReplayEditResult(details, options, theme);
        case "nativeWrite":
            return renderCursorReplayWriteResult(details, result, theme);
        case "generateImage":
            return renderCursorGenerateImageResult(details, result, options, theme, context, isError);
        case "activity":
            return renderExpandableCursorReplayResult(details.title, details, result, options, theme, context, isError);
        case "genericFallback":
            break;
        default: {
            const _exhaustive = details;
            return _exhaustive;
        }
    }
    return new Text(text || theme.fg("success", "Cursor tool result replayed"), 0, 0);
}
export function renderCursorReplayResult(result, options, theme, context, isError) {
    if (options.isPartial)
        return new Text(theme.fg("warning", "Replaying Cursor tool result..."), 0, 0);
    const details = parseCursorReplayToolDetails(result.details);
    const text = firstContentText(result);
    if (isError && !hasCursorReplayDisplayTitle(details)) {
        return new Text(theme.fg("error", text.split("\n")[0] || "Cursor replay failed"), 0, 0);
    }
    if (!details)
        return new Text(text || theme.fg("success", "Cursor tool result replayed"), 0, 0);
    return renderCursorReplayDetails(details, result, options, theme, context, isError, text);
}
export function renderNativeLookingCursorReadReplayResult(result, options, theme, context, renderBase) {
    const base = renderBase?.() ?? new Text("", 0, 0);
    const readArgs = context.args;
    const replayDetails = result.details;
    const usesLocalPreview = readArgs?.localReadPreview === true ||
        replayDetails?.localReadPreview === true ||
        isLocalReadPreviewContent(firstContentText(result));
    if (usesLocalPreview && !options.expanded && !context.isError) {
        const noticeText = `\n${theme.fg("warning", LOCAL_READ_PREVIEW_NOTICE)}`;
        if (base instanceof Text) {
            base.setText(noticeText);
            return base;
        }
        return new Text(noticeText, 0, 0);
    }
    return base;
}
export function createCursorReplayOnlyToolDefinition(toolName) {
    return {
        name: toolName,
        label: "Cursor activity",
        description: "Display recorded Cursor SDK tool activity. This tool only returns recorded Cursor results and never executes work directly.",
        parameters: cursorReplayToolSchema,
        async execute() {
            throw new Error("No recorded Cursor activity result was available. This replay-only tool does not execute work directly.");
        },
        renderCall(args, theme, context) {
            return renderCursorReplayCall(toolName, args, theme, context.isPartial);
        },
        renderResult(result, options, theme, context) {
            return renderCursorReplayResult(result, options, theme, context, context.isError);
        },
    };
}
