import { createRequire } from "node:module";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "bun:test";
import {
	containsPlaceholder,
	lookupSecret,
	mintToken,
	resetRedactionRegistry,
	restorePlaceholders,
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
