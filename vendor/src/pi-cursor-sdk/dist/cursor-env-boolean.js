const DISABLED_ENV_VALUES = new Set(["0", "false", "off", "none", "no", "disabled"]);
const ENABLED_ENV_VALUES = new Set(["1", "true", "on", "yes", "enabled"]);
function normalizeEnvBoolean(raw) {
    const normalized = raw?.trim().toLowerCase();
    return normalized || undefined;
}
export function parseOptionalEnvBoolean(raw) {
    const normalized = normalizeEnvBoolean(raw);
    if (!normalized)
        return undefined;
    if (DISABLED_ENV_VALUES.has(normalized))
        return false;
    if (ENABLED_ENV_VALUES.has(normalized))
        return true;
    return undefined;
}
export function parseEnvBoolean(raw, defaultValue) {
    return parseOptionalEnvBoolean(raw) ?? defaultValue;
}
