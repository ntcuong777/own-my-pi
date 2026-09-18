import { buildCursorIncrementalPrompt, buildCursorPrompt, shouldBootstrapCursorContext, } from "./context.js";
// Long-lived SDK session agents can drift tool-call behavior; recreate the agent after this many successful incremental sends.
export const MAX_COMPLETED_INCREMENTAL_SENDS_BEFORE_REBOOTSTRAP = 20;
export function planCursorSessionSend(sendState, context) {
    if (!sendState.bootstrapped) {
        return { mode: "bootstrap", resetAgent: false, reason: "initial" };
    }
    if (sendState.incrementalSendCount >= MAX_COMPLETED_INCREMENTAL_SENDS_BEFORE_REBOOTSTRAP) {
        return { mode: "bootstrap", resetAgent: true, reason: "incremental_threshold" };
    }
    if (shouldBootstrapCursorContext(sendState, context)) {
        return { mode: "bootstrap", resetAgent: true, reason: "context_divergence" };
    }
    return { mode: "incremental", resetAgent: false, reason: "incremental" };
}
export function buildCursorSessionSendPrompt(context, options, plan) {
    return plan.mode === "bootstrap" ? buildCursorPrompt(context, options) : buildCursorIncrementalPrompt(context, options);
}
