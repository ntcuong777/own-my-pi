import * as piAi from "@earendil-works/pi-ai";
import type { Context, Message, Tool } from "@earendil-works/pi-ai";

// Stock 0.84/0.85 do not export transcript helpers. Keep the namespace import in
// Pi's static extension graph: the host loader supplies its own peer module.
// Context remains the common structural input (its shorthand fields are optional);
// transcript hosts pass messages only. Never implement Pi's replay rules here.
interface PiTranscriptHelpers {
	normalizeContext(context: Context): { messages: readonly { role: string }[] };
	getCurrentSystemPrompt(messages: readonly { role: string }[]): string;
	getCurrentTools(messages: readonly { role: string }[]): Tool[];
}
const optionalHelpers = piAi as typeof piAi & Partial<PiTranscriptHelpers>;
const transcriptHelpers = typeof optionalHelpers.normalizeContext === "function"
	&& typeof optionalHelpers.getCurrentSystemPrompt === "function"
	&& typeof optionalHelpers.getCurrentTools === "function"
	? optionalHelpers as PiTranscriptHelpers : undefined;

export function isCursorSystemMessage(message: { role: string }): boolean {
	return message.role === "system";
}

/** Conversation-only view for Cursor text/history and trailing tool-result scans. */
export function getCursorConversationMessages(context: Pick<Context, "messages">): Message[] {
	return context.messages.filter((message) => !isCursorSystemMessage(message));
}

export function resolveCursorPiContext(context: Context): { systemPrompt: string; tools: Tool[] | undefined } {
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
