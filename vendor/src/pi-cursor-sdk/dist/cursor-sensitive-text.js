import { asRecord } from "./cursor-record-utils.js";
/** Provider-facing wrapper; canonical scrubbing lives in shared/cursor-sensitive-text.mjs. */
import { scrubSensitiveText as scrubSensitiveTextJs } from "../shared/cursor-sensitive-text.mjs";
export function scrubSensitiveText(text, apiKey) {
    return scrubSensitiveTextJs(text, apiKey);
}
function scrubDisplayValue(value, apiKey) {
    if (typeof value === "string")
        return scrubSensitiveText(value, apiKey);
    if (Array.isArray(value))
        return value.map((entry) => scrubDisplayValue(entry, apiKey));
    const record = asRecord(value);
    if (!record)
        return value;
    return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, scrubDisplayValue(entry, apiKey)]));
}
export function scrubPiToolDisplay(display, apiKey) {
    return {
        ...display,
        args: scrubDisplayValue(display.args, apiKey),
        result: scrubDisplayValue(display.result, apiKey),
    };
}
