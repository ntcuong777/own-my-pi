import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerGrepTool } from "../vendor/src/pi-hashline-edit/src/grep";
interface GrepResult {
	content: Array<{ type: string; text: string }>;
	details: {
		matches: number;
		files: number;
		truncated: boolean;
		hasMore?: boolean;
		cursor?: string;
	};
}

interface GrepTool {
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
		signal: AbortSignal | undefined,
		onUpdate: undefined,
		ctx: { cwd: string },
	): Promise<GrepResult>;
}

function grabGrepTool(): GrepTool {
	let tool: GrepTool | undefined;
	registerGrepTool({
		registerTool: (registeredTool: GrepTool) => { tool = registeredTool; },
	} as unknown as Parameters<typeof registerGrepTool>[0]);
	if (!tool) throw new Error("grep tool was not registered");
	return tool;
}

function makeDir() {
	return mkdtempSync(join(tmpdir(), "hashline-grep-"));
}

async function execute(tool: GrepTool, params: Record<string, unknown>, cwd: string) {
	return tool.execute("grep-test", params, undefined, undefined, { cwd });
}

function textOf(result: GrepResult): string {
	return result.content[0].text;
}

function cleanup(dir: string) {
	rmSync(dir, { recursive: true, force: true });
}

test("paginates in stable path-then-line order and carries an opaque cursor", async () => {
	const dir = makeDir();
	try {
		writeFileSync(join(dir, "a.ts"), "hit one\nplain\nhit three\n");
		writeFileSync(join(dir, "b.ts"), "hit two\nplain\nhit four\n");
		const tool = grabGrepTool();

		const first = await execute(tool, { pattern: "hit", limit: 2 }, dir);
		expect(first.details.matches).toBe(2);
		expect(first.details.hasMore).toBe(true);
		expect(first.details.truncated).toBe(true);
		expect(first.details.cursor).toMatch(/^hlg1\./);
		expect(textOf(first)).toContain("More remain");
		expect(textOf(first)).toContain(first.details.cursor);

		const second = await execute(tool, { pattern: "hit", limit: 2, cursor: first.details.cursor }, dir);
		expect(second.details.hasMore).toBe(false);
		expect(second.details.truncated).toBe(false);
		expect(second.details.cursor).toBeUndefined();
		expect(textOf(second)).not.toContain("truncated at");
		expect(second.details.matches).toBe(2);
		expect(`${textOf(first)}\n${textOf(second)}`).toContain("a.ts:");
		expect(`${textOf(first)}\n${textOf(second)}`).toContain("b.ts:");
		const firstPaths = [...textOf(first).matchAll(/(?:^|\n)([^\n:]+\.ts):/g)].map((m) => m[1]);
		const secondPaths = [...textOf(second).matchAll(/(?:^|\n)([^\n:]+\.ts):/g)].map((m) => m[1]);
		expect(firstPaths.concat(secondPaths)).toEqual(["a.ts", "b.ts"]);
		expect(textOf(first).indexOf("1#")).toBeLessThan(textOf(first).indexOf("3#"));
		expect(textOf(second).indexOf("1#")).toBeLessThan(textOf(second).indexOf("3#"));
	} finally {
		cleanup(dir);
	}
});

test("rejects a cursor when pattern or path differs", async () => {
	const dir = makeDir();
	try {
		writeFileSync(join(dir, "a.ts"), "hit\nhit\n");
		const tool = grabGrepTool();
		const first = await execute(tool, { pattern: "hit", limit: 1 }, dir);
		await expect(execute(tool, { pattern: "other", limit: 1, cursor: first.details.cursor }, dir)).rejects.toMatchObject({ message: expect.stringMatching(/\[E_GREP_CURSOR\].*different search/) });
		await expect(execute(tool, { pattern: "hit", path: join(dir, "a.ts"), limit: 1, cursor: first.details.cursor }, dir)).rejects.toMatchObject({ message: expect.stringMatching(/\[E_GREP_CURSOR\].*different search/) });
	} finally {
		cleanup(dir);
	}
});

test("rejects a malformed cursor", async () => {
	const dir = makeDir();
	try {
		writeFileSync(join(dir, "a.ts"), "hit\n");
		const tool = grabGrepTool();
		await expect(execute(tool, { pattern: "hit", cursor: "garbage" }, dir)).rejects.toMatchObject({ message: expect.stringMatching(/\[E_GREP_CURSOR\].*invalid cursor/) });
	} finally {
		cleanup(dir);
	}
});

