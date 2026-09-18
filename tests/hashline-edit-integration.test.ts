/**
 * Integration coverage for the edit tool's span-freshness wiring.
 *
 * findStaleSpan has its own unit tests, but those cannot prove the guard is
 * actually CALLED by executeEditPipeline, nor that the snapshot is looked up
 * under the same canonical (realpath-resolved) key the pipeline writes it
 * under. Both were real defects during development: seeding the snapshot under
 * an unresolved /tmp path silently disabled the guard, because a missing
 * snapshot is a legitimate no-op.
 *
 * The drift case below is the one endpoint hashes cannot catch: only line 3
 * changes, so the 3-line context windows of lines 2 and 4 are intact and both
 * range endpoints still validate.
 */
import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerEditTool } from "../vendor/src/pi-hashline-edit/src/edit";
import { computeLineHash } from "../vendor/src/pi-hashline-edit/src/hashline/hash";
import { rememberReadSnapshot, resetReadSnapshot } from "../vendor/src/pi-hashline-edit/src/read-snapshot";
import { resolveMutationTargetPath } from "../vendor/src/pi-hashline-edit/src/fs-write";

function grabEditTool() {
	let tool: any;
	registerEditTool({ registerTool: (t: any) => { tool = t; } } as any);
	return tool;
}

const LINES = ["one", "two", "three", "four", "five"];
const TEXT = LINES.join("\n") + "\n";

function setup() {
	resetReadSnapshot();
	const dir = mkdtempSync(join(tmpdir(), "hl-e2e-"));
	const file = join(dir, "f.txt");
	writeFileSync(file, TEXT);
	return { dir, file, ctx: { cwd: dir } as any };
}

test("range replace succeeds when the span is fresh", async () => {
	const { file, ctx } = setup();
	rememberReadSnapshot(await resolveMutationTargetPath(file), TEXT);
	const tool = grabEditTool();
	await tool.execute("t1", {
		path: file,
		edits: [{ op: "replace", pos: `2#${computeLineHash(LINES, 1)}`, end: `4#${computeLineHash(LINES, 3)}`, lines: ["X"] }],
	}, undefined, undefined, ctx);
	expect(readFileSync(file, "utf8")).toBe("one\nX\nfive\n");
});

test("E_STALE_SPAN fires when only the span interior drifted", async () => {
	const { file, ctx } = setup();
	// Model saw TEXT; disk now differs in the MIDDLE only. Endpoint hashes of
	// lines 2 and 4 are unchanged because their 3-line windows are intact.
	const drifted = ["one", "two", "CHANGED", "four", "five"];
	writeFileSync(file, drifted.join("\n") + "\n");
	rememberReadSnapshot(await resolveMutationTargetPath(file), TEXT);
	const tool = grabEditTool();
	let err: any;
	try {
		await tool.execute("t2", {
			path: file,
			edits: [{ op: "replace", pos: `2#${computeLineHash(drifted, 1)}`, end: `4#${computeLineHash(drifted, 3)}`, lines: ["X"] }],
		}, undefined, undefined, ctx);
	} catch (e) { err = e; }
	expect(String(err?.message)).toContain("E_STALE_SPAN");
	// nothing written
	expect(readFileSync(file, "utf8")).toBe(drifted.join("\n") + "\n");
});

test("index.ts registers every tool, hook, and command without throwing", async () => {
	const mod = await import("../vendor/src/pi-hashline-edit/index");
	const tools: string[] = [];
	const commands: string[] = [];
	const events: string[] = [];
	mod.default({
		registerTool: (t: any) => tools.push(t.name),
		registerCommand: (n: string) => commands.push(n),
		on: (e: string) => events.push(e),
	} as any);
	// read/edit override the builtins; undo_last_change is new.
	expect(tools).toContain("read");
	expect(tools).toContain("edit");
	expect(tools).toContain("undo_last_change");
	expect(commands).toContain("hashline-config");
	// write-hook needs both halves: the echo guard and the auto-read.
	expect(events).toContain("tool_call");
	expect(events).toContain("tool_result");
});

test("undo_last_change restores the exact pre-edit bytes after a real edit", async () => {
	const { file, ctx } = setup();
	const canonical = await resolveMutationTargetPath(file);
	rememberReadSnapshot(canonical, TEXT);

	const editTool = grabEditTool();
	await editTool.execute("e1", {
		path: file,
		edits: [{ op: "replace", pos: `2#${computeLineHash(LINES, 1)}`, lines: ["TWO"] }],
	}, undefined, undefined, ctx);
	expect(readFileSync(file, "utf8")).toBe("one\nTWO\nthree\nfour\nfive\n");

	const { registerUndoTool } = await import("../vendor/src/pi-hashline-edit/src/undo-tool");
	let undoTool: any;
	registerUndoTool({ registerTool: (t: any) => { undoTool = t; } } as any);

	await undoTool.execute("u1", {}, undefined, undefined, ctx);
	expect(readFileSync(file, "utf8")).toBe(TEXT);

	// One shot: a second undo must refuse rather than silently no-op.
	let err: any;
	try {
		await undoTool.execute("u2", {}, undefined, undefined, ctx);
	} catch (e) { err = e; }
	expect(String(err?.message)).toContain("E_NO_UNDO");
});
