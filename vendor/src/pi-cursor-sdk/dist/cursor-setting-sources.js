/** Provider-facing wrapper; canonical parsing lives in shared/cursor-setting-sources.mjs. */
import { CURSOR_SETTING_SOURCES_ENV as CURSOR_SETTING_SOURCES_ENV_JS, DEFAULT_CURSOR_SETTING_SOURCES as DEFAULT_CURSOR_SETTING_SOURCES_JS, resolveCursorSettingSources as resolveCursorSettingSourcesJs, } from "../shared/cursor-setting-sources.mjs";
export const CURSOR_SETTING_SOURCES_ENV = CURSOR_SETTING_SOURCES_ENV_JS;
export const DEFAULT_CURSOR_SETTING_SOURCES = DEFAULT_CURSOR_SETTING_SOURCES_JS;
export function resolveCursorSettingSources(raw) {
    return resolveCursorSettingSourcesJs(raw);
}
export function getEffectiveCursorSettingSources(raw = process.env[CURSOR_SETTING_SOURCES_ENV]) {
    return resolveCursorSettingSources(raw);
}
export function cursorSettingSourcesIncludes(settingSources, source) {
    if (!settingSources?.length)
        return false;
    return settingSources.includes("all") || settingSources.includes(source);
}
