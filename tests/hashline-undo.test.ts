import { afterEach, describe, expect, test } from "bun:test";
import {
	clearUndo,
	lastUndoPath,
	peekUndo,
	rememberUndo,
	takeUndo,
} from "../vendor/src/pi-hashline-edit/src/undo";

afterEach(() => {
	clearUndo();
});

describe("undo store", () => {
	test("returns the exact pre-edit bytes", () => {
		rememberUndo("/tmp/a.ts", "before\r\n");
		expect(peekUndo("/tmp/a.ts")).toBe("before\r\n");
	});

	test("is one-shot: the second take finds nothing", () => {
		rememberUndo("/tmp/a.ts", "before");
		expect(takeUndo("/tmp/a.ts")).toBe("before");
		expect(takeUndo("/tmp/a.ts")).toBeUndefined();
	});

	test("keeps only the latest snapshot per path", () => {
		rememberUndo("/tmp/a.ts", "v1");
		rememberUndo("/tmp/a.ts", "v2");
		expect(takeUndo("/tmp/a.ts")).toBe("v2");
	});

	test("tracks separate snapshots for separate paths", () => {
		rememberUndo("/tmp/a.ts", "a");
		rememberUndo("/tmp/b.ts", "b");
		expect(takeUndo("/tmp/a.ts")).toBe("a");
		expect(takeUndo("/tmp/b.ts")).toBe("b");
	});

	test("lastUndoPath names the most recently edited file", () => {
		rememberUndo("/tmp/a.ts", "a");
		rememberUndo("/tmp/b.ts", "b");
		expect(lastUndoPath()).toBe("/tmp/b.ts");
	});

	test("lastUndoPath goes undefined once that snapshot is consumed", () => {
		rememberUndo("/tmp/a.ts", "a");
		takeUndo("/tmp/a.ts");
		expect(lastUndoPath()).toBeUndefined();
	});

	test("an unknown path yields no snapshot", () => {
		expect(takeUndo("/tmp/missing.ts")).toBeUndefined();
	});

	test("clearUndo with a path leaves other paths intact", () => {
		rememberUndo("/tmp/a.ts", "a");
		rememberUndo("/tmp/b.ts", "b");
		clearUndo("/tmp/a.ts");
		expect(peekUndo("/tmp/a.ts")).toBeUndefined();
		expect(peekUndo("/tmp/b.ts")).toBe("b");
	});
});
