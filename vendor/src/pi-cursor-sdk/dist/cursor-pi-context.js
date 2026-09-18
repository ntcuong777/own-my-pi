import * as piAi from "@earendil-works/pi-ai";
const optionalHelpers = piAi;
const transcriptHelpers = typeof optionalHelpers.normalizeContext === "function"
    && typeof optionalHelpers.getCurrentSystemPrompt === "function"
    && typeof optionalHelpers.getCurrentTools === "function"
    ? optionalHelpers : undefined;
export function isCursorSystemMessage(message) {
    return message.role === "system";
}
/** Conversation-only view for Cursor text/history and trailing tool-result scans. */
export function getCursorConversationMessages(context) {
    return context.messages.filter((message) => !isCursorSystemMessage(message));
}
export function resolveCursorPiContext(context) {
    if (!transcriptHelpers) {
        if (context.messages.some(isCursorSystemMessage)) {
            throw new Error("Pi transcript context requires the host's public transcript replay helpers.");
        }
        return { systemPrompt: context.systemPrompt ?? "", tools: context.tools };
    }
    const messages = transcriptHelpers.normalizeContext(context).messages;
    const legacyWithoutTools = ("systemPrompt" in context || "tools" in context)
        && context.tools === undefined && !context.messages.some(isCursorSystemMessage);
    return {
        systemPrompt: transcriptHelpers.getCurrentSystemPrompt(messages),
        // A messages-only provider request is authoritative, including no declarations.
        // An explicitly legacy shorthand context retains its absent-snapshot semantics.
        tools: legacyWithoutTools ? undefined : transcriptHelpers.getCurrentTools(messages),
    };
}
