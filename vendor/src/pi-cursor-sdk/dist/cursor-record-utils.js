export function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}
export function getField(value, field) {
    return asRecord(value)?.[field];
}
export function hasUsableText(value) {
    return typeof value === "string" && value.trim().length > 0;
}
export function getString(record, key) {
    const value = record?.[key];
    return typeof value === "string" ? value : undefined;
}
export function getNumber(record, key) {
    const value = record?.[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
export function getBoolean(record, key) {
    const value = record?.[key];
    return typeof value === "boolean" ? value : undefined;
}
export function getRecord(record, key) {
    return asRecord(record?.[key]);
}
export function getArray(record, key) {
    const value = record?.[key];
    return Array.isArray(value) ? value : undefined;
}
export function firstNonEmptyString(...values) {
    for (const value of values) {
        const trimmed = value?.trim();
        if (trimmed)
            return trimmed;
    }
    return undefined;
}
export function stringifyUnknown(value, options = {}) {
    if (value === undefined)
        return "";
    if (typeof value === "string")
        return value;
    try {
        return JSON.stringify(value, null, options.pretty ? 2 : undefined) ?? String(value);
    }
    catch {
        return String(value);
    }
}
export function getFirstStringByKeys(record, keys, options) {
    if (!record)
        return undefined;
    for (const key of keys) {
        const value = record[key];
        if (typeof value !== "string")
            continue;
        if (options?.nonEmpty && !value)
            continue;
        return value;
    }
    return undefined;
}
