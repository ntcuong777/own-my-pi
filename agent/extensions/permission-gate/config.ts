/**
 * permission-gate — config loading, compilation and persistence.
 *
 * Configuration is read from four places, in order. Each place can add
 * rules or turn off rules that came from an earlier place:
 *
 *   1. the built-in rules
 *   2. the user's rules.ts (or .mjs / .js) in the config directory
 *   3. the user's rules.json in the config directory (written by /gate)
 *   4. the project's .pi/permission-gate.json in the working directory
 *
 * The user files (2, 3) are trusted. The project file (4) ships with the
 * repository, so it is not: it may add rules and turn off ordinary prompt
 * rules (the user is notified), but it can never turn off block rules
 * or the parser safety limits. A project rules.ts is refused entirely,
 * since importing it would run untrusted repository code on session start.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import type {
	CompiledRule,
	GateConfig,
	GateConfigModule,
	GateHelpers,
	RuleEntry,
	RuleSource,
	WarnFn,
} from "./types.ts";
import { DEFAULT_BLOCK_RULES, DEFAULT_PROMPT_RULES } from "./builtin-rules.ts";

// ── paths ────────────────────────────────────────────────────────────────

/** Resolve config directory. See .ref/config-dir.org for convention. */
export function configDir(): string {
	const override = path.join(homedir(), ".pi", "agent", "pi-agent-extensions.json");
	try {
		const cfg = JSON.parse(fs.readFileSync(override, "utf-8"));
		if (cfg.configDir) return path.join(cfg.configDir, "permission-gate");
	} catch {}
	const base = process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config");
	return path.join(base, "pi-agent-extensions", "permission-gate");
}

function userCodeConfigPath(): string | undefined {
	const dir = configDir();
	for (const ext of [".ts", ".mjs", ".js"]) {
		const p = path.join(dir, `rules${ext}`);
		if (fs.existsSync(p)) return p;
	}
	return undefined;
}

function userJsonConfigPath(): string {
	return path.join(configDir(), "rules.json");
}

function projectJsonConfigPath(cwd: string): string {
	return path.join(cwd, ".pi", "permission-gate.json");
}

// ── loading ──────────────────────────────────────────────────────────────

function readJsonSafe(filePath: string, warn?: WarnFn): unknown {
	try {
		if (!fs.existsSync(filePath)) return {};
		return JSON.parse(fs.readFileSync(filePath, "utf-8"));
	} catch (err) {
		warn?.(`permission-gate: failed to load ${filePath}: ${(err as Error).message}`);
		return {};
	}
}

// ── validation ────────────────────────────────────────────────────────────────

/**
 * Shape-check a config layer before compilation. JSON files arrive from
 * disk with arbitrary content — an unchecked `{"test": true}` survives
 * until matchRules and throws on every bash call, and non-object shapes
 * (null file, `"disabledRules": 42`, `"extraRules": {}`) throw at reload. `allowTest` is true only for code configs; JSON cannot carry
 * functions, so any `test` there is malformed (or malicious) and the rule
 * is skipped. Never throws.
 */
