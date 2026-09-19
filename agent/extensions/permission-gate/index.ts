/**
 * permission-gate — confirm or block dangerous bash commands before they run.
 *
 * Every bash command is parsed into the programs it actually runs (see
 * shell.ts) and checked against the rules. A matching rule rejects the
 * command with guidance. The user is never prompted unless the agent
 * supplies a rationale tied to the current user request (request_permission
 * or `# pi-gate-goal` / `# pi-gate-rationale` comments). Protected rules
 * cannot be appealed.
 *
 * The review widget is Allow once / Always allow this command in session /
 * Reject (pre-filled reasons plus type-your-own). Session allow is the
 * exact requested command, not the rule and not every later script; cap
 * 512, LRU. A later run of that command still warns if it matches a
 * gate rule. A reminder fires after 60s;
 * 5 minutes after that the prompt auto-rejects (configurable). Toggle
 * prompting with /gate. Block rules stay active when prompting is off.
 * PI_NO_GATE=1 turns the whole extension off.
 *
 * Configuration is read from four places, in order (each can add rules or
 * turn off earlier ones); see config.ts for the trust rules per place:
 *   1. the built-in rules
 *   2. ~/.config/pi-agent-extensions/permission-gate/rules.ts (or .mjs / .js)
 *   3. ~/.config/pi-agent-extensions/permission-gate/rules.json  (written by /gate)
 *   4. <cwd>/.pi/permission-gate.json                            (project, untrusted)
 *
 * Based on pi's built-in permission-gate example, PR #13, and the
 * block-commands extension by Mic92 (github.com/Mic92/dotfiles).
 */

import type { ExtensionAPI, ExtensionContext, BashToolCallEvent } from "@earendil-works/pi-coding-agent";
import { EVENTS, type CompiledRule, type GateHelpers, type PromptSettings, type WarnFn } from "./types.ts";
import { searchPaths } from "./builtin-rules.ts";
import { anyCmd, hasFlag } from "./helpers.ts";
import { deferredScripts, nestedScripts, pipelines, SHELLS, simpleCommands, unwrap, unwrapSteps } from "./shell.ts";
import { matchEvidence, matchRules } from "./match.ts";
import { compileRules, type ConfigLayers, loadConfig, saveUserJson } from "./config.ts";
import { showReviewPrompt } from "./ui.ts";
import {
	compilePromptSettings,
	rejectReasonChoices,
	SessionAllow,
} from "./prompt.ts";
import { APPEAL_FOOTER, decideGate, parseAppealComments } from "./appeal.ts";
import { Type } from "typebox";

const GATE_SUBCMDS = "list(ls)|off <group>|on <group>|add|remove(rm)|reload";
const HELPERS: GateHelpers = {
	simpleCommands, pipelines, searchPaths,
	unwrap, unwrapSteps, nestedScripts, deferredScripts,
	anyCmd, hasFlag, SHELLS,
};

// ── extension ────────────────────────────────────────────────────────────

