function normalizeLifecycleHandlers(handlerOrHandlers) {
    return typeof handlerOrHandlers === "function" ? { sync: handlerOrHandlers } : handlerOrHandlers;
}
export function registerCursorModelLifecycle(pi, handlerOrHandlers) {
    const handlers = normalizeLifecycleHandlers(handlerOrHandlers);
    const sync = handlers.sync;
    if (handlers.sessionStart || sync) {
        pi.on("session_start", async (event, ctx) => {
            await handlers.sessionStart?.(event, ctx);
            await sync?.(ctx);
        });
    }
    if (handlers.modelSelect || sync) {
        pi.on("model_select", async (event, ctx) => {
            const effectiveCtx = { ...ctx, model: event.model };
            await handlers.modelSelect?.(event, effectiveCtx);
            await sync?.(effectiveCtx);
        });
    }
    if (handlers.turnStart || sync) {
        pi.on("turn_start", async (event, ctx) => {
            await handlers.turnStart?.(event, ctx);
            await sync?.(ctx);
        });
    }
    if (handlers.beforeAgentStart || sync) {
        pi.on("before_agent_start", async (event, ctx) => {
            await sync?.(ctx);
            return await handlers.beforeAgentStart?.(event, ctx);
        });
    }
}
