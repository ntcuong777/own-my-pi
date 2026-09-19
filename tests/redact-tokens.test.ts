import { createRequire } from "node:module";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "bun:test";
import {
	containsPlaceholder,
	lookupSecret,
	mintToken,
	redactContext,
	redactText,
	resetRedactionRegistry,
	restorePlaceholders,
	shouldRedactToolResult,
} from "../agent/extensions/redact-secrets";

beforeEach(() => {
	resetRedactionRegistry();
});

describe("mintToken", () => {
	test("two different secrets never share a token", () => {
		const a = mintToken("API_KEY", "AAAA");
		const b = mintToken("API_KEY", "BBBB");
		expect(a).not.toBe(b);
	});

	test("the same secret reuses its token", () => {
		expect(mintToken("API_KEY", "AAAA")).toBe(mintToken("API_KEY", "AAAA"));
	});

	test("the category drives the token prefix", () => {
		expect(mintToken("AWS_KEY", "AKIA1")).toMatch(/^<redacted:aws\d+>$/);
		expect(mintToken("PRIVATE_KEY", "pem1")).toMatch(/^<redacted:pk\d+>$/);
		expect(mintToken("DATABASE_CREDENTIALS", "pg1")).toMatch(/^<redacted:db\d+>$/);
	});

	test("an unknown category still yields a usable token", () => {
		expect(mintToken("SOMETHING_NEW", "x")).toMatch(/^<redacted:sec\d+>$/);
	});

	test("counters are per prefix", () => {
		expect(mintToken("API_KEY", "a1")).toBe("<redacted:ak1>");
		expect(mintToken("AWS_KEY", "a2")).toBe("<redacted:aws1>");
		expect(mintToken("API_KEY", "a3")).toBe("<redacted:ak2>");
	});

	test("resetRedactionRegistry drops the mapping", () => {
		const token = mintToken("API_KEY", "AAAA");
		resetRedactionRegistry();
		expect(lookupSecret(token)).toBeUndefined();
	});
});

describe("containsPlaceholder", () => {
	test("detects a token anywhere in the line", () => {
		expect(containsPlaceholder('key = "<redacted:ak1>"')).toBe(true);
	});

	test("is stateless across repeated calls despite the global regex", () => {
		const line = "a <redacted:ak1> b";
		expect(containsPlaceholder(line)).toBe(true);
		expect(containsPlaceholder(line)).toBe(true);
	});

	test("ignores ordinary text", () => {
		expect(containsPlaceholder("redacted, sort of")).toBe(false);
	});
});

describe("restorePlaceholders", () => {
	test("restores the exact secret bytes in nested payloads", () => {
		const token = mintToken("API_KEY", "sk-live-9");
		const out = restorePlaceholders({
			path: "a.ts",
			edits: [{ op: "replace", lines: [`key = "${token}"`] }],
		});
		expect(out.restored).toBe(1);
		expect(out.unresolved).toEqual([]);
		expect(out.value).toEqual({
			path: "a.ts",
			edits: [{ op: "replace", lines: ['key = "sk-live-9"'] }],
		});
	});

	test("maps two tokens back to their own secrets", () => {
		const one = mintToken("API_KEY", "AAAA");
		const two = mintToken("API_KEY", "BBBB");
		const out = restorePlaceholders([`x=${one}`, `y=${two}`]);
		expect(out.value).toEqual(["x=AAAA", "y=BBBB"]);
		expect(out.restored).toBe(2);
	});

	test("restores several tokens in one string", () => {
		const one = mintToken("API_KEY", "AAAA");
		const two = mintToken("AWS_KEY", "BBBB");
		const out = restorePlaceholders(`${one}:${two}`);
		expect(out.value).toBe("AAAA:BBBB");
		expect(out.restored).toBe(2);
	});

	test("reports an unknown token instead of writing it to disk", () => {
		const out = restorePlaceholders({ lines: ["k = <redacted:ak7>"] });
		expect(out.restored).toBe(0);
		expect(out.unresolved).toEqual(["<redacted:ak7>"]);
	});

	test("leaves payloads without placeholders untouched", () => {
		const input = { path: "a.ts", lines: ["const x = 1;"] };
		const out = restorePlaceholders(input);
		expect(out.value).toEqual(input);
		expect(out.restored).toBe(0);
	});

	test("preserves non-string scalars", () => {
		const out = restorePlaceholders({ n: 1, ok: true, nil: null });
		expect(out.value).toEqual({ n: 1, ok: true, nil: null });
	});
});

