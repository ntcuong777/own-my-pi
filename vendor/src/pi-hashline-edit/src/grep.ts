import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";
import { spawn, spawnSync } from "child_process";
import { createInterface } from "readline";
import { normalizeToLF, stripBom } from "./edit-diff";
import { resolveMutationTargetPath } from "./fs-write";
import { loadFileKindAndText } from "./file-kind";
import { formatHashlineRegion } from "./hashline";
import { resolveToCwd } from "./path-utils";
import { loadPrompt } from "./prompt-loader";
import { rememberReadSnapshot } from "./read-snapshot";
import { throwIfAborted } from "./runtime";

const GREP_DESC = loadPrompt(new URL("../prompts/grep.md", import.meta.url)).trim();

const GREP_PROMPT_SNIPPET = loadPrompt(
	new URL("../prompts/grep-snippet.md", import.meta.url),
).trim();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const STDERR_MAX_BYTES = 64 * 1024;

// Exported so tests can inspect or stub the binary name without vi.mock("child_process").
export const RG_BIN = "rg";

/** Detect whether ripgrep is available on PATH. Only called at registration time. */
function isRgAvailable(): boolean {
	try {
		const result = spawnSync(RG_BIN, ["--version"], { encoding: "utf-8" });
		return result.error === undefined && result.status === 0;
	} catch {
		return false;
	}
}

/** rg --json match event. */
interface RgMatchEvent {
	type: "match";
	data: {
		path: { text: string };
		line_number: number;
	};
}

interface RgEvent {
	type: string;
	data: unknown;
}

/** Inclusive range [start, end] of 1-based line numbers. */
interface LineRange {
	start: number;
	end: number;
}

/** Merge a new range into an existing sorted, non-overlapping list. */
function mergeRange(ranges: LineRange[], range: LineRange): void {
	let merged = range;
	const remaining: LineRange[] = [];
	for (const r of ranges) {
		if (r.end < merged.start - 1 || r.start > merged.end + 1) {
			remaining.push(r);
		} else {
			merged = {
				start: Math.min(merged.start, r.start),
				end: Math.max(merged.end, r.end),
			};
		}
	}
	remaining.push(merged);
	remaining.sort((a, b) => a.start - b.start);
	ranges.splice(0, ranges.length, ...remaining);
}

interface RgSearchResult {
	matchesByFile: Map<string, number[]>;
	matches: number;
	hasMore: boolean;
	lastMatch: { file: string; line: number } | undefined;
}

interface CursorPayload {
	v: 1;
	q: string;
	after: { file: string; line: number };
}

function addMatch(
	matchesByFile: Map<string, number[]>,
	filePath: string,
	lineNum: number,
): void {
	if (!matchesByFile.has(filePath)) {
		matchesByFile.set(filePath, []);
	}
	matchesByFile.get(filePath)!.push(lineNum);
}

function parseMatchLine(line: string): { filePath: string; lineNum: number } | null {
	if (!line.trim()) return null;
	let event: RgEvent;
	try {
		event = JSON.parse(line) as RgEvent;
	} catch {
		return null;
	}
	if (event.type !== "match") return null;

	const matchEvent = event as RgMatchEvent;
	return {
		filePath: matchEvent.data.path.text,
		lineNum: matchEvent.data.line_number,
	};
}

function appendLimitedStderr(current: string, chunk: string): string {
	const combined = current + chunk;
	if (Buffer.byteLength(combined, "utf8") <= STDERR_MAX_BYTES) {
		return combined;
	}
	return Buffer.from(combined, "utf8")
		.subarray(0, STDERR_MAX_BYTES)
		.toString("utf8");
}

/**
 * Run rg asynchronously, returning at most `limit` match events plus one
 * extra event to determine whether another page exists.
 */
