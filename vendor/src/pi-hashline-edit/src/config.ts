/**
 * Hashline configuration — loads ~/.pi/agent/hashline.json once at module init.
 *
 * Schema: { "hashLength": 2 | 3 | 4, "grep": boolean, "replaceText": boolean, "boundaryDedup": "off" | "warn" | "on" | "strict" }
 * Defaults: hashLength=2, grep=false, replaceText=true, boundaryDedup="warn".
 * Any field that fails validation falls back to its default; loading errors
 * are collected as warnings, never thrown.
 */

import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

// ─── Types ───────────────────────────────────────────────────────────────

export type BoundaryDedupMode = "off" | "warn" | "on" | "strict";

export type HashlineConfig = {
	hashLength: 2 | 3 | 4;
	grep: boolean;
	replaceText: boolean;
	boundaryDedup: BoundaryDedupMode;
};

const BOUNDARY_DEDUP_MODES: readonly BoundaryDedupMode[] = [
	"off",
	"warn",
	"on",
	"strict",
];

function isBoundaryDedupMode(value: unknown): value is BoundaryDedupMode {
	return (
		typeof value === "string" &&
		(BOUNDARY_DEDUP_MODES as readonly string[]).includes(value)
	);
}

/**
 * Supported hash length range. Single source of truth for every site that
 * must agree on it: config validation above, the length-mismatch anchor
 * diagnostic, and the display-prefix rejection regexes (which match ALL
 * supported lengths, not just the session's — stale transcripts may carry
 * anchors from a different configuration).
 * Must stay in sync with the HashlineConfig["hashLength"] union.
 */
export const HASH_LENGTH_MIN = 2;
export const HASH_LENGTH_MAX = 4;

// ─── Pure parse function (exported for unit tests) ───────────────────────

/**
 * Parse and validate a raw JSON value into a HashlineConfig.
 * All invalid fields fall back to defaults; errors are collected as warnings.
 */
export function parseHashlineConfig(raw: unknown): {
	config: HashlineConfig;
	warnings: string[];
} {
	const warnings: string[] = [];
	let hashLength: 2 | 3 | 4 = 2;
	let grep = false;
	let replaceText = true;
	let boundaryDedup: BoundaryDedupMode = "warn";

	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		warnings.push(
			`hashline.json: expected an object at top level, got ${JSON.stringify(raw)}. Using defaults.`,
		);
		return { config: { hashLength, grep, replaceText, boundaryDedup }, warnings };
	}

	const obj = raw as Record<string, unknown>;

	// Validate hashLength
	if ("hashLength" in obj) {
		const hl = obj.hashLength;
		if (hl === 2 || hl === 3 || hl === 4) {
			hashLength = hl;
		} else {
			warnings.push(
				`hashline.json: "hashLength" must be 2, 3, or 4; got ${JSON.stringify(hl)}. Using default (2).`,
			);
		}
	}

	// Validate grep
	if ("grep" in obj) {
		const g = obj.grep;
		if (typeof g === "boolean") {
			grep = g;
		} else {
			warnings.push(
				`hashline.json: "grep" must be a boolean; got ${JSON.stringify(g)}. Using default (false).`,
			);
		}
	}

	// Validate replaceText
	if ("replaceText" in obj) {
		const rt = obj.replaceText;
		if (typeof rt === "boolean") {
			replaceText = rt;
		} else {
			warnings.push(
				`hashline.json: "replaceText" must be a boolean; got ${JSON.stringify(rt)}. Using default (true).`,
			);
		}
	}

	// Validate boundaryDedup
	if ("boundaryDedup" in obj) {
		const bd = obj.boundaryDedup;
		if (isBoundaryDedupMode(bd)) {
			boundaryDedup = bd;
		} else {
			warnings.push(
				`hashline.json: "boundaryDedup" must be one of ${BOUNDARY_DEDUP_MODES.join(", ")}; got ${JSON.stringify(bd)}. Using default (warn).`,
			);
		}
	}

	return { config: { hashLength, grep, replaceText, boundaryDedup }, warnings };
}

// ─── Module-level singleton ──────────────────────────────────────────────

let _hashLength: 2 | 3 | 4 = 2;
let _grep = false;
let _replaceText = true;
let _boundaryDedup: BoundaryDedupMode = "warn";
let _warnings: string[] = [];

export function hashlineConfigPath(): string {
	return join(getAgentDir(), "hashline.json");
}

function loadConfig(): void {
	_warnings = [];
	const configPath = hashlineConfigPath();
	let raw: unknown;
	try {
		const text = readFileSync(configPath, "utf8");
		raw = JSON.parse(text);
	} catch (err: unknown) {
		// File not found is the common path — no warning, just use defaults.
		if (
			typeof err === "object" &&
			err !== null &&
			(err as NodeJS.ErrnoException).code !== "ENOENT"
		) {
			_warnings = [
				`hashline.json: failed to load (${(err as Error).message}). Using defaults.`,
			];
		}
		return;
	}
	const { config, warnings } = parseHashlineConfig(raw);
	_hashLength = config.hashLength;
	_grep = config.grep;
	_replaceText = config.replaceText;
	_boundaryDedup = config.boundaryDedup;
	_warnings = warnings;
}

// Load once at module init.
loadConfig();

// ─── Public API ─────────────────────────────────────────────────────────

export function getHashLength(): number {
	return _hashLength;
}

export function getGrepEnabled(): boolean {
	return _grep;
}

export function getReplaceTextEnabled(): boolean {
	return _replaceText;
}

export function getBoundaryDedupMode(): BoundaryDedupMode {
	return _boundaryDedup;
}

/** Re-read hashline.json. Used by /hashline-config after a write. */
export function reloadConfig(): void {
	loadConfig();
}

export function currentHashlineConfig(): HashlineConfig {
	return {
		hashLength: _hashLength,
		grep: _grep,
		replaceText: _replaceText,
		boundaryDedup: _boundaryDedup,
	};
}

/** Persist config to hashline.json, then reload the singleton. */
export async function writeHashlineConfig(next: HashlineConfig): Promise<void> {
	await writeFile(
		hashlineConfigPath(),
		`${JSON.stringify(next, null, 2)}\n`,
		"utf8",
	);
	reloadConfig();
}

export function getConfigWarnings(): string[] {
	return _warnings;
}

/**
 * Return an example anchor hash string of the given length.
 * Defaults to the current configured length.
 * Source of truth: "MQQV".slice(0, len).
 */
export function exampleAnchor(len?: number): string {
	const n = len ?? _hashLength;
	return `5#${"MQQV".slice(0, n)}`;
}

// ─── Test helpers (not for production use) ──────────────────────────────

/** @internal */
export function __setHashLengthForTests(n: 2 | 3 | 4): void {
	_hashLength = n;
}

/** @internal */
export function __setGrepEnabledForTests(v: boolean): void {
	_grep = v;
}

/** @internal */
export function __setReplaceTextEnabledForTests(v: boolean): void {
	_replaceText = v;
}

/** @internal */
export function __setBoundaryDedupForTests(v: BoundaryDedupMode): void {
	_boundaryDedup = v;
}

/** @internal */
export function __resetConfigForTests(): void {
	_hashLength = 2;
	_grep = false;
	_replaceText = true;
	_boundaryDedup = "warn";
	_warnings = [];
}