test("redactum resolves from vendor/", () => {
	const req = createRequire(join(import.meta.dir, "../vendor/package.json"));
	const mod = req("redactum") as { redactum?: unknown } | ((...args: unknown[]) => unknown);
	const fn = typeof mod === "function" ? mod : mod?.redactum;
	expect(typeof fn).toBe("function");
});

describe("redactText", () => {
	test("uses redactum defaults for PII as well as secrets", () => {
		const email = "jane.doe@hospital.org";
		const ssn = "123-45-6789";
		const out = redactText(`Contact ${email} SSN ${ssn}`);
		expect(out.hits).toBeGreaterThanOrEqual(2);
		expect(out.text).not.toContain(email);
		expect(out.text).not.toContain(ssn);
		expect(out.text).toMatch(/<redacted:email\d+>/);
		expect(out.text).toMatch(/<redacted:ssn\d+>/);
	});

	test("redacts a medical record number", () => {
		const out = redactText("MRN: 1234567");
		expect(out.hits).toBeGreaterThanOrEqual(1);
		expect(out.text).not.toContain("MRN: 1234567");
		expect(out.text).toMatch(/<redacted:med\d+>/);
	});

	test("still redacts a named Stripe live key", () => {
		// Mock key for testing redactor
		const key = "sk_live_4eC32HwLxjWDaritT2zdp7dc";
		const out = redactText(`token=${key}`);
		expect(out.hits).toBe(1);
		expect(out.text).not.toContain(key);
		expect(out.text).toMatch(/<redacted:ak\d+>/);
	});
});

describe("shouldRedactToolResult", () => {
	test("skips Cursor skill activation", () => {
		expect(
			shouldRedactToolResult({
				toolName: "cursor_activate_skill",
				input: { name: "using-superpowers" },
			}),
		).toBe(false);
	});

	test("skips a SKILL.md read even though read is a file tool", () => {
		expect(
			shouldRedactToolResult({
				toolName: "read",
				input: { path: "/home/ntcuong777/.pi/agent/skills/using-superpowers/SKILL.md" },
			}),
		).toBe(false);
	});

	test("redacts a local patient file read", () => {
		expect(
			shouldRedactToolResult({
				toolName: "read",
				input: { path: "/var/data/patients/chart.txt" },
			}),
		).toBe(true);
	});

	test("does not redact MCP or web tools", () => {
		expect(shouldRedactToolResult({ toolName: "web_fetch", input: { url: "https://example.com" } })).toBe(
			false,
		);
	});
});

describe("redactContext", () => {
	test("does not rewrite thinkingSignature even if the blob looks secret-like", () => {
		// AWS_SECRET_KEY is a 40-char base64 run. Codex encrypted_content is
		// the same shape, so redactText would hit it; the context hook must
		// still pass the signature through or Codex replay fails.
		const enc = `gAAAAAB${"A".repeat(40)}-${"b".repeat(40)}_${"C".repeat(40)}`;
		const signature = JSON.stringify({
			id: "rs_test",
			type: "reasoning",
			encrypted_content: enc,
		});
		const messages = [
			{
				role: "assistant",
				content: [
					{
						type: "thinking",
						thinking: "plan",
						thinkingSignature: signature,
					},
				],
			},
		];
		const hit = { n: 0 };
		const out = redactContext(messages, hit);
		expect(hit.n).toBe(0);
		expect(out).toEqual(messages);
		const block = (out as typeof messages)[0].content[0];
		expect(block.thinkingSignature).toBe(signature);
	});
});
