/*
 * Keep current prompt text while toggling pi-plan-mode.
 * Alt+Shift+P avoids conflicting with normal prompt input.
 * Do not also set toggleShortcut in pi-plan-mode.json — that would double-fire.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function planToggle(pi: ExtensionAPI): void {
	pi.registerShortcut("alt+shift+p", {
		description: "Toggle plan mode without clearing the prompt",
		handler: async (ctx) => {
			const prompt = ctx.ui.getEditorText();
			pi.sendUserMessage("/plan", { expandPromptTemplates: true });
			await new Promise<void>((resolve) => setTimeout(resolve, 0));
			ctx.ui.setEditorText(prompt);
			ctx.ui.notify("Plan mode toggled; prompt preserved", "info");
		},
	});
}
