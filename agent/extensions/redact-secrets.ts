import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Scrub secrets from tool output and from the LLM context copy using
 * redactum (https://github.com/alexwhin/redactum). Pi still opens the file
 * locally; the model and the persisted tool result see placeholders instead.
 *
 * Secret categories only. Full PII (emails, IPs, phones) would mangle git
 * logs and source. This is not a sandbox.
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
		categories?: Record<string, boolean>;
	},
) => { redactedText: string; findings?: RedactumFinding[] } | string;

const SECRET_CATEGORIES: Record<string, boolean> = {
	EMAIL: false,
	PHONE: false,
	SSN: false,
	CREDIT_CARD: false,
	IP_ADDRESS: false,
	ADDRESS: false,
	MEDICAL: false,
	API_KEY: true,
	AWS_KEY: true,
	PRIVATE_KEY: true,
	DATABASE_CREDENTIALS: true,
	DEV_SECRET: true,
};

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

export function redactText(input: string): { text: string; hits: number } {
	if (!redactum) return { text: input, hits: 0 };
	const result = redactum(input, { categories: SECRET_CATEGORIES });
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

function redactAny(value: unknown, hit: { n: number }): unknown {
	if (typeof value === "string") {
		const out = redactText(value);
		hit.n += out.hits;
		return out.text;
	}
	if (Array.isArray(value)) return value.map((v) => redactAny(v, hit));
	if (value && typeof value === "object") {
		const src = value as Record<string, unknown>;
		const dst: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(src)) dst[k] = redactAny(v, hit);
		return dst;
	}
	return value;
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
		const hit = { n: 0 };
		const content = redactAny(event.content, hit);
		const details = event.details === undefined ? undefined : redactAny(event.details, hit);
		if (hit.n === 0) return;
		return {
			content,
			...(details === undefined ? {} : { details }),
		};
	});

	pi.on("context", async (event, ctx) => {
		const hit = { n: 0 };
		const messages = redactAny(event.messages, hit) as typeof event.messages;
		if (hit.n === 0) return;
		ctx.ui.setStatus("redact-secrets", `redacted ${hit.n}`);
		return { messages };
	});
}
