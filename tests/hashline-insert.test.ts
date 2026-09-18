import { afterEach, describe, expect, test } from "bun:test";
import { resolveEditAnchors } from "../vendor/src/pi-hashline-edit/src/hashline/parse";
import { __resetConfigForTests } from "../vendor/src/pi-hashline-edit/src/config";

afterEach(() => {
	__resetConfigForTests();
});

describe("resolveEditAnchors insert op", () => {
	test('direction "after" desugars to append at the same anchor', () => {
		const resolved = resolveEditAnchors([
			{
				op: "insert",
				pos: "12#MQ",
				direction: "after",
				lines: ["const y = 2;"],
			},
		]);
		expect(resolved).toEqual([
			{
				op: "append",
				pos: { line: 12, hash: "MQ" },
				lines: ["const y = 2;"],
			},
		]);
	});

	test('direction "before" desugars to prepend', () => {
		const resolved = resolveEditAnchors([
			{
				op: "insert",
				pos: "12#MQ",
				direction: "before",
				lines: ["const y = 2;"],
			},
		]);
		expect(resolved).toEqual([
			{
				op: "prepend",
				pos: { line: 12, hash: "MQ" },
				lines: ["const y = 2;"],
			},
		]);
	});

	test("strips a pasted display prefix and emits one warning", () => {
		const warnings: string[] = [];
		const resolved = resolveEditAnchors(
			[
				{
					op: "insert",
					pos: "12#MQ",
					direction: "after",
					lines: ["12#MQ:const y = 2;"],
				},
			],
			warnings,
		);
		expect(resolved).toEqual([
			{
				op: "append",
				pos: { line: 12, hash: "MQ" },
				lines: ["const y = 2;"],
			},
		]);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("Stripped a rendered display prefix from 1");
	});

	test("missing pos throws E_BAD_OP mentioning pos", () => {
		expect(() =>
			resolveEditAnchors([
				{ op: "insert", direction: "after", lines: ["x"] },
			]),
		).toThrow(/E_BAD_OP.*pos/);
	});

	test("invalid direction throws E_BAD_OP mentioning direction", () => {
		expect(() =>
			resolveEditAnchors([
				{ op: "insert", pos: "12#MQ", direction: "below", lines: ["x"] },
			]),
		).toThrow(/E_BAD_OP.*direction/);
	});

	test("end on insert throws E_BAD_OP", () => {
		expect(() =>
			resolveEditAnchors([
				{
					op: "insert",
					pos: "12#MQ",
					direction: "after",
					end: "14#VR",
					lines: ["x"],
				},
			]),
		).toThrow(/E_BAD_OP/);
	});

	test("direction on replace throws instead of being ignored", () => {
		expect(() =>
			resolveEditAnchors([
				{
					op: "replace",
					pos: "12#MQ",
					direction: "after",
					lines: ["x"],
				},
			]),
		).toThrow(/E_BAD_OP.*direction/);
	});

	test("unknown op still throws E_BAD_OP", () => {
		expect(() =>
			resolveEditAnchors([{ op: "delete", pos: "12#MQ", lines: ["x"] }]),
		).toThrow(/E_BAD_OP/);
	});
});
