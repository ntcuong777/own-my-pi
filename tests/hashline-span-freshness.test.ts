import { describe, expect, test } from "bun:test";
import {
	assertSpansFresh,
	findStaleSpan,
} from "../vendor/src/pi-hashline-edit/src/span-freshness";
import type { HashlineEdit } from "../vendor/src/pi-hashline-edit/src/hashline/parse";

const rangeReplace = (start: number, end: number): HashlineEdit => ({
	op: "replace",
	pos: { line: start, hash: "MQ" },
	end: { line: end, hash: "VR" },
	lines: ["new"],
});

const singleReplace = (line: number): HashlineEdit => ({
	op: "replace",
	pos: { line, hash: "MQ" },
	lines: ["new"],
});

const FILE = "a\nb\nc\nd\ne\n";

describe("findStaleSpan", () => {
	test("returns undefined when the span matches what was shown", () => {
		expect(
			findStaleSpan({
				edits: [rangeReplace(2, 4)],
				liveLines: ["a", "b", "c", "d", "e"],
				snapshotLines: ["a", "b", "c", "d", "e"],
			}),
		).toBeUndefined();
	});

	test("catches interior drift that both endpoint hashes would miss", () => {
		expect(
			findStaleSpan({
				edits: [rangeReplace(2, 4)],
				liveLines: ["a", "b", "CHANGED", "d", "e"],
				snapshotLines: ["a", "b", "c", "d", "e"],
			}),
		).toEqual({ startLine: 2, endLine: 4, firstDivergentLine: 3 });
	});

	test("ignores drift outside the replaced range", () => {
		expect(
			findStaleSpan({
				edits: [rangeReplace(2, 3)],
				liveLines: ["a", "b", "c", "CHANGED", "e"],
				snapshotLines: ["a", "b", "c", "d", "e"],
			}),
		).toBeUndefined();
	});

	test("ignores single-line replaces, whose anchor already covers the line", () => {
		expect(
			findStaleSpan({
				edits: [singleReplace(3)],
				liveLines: ["a", "b", "CHANGED", "d", "e"],
				snapshotLines: ["a", "b", "c", "d", "e"],
			}),
		).toBeUndefined();
	});

	test("treats a truncated file as drift", () => {
		expect(
			findStaleSpan({
				edits: [rangeReplace(2, 4)],
				liveLines: ["a", "b"],
				snapshotLines: ["a", "b", "c", "d", "e"],
			}),
		).toEqual({ startLine: 2, endLine: 4, firstDivergentLine: 3 });
	});

	test("is a no-op without a snapshot, so the first edit of a session works", () => {
		expect(
			findStaleSpan({
				edits: [rangeReplace(2, 4)],
				liveLines: ["a", "b", "c"],
				snapshotLines: undefined,
			}),
		).toBeUndefined();
	});

	test("reports the first divergent line across several edits", () => {
		const stale = findStaleSpan({
			edits: [rangeReplace(1, 2), rangeReplace(4, 5)],
			liveLines: ["a", "b", "c", "d", "CHANGED"],
			snapshotLines: ["a", "b", "c", "d", "e"],
		});
		expect(stale).toEqual({ startLine: 4, endLine: 5, firstDivergentLine: 5 });
	});
});

describe("assertSpansFresh", () => {
	test("throws E_STALE_SPAN naming the range and the divergent line", () => {
		expect(() =>
			assertSpansFresh({
				path: "src/x.ts",
				edits: [rangeReplace(2, 4)],
				liveContent: "a\nb\nCHANGED\nd\ne\n",
				snapshotContent: FILE,
			}),
		).toThrow(/E_STALE_SPAN.*Line 3.*2\.\.4.*src\/x\.ts/s);
	});

	test("does not throw when the span is fresh", () => {
		expect(() =>
			assertSpansFresh({
				path: "src/x.ts",
				edits: [rangeReplace(2, 4)],
				liveContent: FILE,
				snapshotContent: FILE,
			}),
		).not.toThrow();
	});

	test("does not throw without a snapshot", () => {
		expect(() =>
			assertSpansFresh({
				path: "src/x.ts",
				edits: [rangeReplace(2, 4)],
				liveContent: FILE,
				snapshotContent: undefined,
			}),
		).not.toThrow();
	});

	test("handles a file with no trailing newline", () => {
		expect(() =>
			assertSpansFresh({
				path: "src/x.ts",
				edits: [rangeReplace(1, 2)],
				liveContent: "a\nb",
				snapshotContent: "a\nb",
			}),
		).not.toThrow();
	});
});
