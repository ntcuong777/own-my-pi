import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { writeFileAtomically, resolveMutationTargetPath } from "./fs-write";
import { resolveToCwd } from "./path-utils";
import { rememberReadSnapshot } from "./read-snapshot";
import { normalizeToLF, stripBom } from "./edit-diff";
import { lastUndoPath, takeUndo } from "./undo";

export function registerUndoTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "undo_last_change",
		label: "Undo",
		description:
			"Revert the most recent hashline edit to a file, restoring the exact pre-edit bytes. One shot per edit, in memory only: it does not survive a pi restart and cannot undo a write or a bash change.",
		promptSnippet:
			"Revert the most recent hashline edit to a file (one shot, in-memory)",
		parameters: Type.Object(
			{
				path: Type.Optional(
					Type.String({
						description:
							"File to revert. Omit to revert the most recently edited file.",
					}),
				),
			},
			{ additionalProperties: false },
		),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const requested = (params as { path?: string }).path;
			const canonicalPath =
				requested === undefined
					? lastUndoPath()
					: await resolveMutationTargetPath(resolveToCwd(requested, ctx.cwd));

			if (canonicalPath === undefined) {
				throw new Error(
					"[E_NO_UNDO] No hashline edit is available to undo in this process. Undo is in-memory and one-shot: it is consumed by the first undo and cleared on restart.",
				);
			}

			const before = takeUndo(canonicalPath);
			if (before === undefined) {
				throw new Error(
					`[E_NO_UNDO] No undo snapshot for ${requested ?? canonicalPath}. Only the most recent hashline edit per file is revertible, and it is consumed by the first undo.`,
				);
			}

			await writeFileAtomically(canonicalPath, before, { alreadyResolved: true });
			rememberReadSnapshot(canonicalPath, normalizeToLF(stripBom(before).text));

			return {
				content: [
					{
						type: "text",
						text: `Reverted the last hashline edit to ${canonicalPath}. Anchors from before that edit are valid again; anchors from the edit response are now stale.`,
					},
				],
				details: {},
			};
		},
	});
}
