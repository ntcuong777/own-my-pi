import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { BUNDLED_CONTEXT_WINDOWS } from "./bundled-context-windows.js";
import { asRecord } from "./cursor-record-utils.js";
const CONTEXT_WINDOW_CACHE_FILE = "cursor-sdk-context-windows.json";
let userContextWindowOverrideLoadCount = 0;
function getCachePath() {
    return join(getAgentDir(), CONTEXT_WINDOW_CACHE_FILE);
}
function isPositiveInteger(value) {
    return typeof value === "number" && Number.isInteger(value) && value > 0;
}
function parseContextWindowCacheFile(value) {
    const record = asRecord(value);
    if (!record)
        return undefined;
    const { contextWindows } = record;
    if (contextWindows === undefined)
        return {};
    const contextWindowRecord = asRecord(contextWindows);
    if (!contextWindowRecord)
        return undefined;
    return {
        contextWindows: Object.fromEntries(Object.entries(contextWindowRecord).filter((entry) => isPositiveInteger(entry[1]))),
    };
}
function loadUserContextWindowOverrides() {
    userContextWindowOverrideLoadCount += 1;
    const path = getCachePath();
    const overrides = new Map();
    if (!existsSync(path))
        return overrides;
    try {
        const parsed = parseContextWindowCacheFile(JSON.parse(readFileSync(path, "utf-8")));
        for (const [modelId, contextWindow] of Object.entries(parsed?.contextWindows ?? {})) {
            overrides.set(modelId, contextWindow);
        }
    }
    catch {
        return overrides;
    }
    return overrides;
}
export function loadContextWindowCache() {
    const cache = new Map(Object.entries(BUNDLED_CONTEXT_WINDOWS));
    for (const [modelId, contextWindow] of loadUserContextWindowOverrides()) {
        cache.set(modelId, contextWindow);
    }
    return cache;
}
export function getCachedContextWindowExact(modelId) {
    return loadContextWindowCache().get(modelId);
}
export function getCachedContextWindow(modelId) {
    const cache = loadContextWindowCache();
    return cache.get(modelId) ?? cache.get("default");
}
export function getCheckpointContextWindow(checkpoint) {
    const tokenDetails = asRecord(checkpoint)?.tokenDetails;
    const maxTokens = asRecord(tokenDetails)?.maxTokens;
    return isPositiveInteger(maxTokens) ? maxTokens : undefined;
}
export function saveCachedContextWindow(modelId, contextWindow) {
    if (!isPositiveInteger(contextWindow))
        return;
    const overrides = loadUserContextWindowOverrides();
    const bundledContextWindow = BUNDLED_CONTEXT_WINDOWS[modelId] ?? BUNDLED_CONTEXT_WINDOWS.default;
    if (bundledContextWindow === contextWindow) {
        if (!overrides.has(modelId))
            return;
        overrides.delete(modelId);
    }
    else {
        if (overrides.get(modelId) === contextWindow)
            return;
        overrides.set(modelId, contextWindow);
    }
    const path = getCachePath();
    mkdirSync(dirname(path), { recursive: true });
    const data = {
        contextWindows: Object.fromEntries([...overrides.entries()].sort(([a], [b]) => a.localeCompare(b))),
    };
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}
export const __testUtils = {
    getCachePath,
    getUserContextWindowOverrideLoadCount: () => userContextWindowOverrideLoadCount,
    resetUserContextWindowOverrideLoadCount: () => {
        userContextWindowOverrideLoadCount = 0;
    },
};
