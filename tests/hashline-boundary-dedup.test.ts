import { afterEach, describe, expect, test } from "bun:test";
import { dedupBoundaryLines } from "../vendor/src/pi-hashline-edit/src/hashline/apply";
import {
	__resetConfigForTests,
	__setBoundaryDedupForTests,
} from "../vendor/src/pi-hashline-edit/src/config";

afterEach(() => {
	__resetConfigForTests();
});

const call = (
	lines: string[],
	mode: "off" | "warn" | "on" | "strict",
	prevLine?: string,
	nextLine?: string,
) => dedupBoundaryLines({ lines, prevLine, nextLine, mode });

describe("dedupBoundaryLines", () => {
	test("drops a trailing line that repeats the next surviving line", () => {
		const out = call(["body();", "}"], "on", "function f() {", "}");
		expect(out.lines).toEqual(["body();"]);
		expect(out.strippedLast).toBe(true);
		expect(out.strippedFirst).toBe(false);
	});

	test("drops a leading line that repeats the preceding surviving line", () => {
		const out = call(["function f() {", "body();"], "on", "function f() {", "}");
		expect(out.lines).toEqual(["body();"]);
		expect(out.strippedFirst).toBe(true);
	});

	test("drops both ends when both duplicate", () => {
		const out = call(
			["function f() {", "body();", "}"],
			"on",
			"function f() {",
			"}",
		);
		expect(out.lines).toEqual(["body();"]);
		expect(out.strippedFirst).toBe(true);
		expect(out.strippedLast).toBe(true);
	});

	test("ignores indentation differences when comparing", () => {
		const out = call(["body();", "    }"], "on", undefined, "}");
		expect(out.lines).toEqual(["body();"]);
	});

	test("never strips a single-line replacement into a deletion", () => {
		const out = call(["}"], "on", undefined, "}");
		expect(out.lines).toEqual(["}"]);
		expect(out.strippedLast).toBe(false);
	});

	test("never strips an explicit empty payload", () => {
		const out = call([], "on", "a", "b");
		expect(out.lines).toEqual([]);
	});

	test("does not treat insignificant lines as duplicates", () => {
		const out = call(["body();", ""], "on", undefined, "");
		expect(out.lines).toEqual(["body();", ""]);
	});

	test("mode off and mode warn leave the payload untouched", () => {
		for (const mode of ["off", "warn"] as const) {
			const out = call(["body();", "}"], mode, undefined, "}");
			expect(out.lines).toEqual(["body();", "}"]);
			expect(out.strippedLast).toBe(false);
		}
	});

	test("strict reports the same detection as on, so the caller can reject", () => {
		const out = call(["body();", "}"], "strict", undefined, "}");
		expect(out.strippedLast).toBe(true);
	});
});

describe("config wiring", () => {
	test("the test setter drives the mode the apply engine reads", () => {
		__setBoundaryDedupForTests("strict");
		// Imported lazily so the setter above is observed.
		const { getBoundaryDedupMode } = require("../vendor/src/pi-hashline-edit/src/config");
		expect(getBoundaryDedupMode()).toBe("strict");
	});
});
