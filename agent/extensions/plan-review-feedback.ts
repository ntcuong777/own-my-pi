/*
 * plan-review-feedback — Pi-native refine path for @narumitw/pi-plan-mode.
 *
 * OMP patched a PlanReviewOverlay "Refine plan" row. That overlay does not
 * exist here. /plan-refine collects notes and asks the agent to revise the
 * active plan without starting implementation.
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export const REFINE_LABEL = "Refine plan";

function reviseMessage(notes: string): string {
	return [
		"Revise the active plan using this feedback.",
		"Do not start implementing. Update the plan document only.",
		"",
		"Feedback:",
		notes.trim(),
	].join("\n");
}

export default function planReviewFeedback(pi: ExtensionAPI): void {
	pi.registerCommand("plan-refine", {
		description: "Revise the current plan with feedback (does not implement)",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			let notes = args.trim();
			if (!notes) {
				notes = (await ctx.ui.editor("Plan feedback", ""))?.trim() ?? "";
			}
			if (!notes) {
				ctx.ui.notify("Plan refine cancelled.", "info");
				return;
			}
			pi.sendUserMessage(reviseMessage(notes), { expandPromptTemplates: false });
			ctx.ui.notify("Sent plan feedback.", "info");
		},
	});
}