function runRg(
	args: string[],
	limit: number,
	after: { file: string; line: number } | undefined,
	signal: AbortSignal | undefined,
): Promise<RgSearchResult> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("Aborted"));
			return;
		}

		const child = spawn(RG_BIN, args);
		const rl = createInterface({ input: child.stdout });
		const matchesByFile = new Map<string, number[]>();
		let totalMatched = 0;
		let hasMore = false;
		let lastMatch: { file: string; line: number } | undefined;
		let stoppedByLimit = false;
		let settled = false;
		let stderr = "";

		const cleanup = () => signal?.removeEventListener("abort", onAbort);
		const settleResolve = () => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve({ matchesByFile, matches: totalMatched, hasMore, lastMatch });
		};
		const settleReject = (error: Error) => {
			if (settled) return;
			settled = true;
			cleanup();
			rl.close();
			reject(error);
		};
		const stopForLimit = () => {
			if (stoppedByLimit) return;
			hasMore = true;
			stoppedByLimit = true;
			cleanup();
			rl.close();
			child.kill();
		};

		child.stdout.setEncoding("utf-8");
		child.stderr.setEncoding("utf-8");
		rl.on("line", (line: string) => {
			if (settled || stoppedByLimit) return;
			const match = parseMatchLine(line);
			if (!match) return;
			if (
				after &&
				(match.filePath < after.file ||
					(match.filePath === after.file && match.lineNum <= after.line))
			) {
				return;
			}
			if (totalMatched >= limit) {
				stopForLimit();
				return;
			}
			addMatch(matchesByFile, match.filePath, match.lineNum);
			totalMatched++;
			lastMatch = { file: match.filePath, line: match.lineNum };
		});
		child.stderr.on("data", (chunk: string) => {
			stderr = appendLimitedStderr(stderr, chunk);
		});
		const onAbort = () => {
			child.kill();
			settleReject(new Error("Aborted"));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		child.on("error", (err: Error) => {
			if (!stoppedByLimit) settleReject(new Error(`ripgrep spawn error: ${err.message}`));
		});
		child.on("close", (code: number | null) => {
			if (settled) return;
			if (stoppedByLimit) {
				settleResolve();
				return;
			}
			if (signal?.aborted) {
				settleReject(new Error("Aborted"));
				return;
			}
			if (code === null) {
				settleReject(new Error("ripgrep process terminated unexpectedly"));
				return;
			}
			if (code === 2) {
				settleReject(new Error(`ripgrep error: ${stderr.trim() || "unknown error"}`));
				return;
			}
			settleResolve();
		});
	});
}

function normalizeGlobs(glob: string | string[] | undefined): string[] {
	return [...new Set((Array.isArray(glob) ? glob : glob ? [glob] : []).filter(Boolean))].sort();
}