export default function permissionGate(pi: ExtensionAPI) {
	// PI_NO_GATE=1 disables the extension entirely (prompts and block
	// rules). Exact match on "1": treating any non-empty value as a
	// disable made PI_NO_GATE=0 turn the gate off — the standard env-var
	// footgun, and this one is a kill switch.
	if (process.env.PI_NO_GATE === "1") return;

	let promptsEnabled = true;
	let layers: ConfigLayers = { userCode: {}, userJson: {}, project: {} };
	let rules: CompiledRule[] = compileRules(layers);
	let promptSettings: PromptSettings = compilePromptSettings(layers);
	const sessionAllow = new SessionAllow();
	const onceAllow = new Set<string>();

	function updateStatus(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		ctx.ui.setStatus("gate", ctx.ui.theme.fg("dim", promptsEnabled ? "\uf132 gate" : "\uf132 block"));
	}

	async function reloadRules(cwd: string, warn: WarnFn | undefined, headless: boolean): Promise<void> {
		layers = await loadConfig(cwd, HELPERS, warn);
		rules = compileRules(layers, warn, { headless });
		promptSettings = compilePromptSettings(layers);
	}

	// ── events ───────────────────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		// Headless the warn channel is stderr — a no-op here let a repo-shipped
		// config neuter every prompt rule with zero record. compileRules also
		// refuses project prompt-disables entirely when headless (prompts
		// hard-block without a UI, so disabling one escalates, not softens).
		const warn: WarnFn = (msg) =>
			ctx.hasUI ? ctx.ui.notify(msg, "warning") : console.error(msg);
		await reloadRules(ctx.cwd, warn, !ctx.hasUI);
		sessionAllow.clear();
		onceAllow.clear();
		updateStatus(ctx);
	});

	async function reviewCommand(
		ctx: ExtensionContext,
		command: string,
		matched: CompiledRule[],
		appeal?: { goal: string; rationale: string },
		deferOnce = false,
	) {
		const decision = decideGate(command, matched, { sessionAllow, onceAllow, promptsEnabled, appeal });
		if (decision.kind === "allow") {
			if (decision.warning) {
				if (ctx.hasUI) ctx.ui.notify(decision.warning, "warning");
				else console.warn(decision.warning);
			}
			return undefined;
		}
		if (decision.kind === "block") return { block: true, reason: decision.reason };

		if (!ctx.hasUI) {
			return { block: true, reason: `Dangerous command blocked (${decision.labels}) — no UI` };
		}

		const matches = decision.matches.map((r) => ({ label: r.label, evidence: matchEvidence(decision.command, r) }));
		const result = await showReviewPrompt(ctx, decision.command, decision.labels, pi.events, matches, {
			settings: promptSettings,
			rejectReasons: rejectReasonChoices(decision.matches),
			appeal: decision.appeal,
			onNotify: () => {
				ctx.ui.notify(`Permission prompt still waiting (${decision.labels})`, "warning");
			},
		});
		pi.events.emit(EVENTS.resolved);
		if (result.allow && result.always) {
			sessionAllow.add(decision.command);
		} else if (result.allow && deferOnce) {
			onceAllow.add(decision.command);
		}
		if (result.allow) return undefined;
		return { block: true, reason: `${result.reason}\n\n${APPEAL_FOOTER}` };
	}

	pi.on("tool_call", async (event, ctx) => {
		let command: string | undefined;
		if (event.toolName === "bash") {
			command = (event as BashToolCallEvent).input.command;
		} else if (event.toolName === "write" || event.toolName === "edit") {
			const input = (event as { input?: Record<string, unknown> }).input;
			const filePath = String(input?.path ?? "");
			command = `${event.toolName} ${filePath}\n${JSON.stringify(input ?? {})}`;
		} else {
			return undefined;
		}
		if (!command) return undefined;

		let matched: CompiledRule[];
		try {
			const stripped = parseAppealComments(command).command;
			matched = matchRules(stripped, rules, { sessionCwd: ctx.cwd });
		} catch (err) {
			if (ctx.hasUI) {
				ctx.ui.notify(`permission-gate: rule evaluation failed: ${(err as Error).message}`, "warning");
			}
			return { block: true, reason: "Blocked: permission-gate rule evaluation failed — fix the gate config (see /gate list) and retry" };
		}
		if (matched.length === 0) return undefined;
		return reviewCommand(ctx, command, matched);
	});

	pi.registerTool({
		name: "request_permission",
		label: "Request permission",
		description:
			"Ask the user to allow a gated shell command. Only call this when you can name the user's current request and why THIS exact command is required for it. Do not call it for convenience, exploration, a failed edit, or if you cannot tie the command to that request.",
		promptSnippet: "Ask the user to allow a gated command, with a goal-tied rationale",
		promptGuidelines: [
			"Never prompt the user for a gated command unless you can restate their current request and explain why this exact command is required for it.",
			"Call request_permission instead of retrying a blocked command as-is. Protected blocks cannot be appealed.",
		],
		parameters: Type.Object({
			command: Type.String({ description: "The exact shell command to run if the user allows it." }),
			goal: Type.String({ description: "The user's current request in their words, not a restatement of the command." }),
			rationale: Type.String({ description: "Why this exact command is required for that request. Name the path, host, or target." }),
		}, { additionalProperties: false }),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const command = String(params.command ?? "");
			const goal = String(params.goal ?? "");
			const rationale = String(params.rationale ?? "");
			const stripped = parseAppealComments(command).command;
			let matched: CompiledRule[];
			try {
				matched = matchRules(stripped, rules, { sessionCwd: ctx.cwd });
			} catch (err) {
				return {
					content: [{ type: "text", text: `Blocked: permission-gate rule evaluation failed: ${(err as Error).message}` }],
					details: {},
				};
			}
			if (matched.length === 0) {
				return {
					content: [{ type: "text", text: "This command is not gated. Run it with bash; do not ask the user." }],
					details: {},
				};
			}
			const result = await reviewCommand(ctx, stripped, matched, { goal, rationale }, true);
			if (!result) {
				return {
					content: [{ type: "text", text: "Allowed. Retry the same command with bash now (do not add appeal comments)." }],
					details: {},
				};
			}
			return {
				content: [{ type: "text", text: result.reason }],
				details: {},
			};
		},
	});

	// ── /gate ────────────────────────────────────────────────────────────

	pi.registerCommand("gate", {
		description: `Permission gate — toggle prompts or manage rules: /gate [${GATE_SUBCMDS}]`,
		handler: async (args, ctx) => {
			// Every branch below talks to the UI; headless/RPC callers get a no-op.
			if (!ctx.hasUI) return;
			const sub = args?.trim().toLowerCase() ?? "";
			const warn: WarnFn = (msg) => ctx.ui.notify(msg, "warning");

			// Toggle prompting (block rules unaffected).
			if (!sub) {
				promptsEnabled = !promptsEnabled;
				updateStatus(ctx);
				ctx.ui.notify(
					promptsEnabled
						? "Permission gate: prompts enabled"
						: "Permission gate: prompts disabled (block rules still active)",
					"info",
				);
				return;
			}

			if (sub === "list" || sub === "ls") {
				// Grouped by the coarse dial users actually turn (`/gate off vcs`),
				// not by config source; non-built-in rules note their source inline.
				const byGroup: Record<string, string[]> = {};
				for (const r of rules) {
					const tags = [
						r.action === "block" ? "[block]" : "",
						r.source !== "built-in" ? `[${r.source}]` : "",
					].filter(Boolean).join(" ");
					(byGroup[r.group ?? "custom"] ??= []).push(tags ? `${r.label} ${tags}` : r.label);
				}
				const off = [
					...(layers.userJson.disabledGroups ?? []),
					...(layers.userCode.disabledGroups ?? []),
				];
				const sections = Object.entries(byGroup).map(([group, labels]) =>
					`${group} (${labels.length}):\n${labels.map((l) => `  • ${l}`).join("\n")}`,
				);
				if (off.length) sections.push(`off: ${[...new Set(off)].join(", ")}`);
				ctx.ui.notify(sections.join("\n\n") || "No active rules", "info");
				return;
			}

			// `/gate off vcs` / `/gate on vcs` — the coarse dial. Writes
			// disabledGroups in the user rules.json so it persists.
			const [verb, groupArg] = sub.split(/\s+/, 2);
			if ((verb === "off" || verb === "on") && groupArg) {
				const cfg = layers.userJson;
				const current = new Set(cfg.disabledGroups ?? []);
				if (verb === "off") current.add(groupArg);
				else current.delete(groupArg);
				cfg.disabledGroups = [...current];
				saveUserJson(cfg, warn);
				await reloadRules(ctx.cwd, warn, false);
				ctx.ui.notify(
					verb === "off"
						? `Group "${groupArg}" disabled (${rules.length} rule(s) active)`
						: `Group "${groupArg}" enabled (${rules.length} rule(s) active)`,
					"info",
				);
				return;
			}

			if (sub === "reload") {
				await reloadRules(ctx.cwd, warn, false);
				const src = layers.userCodePath ? ` from ${layers.userCodePath}` : "";
				ctx.ui.notify(`Reloaded ${rules.length} rule(s)${src}`, "info");
				return;
			}

			// Add regex rule → user JSON.
			if (sub === "add") {
				const pattern = await ctx.ui.input("Pattern", "Regex (e.g. \\\\bdocker\\\\s+rm\\\\b)");
				if (!pattern) return;
				const label = await ctx.ui.input("Label", "Short name (e.g. docker remove)");
				if (!label) return;
				try { new RegExp(pattern, "i"); } catch {
					ctx.ui.notify("Invalid regex", "error");
					return;
				}
				const action = (await ctx.ui.select("Action", ["prompt", "block"])) as "prompt" | "block" | undefined;
				if (!action) return;
				const reason = action === "block"
					? await ctx.ui.input("Reason (sent to model)", "")
					: undefined;
				const cfg = layers.userJson;
				cfg.extraRules = [...(cfg.extraRules ?? []), { pattern, label, action, ...(reason ? { reason } : {}) }];
				const saved = saveUserJson(cfg, warn);
				await reloadRules(ctx.cwd, warn, false);
				if (saved) ctx.ui.notify(`Rule added: ${label}`, "info");
				return;
			}

			// Remove: user-json rules are spliced; anything else is disabled by label.
			if (sub === "remove" || sub === "rm") {
				if (rules.length === 0) { ctx.ui.notify("No rules to remove", "info"); return; }
				const choice = await ctx.ui.select("Remove rule", rules.map((r) => r.label));
				if (!choice) return;

				const cfg = layers.userJson;
				// Prefer the user-json rule when labels collide — /gate rm must
				// splice the user's own rule, not disable a built-in that happens
				// to share its label.
				const target = rules.find((r) => r.label === choice && r.source === "user-json")
					?? rules.find((r) => r.label === choice);
				const idx = (cfg.extraRules ?? []).findIndex((r) => r.label === choice);
				if (target?.source === "user-json" && idx >= 0) {
					cfg.extraRules!.splice(idx, 1);
				} else {
					cfg.disabledRules = [...new Set([...(cfg.disabledRules ?? []), choice])];
				}
				const saved = saveUserJson(cfg, warn);
				await reloadRules(ctx.cwd, warn, false);
				if (saved) ctx.ui.notify(`Rule removed: ${choice}`, "info");
				return;
			}

			ctx.ui.notify(`Usage: /gate [${GATE_SUBCMDS}]`, "info");
		},
	});
}
