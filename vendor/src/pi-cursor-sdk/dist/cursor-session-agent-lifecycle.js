import { clearCursorSdkHttp1 } from "./cursor-http1.js";
import { onCursorSessionScopeKeyChange } from "./cursor-session-scope.js";
import { disposeSessionCursorAgent, invalidateSessionAgent, resetSessionCursorAgent, } from "./cursor-session-agent.js";
export function registerCursorSessionAgentLifecycle(pi) {
    onCursorSessionScopeKeyChange(async (previousScopeKey) => {
        await disposeSessionCursorAgent(previousScopeKey);
    });
    pi.on("session_shutdown", async (event) => {
        try {
            if (event.reason === "reload") {
                await resetSessionCursorAgent();
                return;
            }
            await disposeSessionCursorAgent();
        }
        finally {
            clearCursorSdkHttp1();
        }
    });
    pi.on("session_compact", () => {
        invalidateSessionAgent();
    });
    pi.on("session_before_tree", () => {
        invalidateSessionAgent();
    });
    pi.on("session_tree", async () => {
        await resetSessionCursorAgent();
    });
    pi.on("model_select", () => {
        invalidateSessionAgent();
    });
}
