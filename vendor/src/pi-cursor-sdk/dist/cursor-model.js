export const CURSOR_PROVIDER = "cursor";
export const CURSOR_SDK_API = "cursor-sdk";
export function isCursorModel(model) {
    return model?.provider === CURSOR_PROVIDER || model?.api === CURSOR_SDK_API;
}
