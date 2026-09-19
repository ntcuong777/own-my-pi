/**
 * permission-gate — appeals: a gated command never prompts the user
 * unless the agent supplied a rationale tied to the current user request.
 *
 * Protected rules cannot be appealed. Generic "please allow" text is not
 * a rationale. The human still judges quality in the review widget; these
 * checks only stop empty or unanchored asks from reaching the user.
 */

import { PROTECTED_LABELS } from "./config.ts";
import { formatSessionAllowWarning, type SessionAllow } from "./prompt.ts";
import type { CompiledRule } from "./types.ts";

export const MIN_GOAL_CHARS = 12;
export const MIN_RATIONALE_CHARS = 40;
export const MAX_GOAL_CHARS = 500;
export const MAX_RATIONALE_CHARS = 1500;

export const GOAL_COMMENT = "pi-gate-goal";
export const RATIONALE_COMMENT = "pi-gate-rationale";

const GENERIC_RATIONALE = [
	/\bplease allow\b/i,
	/\bjust this once\b/i,
	/\bi need (this|it)\b/i,
	/\btrust me\b/i,
	/\bbecause it was blocked\b/i,
	/\bso i can (continue|proceed)\b/i,
	/\bit'?s safe\b/i,
	/\bthe user would want this\b/i,
];

export const APPEAL_FOOTER =
	"This command was not shown to the user. Do not retry it as-is.\n" +
	"If — and only if — it is required for the user's current request, call " +
	"request_permission with:\n" +
	"- goal: the user's current request in their words (what they asked for, not this command)\n" +
	"- rationale: why THIS exact command is required for that request. Name the path, host, or target.\n" +
	"- command: the same command\n" +
	"In Cursor host Shell, prefix the command with `# pi-gate-goal: …` and " +
	"`# pi-gate-rationale: …` instead.\n" +
	"Do not call request_permission for convenience, exploration, because a " +
	"previous tool failed, or to bypass the hashline edit tool. If you cannot " +
	"tie the command to the user's request, do not ask.";

export const CANNOT_APPEAL_FOOTER = "This cannot be appealed.";

export type Appeal = { goal: string; rationale: string };

export type AppealCheck = { ok: true } | { ok: false; reason: string };

export type GateDecision =
	| { kind: "allow"; warning?: string }
	| { kind: "block"; reason: string }
	| { kind: "prompt"; labels: string; matches: CompiledRule[]; appeal: Appeal; command: string };

export type DecideGateOpts = {
	sessionAllow?: SessionAllow;
	onceAllow?: Set<string>;
	promptsEnabled?: boolean;
	appeal?: Appeal;
};

export function isAppealable(rule: { label: string; appealable?: boolean }): boolean {
	if (PROTECTED_LABELS.has(rule.label)) return false;
	return rule.appealable !== false;
}

