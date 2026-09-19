/*
 * Mid-prompt skill summon.
 *
 * Pi's editor only auto-opens the slash popup at the start of the prompt, and
 * CombinedAutocompleteProvider treats a later slash as arguments to the first
 * command. This extension wraps autocomplete so a later token lists skills, and
 * patches Editor.insertCharacter so typing that slash opens the popup.
 *
 * Autocomplete is ctx.ui.addAutocompleteProvider (session_start), not pi.
 * Calling it on the factory API crashes `pi resume`.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Editor } from "@earendil-works/pi-tui";
import { patchEditorSlashTrigger } from "./editor-patch";
import { registerSkillSummon } from "./register";

export default function skillSummon(pi: ExtensionAPI): void {
	patchEditorSlashTrigger(Editor);
	registerSkillSummon(pi);
}
