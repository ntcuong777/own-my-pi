import { afterEach, describe, expect, test } from "bun:test";
import {
	resolveEditAnchors,
	stripDisplayPrefix,
	stripDisplayPrefixes,
} from "../vendor/src/pi-hashline-edit/src/hashline/parse";
import { __resetConfigForTests } from "../vendor/src/pi-hashline-edit/src/config";

afterEach(() => {
	__resetConfigForTests();
});

describe("stripDisplayPrefix", () => {
	test("removes a LINE#HASH read prefix and keeps indentation", () => {
		expect(stripDisplayPrefix("12#MQ:\tconst x = 1;")).toBe("\tconst x = 1;");
	});

	test("removes a diff-plus prefix", () => {
		expect(stripDisplayPrefix("+12#MQ:const x = 1;")).toBe("const x = 1;");
	});

	test("leaves literal content alone", () => {
		expect(stripDisplayPrefix("const url = `http://x`;")).toBe(
			"const url = `http://x`;",
		);
	});

	test("leaves a plain colon line alone", () => {
		expect(stripDisplayPrefix("default: return null;")).toBe(
			"default: return null;",
		);
	});

	test("strips only one pass, so nested rows stay detectable", () => {
		expect(stripDisplayPrefix("12#MQ:13#VR:const x = 1;")).toBe(
			"13#VR:const x = 1;",
		);
	});
});

describe("stripDisplayPrefixes", () => {
	test("counts only the lines it changed", () => {
		const out = stripDisplayPrefixes(["12#MQ:a", "b", "+13#VR:c"]);
		expect(out.lines).toEqual(["a", "b", "c"]);
		expect(out.stripped).toBe(2);
	});

	test("preserves explicit blank lines", () => {
		const out = stripDisplayPrefixes(["", "12#MQ:a", ""]);
		expect(out.lines).toEqual(["", "a", ""]);
		expect(out.stripped).toBe(1);
	});
});

describe("resolveEditAnchors prefix handling", () => {
	test("applies the edit and warns instead of rejecting a copy slip", () => {
		const warnings: string[] = [];
		const resolved = resolveEditAnchors(
			[{ op: "replace", pos: "12#MQ", lines: ["12#MQ:const x = 1;"] }],
			warnings,
		);
		expect(resolved[0]).toMatchObject({ op: "replace", lines: ["const x = 1;"] });
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("Stripped a rendered display prefix from 1");
	});

	test("emits one warning for a whole call, not one per line", () => {
		const warnings: string[] = [];
		resolveEditAnchors(
			[
				{ op: "replace", pos: "12#MQ", lines: ["12#MQ:a", "13#VR:b"] },
				{ op: "append", pos: "20#KT", lines: ["+21#TP:c"] },
			],
			warnings,
		);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("3 replacement line(s)");
	});

	test("stays silent when the payload is already literal", () => {
		const warnings: string[] = [];
		resolveEditAnchors(
			[{ op: "replace", pos: "12#MQ", lines: ["const x = 1;"] }],
			warnings,
		);
		expect(warnings).toEqual([]);
	});

	test("fails closed on nested rendered rows", () => {
		expect(() =>
			resolveEditAnchors([
				{ op: "replace", pos: "12#MQ", lines: ["12#MQ:13#VR:const x = 1;"] },
			]),
		).toThrow(/E_INVALID_PATCH/);
	});
});