test("accepts glob as a string and as a string array", async () => {
	const dir = makeDir();
	try {
		writeFileSync(join(dir, "hit.ts"), "needle\n");
		writeFileSync(join(dir, "hit.md"), "needle\n");
		const tool = grabGrepTool();
		for (const glob of ["*.ts", ["*.ts"]]) {
			const result = await execute(tool, { pattern: "needle", glob }, dir);
			expect(result.details.matches).toBe(1);
			expect(textOf(result)).toContain("hit.ts:");
			expect(textOf(result)).not.toContain("hit.md:");
		}
	} finally {
		cleanup(dir);
	}
});

test("excludes hidden files by default and includes them with hidden true", async () => {
	const dir = makeDir();
	try {
		const hidden = join(dir, ".secret");
		mkdirSync(hidden);
		writeFileSync(join(hidden, "file.ts"), "needle\n");
		const tool = grabGrepTool();
		const absent = await execute(tool, { pattern: "needle" }, dir);
		expect(absent.details.matches).toBe(0);
		const present = await execute(tool, { pattern: "needle", hidden: true }, dir);
		expect(present.details.matches).toBe(1);
		expect(textOf(present)).toContain(".secret/file.ts:");
	} finally {
		cleanup(dir);
	}
});

test("filters by ripgrep type", async () => {
	const dir = makeDir();
	try {
		writeFileSync(join(dir, "hit.ts"), "needle\n");
		writeFileSync(join(dir, "hit.md"), "needle\n");
		const result = await execute(grabGrepTool(), { pattern: "needle", type: "ts" }, dir);
		expect(result.details.matches).toBe(1);
		expect(textOf(result)).toContain("hit.ts:");
		expect(textOf(result)).not.toContain("hit.md:");
	} finally {
		cleanup(dir);
	}
});

test("includes gitignored files only with noIgnore", async () => {
	const dir = makeDir();
	try {
		mkdirSync(join(dir, ".git"));
		writeFileSync(join(dir, ".gitignore"), "ignored/\n");
		const ignored = join(dir, "ignored");
		mkdirSync(ignored);
		writeFileSync(join(ignored, "file.ts"), "needle\n");
		const tool = grabGrepTool();
		const absent = await execute(tool, { pattern: "needle" }, dir);
		expect(absent.details.matches).toBe(0);
		const present = await execute(tool, { pattern: "needle", noIgnore: true }, dir);
		expect(present.details.matches).toBe(1);
		expect(textOf(present)).toContain("ignored/file.ts:");
	} finally {
		cleanup(dir);
	}
});

test("skips a vanished file when continuing pagination", async () => {
	const dir = makeDir();
	try {
		const firstFile = join(dir, "a.ts");
		const vanished = join(dir, "b.ts");
		writeFileSync(firstFile, "needle\n");
		writeFileSync(vanished, "needle\n");
		const tool = grabGrepTool();
		const first = await execute(tool, { pattern: "needle", limit: 1 }, dir);
		rmSync(vanished);
		const second = await execute(tool, { pattern: "needle", limit: 1, cursor: first.details.cursor }, dir);
		expect(second).toBeDefined();
		expect(second.details.matches).toBe(0);
		expect(textOf(second)).toBe("No matches found for needle.");
	} finally {
		cleanup(dir);
	}
});

test("keeps the existing zero-match summary", async () => {
	const dir = makeDir();
	try {
		writeFileSync(join(dir, "a.ts"), "other\n");
		const result = await execute(grabGrepTool(), { pattern: "needle" }, dir);
		expect(textOf(result)).toBe("No matches found for needle.");
		expect(result.details.matches).toBe(0);
	} finally {
		cleanup(dir);
	}
});

test("includes symmetric context lines with hashline anchors", async () => {
	const dir = makeDir();
	try {
		writeFileSync(join(dir, "a.ts"), "before\nneedle\nafter\n");
		const result = await execute(grabGrepTool(), { pattern: "needle", context: 1 }, dir);
		const output = textOf(result);
		expect(output).toContain("before");
		expect(output).toContain("needle");
		expect(output).toContain("after");
		expect(output).toMatch(/\d+#\w+/);
	} finally {
		cleanup(dir);
	}
});
