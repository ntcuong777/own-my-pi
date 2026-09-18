/** Canonical single-line sanitization and truncation for Cursor replay/trace display. */
export function sanitizeCursorDisplayLine(value) {
    return value
        .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "�")
        .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
export function truncateCursorDisplayLine(value, maxLength = 240) {
    if (maxLength <= 0)
        return "";
    const sanitized = sanitizeCursorDisplayLine(value);
    if (sanitized.length <= maxLength)
        return sanitized;
    if (maxLength === 1)
        return "…";
    return `${sanitized.slice(0, maxLength - 1).replace(/[\uD800-\uDBFF]$/, "")}…`;
}
