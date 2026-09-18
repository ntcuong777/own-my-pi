/**
 * One-shot in-memory undo for hashline edits.
 *
 * Deliberately NOT persisted. The pro plugin keeps full pre/post file text in
 * a SQLite store under ~/.config, which becomes a durable copy of every secret
 * that ever passed through an edited file. This store dies with the process and
 * holds exactly one pre-edit snapshot per path.
 */
const undoByPath = new Map<string, string>();
let mostRecentPath: string | undefined;

export function rememberUndo(canonicalPath: string, beforeContent: string): void {
	undoByPath.set(canonicalPath, beforeContent);
	mostRecentPath = canonicalPath;
}

export function peekUndo(canonicalPath: string): string | undefined {
	return undoByPath.get(canonicalPath);
}

/** Return and consume the snapshot: undo is one-shot. */
export function takeUndo(canonicalPath: string): string | undefined {
	const content = undoByPath.get(canonicalPath);
	if (content === undefined) return undefined;
	undoByPath.delete(canonicalPath);
	if (mostRecentPath === canonicalPath) mostRecentPath = undefined;
	return content;
}

export function lastUndoPath(): string | undefined {
	return mostRecentPath !== undefined && undoByPath.has(mostRecentPath)
		? mostRecentPath
		: undefined;
}

export function clearUndo(canonicalPath?: string): void {
	if (canonicalPath === undefined) {
		undoByPath.clear();
		mostRecentPath = undefined;
		return;
	}
	undoByPath.delete(canonicalPath);
	if (mostRecentPath === canonicalPath) mostRecentPath = undefined;
}
