import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Scrub secrets and PII from local file/shell tool output using redactum's
 * built-in default policy set (https://github.com/alexwhin/redactum).
 * No custom `policies` / `categories` override: that is the library config.
 *
 * Pi still opens the file locally; the model and the persisted tool result
 * see placeholders instead. Skills (`cursor_activate_skill`, SKILL.md) are
 * not redacted — they are instructions, not machine data. Disk is never
 * rewritten. This is a regex technical control, not a HIPAA/BAA determination.
 */

type RedactumFinding = {
	category?: string;
	value?: string;
	match?: string;
	text?: string;
};

type RedactumFn = (
	text: string,
	options?: {
		replacement?: string;
		policies?: readonly string[];
	},
) => { redactedText: string; findings?: RedactumFinding[] } | string;

/** Local inspection tools whose results are copies of machine files or dumps. */
export const FILE_TOOLS = new Set([
	"read",
	"grep",
	"find",
	"ls",
	"bash",
	"powershell",
	"edit",
	"write",
]);

const CONTEXT_SKIP_KEYS = new Set([
	"thinkingSignature",
	"textSignature",
	"encrypted_content",
	"responseId",
	"signature",
]);

function vendorPackageJson(): string {
	const here = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		join(homedir(), ".pi/agent/vendor/package.json"),
		join(here, "../../vendor/package.json"),
		join(here, "../vendor/package.json"),
	];
	for (const path of candidates) {
		if (existsSync(path)) return path;
	}
	return candidates[0];
}

function loadRedactum(): RedactumFn | undefined {
	try {
		const req = createRequire(vendorPackageJson());
		const mod = req("redactum") as { redactum?: RedactumFn } | RedactumFn;
		if (typeof mod === "function") return mod;
		if (mod && typeof mod.redactum === "function") return mod.redactum;
	} catch (error) {
		console.warn(
			`[redact-secrets] redactum not loadable (${error instanceof Error ? error.message : String(error)})`,
		);
	}
	return undefined;
}

const redactum = loadRedactum();

const CATEGORY_ABBREV: Record<string, string> = {
	API_KEY: "ak",
	AWS_KEY: "aws",
	PRIVATE_KEY: "pk",
	DATABASE_CREDENTIALS: "db",
	DEV_SECRET: "ds",
	EMAIL: "email",
	PHONE: "ph",
	SSN: "ssn",
	IP_ADDRESS: "ip",
	ADDRESS: "addr",
	GOVERNMENT_ID: "gov",
	TAX_IDENTIFIER: "tax",
	INSURANCE: "ins",
	FINANCIAL: "fin",
	MEDICAL: "med",
	DIGITAL_IDENTITY: "did",
	GEOGRAPHIC: "geo",
	EMPLOYEE_ID: "emp",
	VEHICLE: "veh",
	DEV_IDENTIFIER: "devid",
	CLOUD_CREDENTIALS: "cloud",
	CI_CD_SECRETS: "cicd",
	PACKAGE_REGISTRY: "pkg",
	MONITORING_SECRETS: "mon",
	AUTH_SECRETS: "auth",
	MESSAGING_SECRETS: "msg",
	WEBHOOK_URLS: "wh",
	ENCRYPTION_KEYS: "enc",
	CONTAINER_REGISTRY: "cr",
	INFRASTRUCTURE_SECRETS: "infra",
};

export const PLACEHOLDER_RE = /<redacted:([a-z]+)(\d+)>/g;

const tokenToSecret = new Map<string, string>();
const secretToToken = new Map<string, string>();
const counters = new Map<string, number>();

export function resetRedactionRegistry(): void {
	tokenToSecret.clear();
	secretToToken.clear();
	counters.clear();
}

function abbrev(category: string): string {
	return CATEGORY_ABBREV[category] ?? "sec";
}

/**
 * Mint (or reuse) a unique placeholder for one secret.
 *
 * Uniqueness is the point: a shared "<redacted>" destroys the distinction
 * between two different keys, which is exactly how an anchored edit can be
 * aimed at the wrong occurrence.
 */
export function mintToken(category: string, secret: string): string {
	const existing = secretToToken.get(secret);
	if (existing) return existing;
	const prefix = abbrev(category);
	const next = (counters.get(prefix) ?? 0) + 1;
	counters.set(prefix, next);
	const token = `<redacted:${prefix}${next}>`;
	secretToToken.set(secret, token);
	tokenToSecret.set(token, secret);
	return token;
}

export function lookupSecret(token: string): string | undefined {
	return tokenToSecret.get(token);
}

export function containsPlaceholder(value: string): boolean {
	PLACEHOLDER_RE.lastIndex = 0;
	return PLACEHOLDER_RE.test(value);
}

function posixPath(value: string): string {
	return value.replace(/\\/g, "/");
}

/** Skill catalogs and SKILL.md trees — instructions, not machine PHI. */
export function isSkillPath(path: unknown): boolean {
	if (typeof path !== "string" || path.length === 0) return false;
	const n = posixPath(path);
	if (/(^|\/)SKILL\.md$/i.test(n)) return true;
	return /(^|\/)(\.agents|\.claude|\.codex)\/skills\//.test(n) || /(^|\/)\.pi\/agent\/skills\//.test(n);
}

