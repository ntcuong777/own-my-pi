const CURSOR_SDK_MCP_DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_CURSOR_MCP_TOOL_TIMEOUT_MS = 3_600_000;
const DEFAULT_CURSOR_MCP_CONNECT_TIMEOUT_MS = 10_000;
const MIN_CURSOR_MCP_CONNECT_TIMEOUT_MS = 1_000;
const MAX_NODE_TIMER_DELAY_MS = 2_147_483_647;
const CURSOR_MCP_TOOL_TIMEOUT_MS_ENV = "PI_CURSOR_MCP_TOOL_TIMEOUT_MS";
const CURSOR_MCP_TOOL_TIMEOUT_SECONDS_ENV = "PI_CURSOR_MCP_TOOL_TIMEOUT_SECONDS";
const CURSOR_MCP_CONNECT_TIMEOUT_MS_ENV = "PI_CURSOR_MCP_CONNECT_TIMEOUT_MS";
const CURSOR_MCP_CONNECT_TIMEOUT_SECONDS_ENV = "PI_CURSOR_MCP_CONNECT_TIMEOUT_SECONDS";
let originalSetTimeout;
let installedToolTimeoutMs = DEFAULT_CURSOR_MCP_TOOL_TIMEOUT_MS;
let installedConnectTimeoutMs = DEFAULT_CURSOR_MCP_CONNECT_TIMEOUT_MS;
function parsePositiveNumber(value) {
    const trimmed = value?.trim();
    if (!trimmed)
        return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
function normalizeOverrideTimeoutMs(timeoutMs) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
        return DEFAULT_CURSOR_MCP_TOOL_TIMEOUT_MS;
    return Math.min(Math.max(Math.trunc(timeoutMs), CURSOR_SDK_MCP_DEFAULT_TIMEOUT_MS), MAX_NODE_TIMER_DELAY_MS);
}
export function resolveCursorMcpToolTimeoutMs(env = process.env) {
    const explicitMs = parsePositiveNumber(env[CURSOR_MCP_TOOL_TIMEOUT_MS_ENV]);
    if (explicitMs !== undefined)
        return normalizeOverrideTimeoutMs(explicitMs);
    const explicitSeconds = parsePositiveNumber(env[CURSOR_MCP_TOOL_TIMEOUT_SECONDS_ENV]);
    if (explicitSeconds !== undefined)
        return normalizeOverrideTimeoutMs(explicitSeconds * 1000);
    return DEFAULT_CURSOR_MCP_TOOL_TIMEOUT_MS;
}
function normalizeConnectTimeoutMs(timeoutMs) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
        return DEFAULT_CURSOR_MCP_CONNECT_TIMEOUT_MS;
    return Math.min(Math.max(Math.trunc(timeoutMs), MIN_CURSOR_MCP_CONNECT_TIMEOUT_MS), CURSOR_SDK_MCP_DEFAULT_TIMEOUT_MS);
}
export function resolveCursorMcpConnectTimeoutMs(env = process.env) {
    const explicitMs = parsePositiveNumber(env[CURSOR_MCP_CONNECT_TIMEOUT_MS_ENV]);
    if (explicitMs !== undefined)
        return normalizeConnectTimeoutMs(explicitMs);
    const explicitSeconds = parsePositiveNumber(env[CURSOR_MCP_CONNECT_TIMEOUT_SECONDS_ENV]);
    if (explicitSeconds !== undefined)
        return normalizeConnectTimeoutMs(explicitSeconds * 1000);
    return DEFAULT_CURSOR_MCP_CONNECT_TIMEOUT_MS;
}
function isCursorSdkMcpProtocolTimeoutStack(stack) {
    if (!stack)
        return false;
    return (/(?:node_modules[/\\]@cursor[/\\]sdk|node_modules\/\@cursor\/sdk|@cursor\/sdk\/dist)/.test(stack) &&
        /\b_setupTimeout\b|\bProtocol\._setupTimeout\b/.test(stack));
}
export function isCursorSdkMcpToolTimeoutStack(stack) {
    if (!stack)
        return false;
    return (isCursorSdkMcpProtocolTimeoutStack(stack) &&
        /\bcallTool\b|\bClient\.callTool\b|\bMcpSdkClient\.callTool\b/.test(stack));
}
export function isCursorSdkMcpConnectTimeoutStack(stack) {
    if (!stack || !isCursorSdkMcpProtocolTimeoutStack(stack))
        return false;
    return /\bClient\.(?:connect|listTools)\b|\bMcpSdkClient\.getTools\b/.test(stack);
}
function isCursorSdkDefaultMcpTimeout(delay) {
    return typeof delay === "number" && delay === CURSOR_SDK_MCP_DEFAULT_TIMEOUT_MS;
}
function patchedSetTimeout(handler, delay, ...args) {
    const delegate = originalSetTimeout;
    if (!delegate)
        throw new Error("Cursor MCP timeout override installed without original setTimeout");
    let nextDelay = delay;
    if (isCursorSdkDefaultMcpTimeout(delay)) {
        const stack = new Error().stack;
        if (isCursorSdkMcpToolTimeoutStack(stack)) {
            nextDelay = installedToolTimeoutMs;
        }
        else if (isCursorSdkMcpConnectTimeoutStack(stack)) {
            nextDelay = installedConnectTimeoutMs;
        }
    }
    return Reflect.apply(delegate, globalThis, [handler, nextDelay, ...args]);
}
export function installCursorMcpToolTimeoutOverride(options = {}) {
    installedToolTimeoutMs = normalizeOverrideTimeoutMs(options.timeoutMs ?? resolveCursorMcpToolTimeoutMs(options.env));
    installedConnectTimeoutMs = normalizeConnectTimeoutMs(options.connectTimeoutMs ?? resolveCursorMcpConnectTimeoutMs(options.env));
    if (!originalSetTimeout) {
        originalSetTimeout = globalThis.setTimeout;
        globalThis.setTimeout = patchedSetTimeout;
    }
    return {
        installed: true,
        timeoutMs: installedToolTimeoutMs,
        connectTimeoutMs: installedConnectTimeoutMs,
        sdkDefaultTimeoutMs: CURSOR_SDK_MCP_DEFAULT_TIMEOUT_MS,
    };
}
export function restoreCursorMcpToolTimeoutOverride() {
    if (originalSetTimeout) {
        globalThis.setTimeout = originalSetTimeout;
        originalSetTimeout = undefined;
    }
    installedToolTimeoutMs = DEFAULT_CURSOR_MCP_TOOL_TIMEOUT_MS;
    installedConnectTimeoutMs = DEFAULT_CURSOR_MCP_CONNECT_TIMEOUT_MS;
}
export const cursorMcpToolTimeoutOverrideDefaults = {
    cursorSdkDefaultTimeoutMs: CURSOR_SDK_MCP_DEFAULT_TIMEOUT_MS,
    defaultOverrideTimeoutMs: DEFAULT_CURSOR_MCP_TOOL_TIMEOUT_MS,
    defaultConnectTimeoutMs: DEFAULT_CURSOR_MCP_CONNECT_TIMEOUT_MS,
    minConnectTimeoutMs: MIN_CURSOR_MCP_CONNECT_TIMEOUT_MS,
    maxNodeTimerDelayMs: MAX_NODE_TIMER_DELAY_MS,
    timeoutMsEnv: CURSOR_MCP_TOOL_TIMEOUT_MS_ENV,
    timeoutSecondsEnv: CURSOR_MCP_TOOL_TIMEOUT_SECONDS_ENV,
    connectTimeoutMsEnv: CURSOR_MCP_CONNECT_TIMEOUT_MS_ENV,
    connectTimeoutSecondsEnv: CURSOR_MCP_CONNECT_TIMEOUT_SECONDS_ENV,
};
