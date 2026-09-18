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

type RedactumFn = (
	text: string,
	options?: {
		replacement?: string;
		categories?: Record<string, boolean>;
	},
) => { redactedText: string; findings?: unknown[] } | string;

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

export function redactText(input: string): { text: string; hits: number } {
	if (!redactum) return { text: input, hits: 0 };
	const result = redactum(input, {
		replacement: "<redacted>",
		categories: SECRET_CATEGORIES,
	});
	const text = typeof result === "string" ? result : result.redactedText;
	if (typeof result === "object" && result && Array.isArray(result.findings)) {
		return { text, hits: result.findings.length };
	}
	return { text, hits: text === input ? 0 : 1 };
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
