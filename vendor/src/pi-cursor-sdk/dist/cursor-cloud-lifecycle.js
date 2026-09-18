import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, fchmodSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveCursorApiKey } from "./cursor-api-key.js";
import { MAX_CLOUD_REPORT_BRANCHES, } from "./cursor-cloud-reporting.js";
import { CLOUD_AGENT_ID_PATTERN, CLOUD_LIFECYCLE_ENTRY_TYPE, CLOUD_LIFECYCLE_JOURNAL_PREFIX, } from "../shared/cursor-cloud-lifecycle-constants.mjs";
import { fsyncExistingRegularFile, noFollowFlag, openExistingRegularFileNoFollow } from "./cursor-durable-fs.js";
import { truncateCursorDisplayLine } from "./cursor-display-text.js";
import { asRecord, getString } from "./cursor-record-utils.js";
import { scrubSensitiveText } from "./cursor-sensitive-text.js";
import { loadCursorSdk } from "./cursor-sdk-runtime.js";
export { CLOUD_LIFECYCLE_ENTRY_TYPE };
const MAX_LEDGER_AGENT_ID_LENGTH = 256;
const MAX_LEDGER_RUN_ID_LENGTH = 256;
const MAX_LEDGER_TIMESTAMP_LENGTH = 64;
const MAX_LEDGER_BRANCH_LENGTH = 160;
const MAX_LEDGER_PR_URL_LENGTH = 240;
const MAX_LIST_RECORDS = 25;
const MAX_CLOUD_AGENT_ID_ERROR_LENGTH = 256;
const DURABLE_LEDGER_VERSION = 1;
const DURABLE_LEDGER_PREFIX = CLOUD_LIFECYCLE_JOURNAL_PREFIX;
let cloudLifecycleApi;
let cloudLifecycleSession = {};
let durableWriterForTests;
let sessionFsyncForTests;
let runtimeApiKeyResolverForTests;
let sdkOperationsForTests;
function isCloudLifecycleAction(value) {
    return value === "record" ||
        value === "archive_intent" ||
        value === "delete_intent" ||
        value === "archive" ||
        value === "delete";
}
function sanitizeLedgerString(value, maxLength, apiKey) {
    return truncateCursorDisplayLine(scrubSensitiveText(value, apiKey), maxLength);
}
function isValidExactCloudAgentId(value) {
    return typeof value === "string" && CLOUD_AGENT_ID_PATTERN.test(value);
}
function requiredBoundedString(record, key, maxLength) {
    const value = record[key];
    if (typeof value !== "string")
        return undefined;
    const sanitized = sanitizeLedgerString(value, maxLength);
    return sanitized || undefined;
}
function optionalString(record, key, maxLength, apiKey) {
    const value = record[key];
    if (value === undefined)
        return undefined;
    if (typeof value !== "string")
        return false;
    return sanitizeLedgerString(value, maxLength, apiKey) || undefined;
}
function parseBranch(value, apiKey) {
    const record = asRecord(value);
    if (!record)
        return undefined;
    const branch = optionalString(record, "branch", MAX_LEDGER_BRANCH_LENGTH, apiKey);
    const prUrl = optionalString(record, "prUrl", MAX_LEDGER_PR_URL_LENGTH, apiKey);
    if (branch === false || prUrl === false || (!branch && !prUrl))
        return undefined;
    return {
        ...(branch ? { branch } : {}),
        ...(prUrl ? { prUrl } : {}),
    };
}
function parseArray(value, parseItem) {
    if (value === undefined)
        return undefined;
    if (!Array.isArray(value))
        return undefined;
    const parsed = value.map(parseItem).filter((item) => item !== undefined);
    return parsed.length > 0 ? parsed : undefined;
}
function parseCloudLifecycleEntryData(value) {
    const record = asRecord(value);
    if (!record || !isCloudLifecycleAction(record.action) || record.runtime !== "cloud")
        return undefined;
    const agentId = record.agentId;
    const timestamp = requiredBoundedString(record, "timestamp", MAX_LEDGER_TIMESTAMP_LENGTH);
    if (!isValidExactCloudAgentId(agentId) || !timestamp)
        return undefined;
    const runId = optionalString(record, "runId", MAX_LEDGER_RUN_ID_LENGTH);
    if (runId === false)
        return undefined;
    const branches = parseArray(record.branches, (branch) => parseBranch(branch))?.slice(0, MAX_CLOUD_REPORT_BRANCHES);
    return {
        action: record.action,
        runtime: "cloud",
        agentId,
        timestamp,
        ...(runId ? { runId } : {}),
        ...(branches ? { branches } : {}),
    };
}
function buildBranchEntries(report, apiKey) {
    if (!Array.isArray(report.branches))
        return undefined;
    return parseArray(report.branches.slice(0, MAX_CLOUD_REPORT_BRANCHES), (branch) => parseBranch(branch, apiKey));
}
function buildBaseEntry(agentId, action) {
    if (!isValidExactCloudAgentId(agentId))
        return undefined;
    return {
        action,
        runtime: "cloud",
        agentId,
        timestamp: new Date().toISOString(),
    };
}
function captureCloudLifecycleSession(ctx) {
    cloudLifecycleSession = {
        sessionFile: ctx.sessionManager.getSessionFile?.() ?? undefined,
        sessionId: ctx.sessionManager.getSessionId?.() ?? undefined,
        getBranch: () => ctx.sessionManager.getBranch(),
    };
}
function durableLedgerPath(sessionFile, sessionId) {
    const sessionHash = createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
    return join(dirname(sessionFile), `${DURABLE_LEDGER_PREFIX}-${sessionHash}.journal`);
}
function sameFileIdentity(left, right) {
    return left.dev === right.dev && left.ino === right.ino;
}
function createRegularFileExclusive(path, flags, mode) {
    let fd;
    try {
        fd = openSync(path, flags | constants.O_CREAT | constants.O_EXCL | noFollowFlag(), mode);
        const opened = fstatSync(fd);
        const after = lstatSync(path);
        if (!opened.isFile() || !after.isFile() || !sameFileIdentity(opened, after)) {
            throw new Error("created journal path changed while opening");
        }
        return fd;
    }
    catch (error) {
        if (fd !== undefined) {
            try {
                closeSync(fd);
            }
            catch { }
        }
        throw error;
    }
}
function fsyncCloudLifecycleSessionFile() {
    if (sessionFsyncForTests)
        return sessionFsyncForTests();
    const sessionFile = cloudLifecycleSession.sessionFile;
    if (!sessionFile || !existsSync(sessionFile))
        return true;
    return fsyncExistingRegularFile(sessionFile);
}
function appendDurableCloudLifecycleEntry(data, anchorEntryId) {
    if (durableWriterForTests)
        return durableWriterForTests(data);
    const { sessionFile, sessionId } = cloudLifecycleSession;
    if (!sessionFile || !sessionId)
        return false;
    const entry = {
        ...data,
        version: DURABLE_LEDGER_VERSION,
        sessionId,
        sessionFile,
        anchorEntryId: existsSync(sessionFile) ? anchorEntryId : null,
    };
    const path = durableLedgerPath(sessionFile, sessionId);
    let created = false;
    let fd;
    let directoryFd;
    try {
        const flags = constants.O_RDWR | constants.O_APPEND;
        try {
            fd = createRegularFileExclusive(path, flags, 0o600);
            created = true;
        }
        catch (error) {
            if (error.code !== "EEXIST")
                throw error;
            fd = openExistingRegularFileNoFollow(path, flags);
        }
        if (process.platform !== "win32")
            fchmodSync(fd, 0o600);
        const { size } = fstatSync(fd);
        const lastByte = Buffer.allocUnsafe(1);
        const needsFrameBoundary = size > 0 && readSync(fd, lastByte, 0, 1, size - 1) === 1 && lastByte[0] !== 0x0a;
        writeFileSync(fd, `${needsFrameBoundary ? "\n" : ""}${JSON.stringify(entry)}\n`);
        fsyncSync(fd);
        if (created && process.platform !== "win32") {
            directoryFd = openSync(dirname(path), "r");
            fsyncSync(directoryFd);
        }
        return true;
    }
    catch {
        return false;
    }
    finally {
        for (const openFd of [fd, directoryFd]) {
            if (openFd === undefined)
                continue;
            try {
                closeSync(openFd);
            }
            catch {
                // fsync already established the durability decision.
            }
        }
    }
}
function appendCloudLifecycleEntry(pi, data) {
    if (!data || (!durableWriterForTests && (!cloudLifecycleSession.sessionFile || !cloudLifecycleSession.sessionId)))
        return false;
    let anchorEntryId;
    try {
        const previousEntryId = durableWriterForTests ? undefined : cloudLifecycleSession.getBranch?.().at(-1)?.id;
        pi.appendEntry(CLOUD_LIFECYCLE_ENTRY_TYPE, data);
        const anchor = cloudLifecycleSession.getBranch?.().at(-1);
        anchorEntryId = durableWriterForTests
            ? "test-cloud-lifecycle-entry"
            : anchor?.type === "custom" &&
                anchor.customType === CLOUD_LIFECYCLE_ENTRY_TYPE &&
                anchor.id !== previousEntryId
                ? anchor.id
                : undefined;
    }
    catch {
        return false;
    }
    return anchorEntryId !== undefined &&
        fsyncCloudLifecycleSessionFile() &&
        appendDurableCloudLifecycleEntry(data, anchorEntryId);
}
function appendCloudLifecycleMutationEntry(pi, ctx, data) {
    const anchorEntryId = ctx.sessionManager.getBranch().at(-1)?.id;
    if (!data || !anchorEntryId || !fsyncCloudLifecycleSessionFile() || !appendDurableCloudLifecycleEntry(data, anchorEntryId))
        return false;
    try {
        pi.appendEntry(CLOUD_LIFECYCLE_ENTRY_TYPE, data);
    }
    catch {
        // The fsynced mutation journal is authoritative.
    }
    return true;
}
export function registerCursorCloudLifecycleLedger(pi) {
    cloudLifecycleApi = pi;
    pi.on("session_start", (_event, ctx) => captureCloudLifecycleSession(ctx));
    pi.on("before_agent_start", (_event, ctx) => captureCloudLifecycleSession(ctx));
    pi.on("session_tree", (_event, ctx) => captureCloudLifecycleSession(ctx));
}
export function recordCursorCloudLifecycleRun(report, options = {}) {
    if (!cloudLifecycleApi)
        return false;
    const baseEntry = buildBaseEntry(report.agentId, "record");
    if (!baseEntry)
        return false;
    const branches = buildBranchEntries(report, options.apiKey);
    const runId = typeof report.runId === "string"
        ? sanitizeLedgerString(report.runId, MAX_LEDGER_RUN_ID_LENGTH, options.apiKey)
        : "";
    return appendCloudLifecycleEntry(cloudLifecycleApi, {
        ...baseEntry,
        ...(runId ? { runId } : {}),
        ...(branches ? { branches } : {}),
    });
}
export function recordCursorCloudLifecycleSafely(report, apiKey) {
    try {
        return recordCursorCloudLifecycleRun({ ...report, branches: [] }, { apiKey });
    }
    catch {
        return false;
    }
}
export function createCursorCloudLifecyclePersistenceError(agentId, phase, cancellationConfirmed, apiKey) {
    const boundedAgentId = truncateCursorDisplayLine(scrubSensitiveText(agentId, apiKey), MAX_CLOUD_AGENT_ID_ERROR_LENGTH);
    const cancellation = phase === "intent"
        ? "No run was started."
        : cancellationConfirmed
            ? "Cancellation requested/confirmed."
            : "Cancellation requested but unconfirmed.";
    return new Error(scrubSensitiveText(`Cursor Cloud ${phase === "intent" ? "send intent" : "run"} blocked because its lifecycle record could not be persisted for agent ${boundedAgentId}. Cloud requires a writable persisted pi session; do not use --no-session. ${cancellation} Open the Cursor Cloud dashboard and manually archive or delete agent ${boundedAgentId} before retrying.`, apiKey));
}
function compareLifecycleTimestamps(left, right) {
    const leftTime = Date.parse(left);
    const rightTime = Date.parse(right);
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime))
        return leftTime - rightTime;
    return left.localeCompare(right);
}
function pickNewerRunId(newer, dataRunId, existingRunId) {
    return newer ? dataRunId ?? existingRunId : existingRunId ?? dataRunId;
}
function mergeCloudLifecycleRecordBranches(newer, dataBranches, existingBranches) {
    if (newer)
        return dataBranches ?? existingBranches ?? [];
    return existingBranches?.length ? existingBranches : dataBranches ?? [];
}
function reduceCloudLifecycleEntries(entries) {
    const agents = new Map();
    const mutations = new Map();
    for (const data of entries) {
        if (data.action === "record") {
            const existing = agents.get(data.agentId);
            const newer = !existing || compareLifecycleTimestamps(data.timestamp, existing.timestamp) >= 0;
            agents.set(data.agentId, {
                agentId: data.agentId,
                runId: pickNewerRunId(newer, data.runId, existing?.runId),
                timestamp: newer || !existing ? data.timestamp : existing.timestamp,
                archived: false,
                deleted: false,
                branches: mergeCloudLifecycleRecordBranches(newer, data.branches, existing?.branches),
            });
            continue;
        }
        const action = data.action.startsWith("archive") ? "archive" : "delete";
        const status = data.action.endsWith("_intent") ? "intent" : "result";
        const agentMutations = mutations.get(data.agentId) ?? {};
        const current = agentMutations[action];
        const comparison = current ? compareLifecycleTimestamps(data.timestamp, current.timestamp) : 1;
        if (comparison > 0 || (comparison === 0 && status === "result" && current?.status === "intent")) {
            agentMutations[action] = { status, timestamp: data.timestamp };
            mutations.set(data.agentId, agentMutations);
        }
    }
    for (const [agentId, agent] of agents) {
        const agentMutations = mutations.get(agentId);
        const archive = agentMutations?.archive;
        const deletion = agentMutations?.delete;
        const pending = [
            ...(archive?.status === "intent" ? [{ action: "archive", timestamp: archive.timestamp }] : []),
            ...(deletion?.status === "intent" ? [{ action: "delete", timestamp: deletion.timestamp }] : []),
        ].sort((left, right) => compareLifecycleTimestamps(right.timestamp, left.timestamp))[0];
        const mutationTimestamps = [archive?.timestamp, deletion?.timestamp].filter((value) => value !== undefined);
        const timestamp = mutationTimestamps.reduce((latest, value) => compareLifecycleTimestamps(value, latest) > 0 ? value : latest, agent.timestamp);
        agents.set(agentId, {
            ...agent,
            timestamp,
            archived: archive?.status === "result",
            deleted: deletion?.status === "result",
            ...(pending ? { pendingAction: pending.action } : {}),
        });
    }
    return [...agents.values()].filter((agent) => !agent.deleted);
}
function readCursorCloudLifecycleEntries(entries) {
    return entries.flatMap((entry) => {
        if (entry.type !== "custom" || entry.customType !== CLOUD_LIFECYCLE_ENTRY_TYPE)
            return [];
        const data = parseCloudLifecycleEntryData(entry.data);
        return data ? [data] : [];
    });
}
export function readCursorCloudLifecycleAgents(entries) {
    return reduceCloudLifecycleEntries(readCursorCloudLifecycleEntries(entries));
}
function readDurableCloudLifecycleJournal(ctx) {
    const sessionFile = ctx.sessionManager.getSessionFile?.();
    const sessionId = ctx.sessionManager.getSessionId?.();
    if (!sessionFile || !sessionId)
        return [];
    let fd;
    let lines;
    try {
        fd = openExistingRegularFileNoFollow(durableLedgerPath(sessionFile, sessionId), constants.O_RDONLY);
        lines = readFileSync(fd, "utf8").split(/\r?\n/);
    }
    catch {
        return [];
    }
    finally {
        if (fd !== undefined) {
            try {
                closeSync(fd);
            }
            catch {
                return [];
            }
        }
    }
    const entries = [];
    for (const line of lines) {
        if (!line)
            continue;
        let raw;
        try {
            raw = asRecord(JSON.parse(line));
        }
        catch {
            continue;
        }
        if (raw?.version !== DURABLE_LEDGER_VERSION || raw.sessionId !== sessionId || typeof raw.sessionFile !== "string")
            continue;
        const anchorEntryId = raw.anchorEntryId;
        if (anchorEntryId !== null && typeof anchorEntryId !== "string")
            continue;
        const data = parseCloudLifecycleEntryData(raw);
        if (data)
            entries.push({ data, sessionFile: raw.sessionFile, anchorEntryId });
    }
    return entries;
}
function readDurableCloudLifecycleEntries(ctx) {
    const sessionFile = ctx.sessionManager.getSessionFile?.();
    if (!sessionFile)
        return [];
    const fileless = !existsSync(sessionFile);
    const branchIds = new Set(ctx.sessionManager.getBranch().map((entry) => entry.id));
    return readDurableCloudLifecycleJournal(ctx).flatMap((entry) => {
        if (entry.data.action !== "record")
            return [entry.data];
        if (fileless)
            return entry.anchorEntryId === null ? [entry.data] : [];
        return entry.anchorEntryId !== null && branchIds.has(entry.anchorEntryId) ? [entry.data] : [];
    });
}
function cloudLifecycleEntryKey(data) {
    return JSON.stringify([data.action, data.agentId, data.runId, data.timestamp, data.branches]);
}
function reconcileDurableCloudLifecycleOrphans(pi, ctx) {
    const sessionFile = ctx.sessionManager.getSessionFile?.();
    if (!sessionFile || !existsSync(sessionFile))
        return true;
    const journal = readDurableCloudLifecycleJournal(ctx);
    const claimedAgentIds = new Set(journal.flatMap((entry) => entry.data.action === "record" && entry.anchorEntryId !== null ? [entry.data.agentId] : []));
    const latestOrphanByAgent = new Map();
    for (const entry of journal) {
        if (entry.data.action === "record" && entry.anchorEntryId === null)
            latestOrphanByAgent.set(entry.data.agentId, entry);
    }
    const branch = ctx.sessionManager.getBranch();
    for (const [agentId, orphan] of latestOrphanByAgent) {
        if (claimedAgentIds.has(agentId))
            continue;
        let matchingEntry;
        for (let index = branch.length - 1; index >= 0; index -= 1) {
            const entry = branch[index];
            if (entry.type !== "custom" || entry.customType !== CLOUD_LIFECYCLE_ENTRY_TYPE)
                continue;
            const data = parseCloudLifecycleEntryData(entry.data);
            if (data !== undefined && cloudLifecycleEntryKey(data) === cloudLifecycleEntryKey(orphan.data)) {
                matchingEntry = entry;
                break;
            }
        }
        if (matchingEntry) {
            if (!fsyncCloudLifecycleSessionFile() || !appendDurableCloudLifecycleEntry(orphan.data, matchingEntry.id))
                return false;
            continue;
        }
        if (orphan.sessionFile !== sessionFile && !appendCloudLifecycleEntry(pi, orphan.data))
            return false;
    }
    return true;
}
function reconcileDurableCloudLifecycleOrphansForCommand(pi, ctx) {
    if (reconcileDurableCloudLifecycleOrphans(pi, ctx))
        return true;
    ctx.ui.notify("Unable to reconcile the durable Cursor cloud lifecycle journal with this session branch.", "error");
    return false;
}
function readRecordedCloudAgents(ctx) {
    const durableEntries = readDurableCloudLifecycleEntries(ctx);
    const durableKeys = new Set(durableEntries.map(cloudLifecycleEntryKey));
    const branchOnlyEntries = readCursorCloudLifecycleEntries(ctx.sessionManager.getBranch())
        .filter((entry) => !durableKeys.has(cloudLifecycleEntryKey(entry)));
    return reduceCloudLifecycleEntries([...durableEntries, ...branchOnlyEntries]);
}
function validateCloudAgentIdSyntax(agentId) {
    if (!agentId)
        return "Missing Cursor cloud agent ID.";
    if (!agentId.startsWith("bc-"))
        return "Cursor cloud agent IDs must start with bc-.";
    if (agentId.length > MAX_LEDGER_AGENT_ID_LENGTH)
        return "Cursor cloud agent ID is too long.";
    if (!isValidExactCloudAgentId(agentId))
        return "Pass exactly one valid recorded Cursor cloud agent ID.";
    return undefined;
}
function validateRecordedCloudAgentId(agentId, records, action) {
    const syntaxError = validateCloudAgentIdSyntax(agentId);
    if (syntaxError)
        return syntaxError;
    const record = records.find((candidate) => candidate.agentId === agentId);
    if (!record)
        return `Cursor cloud agent ${agentId} is not recorded in this session branch.`;
    if (record.pendingAction) {
        return `Cursor cloud agent ${agentId} has an unresolved ${record.pendingAction} request; inspect it in the Cursor Cloud dashboard before retrying.`;
    }
    if (action === "archive" && record.archived)
        return `Cursor cloud agent ${agentId} is already archived.`;
    return undefined;
}
function tokenizeArgs(args) {
    return args.trim().split(/\s+/).filter(Boolean);
}
function formatCloudAgentRecord(record) {
    const agentId = sanitizeLedgerString(record.agentId, MAX_LEDGER_AGENT_ID_LENGTH);
    const status = [record.archived ? "archived" : undefined, record.pendingAction ? `${record.pendingAction} pending` : undefined]
        .filter(Boolean)
        .join(", ");
    const parts = [`- ${agentId}${status ? ` (${status})` : ""}`];
    if (record.runId)
        parts.push(`run ${sanitizeLedgerString(record.runId, MAX_LEDGER_RUN_ID_LENGTH)}`);
    const branch = record.branches.find((candidate) => candidate.branch || candidate.prUrl);
    if (branch?.branch)
        parts.push(`branch ${sanitizeLedgerString(branch.branch, MAX_LEDGER_BRANCH_LENGTH)}`);
    if (branch?.prUrl)
        parts.push(`PR ${sanitizeLedgerString(branch.prUrl, MAX_LEDGER_PR_URL_LENGTH)}`);
    return parts.join(" · ");
}
function formatCloudLifecycleRecords(records) {
    if (records.length === 0)
        return "No recorded Cursor cloud agents for this session branch.";
    const visibleRecords = records.slice(0, MAX_LIST_RECORDS);
    const lines = ["Recorded Cursor cloud agents for this session branch:", ...visibleRecords.map(formatCloudAgentRecord)];
    if (records.length > MAX_LIST_RECORDS)
        lines.push(`- +${records.length - MAX_LIST_RECORDS} more recorded agents`);
    return lines.join("\n");
}
export function formatCursorCloudLifecycleList(entries) {
    return formatCloudLifecycleRecords(readCursorCloudLifecycleAgents(entries));
}
async function getSdkOperations() {
    if (sdkOperationsForTests)
        return sdkOperationsForTests;
    const { Agent } = await loadCursorSdk();
    return {
        archive: (agentId, options) => Agent.archive(agentId, options),
        delete: (agentId, options) => Agent.delete(agentId, options),
    };
}
function formatCloudLifecycleError(error, apiKey) {
    return truncateCursorDisplayLine(scrubSensitiveText(getString(asRecord(error), "message") ?? String(error), apiKey));
}
async function resolveCloudLifecycleMutationApiKey(ctx) {
    const apiKey = resolveCursorApiKey(await (runtimeApiKeyResolverForTests?.() ?? ctx.modelRegistry.getApiKeyForProvider("cursor")));
    if (apiKey)
        return apiKey;
    ctx.ui.notify("Cursor cloud lifecycle mutations require a Cursor API key; run /login or set CURSOR_API_KEY, then retry.", "error");
    return undefined;
}
async function mutateRecordedCloudAgent(params) {
    const records = readRecordedCloudAgents(params.ctx);
    const validationError = validateRecordedCloudAgentId(params.agentId, records, params.action);
    if (validationError) {
        params.ctx.ui.notify(validationError, "error");
        return;
    }
    const apiKey = params.apiKey;
    let operations;
    try {
        operations = await getSdkOperations();
    }
    catch (error) {
        params.ctx.ui.notify(`Failed to prepare Cursor cloud ${params.action}: ${formatCloudLifecycleError(error, apiKey)}`, "error");
        return;
    }
    if (!appendCloudLifecycleMutationEntry(params.pi, params.ctx, buildBaseEntry(params.agentId, params.action === "archive" ? "archive_intent" : "delete_intent"))) {
        params.ctx.ui.notify(`Cursor cloud ${params.action} was not started because its durable intent could not be recorded.`, "error");
        return;
    }
    try {
        await operations[params.action](params.agentId, { apiKey });
    }
    catch (error) {
        params.ctx.ui.notify(`Cursor cloud ${params.action} for agent ${params.agentId} is unresolved: ${formatCloudLifecycleError(error, apiKey)} Inspect it in the Cursor Cloud dashboard before retrying.`, "error");
        return;
    }
    if (!appendCloudLifecycleMutationEntry(params.pi, params.ctx, buildBaseEntry(params.agentId, params.action))) {
        params.ctx.ui.notify(`Cursor cloud agent ${params.agentId} ${params.action === "archive" ? "archived" : "deleted"}, but its durable result could not be recorded. Inspect it in the Cursor Cloud dashboard before retrying.`, "error");
        return;
    }
    params.ctx.ui.notify(`Cursor cloud agent ${params.agentId} ${params.action === "archive" ? "archived" : "deleted"}.`, "info");
}
export async function runCursorCloudLifecycleCommand(pi, args, ctx) {
    captureCloudLifecycleSession(ctx);
    const usage = "Usage: /cursor-cloud list | archive <bc-agentId> | delete <bc-agentId> --yes";
    const tokens = tokenizeArgs(args);
    const [subcommand, agentId, ...rest] = tokens;
    if (!subcommand || subcommand === "list") {
        if (tokens.length > (subcommand ? 1 : 0)) {
            ctx.ui.notify(`Invalid Cursor cloud arguments. ${usage}`, "error");
            return;
        }
        if (!reconcileDurableCloudLifecycleOrphansForCommand(pi, ctx))
            return;
        ctx.ui.notify(formatCloudLifecycleRecords(readRecordedCloudAgents(ctx)), "info");
        return;
    }
    if (subcommand === "archive") {
        if (!agentId || rest.length > 0) {
            ctx.ui.notify(`Invalid Cursor cloud archive arguments. ${usage}`, "error");
            return;
        }
        const validationError = validateCloudAgentIdSyntax(agentId);
        if (validationError) {
            ctx.ui.notify(validationError, "error");
            return;
        }
        const apiKey = await resolveCloudLifecycleMutationApiKey(ctx);
        if (!apiKey || !reconcileDurableCloudLifecycleOrphansForCommand(pi, ctx))
            return;
        await mutateRecordedCloudAgent({ pi, ctx, agentId, action: "archive", apiKey });
        return;
    }
    if (subcommand === "delete") {
        if (!agentId || rest.length !== 1 || rest[0] !== "--yes") {
            ctx.ui.notify(`Delete requires exactly one recorded bc- cloud agent ID and --yes. ${usage}`, "error");
            return;
        }
        const validationError = validateCloudAgentIdSyntax(agentId);
        if (validationError) {
            ctx.ui.notify(validationError, "error");
            return;
        }
        const apiKey = await resolveCloudLifecycleMutationApiKey(ctx);
        if (!apiKey || !reconcileDurableCloudLifecycleOrphansForCommand(pi, ctx))
            return;
        await mutateRecordedCloudAgent({ pi, ctx, agentId, action: "delete", apiKey });
        return;
    }
    ctx.ui.notify(`Invalid Cursor cloud command. ${usage}`, "error");
}
export const __testUtils = {
    reset: () => {
        cloudLifecycleApi = undefined;
        cloudLifecycleSession = {};
        durableWriterForTests = undefined;
        sessionFsyncForTests = undefined;
        runtimeApiKeyResolverForTests = undefined;
        sdkOperationsForTests = undefined;
    },
    setDurableWriter: (writer) => {
        durableWriterForTests = writer;
    },
    setSessionFsync: (fsync) => {
        sessionFsyncForTests = fsync;
    },
    setRuntimeApiKeyResolver: (resolver) => {
        runtimeApiKeyResolverForTests = resolver;
    },
    durableLedgerPath,
    setSdkOperations: (operations) => {
        sdkOperationsForTests = operations;
    },
};
