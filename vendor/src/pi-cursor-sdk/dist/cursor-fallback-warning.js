import { isCursorModel } from "./cursor-model.js";
import { registerCursorModelLifecycle } from "./cursor-model-lifecycle.js";
import { getCursorSessionScopeKey } from "./cursor-session-scope.js";
export function registerCursorFallbackIssueWarning(pi, issue) {
    const warnedSessionScopeKeys = new Set();
    registerCursorModelLifecycle(pi, (ctx) => {
        if (!isCursorModel(ctx.model) || !ctx.hasUI)
            return;
        const scopeKey = getCursorSessionScopeKey();
        if (warnedSessionScopeKeys.has(scopeKey))
            return;
        warnedSessionScopeKeys.add(scopeKey);
        ctx.ui.notify(issue.message, "warning");
    });
}
