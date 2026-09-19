/**
 * permission-gate — prompt policy: timeouts, session allow, reject reasons.
 *
 * Pure functions so tests can cover the questionnaire/timeout contract
 * without driving the TUI. The review widget in ui.ts is a thin adapter.
 */

import type { GateConfig, GateResult, PromptSettings } from "./types.ts";

export const DEFAULT_NOTIFY_AFTER_MS = 60_000;
export const DEFAULT_TIMEOUT_MS = 300_000;
export const DEFAULT_PROMPT_SETTINGS: PromptSettings = {
	notifyAfterMs: DEFAULT_NOTIFY_AFTER_MS,
	timeoutMs: DEFAULT_TIMEOUT_MS,
	onTimeout: "reject",
};

export const DEFAULT_REJECT_REASONS = [
	"Too dangerous for this session",
	"Use a narrower or different command",
];

export type PromptSettingsInput = {
	notifyAfterMs?: unknown;
	timeoutMs?: unknown;
	onTimeout?: unknown;
};

export type PromptDecision =
	| { kind: "allow-once" }
	| { kind: "allow-session" }
	| { kind: "reject"; reason?: string };

function finiteMs(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
	return value;
}

/** Trusted user layers only. Unknown keys and bad values fall back to defaults. */
export function resolvePromptSettings(raw?: PromptSettingsInput): PromptSettings {
	const notifyAfterMs = finiteMs(raw?.notifyAfterMs) ?? DEFAULT_NOTIFY_AFTER_MS;
	const timeoutMs = finiteMs(raw?.timeoutMs) ?? DEFAULT_TIMEOUT_MS;
	const onTimeout = raw?.onTimeout === "allow" || raw?.onTimeout === "reject"
		? raw.onTimeout
		: DEFAULT_PROMPT_SETTINGS.onTimeout;
	return { notifyAfterMs, timeoutMs, onTimeout };
}

/**
 * User-code overlay wins over rules.json. The project layer is ignored:
 * a repo must not flip timeout-to-allow (that would auto-run a matched
 * command when the user is AFK).
 */
export function compilePromptSettings(layers: {
	userCode?: Pick<GateConfig, "prompt">;
	userJson?: Pick<GateConfig, "prompt">;
	project?: Pick<GateConfig, "prompt">;
}): PromptSettings {
	return resolvePromptSettings({
		...layers.userJson?.prompt,
		...layers.userCode?.prompt,
	});
}

/** Notify at now+notifyAfterMs; auto-resolve notifyAfterMs+timeoutMs later. */
export function promptDeadlines(now: number, settings: PromptSettings): { notifyAt: number; timeoutAt: number } {
	return {
		notifyAt: now + settings.notifyAfterMs,
		timeoutAt: now + settings.notifyAfterMs + settings.timeoutMs,
	};
}

export function timeoutGateResult(settings: PromptSettings, labels: string): GateResult {
	if (settings.onTimeout === "allow") return { allow: true };
	return { allow: false, reason: `Blocked: permission prompt timed out (${labels})` };
}

/** Exact requested commands the user allowed for the rest of this session. */
export const MAX_SESSION_ALLOW = 512;

/**
 * Per-command session allow. "Always allow in session" covers this exact
 * requested command only — not the rule, and not every later script. Cap
 * 512; inserting past that drops the least recently used command.
 */
export class SessionAllow {
	private readonly commands = new Map<string, true>();

	get size(): number {
		return this.commands.size;
	}

	clear(): void {
		this.commands.clear();
	}

	/** True if this exact command is allowed; counts as a use (LRU). */
	has(command: string): boolean {
		if (!this.commands.has(command)) return false;
		this.touch(command);
		return true;
	}

	add(command: string): void {
		if (!command) return;
		if (this.commands.has(command)) {
			this.touch(command);
			return;
		}
		if (this.commands.size >= MAX_SESSION_ALLOW) {
			const stale = this.commands.keys().next().value;
			if (stale !== undefined) this.commands.delete(stale);
		}
		this.commands.set(command, true);
	}

	private touch(command: string): void {
		this.commands.delete(command);
		this.commands.set(command, true);
	}
}

export function rejectReasonChoices(rules: { rejectReasons?: string[] }[]): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const rule of rules) {
		for (const reason of rule.rejectReasons ?? []) {
			const trimmed = reason.trim();
			if (!trimmed || seen.has(trimmed)) continue;
			seen.add(trimmed);
			out.push(trimmed);
		}
	}
	return out.length ? out : [...DEFAULT_REJECT_REASONS];
}

export function formatUserRejection(labels: string, reason?: string): string {
	const trimmed = reason?.trim();
	return trimmed ? `Blocked by user (${labels}): ${trimmed}` : `Blocked by user (${labels})`;
}

export function decisionToResult(decision: PromptDecision, labels: string): GateResult {
	if (decision.kind === "allow-once") return { allow: true };
	if (decision.kind === "allow-session") return { allow: true, always: true };
	return { allow: false, reason: formatUserRejection(labels, decision.reason) };
}
