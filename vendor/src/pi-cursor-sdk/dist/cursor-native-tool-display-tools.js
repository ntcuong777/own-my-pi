import { createBashToolDefinition, createEditToolDefinition, createFindToolDefinition, createGrepToolDefinition, createLsToolDefinition, createReadToolDefinition, createWriteToolDefinition, } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { getCursorSessionCwd } from "./cursor-session-scope.js";
import { CURSOR_MODEL_ACTIVE_REPLAY_TOOL_NAMES, CURSOR_REPLAY_TOOL_NAMES, } from "./cursor-native-tool-names.js";
import { isCursorReplayToolName } from "./cursor-tool-presentation-registry.js";
import { createCursorReplayOnlyToolDefinition, isCursorReplayNativeEditDetails, isCursorReplayNativeWriteDetails, parseCursorReplayToolDetails, renderCursorReplayResult, renderNativeLookingCursorFileMutationCall, renderNativeLookingCursorReadReplayResult, } from "./cursor-native-tool-display-replay.js";
import { consumeCursorNativeToolDisplay, isCursorReplayToolCallId, } from "./cursor-native-tool-display-state.js";
function emptyText() {
    return new Text("", 0, 0);
}
function renderReadReplayCall(args, theme, context, renderBase) {
    const rendered = renderBase();
    if (args.localReadPreview !== true || context.expanded)
        return rendered;
    const baseText = rendered.render(120).join("\n").trimEnd();
    const labeled = `${baseText}${theme.fg("muted", " · local file preview")}`;
    if (rendered instanceof Text) {
        rendered.setText(labeled);
        return rendered;
    }
    return new Text(labeled, 0, 0);
}
function renderReadReplayResult(result, options, theme, context, renderBase) {
    return renderNativeLookingCursorReadReplayResult(result, options, theme, context, renderBase);
}
function renderEditReplayResult(result, options, theme, context, renderBase) {
    const details = parseCursorReplayToolDetails(result.details);
    return details && isCursorReplayNativeEditDetails(details)
        ? renderCursorReplayResult(result, options, theme, context, context.isError)
        : renderBase();
}
function renderWriteReplayResult(result, options, theme, context, renderBase) {
    const details = parseCursorReplayToolDetails(result.details);
    return details && isCursorReplayNativeWriteDetails(details)
        ? renderCursorReplayResult(result, options, theme, context, context.isError)
        : renderBase();
}
const NATIVE_CURSOR_TOOL_STRATEGIES = {
    read: {
        createDefinition: (cwd) => createReadToolDefinition(cwd),
        renderReplayCall: renderReadReplayCall,
        renderReplayResult: renderReadReplayResult,
    },
    bash: { createDefinition: (cwd) => createBashToolDefinition(cwd) },
    edit: {
        createDefinition: (cwd) => createEditToolDefinition(cwd),
        missingReplayPolicy: "block-file-mutation",
        renderReplayCall: (args, theme, context) => renderNativeLookingCursorFileMutationCall("edit", args, theme, context.isPartial),
        renderReplayResult: renderEditReplayResult,
    },
    write: {
        createDefinition: (cwd) => createWriteToolDefinition(cwd),
        missingReplayPolicy: "block-file-mutation",
        renderReplayCall: (args, theme, context) => renderNativeLookingCursorFileMutationCall("write", args, theme, context.isPartial),
        renderReplayResult: renderWriteReplayResult,
    },
    grep: { createDefinition: (cwd) => createGrepToolDefinition(cwd) },
    find: { createDefinition: (cwd) => createFindToolDefinition(cwd) },
    ls: { createDefinition: (cwd) => createLsToolDefinition(cwd) },
};
function getNativeReplayStrategy(toolName) {
    return Object.hasOwn(NATIVE_CURSOR_TOOL_STRATEGIES, toolName)
        ? NATIVE_CURSOR_TOOL_STRATEGIES[toolName]
        : undefined;
}
export function wrapNativeCursorTool(definition, getCurrentDefinition) {
    const strategy = getNativeReplayStrategy(definition.name);
    return {
        ...definition,
        async execute(toolCallId, params, signal, onUpdate, ctx) {
            const cursorDisplay = consumeCursorNativeToolDisplay(toolCallId);
            if (cursorDisplay) {
                if (cursorDisplay.isError) {
                    const text = cursorDisplay.result.content
                        .map((entry) => (entry.type === "text" ? entry.text : undefined))
                        .filter((entry) => Boolean(entry))
                        .join("\n");
                    throw new Error(text || "Cursor tool replay failed");
                }
                return {
                    content: cursorDisplay.result.content,
                    details: cursorDisplay.result.details,
                    terminate: cursorDisplay.terminate ?? true,
                };
            }
            if (strategy?.missingReplayPolicy === "block-file-mutation" && isCursorReplayToolCallId(toolCallId)) {
                throw new Error(`No recorded Cursor ${definition.name} result was available. This replay-only call does not execute file mutations.`);
            }
            return getCurrentDefinition().execute(toolCallId, params, signal, onUpdate, ctx);
        },
        renderCall(args, theme, context) {
            const currentRenderCall = getCurrentDefinition().renderCall;
            const renderBase = () => currentRenderCall?.(args, theme, context) ?? emptyText();
            const isReplayCall = typeof context.toolCallId === "string" && isCursorReplayToolCallId(context.toolCallId);
            if (isReplayCall && strategy?.renderReplayCall) {
                return strategy.renderReplayCall(args, theme, context, renderBase);
            }
            return renderBase();
        },
        renderResult(result, options, theme, context) {
            const currentRenderResult = getCurrentDefinition().renderResult;
            const renderBase = () => currentRenderResult?.(result, options, theme, context) ?? emptyText();
            const isReplayCall = typeof context.toolCallId === "string" && isCursorReplayToolCallId(context.toolCallId);
            if (isReplayCall && strategy?.renderReplayResult) {
                return strategy.renderReplayResult(result, options, theme, context, renderBase);
            }
            return renderBase();
        },
    };
}
export function createNativeCursorToolDefinition(toolName, cwd) {
    const strategy = getNativeReplayStrategy(toolName);
    if (strategy)
        return strategy.createDefinition(cwd);
    if (isCursorReplayToolName(toolName))
        return createCursorReplayOnlyToolDefinition(toolName);
    throw new Error(`Unsupported Cursor native replay tool: ${toolName}`);
}
export function registerNativeCursorTool(pi, toolName) {
    const definition = createNativeCursorToolDefinition(toolName, getCursorSessionCwd());
    pi.registerTool(wrapNativeCursorTool(definition, () => createNativeCursorToolDefinition(toolName, getCursorSessionCwd())));
}
export { CURSOR_MODEL_ACTIVE_REPLAY_TOOL_NAMES, CURSOR_REPLAY_TOOL_NAMES };