export function parseAppealComments(command: string): { command: string; appeal?: Appeal } {
	const lines = command.split("\n");
	let goal: string | undefined;
	let rationale: string | undefined;
	let i = 0;
	while (i < lines.length) {
		const line = lines[i]!.trim();
		if (!line) {
			i++;
			continue;
		}
		const goalMatch = line.match(/^#\s*pi-gate-goal:\s*(.*)$/i);
		if (goalMatch) {
			goal = goalMatch[1]!.trim();
			i++;
			continue;
		}
		const rationaleMatch = line.match(/^#\s*pi-gate-rationale:\s*(.*)$/i);
		if (rationaleMatch) {
			rationale = rationaleMatch[1]!.trim();
			i++;
			continue;
		}
		break;
	}
	const rest = lines.slice(i).join("\n").trim();
	if (goal && rationale) return { command: rest, appeal: { goal, rationale } };
	return { command: rest || command.trim() };
}

function commandAnchors(command: string): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const raw of command.split(/\s+/)) {
		const word = raw.replace(/['"`]/g, "");
		if (!word || word.startsWith("#")) continue;
		const isPath = word.startsWith("/") || word.startsWith("~") || word.startsWith("./") || word.includes("/");
		if (!isPath && (word.startsWith("-") || word.length < 4)) continue;
		const key = word.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(word);
	}
	return out;
}

export function validateAppeal(appeal: Appeal, command: string): AppealCheck {
	const goal = appeal.goal.trim();
	const rationale = appeal.rationale.trim();
	if (goal.length < MIN_GOAL_CHARS) {
		return { ok: false, reason: "Blocked: goal is too short — restate the user's current request, not this command." };
	}
	if (rationale.length < MIN_RATIONALE_CHARS) {
		return { ok: false, reason: "Blocked: rationale is too short — explain why THIS command is required for that request." };
	}
	if (goal.length > MAX_GOAL_CHARS || rationale.length > MAX_RATIONALE_CHARS) {
		return { ok: false, reason: "Blocked: goal or rationale is too long." };
	}
	if (GENERIC_RATIONALE.some((re) => re.test(rationale) || re.test(goal))) {
		return { ok: false, reason: "Blocked: that rationale is generic. Tie the command to the user's current request, or do not ask." };
	}
	if (goal.toLowerCase() === rationale.toLowerCase()) {
		return { ok: false, reason: "Blocked: rationale restates the goal. Say why this exact command is required." };
	}
	const anchors = commandAnchors(command);
	const hay = rationale.toLowerCase();
	if (anchors.length && !anchors.some((a) => hay.includes(a.toLowerCase()))) {
		return {
			ok: false,
			reason: "Blocked: rationale does not name the path, host, or target in the command. If you cannot, do not ask.",
		};
	}
	return { ok: true };
}

export function formatBlockReason(rule: CompiledRule, extra?: string): string {
	const base = extra?.trim() || rule.reason || `Blocked (${rule.label})`;
	if (!isAppealable(rule)) return `${base}\n\n${CANNOT_APPEAL_FOOTER}`;
	const hint = rule.appealHint?.trim();
	return hint ? `${base}\n\n${hint}\n\n${APPEAL_FOOTER}` : `${base}\n\n${APPEAL_FOOTER}`;
}

export function formatAppealBlock(rules: CompiledRule[], extra?: string): string {
	const unappealable = rules.find((r) => !isAppealable(r));
	return formatBlockReason(unappealable ?? rules[0]!, extra);
}

function pendingRules(matched: CompiledRule[], promptsEnabled: boolean): CompiledRule[] {
	return matched.filter((r) => {
		if (!promptsEnabled && r.action === "prompt") return false;
		return true;
	});
}

export function decideGate(command: string, matched: CompiledRule[], opts: DecideGateOpts = {}): GateDecision {
	const parsed = parseAppealComments(command);
	const stripped = parsed.command;
	if (opts.onceAllow?.has(stripped)) {
		opts.onceAllow.delete(stripped);
		return { kind: "allow" };
	}
	const promptsEnabled = opts.promptsEnabled ?? true;
	const pending = pendingRules(matched, promptsEnabled);
	if (opts.sessionAllow?.has(stripped)) {
		if (pending.length === 0) return { kind: "allow" };
		return {
			kind: "allow",
			warning: formatSessionAllowWarning(stripped, pending.map((r) => r.label).join(", ")),
		};
	}
	if (pending.length === 0) return { kind: "allow" };

	const unappealable = pending.filter((r) => !isAppealable(r));
	if (unappealable.length) {
		return { kind: "block", reason: formatAppealBlock(unappealable) };
	}

	const appeal = opts.appeal ?? parsed.appeal;
	if (!appeal) {
		return { kind: "block", reason: formatAppealBlock(pending) };
	}
	const check = validateAppeal(appeal, stripped);
	if (!check.ok) {
		return { kind: "block", reason: formatAppealBlock(pending, check.reason) };
	}

	if (!promptsEnabled && pending.every((r) => r.action === "prompt")) return { kind: "allow" };

	const labels = pending.map((r) => r.label).join(", ");
	return { kind: "prompt", labels, matches: pending, appeal, command: stripped };
}
