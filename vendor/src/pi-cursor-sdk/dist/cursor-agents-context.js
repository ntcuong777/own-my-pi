import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { parseEnvBoolean } from "./cursor-env-boolean.js";
import { isCursorModel } from "./cursor-model.js";
import { cursorSettingSourcesIncludes, getEffectiveCursorSettingSources, resolveCursorSettingSources, } from "./cursor-setting-sources.js";
export const CURSOR_PRESERVE_PI_AGENTS_MD_ENV = "PI_CURSOR_PRESERVE_PI_AGENTS_MD";
/** Opening tag prefix pi `buildSystemPrompt()` uses for each context file (path attribute only). */
export const PI_PROJECT_INSTRUCTIONS_OPEN_PREFIX = '<project_instructions path="';
const PI_PROJECT_INSTRUCTIONS_CLOSE = "</project_instructions>";
const PI_PROJECT_CONTEXT_OPEN = "\n\n<project_context>\n\nProject-specific instructions and guidelines:\n\n";
const PI_PROJECT_CONTEXT_CLOSE = "</project_context>\n";
function normalizeContextPath(filePath) {
    return filePath.replace(/\\/g, "/");
}
function normalizeDirPath(dirPath) {
    const normalized = normalizeContextPath(dirPath).replace(/\/+$/, "");
    return normalized || "/";
}
/** Pi context filenames that can overlap Cursor project/user ambient rules. */
const CURSOR_OVERLAPPING_CONTEXT_BASE_NAMES = new Set(["agents.md", "claude.md"]);
export function getAgentsContextFileBaseName(filePath) {
    const normalized = normalizeContextPath(filePath);
    return normalized.slice(normalized.lastIndexOf("/") + 1).toLowerCase();
}
function isPiAgentDirContextFilePath(filePath, fileName, agentDir = getAgentDir()) {
    const normalized = normalizeContextPath(filePath);
    const expectedPath = `${normalizeDirPath(agentDir)}/${fileName}`;
    return normalized.toLowerCase() === expectedPath.toLowerCase();
}
/** Actual pi agent dir `AGENTS.md` — overlaps Cursor `user` setting source (global agent instructions). */
export function isPiAgentDirAgentsMdPath(filePath, agentDir = getAgentDir()) {
    return isPiAgentDirContextFilePath(filePath, "agents.md", agentDir);
}
/** Actual pi agent dir `CLAUDE.md` — kept because Cursor user rules use `~/.claude/CLAUDE.md`. */
export function isPiAgentDirClaudeMdPath(filePath, agentDir = getAgentDir()) {
    return isPiAgentDirContextFilePath(filePath, "claude.md", agentDir);
}
/**
 * Classify whether a pi-loaded context file overlaps Cursor ambient rules.
 * Project/repo `AGENTS.md` and `CLAUDE.md` overlap Cursor `project` sources.
 * Only the actual pi agent dir `AGENTS.md` overlaps Cursor `user`; agent-dir `CLAUDE.md` is kept
 * because Cursor user rules use `~/.claude/CLAUDE.md`, not pi's agent dir path.
 */
export function classifyContextFileOverlap(filePath, agentDir = getAgentDir()) {
    const base = getAgentsContextFileBaseName(filePath);
    if (!CURSOR_OVERLAPPING_CONTEXT_BASE_NAMES.has(base))
        return "none";
    if (base === "agents.md" && isPiAgentDirAgentsMdPath(filePath, agentDir))
        return "cursor-user-agents";
    if (base === "claude.md" && isPiAgentDirClaudeMdPath(filePath, agentDir))
        return "none";
    return "cursor-project-rules";
}
export function shouldRemovePiAgentsContextFile(file, settingSources, agentDir) {
    switch (classifyContextFileOverlap(file.path, agentDir)) {
        case "cursor-user-agents":
            return cursorSettingSourcesIncludes(settingSources, "user");
        case "cursor-project-rules":
            return cursorSettingSourcesIncludes(settingSources, "project");
        default:
            return false;
    }
}
export function shouldSuppressPiAgentsContext(model, contextFiles, settingSources, agentDir) {
    if (!isCursorModel(model))
        return false;
    if (parseEnvBoolean(process.env[CURSOR_PRESERVE_PI_AGENTS_MD_ENV], false))
        return false;
    if (contextFiles.length === 0)
        return false;
    return contextFiles.some((file) => shouldRemovePiAgentsContextFile(file, settingSources, agentDir));
}
/** Exact pi `buildSystemPrompt()` serialization for one context file block (including trailing blank line). */
export function serializePiProjectInstructionsBlock(file) {
    return `${PI_PROJECT_INSTRUCTIONS_OPEN_PREFIX}${file.path}">\n${file.content}\n${PI_PROJECT_INSTRUCTIONS_CLOSE}\n\n`;
}
/** The two supported Pi project-context serializations; legacy includes outer spacing. */
export function serializePiProjectContextSection(contextFiles, format = "legacy") {
    if (contextFiles.length === 0)
        return "";
    if (format === "transcript") {
        return [
            "<project_context>",
            "Project-specific instructions and guidelines:",
            "",
            contextFiles.map((file) => serializePiProjectInstructionsBlock(file).trimEnd()).join("\n\n"),
            "</project_context>",
        ].join("\n");
    }
    return `${PI_PROJECT_CONTEXT_OPEN}${contextFiles.map(serializePiProjectInstructionsBlock).join("")}${PI_PROJECT_CONTEXT_CLOSE}`;
}
/** Remove pi context blocks that overlap Cursor setting sources. */
export function removePiAgentsContextFromSystemPrompt(systemPrompt, contextFiles, settingSources, agentDir) {
    const retainedContextFiles = [];
    let removedAny = false;
    for (const file of contextFiles) {
        if (shouldRemovePiAgentsContextFile(file, settingSources, agentDir)) {
            removedAny = true;
            continue;
        }
        retainedContextFiles.push(file);
    }
    if (!removedAny)
        return systemPrompt;
    // Match only the exact known files in either supported serialization; never
    // strip arbitrary user-authored XML or neighboring custom sections.
    for (const format of ["legacy", "transcript"]) {
        const originalSection = serializePiProjectContextSection(contextFiles, format);
        const start = systemPrompt.indexOf(originalSection);
        if (start < 0)
            continue;
        const replacementSection = serializePiProjectContextSection(retainedContextFiles, format);
        return systemPrompt.slice(0, start) + replacementSection + systemPrompt.slice(start + originalSection.length);
    }
    return systemPrompt;
}
export function resolveCursorFacingSystemPrompt(systemPrompt, model, systemPromptOptions, settingSourcesRaw, agentDir, runtime = "local") {
    if (runtime === "cloud" || !systemPromptOptions)
        return systemPrompt;
    const contextFiles = systemPromptOptions.contextFiles ?? [];
    const settingSources = settingSourcesRaw === undefined
        ? getEffectiveCursorSettingSources()
        : resolveCursorSettingSources(settingSourcesRaw);
    if (!shouldSuppressPiAgentsContext(model, contextFiles, settingSources, agentDir)) {
        return systemPrompt;
    }
    return removePiAgentsContextFromSystemPrompt(systemPrompt, contextFiles, settingSources, agentDir);
}
