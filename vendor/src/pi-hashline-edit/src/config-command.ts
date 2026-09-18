/**
 * /hashline-config — edit ~/.pi/agent/hashline.json from the TUI.
 *
 * hashLength and boundaryDedup take effect immediately. replaceText is baked
 * into the published tool schema at registration time, so the tool is
 * re-registered after a change; grep registration is additive only (turning it
 * off needs a restart, because pi has no unregisterTool).
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
	type BoundaryDedupMode,
	currentHashlineConfig,
	getGrepEnabled,
	hashlineConfigPath,
	writeHashlineConfig,
} from "./config";
import { registerEditTool } from "./edit";
import { registerGrepTool } from "./grep";

const DEDUP_MODES: BoundaryDedupMode[] = ["off", "warn", "on", "strict"];

export function registerConfigCommand(pi: ExtensionAPI): void {
	pi.registerCommand("hashline-config", {
		description:
			"Edit hashline settings (hash length, grep, anchor-only edits, boundary dedup)",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const current = currentHashlineConfig();
			const field = await ctx.ui.select("hashline setting to change", [
				`hashLength: ${current.hashLength}`,
				`grep: ${current.grep}`,
				`replaceText (anchor-only when false): ${current.replaceText}`,
				`boundaryDedup: ${current.boundaryDedup}`,
			]);
			if (field === undefined) return;

			const next = { ...current };
			if (field.startsWith("hashLength")) {
				const picked = await ctx.ui.select("hashLength", ["2", "3", "4"]);
				if (picked === undefined) return;
				next.hashLength = Number(picked) as 2 | 3 | 4;
			} else if (field.startsWith("grep")) {
				next.grep = !current.grep;
			} else if (field.startsWith("replaceText")) {
				next.replaceText = !current.replaceText;
			} else {
				const picked = await ctx.ui.select("boundaryDedup", DEDUP_MODES);
				if (picked === undefined) return;
				next.boundaryDedup = picked as BoundaryDedupMode;
			}

			try {
				await writeHashlineConfig(next);
			} catch (error) {
				ctx.ui.notify(
					`Could not write ${hashlineConfigPath()}: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
				return;
			}

			// replaceText changes the published schema; re-register to apply it.
			registerEditTool(pi);
			if (getGrepEnabled()) registerGrepTool(pi);

			const restartNote =
				current.grep && !next.grep
					? " Turning grep off needs a pi restart."
					: current.hashLength !== next.hashLength
						? " Anchors from earlier reads in this session are now stale; re-read before editing."
						: "";
			ctx.ui.notify(
				`hashline: ${JSON.stringify(next)}.${restartNote}`,
				"info",
			);
		},
	});
}
