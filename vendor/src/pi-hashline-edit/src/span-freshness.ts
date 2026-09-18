/**
 * Whole-span freshness for range replaces.
 *
 * Endpoint hashes cover lines `pos` and `end` (and, via context hashing, their
 * immediate neighbors). They do NOT cover the interior of a long span: an
 * external write that changes line 40 of a 10..60 replace leaves both endpoint
 * hashes intact, and the edit would silently overwrite content the model never
 * read.
 *
 * The comparison is disk-vs-snapshot, never disk-vs-rendered-output: the
 * snapshot store holds the unredacted bytes hashline itself read, so a
 * redaction extension rewriting the model's view cannot make a fresh span look
 * stale (or a stale span look fresh).
 */
import type { HashlineEdit } from "./hashline/parse";

function splitLines(content: string): string[] {
	const lines = content.split("\n");
	return content.endsWith("\n") ? lines.slice(0, -1) : lines;
}

export function findStaleSpan(params: {
	edits: HashlineEdit[];
	liveLines: readonly string[];
	snapshotLines: readonly string[] | undefined;
}): { startLine: number; endLine: number; firstDivergentLine: number } | undefined {
	const { edits, liveLines, snapshotLines } = params;
	if (!snapshotLines) return undefined;

	for (const edit of edits) {
		// Only range replaces have an unvalidated interior.
		if (edit.op !== "replace" || !edit.end) continue;
		const startLine = edit.pos.line;
		const endLine = edit.end.line;
		if (endLine < startLine) continue;

		for (let line = startLine; line <= endLine; line++) {
			const live = liveLines[line - 1];
			const shown = snapshotLines[line - 1];
			if (live === shown) continue;
			return { startLine, endLine, firstDivergentLine: line };
		}
	}
	return undefined;
}

export function assertSpansFresh(params: {
	path: string;
	edits: HashlineEdit[];
	liveContent: string;
	snapshotContent: string | undefined;
}): void {
	const { path, edits, liveContent, snapshotContent } = params;
	if (snapshotContent === undefined) return;

	const stale = findStaleSpan({
		edits,
		liveLines: splitLines(liveContent),
		snapshotLines: splitLines(snapshotContent),
	});
	if (!stale) return;

	throw new Error(
		`[E_STALE_SPAN] Line ${stale.firstDivergentLine} inside the replaced range ${stale.startLine}..${stale.endLine} of ${path} changed since it was last shown to you, even though both range endpoints still match. Nothing was written. Re-read ${path} and retry with current anchors.`,
	);
}
