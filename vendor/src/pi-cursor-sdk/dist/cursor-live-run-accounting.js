import { CURSOR_APPROX_CHARS_PER_TOKEN, estimateCursorPromptMessageTokens } from "./context.js";
export function createCursorLiveRunAccountingState(promptInputTokens) {
    return {
        promptInputTokens,
        promptInputTokensReported: false,
        consumedToolResultIds: new Set(),
        sdkTurnEnded: false,
    };
}
export function recordCursorLiveSdkTurnEnded(state, sdkTurnUsage) {
    return { ...state, sdkTurnEnded: true, sdkTurnUsage };
}
export function takeCursorLiveSdkTurnUsage(state) {
    const { sdkTurnUsage, ...nextState } = state;
    return {
        state: {
            ...nextState,
            sdkTurnEnded: false,
        },
        sdkTurnUsage,
    };
}
function asToolResultMessage(message) {
    return message.role === "toolResult" ? message : undefined;
}
export function consumeCursorLiveToolResults(state, context, isMatchingToolResult) {
    const consumedToolResultIds = new Set(state.consumedToolResultIds);
    const toolResults = [];
    let toolResultInputTokens = 0;
    for (const message of context.messages) {
        const toolResult = asToolResultMessage(message);
        if (!toolResult)
            continue;
        if (consumedToolResultIds.has(toolResult.toolCallId))
            continue;
        if (!isMatchingToolResult(toolResult))
            continue;
        consumedToolResultIds.add(toolResult.toolCallId);
        toolResults.push(toolResult);
        toolResultInputTokens += estimateCursorPromptMessageTokens(toolResult, { charsPerToken: CURSOR_APPROX_CHARS_PER_TOKEN });
    }
    return {
        state: { ...state, consumedToolResultIds },
        toolResults,
        toolResultInputTokens,
        toolCallIds: toolResults.map((toolResult) => toolResult.toolCallId),
    };
}
export function takeCursorLiveTurnInputTokens(state, toolResultInputTokens) {
    const promptInputTokens = state.promptInputTokensReported ? 0 : state.promptInputTokens;
    return {
        state: state.promptInputTokensReported ? state : { ...state, promptInputTokensReported: true },
        sessionInputTokens: promptInputTokens + toolResultInputTokens,
    };
}
