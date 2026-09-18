import { asRecord } from "./cursor-record-utils.js";
const CURSOR_EDIT_DIFF_FIELD_ORDER = ["diffString", "diff", "unifiedDiff", "patch"];
export function resolveCursorEditDiff(source) {
    const record = asRecord(source);
    if (!record)
        return undefined;
    for (const key of CURSOR_EDIT_DIFF_FIELD_ORDER) {
        const value = record[key];
        if (typeof value === "string" && value.length > 0)
            return value;
    }
    return undefined;
}