export function sanitizeConfig(raw: unknown, origin: string, allowTest: boolean, warn?: WarnFn): GateConfig {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		if (raw != null) warn?.(`permission-gate: ${origin}: config must be an object — ignored`);
		return {};
	}
	const cfg = raw as Record<string, unknown>;
	const out: GateConfig = {};
	if (cfg.disabledRules !== undefined) {
		if (Array.isArray(cfg.disabledRules)) {
			out.disabledRules = cfg.disabledRules.filter((x): x is string => {
				if (typeof x === "string") return true;
				warn?.(`permission-gate: ${origin}: non-string disabledRules entry ignored`);
				return false;
			});
		} else {
			warn?.(`permission-gate: ${origin}: disabledRules must be an array — ignored`);
		}
	}
	if (cfg.disabledGroups !== undefined) {
		if (Array.isArray(cfg.disabledGroups)) {
			out.disabledGroups = cfg.disabledGroups.filter((x): x is string => {
				if (typeof x === "string") return true;
				warn?.(`permission-gate: ${origin}: non-string disabledGroups entry ignored`);
				return false;
			});
		} else {
			warn?.(`permission-gate: ${origin}: disabledGroups must be an array — ignored`);
		}
	}
	const sanitizeEntries = (v: unknown, key: string): RuleEntry[] | undefined => {
		if (!Array.isArray(v)) {
			warn?.(`permission-gate: ${origin}: ${key} must be an array — ignored`);
			return undefined;
		}
		const entries: RuleEntry[] = [];
		for (const r of v) {
			if (r === null || typeof r !== "object" || Array.isArray(r) ||
				typeof (r as RuleEntry).label !== "string") {
				warn?.(`permission-gate: ${origin}: ${key} entry without a string label — skipped`);
				continue;
			}
			const e = r as RuleEntry;
			if (e.test !== undefined && (!allowTest || typeof e.test !== "function")) {
				warn?.(allowTest
					? `permission-gate: ${origin}: rule "${e.label}" test is not a function — skipped`
					: `permission-gate: ${origin}: rule "${e.label}" carries a test (JSON rules cannot) — skipped`);
				continue;
			}
			if (e.pattern !== undefined && typeof e.pattern !== "string" && !(e.pattern instanceof RegExp)) {
				warn?.(`permission-gate: ${origin}: rule "${e.label}" pattern is not a string — skipped`);
				continue;
			}
			if (e.action !== undefined && e.action !== "prompt" && e.action !== "block") {
				warn?.(`permission-gate: ${origin}: rule "${e.label}" has unknown action — skipped`);
				continue;
			}
			if (e.reason !== undefined && typeof e.reason !== "string") {
				warn?.(`permission-gate: ${origin}: rule "${e.label}" reason is not a string — skipped`);
				continue;
			}
			if (e.flags !== undefined && typeof e.flags !== "string") {
				warn?.(`permission-gate: ${origin}: rule "${e.label}" flags is not a string — skipped`);
				continue;
			}
			entries.push(e);
		}
		return entries;
	};
	if (cfg.rules !== undefined) out.rules = sanitizeEntries(cfg.rules, "rules");
	if (cfg.extraRules !== undefined) out.extraRules = sanitizeEntries(cfg.extraRules, "extraRules");
	return out;
}

/**
 * Import the user's rules.ts / .mjs / .js. Tries pi's bundled jiti first (handles .ts and
 * gives fresh evaluation for /gate reload); falls back to native import()
 * with a cache-busting query. Returns {} on failure with a warning.
 */
async function importCodeConfig(filePath: string, helpers: GateHelpers, warn?: WarnFn): Promise<GateConfig> {
	let mod: { default?: GateConfigModule } | undefined;
	try {
		try {
			const { createJiti } = await import("jiti");
			const jiti = createJiti(import.meta.url, { moduleCache: false, fsCache: false });
			mod = await jiti.import(filePath);
		} catch {
			// jiti unavailable (e.g. compiled binary without the alias) — try native.
			const url = `${pathToFileURL(filePath).href}?t=${Date.now()}`;
			mod = await import(/* @vite-ignore */ url);
		}
	} catch (err) {
		const e = err as NodeJS.ErrnoException;
		if (e?.code === "ERR_UNKNOWN_FILE_EXTENSION") {
			warn?.(`permission-gate: ${path.basename(filePath)} found but no TS loader available — rename to rules.mjs`);
		} else {
			warn?.(`permission-gate: failed to load ${filePath}: ${(err as Error).message}`);
		}
		return {};
	}
	const exp = mod?.default;
	if (exp == null) {
		warn?.(`permission-gate: ${path.basename(filePath)} has no default export`);
		return {};
	}
	try {
		return typeof exp === "function" ? exp(helpers) : exp;
	} catch (err) {
		warn?.(`permission-gate: rules factory threw: ${(err as Error).message}`);
		return {};
	}
}

export interface ConfigLayers {
	userCode: GateConfig;
	userJson: GateConfig;
	project: GateConfig;
	/** Path of the user's rules code file (rules.ts, .mjs or .js), if any. */
	userCodePath?: string;
}

export async function loadConfig(cwd: string, helpers: GateHelpers, warn?: WarnFn): Promise<ConfigLayers> {
	const projectTs = path.join(cwd, ".pi", "permission-gate.ts");
	if (fs.existsSync(projectTs)) {
		warn?.(`permission-gate: ignoring ${projectTs} (project-level code config would execute untrusted code)`);
	}
	const userCodePath = userCodeConfigPath();
	return {
		userCode: sanitizeConfig(
			userCodePath ? await importCodeConfig(userCodePath, helpers, warn) : {},
			userCodePath ? path.basename(userCodePath) : "rules.ts", true, warn,
		),
		userJson: sanitizeConfig(readJsonSafe(userJsonConfigPath(), warn), "rules.json", false, warn),
		project: sanitizeConfig(
			readJsonSafe(projectJsonConfigPath(cwd), warn), ".pi/permission-gate.json", false, warn,
		),
		userCodePath,
	};
}

