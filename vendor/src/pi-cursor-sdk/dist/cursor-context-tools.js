import { resolveCursorPiContext } from "./cursor-pi-context.js";
/** Tool names from the provider context snapshot at stream start (not live pi.getActiveTools()). */
export function getActiveContextToolNames(context) {
    const { tools } = resolveCursorPiContext(context);
    return tools === undefined ? undefined : new Set(tools.map((tool) => tool.name));
}