export function isSkillTool(toolName: string): boolean {
	return toolName === "cursor_activate_skill" || /skill/i.test(toolName);
}

function toolPath(input: Record<string, unknown> | undefined): unknown {
	if (!input) return undefined;
	return input.path ?? input.file_path ?? input.target_directory ?? input.filePath;
}

/** Redact copies of local files/dumps. Never skills, never remote/MCP tools. */
export function shouldRedactToolResult(event: {
	toolName: string;
	input?: Record<string, unknown>;
}): boolean {
	if (isSkillTool(event.toolName)) return false;
	if (!FILE_TOOLS.has(event.toolName)) return false;
	if (isSkillPath(toolPath(event.input))) return false;
	return true;
}

export function redactText(input: string): { text: string; hits: number } {
	if (!redactum) return { text: input, hits: 0 };
	// Library defaults: every built-in secret + PII policy. Do not pass a
	// `categories` map (ignored) or a custom `policies` whitelist.
	const result = redactum(input);
	if (typeof result === "string") {
		// No findings metadata: fall back to the opaque single-token form.
		return { text: result, hits: result === input ? 0 : 1 };
	}

	const findings = result.findings ?? [];
	const values = new Map<string, string>();
	for (const finding of findings) {
		const secret = finding.value ?? finding.match ?? finding.text;
		if (typeof secret !== "string" || secret.length === 0) continue;
		values.set(secret, finding.category ?? "DEV_SECRET");
	}
	if (values.size === 0) {
		return { text: input, hits: 0 };
	}

	let text = input;
	let hits = 0;
	for (const secret of [...values.keys()].sort((a, b) => b.length - a.length)) {
		const token = mintToken(values.get(secret)!, secret);
		if (!text.includes(secret)) continue;
		text = text.split(secret).join(token);
		hits += 1;
	}
	return { text, hits };
}

/**
 * Swap placeholders back to the real secret before a tool writes to disk.
 *
 * Hashline matches disk bytes, so the file itself was never redacted; only the
 * model's view was. Without this, a replacement payload quoting the redacted
 * line would overwrite a live secret with "<redacted:ak1>".
 */
export function restorePlaceholders(value: unknown): {
	value: unknown;
	restored: number;
	unresolved: string[];
} {
	let restored = 0;
	const unresolved: string[] = [];

	const walk = (node: unknown): unknown => {
		if (typeof node === "string") {
			if (!containsPlaceholder(node)) return node;
			return node.replace(PLACEHOLDER_RE, (match) => {
				const secret = lookupSecret(match);
				if (secret === undefined) {
					unresolved.push(match);
					return match;
				}
				restored += 1;
				return secret;
			});
		}
		if (Array.isArray(node)) return node.map(walk);
		if (node && typeof node === "object") {
			const out: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
				out[k] = walk(v);
			}
			return out;
		}
		return node;
	};

	return { value: walk(value), restored, unresolved };
}

function redactAny(value: unknown, hit: { n: number }, skipKeys?: ReadonlySet<string>): unknown {
	if (typeof value === "string") {
		const out = redactText(value);
		hit.n += out.hits;
		return out.text;
	}
	if (Array.isArray(value)) return value.map((v) => redactAny(v, hit, skipKeys));
	if (value && typeof value === "object") {
		const src = value as Record<string, unknown>;
		const dst: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(src)) {
			dst[k] = skipKeys?.has(k) ? v : redactAny(v, hit, skipKeys);
		}
		return dst;
	}
	return value;
}

/** LLM context copy: redact text, but never provider-private reasoning blobs. */
export function redactContext(value: unknown, hit: { n: number }): unknown {
	return redactAny(value, hit, CONTEXT_SKIP_KEYS);
}

export default function (pi: ExtensionAPI) {
	if (!redactum) {
		console.warn("[redact-secrets] disabled: install redactum in vendor/");
		return;
	}

	const MUTATING_TOOLS = new Set(["edit", "write", "insert", "replace"]);

	pi.on("session_start", async () => {
		resetRedactionRegistry();
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!MUTATING_TOOLS.has(event.toolName)) return;
		const input = event.input as Record<string, unknown> | undefined;
		if (!input) return;

		const out = restorePlaceholders(input);
		if (out.restored > 0) {
			for (const [k, v] of Object.entries(out.value as Record<string, unknown>)) {
				input[k] = v;
			}
			ctx.ui.setStatus("redact-secrets", `restored ${out.restored}`);
		}
		if (out.unresolved.length > 0) {
			return {
				block: true,
				reason: `[E_REDACT_PLACEHOLDER] This ${event.toolName} payload contains redaction placeholders this session cannot resolve (${out.unresolved.join(", ")}). Writing them would replace a live secret with a placeholder. Re-read the file and send the literal content, or edit a range that excludes the secret.`,
			};
		}
		return;
	});

	pi.on("tool_result", async (event) => {
		if (!shouldRedactToolResult(event)) return;
		const hit = { n: 0 };
		const content = redactAny(event.content, hit);
		const details = event.details === undefined ? undefined : redactAny(event.details, hit);
		if (hit.n === 0) return;
		return {
			content,
			...(details === undefined ? {} : { details }),
		};
	});
}
