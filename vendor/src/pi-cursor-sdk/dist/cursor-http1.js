import { asRecord } from "./cursor-record-utils.js";
export const CURSOR_HTTP1_ENTRY_TYPE = "cursor-http1-state";
let sessionCursorHttp1Enabled;
let globalPreferenceAuthoritative = false;
let configuredCursor;
export function isCursorHttp1EntryData(value) {
    return typeof asRecord(value)?.enabled === "boolean";
}
export function getStoredCursorHttp1Enabled() {
    return sessionCursorHttp1Enabled;
}
export function setStoredCursorHttp1Enabled(enabled) {
    sessionCursorHttp1Enabled = enabled;
}
export function getResolvedSessionCursorHttp1Enabled() {
    return globalPreferenceAuthoritative ? undefined : sessionCursorHttp1Enabled;
}
export function setCursorHttp1GlobalPreferenceAuthoritative(authoritative) {
    globalPreferenceAuthoritative = authoritative;
}
export function clearCursorSdkHttp1() {
    if (configuredCursor === undefined)
        return;
    configuredCursor.configure({ local: { useHttp1ForAgent: null } });
    configuredCursor = undefined;
}
export function configureCursorSdkHttp1(sdk, setting) {
    if (setting.source !== "builtin") {
        sdk.Cursor.configure({ local: { useHttp1ForAgent: setting.value } });
        configuredCursor = sdk.Cursor;
        return setting.value;
    }
    if (configuredCursor === sdk.Cursor)
        clearCursorSdkHttp1();
    else
        configuredCursor = undefined;
    return undefined;
}
export const __testUtils = {
    reset() {
        sessionCursorHttp1Enabled = undefined;
        globalPreferenceAuthoritative = false;
        configuredCursor = undefined;
    },
};
