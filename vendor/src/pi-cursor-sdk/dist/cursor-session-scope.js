import { resolve } from "node:path";
import { parseArgs } from "@earendil-works/pi-coding-agent";
import { truncateCursorDisplayLine } from "./cursor-display-text.js";
const ANONYMOUS_SESSION_SCOPE_KEY = "__anonymous__";
const EPHEMERAL_SESSION_SCOPE_PREFIX = "__ephemeral__:";
export const MAX_CURSOR_SESSION_NAME_LENGTH = 100;
const state = {
    sessionCwd: process.cwd(),
    sessionFile: undefined,
    sessionId: undefined,
    sessionName: undefined,
    projectTrusted: false,
    sessionGeneration: 0,
};
const scopeGenerations = new Map([[ANONYMOUS_SESSION_SCOPE_KEY, state.sessionGeneration]]);
const projectTrustResolutionCwds = new Set();
let nextSessionGeneration = 1;
let scopeChangeHandler;
/**
 * Pi session file when known; used to scope reused Cursor SDK agents to one pi session.
 */
export function getCursorSessionFile() {
    return state.sessionFile;
}
/**
 * Stable scope key for session-agent pooling. Falls back to a process-local anonymous key
 * before the first session_start (tests and early startup).
 */
export function getCursorSessionScopeKey() {
    if (state.sessionFile)
        return state.sessionFile;
    if (state.sessionId)
        return `${EPHEMERAL_SESSION_SCOPE_PREFIX}${state.sessionId}`;
    return ANONYMOUS_SESSION_SCOPE_KEY;
}
export function getCursorSessionScopeGeneration(scopeKey = getCursorSessionScopeKey()) {
    return scopeGenerations.get(scopeKey) ?? 0;
}
/**
 * Pi session cwd when known; falls back to process.cwd() before session_start.
 * Updated on session_start only until pi threads cwd into streamSimple—mid-session cwd
 * changes without a new session_start event are not reflected here.
 */
export function getCursorSessionCwd() {
    return state.sessionCwd;
}
export function getCursorSessionProjectTrusted() {
    return state.projectTrusted;
}
export function getCursorSessionName() {
    return state.sessionName;
}
function normalizeCursorSessionName(name) {
    if (name === undefined)
        return undefined;
    return truncateCursorDisplayLine(name, MAX_CURSOR_SESSION_NAME_LENGTH) || undefined;
}
function setCursorSessionScope(cwd, sessionFile, sessionId, projectTrusted = false, sessionName) {
    state.sessionCwd = cwd;
    state.sessionFile = sessionFile;
    state.sessionId = sessionId;
    state.sessionName = normalizeCursorSessionName(sessionName);
    state.projectTrusted = projectTrusted;
    state.sessionGeneration = nextSessionGeneration;
    nextSessionGeneration += 1;
    scopeGenerations.set(getCursorSessionScopeKey(), state.sessionGeneration);
}
function recordProjectTrustResolution(cwd) {
    projectTrustResolutionCwds.add(resolve(cwd));
}
function isCliProjectTrustApproved(args = process.argv.slice(2)) {
    return parseArgs(args).projectTrustOverride === true;
}
function resetCursorSessionScope() {
    state.sessionCwd = process.cwd();
    state.sessionFile = undefined;
    state.sessionId = undefined;
    state.sessionName = undefined;
    state.projectTrusted = false;
    state.sessionGeneration = 0;
    nextSessionGeneration = 1;
    scopeGenerations.clear();
    scopeGenerations.set(ANONYMOUS_SESSION_SCOPE_KEY, state.sessionGeneration);
    projectTrustResolutionCwds.clear();
}
export function onCursorSessionScopeKeyChange(handler) {
    scopeChangeHandler = handler;
}
export function registerCursorSessionScope(pi) {
    pi.on("project_trust", (event) => {
        recordProjectTrustResolution(event.cwd);
        return { trusted: "undecided" };
    });
    pi.on("session_start", async (_event, ctx) => {
        const previousScopeKey = getCursorSessionScopeKey();
        setCursorSessionScope(ctx.cwd, ctx.sessionManager?.getSessionFile?.() ?? undefined, ctx.sessionManager?.getSessionId?.() ?? undefined, ctx.isProjectTrusted?.() === true
            && (projectTrustResolutionCwds.has(resolve(ctx.cwd)) || isCliProjectTrustApproved()), ctx.sessionManager?.getSessionName?.() ?? undefined);
        if (previousScopeKey !== getCursorSessionScopeKey()) {
            await scopeChangeHandler?.(previousScopeKey);
        }
    });
    pi.on("session_info_changed", (event) => {
        state.sessionName = normalizeCursorSessionName(event.name);
    });
}
export const __testUtils = {
    ANONYMOUS_SESSION_SCOPE_KEY,
    EPHEMERAL_SESSION_SCOPE_PREFIX,
    set: setCursorSessionScope,
    recordProjectTrustResolution,
    isCliProjectTrustApproved,
    reset: resetCursorSessionScope,
};