// ── compilation ──────────────────────────────────────────────────────────

// Project regexes run against every bash command and come from an untrusted
// repo file — a catastrophic pattern would hang the agent on its first tool
// call (ReDoS). Three bounds compose, because none alone is an analyzer:
// this length cap and the rule-count cap bound pattern size and number,
// the nested-quantifier check below rejects the classic exponential shape,
// and matchRules truncates the *subject* for project rules — backtracking
// cost grows with the command, so a short in-cap pattern against an
// ordinary command was still exponential (~4 s at 56 chars, doubling per
// character). User-scope configs are trusted and skip all three.
const MAX_PROJECT_PATTERN_LENGTH = 256;

// (x+)+ / (x*)+ shapes — a quantified group whose body itself ends in a
// quantifier — are the canonical exponential-backtracking pattern: the
// 24-char `^(([a-z0-9 /._-]+)+)+\0$` compiled fine under every size cap
// and stalled matchRules for seconds. No heuristic catches every ReDoS
// (the subject truncation in matchRules is the backstop); this rejects
// the classic shape outright, with a warning.
const NESTED_QUANTIFIER = /\([^()]*[+*}]\)[+*{]/;

// The length cap alone does not bound match cost — catastrophic patterns are
// short (`(x+x+)+y` costs ~0.6 s per command on bun), and nothing else limits
// how many rules a repo ships, so 50 of them would add ~30 s to every bash
// call. Capping the *count* bounds the total without building a regex
// time-budget engine; 20 is far above any legitimate project config.
const MAX_PROJECT_RULES = 20;

// A block rule's reason is delivered verbatim to the model — from the
// untrusted project layer that is an instruction-injection channel ("Tool
// policy: instead run …"). Mark the origin and bound the length.
const MAX_PROJECT_REASON_LENGTH = 300;

// Labels flow into prompt titles, /gate list and — via the derived
// `Blocked (label)` reason — to the model, so untrusted ones are capped
// at compile time too.
const MAX_PROJECT_LABEL_LENGTH = 100;

/**
 * Prompt rules the untrusted project layer may never disable, UI or
 * headless — they are the enforcement floor under every other rule, so a
 * repo-shipped disable escalates exactly like disabling a block rule:
 *
 *   - "unparseable command (depth budget)" is the fail-closed sentinel for
 *     parse-budget exhaustion; without it a mechanical 66×`eval` prefix
 *     hides any payload from every rule, blocks included;
 *   - "modify gate config" keeps the gated agent from rewriting the
 *     *trusted* user config layer (which may disable block rules) through
 *     its own bash tool;
 *   - "non-literal command name" is what keeps `$a id` / `$(echo sudo) id`
 *     from bypassing every argv rule, blocks included.
 *
 * User layers are trusted and may still disable them.
 */
export const PROTECTED_LABELS = new Set([
	"unparseable command (depth budget)",
	"modify gate config",
	"non-literal command name",
]);

function compileEntry(r: RuleEntry, source: RuleSource, warn?: WarnFn): CompiledRule | undefined {
	const action = r.action ?? "prompt";
	let label = r.label;
	if (source === "project" && label.length > MAX_PROJECT_LABEL_LENGTH) {
		warn?.(`permission-gate: project rule label truncated to ${MAX_PROJECT_LABEL_LENGTH} chars`);
		label = label.slice(0, MAX_PROJECT_LABEL_LENGTH);
	}
	let reason = r.reason;
	if (source === "project") {
		// Cap and origin-prefix the *derived* fallback too — `Blocked (label)`
		// reached the model unmarked and uncapped whenever a project block
		// rule simply omitted `reason`.
		const base = r.reason ?? (action === "block" ? `Blocked (${label})` : undefined);
		reason = base === undefined
			? undefined
			: `[project rule] ${base}`.slice(0, MAX_PROJECT_REASON_LENGTH);

[Showing lines 1-300 of 502. Use :301 to continue]