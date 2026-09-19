/*
 * Mid-prompt skill summon.
 *
 * Pi's editor only auto-opens the slash popup at the start of the prompt, and
 * CombinedAutocompleteProvider treats a later slash as arguments to the first
 * command. This extension wraps autocomplete so a later token lists skills, and
 * patches Editor.insertCharacter so typing that slash opens the popup.
 *
 * Pi ignores triggerCharacters for slash, so the editor patch is required for
 * the list to appear on slash itself, not only after the next letter.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Editor } from "@earendil-works/pi-tui";
import { patchEditorSlashTrigger } from "./editor-patch";
import { wrapSkillSummonProvider } from "./provider";

export default function skillSummon(pi: ExtensionAPI): void {
	patchEditorSlashTrigger(Editor);
	pi.addAutocompleteProvider((current) => wrapSkillSummonProvider(current));
}
