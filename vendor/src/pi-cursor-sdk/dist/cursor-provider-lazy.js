import { createAssistantMessageEventStream, } from "@earendil-works/pi-ai";
import { streamCursor } from "./cursor-provider.js";
import { sanitizeCursorProviderError } from "./cursor-provider-errors.js";
function makeProviderRuntimeErrorMessage(model, error, apiKey) {
    return {
        role: "assistant",
        content: [],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "error",
        timestamp: Date.now(),
        errorMessage: `Cursor provider runtime failed: ${sanitizeCursorProviderError(error, apiKey)}`,
    };
}
export function streamCursorLazy(model, context, options) {
    const outer = createAssistantMessageEventStream();
    queueMicrotask(async () => {
        try {
            for await (const event of streamCursor(model, context, options)) {
                outer.push(event);
            }
        }
        catch (error) {
            const message = makeProviderRuntimeErrorMessage(model, error, options?.apiKey);
            outer.push({ type: "error", reason: "error", error: message });
            outer.end(message);
        }
    });
    return outer;
}
