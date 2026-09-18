import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { devNull } from "node:os";
import { dirname, join, resolve } from "node:path";
function isValidCursorCloudBranchName(branch) {
    if (!branch || branch === "HEAD")
        return false;
    if (branch.startsWith("-") || branch.endsWith(".") || branch.endsWith("/") || branch.includes("..") || branch.includes("@{"))
        return false;
    if (/[\x00-\x20\x7f~^:?*\[\\]/.test(branch))
        return false;
    const components = branch.split("/");
    return components.every((component) => component.length > 0 && !component.startsWith(".") && !component.endsWith(".lock"));
}
export function normalizeCursorCloudStartingRef(value) {
    const ref = value?.trim();
    if (!ref)
        return { kind: "absent" };
    if (ref.startsWith("refs/heads/")) {
        const branch = ref.slice("refs/heads/".length);
        return isValidCursorCloudBranchName(branch) ? { kind: "branch", value: branch } : { kind: "unsupported" };
    }
    if (ref.startsWith("refs/"))
        return { kind: "unsupported" };
    if (/^[0-9a-fA-F]{40}$/.test(ref))
        return { kind: "commit", value: ref };
    return isValidCursorCloudBranchName(ref) ? { kind: "branch", value: ref } : { kind: "unsupported" };
}
function buildCursorCloudGitEnvironment(source, isolateConfig) {
    const env = {};
    for (const [name, value] of Object.entries(source)) {
        if (name.toUpperCase().startsWith("GIT_"))
            continue;
        env[name] = value;
    }
    if (isolateConfig) {
        const configNullDevice = process.platform === "win32" ? "NUL" : devNull;
        env.GIT_CONFIG_GLOBAL = configNullDevice;
        env.GIT_CONFIG_SYSTEM = configNullDevice;
        env.GIT_CONFIG_NOSYSTEM = "1";
    }
    env.GIT_NO_REPLACE_OBJECTS = "1";
    return env;
}
export function sanitizeCursorCloudGitEnvironment(source = process.env) {
    return buildCursorCloudGitEnvironment(source, true);
}
function runGitWithEnvironment(cwd, args, env) {
    try {
        const output = execFileSync("git", args, {
            cwd,
            env,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            timeout: 30_000,
            maxBuffer: 64 * 1024 * 1024,
        });
        return output.endsWith("\n") ? output.slice(0, -1) : output;
    }
    catch {
        return undefined;
    }
}
export function runCursorCloudGit(cwd, args) {
    return runGitWithEnvironment(cwd, args, sanitizeCursorCloudGitEnvironment());
}
function runCursorCloudGitWithUserConfig(cwd, args) {
    return runGitWithEnvironment(cwd, args, buildCursorCloudGitEnvironment(process.env, false));
}
function hasPlausibleGitMetadata(cwd) {
    let current = cwd;
    while (true) {
        if (existsSync(join(current, ".git")))
            return true;
        if (["HEAD", "config", "objects", "refs"].every((name) => existsSync(join(current, name))))
            return true;
        const parent = dirname(current);
        if (parent === current)
            return false;
        current = parent;
    }
}
const HTTPS_REPOSITORY_PROTOCOLS = new Set(["https:"]);
const LOCAL_REPOSITORY_PROTOCOLS = new Set(["https:", "ssh:"]);
function parseRepositoryTransportUrl(value, protocols) {
    if (value !== value.trim() || /[\s\\\x00-\x1f\x7f]/.test(value))
        return undefined;
    const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(value);
    if (!scheme?.[1])
        return undefined;
    const protocol = `${scheme[1].toLowerCase()}:`;
    if (!protocols.has(protocol))
        return undefined;
    const authorityAndPath = value.slice(scheme[0].length);
    const pathSeparator = authorityAndPath.indexOf("/");
    if (pathSeparator <= 0)
        return undefined;
    const authority = authorityAndPath.slice(0, pathSeparator);
    const rawPath = authorityAndPath.slice(pathSeparator);
    if (protocol === "https:" && authority.includes("@"))
        return undefined;
    if (protocol === "ssh:" && authority.includes("@")) {
        const userinfo = authority.slice(0, authority.lastIndexOf("@"));
        if (!userinfo || userinfo.includes(":"))
            return undefined;
    }
    if (!rawPath.replace(/\/+$/, ""))
        return undefined;
    for (const part of rawPath.split("/")) {
        let decoded;
        try {
            decoded = decodeURIComponent(part);
        }
        catch {
            return undefined;
        }
        if (decoded === "." || decoded === ".." || /[\/\\\s\x00-\x1f\x7f]/.test(decoded))
            return undefined;
    }
    try {
        const url = new URL(value);
        return url.search || url.hash || url.password || !url.hostname || url.pathname === "/" ? undefined : url;
    }
    catch {
        return undefined;
    }
}
export function parseCursorCloudRepositoryUrl(value) {
    if (!value || value !== value.trim())
        return undefined;
    const url = parseRepositoryTransportUrl(value, HTTPS_REPOSITORY_PROTOCOLS);
    return url && !url.username ? value : undefined;
}
function normalizeRepositoryIdentity(value) {
    if (value !== value.trim() || /[\s\\\x00-\x1f\x7f]/.test(value))
        return undefined;
    const url = parseRepositoryTransportUrl(value, LOCAL_REPOSITORY_PROTOCOLS);
    let transport;
    let host;
    let pathname;
    if (url) {
        transport = url.protocol;
        host = url.host.toLowerCase();
        pathname = url.pathname;
    }
    else {
        if (value.includes("://") || /^[A-Za-z]:/.test(value))
            return undefined;
        const match = /^(?:[^@/:]+@)?([^@/:]+):([^?#]+)$/.exec(value);
        if (!match?.[1] || !match[2])
            return undefined;
        transport = "scp:";
        host = match[1].toLowerCase();
        pathname = `/${match[2]}`;
    }
    pathname = pathname.replace(/\/+$/, "");
    return host === "github.com"
        ? `${host}${pathname.replace(/\.git$/, "").toLowerCase()}`
        : `${transport}//${host}${pathname}`;
}
function verifiedGitOutput(cwd, args, runGit, verifyGit) {
    const output = runGit(cwd, args);
    if (output === undefined || verifyGit === runGit)
        return output;
    return verifyGit(cwd, args) === output ? output : undefined;
}
function parseNullGitConfigRecords(output) {
    const records = output.split("\0");
    if (records.pop() !== "" || records.some((record) => !record))
        return undefined;
    const parsed = [];
    for (const raw of records) {
        const separator = raw.indexOf("\n");
        if (separator <= 0)
            return undefined;
        parsed.push({ key: raw.slice(0, separator), value: raw.slice(separator + 1), raw });
    }
    return parsed;
}
function readConfiguredRemoteUrls(cwd, remote, runGit, verifyGit) {
    const escapedRemote = remote.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const output = verifiedGitOutput(cwd, ["config", "--null", "--get-regexp", `^remote\\.${escapedRemote}\\.(url|pushurl)$`], runGit, verifyGit);
    if (output === undefined)
        return undefined;
    const records = parseNullGitConfigRecords(output);
    if (!records?.length)
        return undefined;
    const fetch = records.filter(({ key }) => key.toLowerCase().endsWith(".url")).map(({ value }) => value);
    const push = records.filter(({ key }) => key.toLowerCase().endsWith(".pushurl")).map(({ value }) => value);
    return fetch.length > 0 && [...fetch, ...push].every((url) => normalizeRepositoryIdentity(url))
        ? { fetch, push }
        : null;
}
function readUrlRewriteRules(cwd, runGit) {
    const output = runGit(cwd, ["config", "--null", "--list"]);
    if (output === undefined)
        return undefined;
    const records = parseNullGitConfigRecords(output);
    if (!records)
        return undefined;
    const rules = [];
    for (const { key, value, raw } of records) {
        const normalizedKey = key.toLowerCase();
        if (!normalizedKey.startsWith("url."))
            continue;
        if (normalizedKey.endsWith(".insteadof"))
            rules.push({ kind: "fetch", prefix: value, raw });
        else if (normalizedKey.endsWith(".pushinsteadof"))
            rules.push({ kind: "push", prefix: value, raw });
    }
    return rules;
}
function selectedUrlRewriteRules(rules, kind, url) {
    const matches = rules.filter((rule) => rule.kind === kind && url.startsWith(rule.prefix));
    const longest = matches.reduce((length, rule) => Math.max(length, rule.prefix.length), 0);
    return matches.filter((rule) => rule.prefix.length === longest).map(({ raw }) => raw).sort();
}
function urlRewriteSignature(rules, urls) {
    const selected = [];
    for (const url of urls.fetch)
        selected.push("fetch", ...selectedUrlRewriteRules(rules, "fetch", url));
    if (urls.push.length > 0) {
        for (const url of urls.push)
            selected.push("push", ...selectedUrlRewriteRules(rules, "fetch", url));
    }
    else {
        for (const url of urls.fetch) {
            const pushRules = selectedUrlRewriteRules(rules, "push", url);
            selected.push("push", ...(pushRules.length > 0 ? pushRules : selectedUrlRewriteRules(rules, "fetch", url)));
        }
    }
    return selected.join("\0");
}
function urlRewriteConfigAgrees(cwd, urls, runGit, verifyGit) {
    if (verifyGit === runGit)
        return true;
    const primary = readUrlRewriteRules(cwd, runGit);
    const ordinary = readUrlRewriteRules(cwd, verifyGit);
    return primary !== undefined && ordinary !== undefined
        && urlRewriteSignature(primary, urls) === urlRewriteSignature(ordinary, urls);
}
function listRemotes(cwd, runGit, verifyGit) {
    const output = verifiedGitOutput(cwd, ["remote"], runGit, verifyGit);
    return output === undefined ? undefined : output.split("\n").filter(Boolean);
}
function resolveRemoteRepository(cwd, remote, runGit, verifyGit) {
    const configuredUrls = readConfiguredRemoteUrls(cwd, remote, runGit, verifyGit);
    if (configuredUrls === undefined)
        return undefined;
    if (configuredUrls === null)
        return null;
    if (!urlRewriteConfigAgrees(cwd, configuredUrls, runGit, verifyGit))
        return undefined;
    const fetchUrls = verifiedGitOutput(cwd, ["remote", "get-url", "--all", remote], runGit, verifyGit);
    const pushUrls = verifiedGitOutput(cwd, ["remote", "get-url", "--push", "--all", remote], runGit, verifyGit);
    if (fetchUrls === undefined || pushUrls === undefined)
        return undefined;
    const records = `${fetchUrls}\n${pushUrls}`.split("\n");
    if (records.some((record) => !record))
        return null;
    const urls = records.map(normalizeRepositoryIdentity);
    const repository = urls[0];
    return repository && urls.every((url) => url === repository) ? repository : null;
}
function findMatchingRemote(cwd, repo, runGit, verifyGit) {
    const target = normalizeRepositoryIdentity(repo);
    if (!target)
        return { kind: "unverified" };
    const remotes = listRemotes(cwd, runGit, verifyGit);
    if (!remotes)
        return { kind: "failed" };
    const matches = [];
    for (const remote of remotes) {
        const repository = resolveRemoteRepository(cwd, remote, runGit, verifyGit);
        if (repository === undefined)
            return { kind: "failed" };
        if (repository === target)
            matches.push(remote);
    }
    return matches.length === 1 ? { kind: "found", remote: matches[0] } : { kind: "unverified" };
}
function matchRefPattern(pattern, ref) {
    const wildcard = pattern.indexOf("*");
    if (wildcard === -1)
        return pattern === ref ? "" : undefined;
    if (pattern.indexOf("*", wildcard + 1) !== -1)
        return undefined;
    const prefix = pattern.slice(0, wildcard);
    const suffix = pattern.slice(wildcard + 1);
    if (ref.length < prefix.length + suffix.length || !ref.startsWith(prefix) || !ref.endsWith(suffix))
        return undefined;
    return ref.slice(prefix.length, ref.length - suffix.length);
}
function isValidFetchRefspecShape(refspec) {
    if (refspec.startsWith("^")) {
        const source = refspec.slice(1);
        return source.startsWith("refs/") && !source.includes(":") && (source.match(/\*/g)?.length ?? 0) <= 1;
    }
    const positive = refspec.startsWith("+") ? refspec.slice(1) : refspec;
    if (positive.startsWith("^"))
        return false;
    const separator = positive.indexOf(":");
    const source = separator === -1 ? positive : positive.slice(0, separator);
    const destination = separator === -1 ? undefined : positive.slice(separator + 1);
    if (!source ||
        (separator !== -1 && positive.indexOf(":", separator + 1) !== -1) ||
        (!source.startsWith("refs/") && !/^[0-9a-fA-F]{40}$/.test(source)) ||
        (destination !== undefined && destination !== "" && !destination.startsWith("refs/")))
        return false;
    const sourceWildcards = source.match(/\*/g)?.length ?? 0;
    const destinationWildcards = destination?.match(/\*/g)?.length ?? 0;
    return sourceWildcards <= 1 && sourceWildcards === destinationWildcards;
}
function parseFetchRefspecs(cwd, runGit, verifyGit) {
    const output = verifiedGitOutput(cwd, ["config", "--get-regexp", "^remote\\..*\\.fetch$"], runGit, verifyGit);
    if (output === undefined)
        return undefined;
    const remotes = new Map();
    for (const line of output.split("\n")) {
        const match = /^remote\.(.+)\.fetch\s+(.+)$/.exec(line);
        if (!match?.[1] || !match[2] || !isValidFetchRefspecShape(match[2]))
            return undefined;
        remotes.set(match[1], [...(remotes.get(match[1]) ?? []), match[2]]);
    }
    return remotes;
}
function sourceForDestination(refspec, destination) {
    const positive = refspec.startsWith("+") ? refspec.slice(1) : refspec;
    if (positive.startsWith("^"))
        return undefined;
    const separator = positive.indexOf(":");
    if (separator === -1)
        return undefined;
    const sourcePattern = positive.slice(0, separator);
    const matched = matchRefPattern(positive.slice(separator + 1), destination);
    if (matched === undefined)
        return undefined;
    return sourcePattern.includes("*") ? sourcePattern.replace("*", matched) : matched === "" ? sourcePattern : undefined;
}
function remoteTracksBranch(cwd, remote, branch, runGit, verifyGit) {
    const allRefspecs = parseFetchRefspecs(cwd, runGit, verifyGit);
    if (!allRefspecs)
        return false;
    const source = `refs/heads/${branch}`;
    const destination = `refs/remotes/${remote}/${branch}`;
    const selectedRefspecs = allRefspecs.get(remote) ?? [];
    if (selectedRefspecs.some((refspec) => refspec.startsWith("^") && matchRefPattern(refspec.slice(1), source) !== undefined))
        return false;
    const writers = new Set();
    for (const [writerRemote, refspecs] of allRefspecs) {
        for (const refspec of refspecs) {
            const writerSource = sourceForDestination(refspec, destination);
            if (writerSource)
                writers.add(`${writerRemote}\0${writerSource}`);
        }
    }
    return writers.size === 1 && writers.has(`${remote}\0${source}`);
}
function resolveRemoteTrackingRef(cwd, remote, branch, runGit, verifyGit) {
    if (!remoteTracksBranch(cwd, remote, branch, runGit, verifyGit))
        return { kind: "unverified" };
    const ref = `refs/remotes/${remote}/${branch}`;
    return runGit(cwd, ["for-each-ref", "--format=%(objecttype)%09%(symref)", ref]) === "commit\t"
        ? { kind: "found", ref }
        : { kind: "unverified" };
}
function hasHistoryOverrides(cwd, runGit) {
    const replacements = runGit(cwd, ["for-each-ref", "--format=%(refname)", "refs/replace"]);
    const graftsPath = runGit(cwd, ["rev-parse", "--git-path", "info/grafts"]);
    if (replacements === undefined || graftsPath === undefined)
        return undefined;
    return replacements.length > 0 || existsSync(resolve(cwd, graftsPath));
}
function resolveComparisonRef(cwd, target, runGit, verifyGit) {
    if (!target.repo) {
        const upstream = verifiedGitOutput(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], runGit, verifyGit);
        if (!upstream)
            return { kind: "unverified" };
        const remotes = listRemotes(cwd, runGit, verifyGit);
        if (!remotes)
            return { kind: "failed" };
        const matches = remotes.filter((remote) => upstream.startsWith(`${remote}/`));
        if (matches.length !== 1)
            return { kind: "unverified" };
        const remote = matches[0];
        const repository = resolveRemoteRepository(cwd, remote, runGit, verifyGit);
        if (repository === undefined)
            return { kind: "failed" };
        if (!repository)
            return { kind: "unverified" };
        return resolveRemoteTrackingRef(cwd, remote, upstream.slice(remote.length + 1), runGit, verifyGit);
    }
    const ref = normalizeCursorCloudStartingRef(target.branch);
    if (ref.kind !== "branch")
        return { kind: "unverified" };
    const remote = findMatchingRemote(cwd, target.repo, runGit, verifyGit);
    return remote.kind === "found"
        ? resolveRemoteTrackingRef(cwd, remote.remote, ref.value, runGit, verifyGit)
        : remote;
}
export function inspectCursorCloudLocalState(cwd, target = {}, runGit = runCursorCloudGit) {
    const verifyGit = runGit === runCursorCloudGit ? runCursorCloudGitWithUserConfig : runGit;
    const insideWorkTree = runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
    if (insideWorkTree !== "true") {
        const bareRepository = runGit(cwd, ["rev-parse", "--is-bare-repository"]);
        if (bareRepository === "true") {
            return { insideGitRepo: true, dirty: "unknown", comparison: "unknown", reasons: [{ code: "bare_repo" }] };
        }
        const gitAlive = runGit(cwd, ["--version"]) !== undefined;
        if (gitAlive && !hasPlausibleGitMetadata(cwd))
            return { insideGitRepo: false };
        return {
            insideGitRepo: "unknown",
            dirty: "unknown",
            comparison: "unknown",
            reasons: [{ code: "repository_detection_failed" }],
        };
    }
    const status = runGit(cwd, [
        ...(process.platform === "win32" ? [] : ["-c", "core.fileMode=true"]),
        "-c", "core.fsmonitor=false", "--no-optional-locks", "status", "--porcelain=v1", "--untracked-files=normal", "--ignore-submodules=none",
    ]);
    const indexFlags = runGit(cwd, ["ls-files", "-v", "--", ":/"]);
    const dirty = status === undefined ? "unknown" : status.length > 0;
    const reasons = [];
    if (status === undefined)
        reasons.push({ code: "status_failed" });
    if (indexFlags === undefined)
        reasons.push({ code: "index_failed" });
    else if (indexFlags.split("\n").some((line) => /^[a-zS] /.test(line)))
        reasons.push({ code: "hidden_index_state" });
    const historyOverrides = hasHistoryOverrides(cwd, runGit);
    if (historyOverrides === undefined)
        reasons.push({ code: "history_probe_failed" });
    else if (historyOverrides)
        reasons.push({ code: "history_overrides" });
    const hasHead = runGit(cwd, ["rev-parse", "--verify", "HEAD"]) !== undefined;
    if (!hasHead)
        reasons.push({ code: "head_unavailable" });
    const comparisonRef = resolveComparisonRef(cwd, target, runGit, verifyGit);
    if (comparisonRef.kind === "failed")
        reasons.push({ code: "target_probe_failed" });
    else if (comparisonRef.kind === "unverified")
        reasons.push({ code: "unverified_target" });
    const ahead = hasHead && comparisonRef.kind === "found" ? runGit(cwd, ["rev-list", "--count", `${comparisonRef.ref}..HEAD`]) : undefined;
    const aheadCount = ahead !== undefined && /^\d+$/.test(ahead) ? Number(ahead) : Number.NaN;
    if (hasHead && comparisonRef.kind === "found" && !Number.isFinite(aheadCount))
        reasons.push({ code: "comparison_failed" });
    const [firstReason, ...remainingReasons] = reasons;
    if (firstReason) {
        return {
            insideGitRepo: true,
            dirty,
            comparison: "unknown",
            reasons: [firstReason, ...remainingReasons],
        };
    }
    return { insideGitRepo: true, dirty: dirty, comparison: aheadCount > 0 ? "unpushed" : "contains_head" };
}
export const __testUtils = { sourceForDestination };