function encodeCursor(payload: CursorPayload): string {
	return `hlg1.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
}

function decodeCursor(cursor: string): CursorPayload {
	try {
		if (!cursor.startsWith("hlg1.")) throw new Error();
		const payload = JSON.parse(Buffer.from(cursor.slice(5), "base64url").toString("utf8")) as CursorPayload;
		if (
			payload.v !== 1 ||
			typeof payload.q !== "string" ||
			!payload.after ||
			typeof payload.after.file !== "string" ||
			!Number.isInteger(payload.after.line) ||
			payload.after.line < 1
		) {
			throw new Error();
		}
		return payload;
	} catch {
		throw new Error("[E_GREP_CURSOR] invalid cursor. Omit cursor and start over.");
	}
}

export function registerGrepTool(pi: ExtensionAPI): void {
	if (!isRgAvailable()) {
		return;
	}

	pi.registerTool({
		name: "grep",
		label: "Grep",
		description: GREP_DESC,
		promptSnippet: GREP_PROMPT_SNIPPET,
		parameters: Type.Object({
			pattern: Type.String({
				description: "Search pattern (regex unless literal: true)",
			}),
			path: Type.Optional(
				Type.String({
					description: "File or directory to search (defaults to cwd)",
				}),
			),
			glob: Type.Optional(
				Type.Union([
					Type.String({ description: 'Filename glob filter, e.g. "**/*.ts"' }),
					Type.Array(Type.String()),
				]),
			),
			type: Type.Optional(Type.String({ description: "File type filter" })),
			hidden: Type.Optional(Type.Boolean({ description: "Search hidden files" })),
			noIgnore: Type.Optional(Type.Boolean({ description: "Do not respect ignore files" })),
			cursor: Type.Optional(Type.String({ description: "Opaque pagination cursor" })),
			ignoreCase: Type.Optional(
				Type.Boolean({
					description: "Case-insensitive matching",
				}),
			),
			literal: Type.Optional(
				Type.Boolean({
					description: "Treat pattern as a literal string, not a regex",
				}),
			),
			context: Type.Optional(
				Type.Integer({
					minimum: 0,
					maximum: 5,
					description: "Number of context lines to show around each match (0–5, default 0)",
				}),
			),
			limit: Type.Optional(
				Type.Integer({
					minimum: 1,
					maximum: MAX_LIMIT,
					description: `Maximum matched lines to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT})`,
				}),
			),
		}),

		renderCall(args) {
			const text = new Text("", 0, 0);
			const label = args.path
				? `grep ${args.pattern} ${args.path}`
				: `grep ${args.pattern}`;
			text.setText(label);
			return text;
		},
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			throwIfAborted(signal);
			const searchPath = params.path
				? resolveToCwd(params.path, ctx.cwd)
				: ctx.cwd;
			const globs = normalizeGlobs(params.glob);
			const fingerprint = JSON.stringify({
				pattern: params.pattern,
				searchPath,
				glob: globs,
				type: params.type ?? "",
				hidden: params.hidden ?? false,
				noIgnore: params.noIgnore ?? false,
				ignoreCase: params.ignoreCase ?? false,
				literal: params.literal ?? false,
			});
			let after: { file: string; line: number } | undefined;
			if (params.cursor !== undefined) {
				const payload = decodeCursor(params.cursor);
				if (payload.q !== fingerprint) {
					throw new Error("[E_GREP_CURSOR] cursor is for a different search. Omit cursor and start over.");
				}
				after = payload.after;
			}

			const limit = params.limit ?? DEFAULT_LIMIT;
			const contextLines = params.context ?? 0;
			const rgArgs: string[] = ["--json", "--sort", "path"];
			if (params.hidden) rgArgs.push("--hidden");
			if (params.noIgnore) rgArgs.push("--no-ignore");
			if (params.type) rgArgs.push("--type", params.type);
			if (params.ignoreCase) rgArgs.push("--ignore-case");
			if (params.literal) rgArgs.push("--fixed-strings");
			for (const glob of globs) rgArgs.push("--glob", glob);
			rgArgs.push("--", params.pattern, searchPath);

			const { matchesByFile, matches: totalMatched, hasMore, lastMatch } = await runRg(
				rgArgs,
				limit,
				after,
				signal,
			);
			throwIfAborted(signal);

			if (totalMatched === 0) {
				return {
					content: [
						{
							type: "text",
							text: `No matches found for ${params.pattern}.`,
						},
					],
					details: {
						matches: 0,
						files: 0,
						truncated: false,
						hasMore: false,
					},
				};
			}

			throwIfAborted(signal);

			const outputParts: string[] = [];
			let fileCount = 0;

			for (const [filePath, matchLines] of matchesByFile) {
				throwIfAborted(signal);

				// Load file to compute context-correct hashes
				let fileLines: string[];
				try {
					const loaded = await loadFileKindAndText(filePath);
					if (
						loaded.kind === "binary" ||
						loaded.kind === "image" ||
						loaded.kind === "directory"
					) {
						continue;
					}
					const normalized = normalizeToLF(stripBom(loaded.text).text);
					fileLines = normalized.split("\n");
					// Strip the trailing empty element from a terminal newline
					if (fileLines.length > 0 && fileLines[fileLines.length - 1] === "") {
						fileLines = fileLines.slice(0, -1);
					}

					// Record snapshot so that edit's stale-anchor recovery and
					// duplicate-edit guard work identically whether anchors came from
					// read or grep. Uses the same canonical path convention as read.ts.
					const canonicalWritePath = await resolveMutationTargetPath(filePath);
					rememberReadSnapshot(canonicalWritePath, normalized);
				} catch {
					continue;
				}

				const totalFileLines = fileLines.length;

				// Guard against a race where the file was truncated between rg reading
				// it and our loadFileKindAndText call. Out-of-bounds line numbers would
				// make formatHashlineRegion push empty strings; filter them out first.
				const validMatchLines = matchLines.filter((n) => n <= totalFileLines);
				if (validMatchLines.length === 0) continue;

				// Build merged context ranges for this file
				const ranges: LineRange[] = [];
				for (const lineNum of validMatchLines) {
					const start = Math.max(1, lineNum - contextLines);
					const end = Math.min(totalFileLines, lineNum + contextLines);
					mergeRange(ranges, { start, end });
				}

				fileCount++;

				// Relative path for display
				const displayPath = filePath.startsWith(ctx.cwd + "/")
					? filePath.slice(ctx.cwd.length + 1)
					: filePath;

				outputParts.push(`${displayPath}:`);

				let prevRangeEnd = -1;
				for (const range of ranges) {
					if (prevRangeEnd !== -1) {
						outputParts.push("    ...");
					}
					outputParts.push(formatHashlineRegion(fileLines, range.start, range.end));
					prevRangeEnd = range.end;
				}

				outputParts.push("---");
			}

			const nextCursor = hasMore && lastMatch
				? encodeCursor({ v: 1, q: fingerprint, after: lastMatch })
				: undefined;
			const summary = `${totalMatched} match${totalMatched !== 1 ? "es" : ""} in ${fileCount} file${fileCount !== 1 ? "s" : ""}.${hasMore ? ` More remain — retry with the same arguments plus cursor: ${nextCursor}` : ""}`;
			outputParts.push(summary);

			return {
				content: [
					{
						type: "text",
						text: outputParts.join("\n"),
					},
				],
				details: {
					matches: totalMatched,
					files: fileCount,
					truncated: hasMore,
					hasMore,
					...(nextCursor ? { cursor: nextCursor } : {}),
				},
			};
		},
	});
}
