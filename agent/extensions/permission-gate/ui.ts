/**
 * permission-gate — review prompt: allow once, allow this session, or
 * reject with pre-filled reasons (plus a type-your-own field). Idle
 * timers fire a reminder, then auto-reject or auto-allow.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Editor, type EditorTheme, Key, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import {
	decisionToResult,
	DEFAULT_PROMPT_SETTINGS,
	DEFAULT_REJECT_REASONS,
	promptDeadlines,
	timeoutGateResult,
} from "./prompt.ts";
import { EVENTS, type GateResult, type PromptSettings } from "./types.ts";

/** What a rule matched, shown above the command (see match.matchEvidence). */
export type MatchDetail = { label: string; evidence?: string };

/**
 * Lines of chrome the prompt needs around the command: header, evidence,
 * options, reject list, editor, hints.
 */
const CHROME_LINES = 30;
const MIN_COMMAND_LINES = 3;
const MAX_COMMAND_LINES = 20;
const FALLBACK_ROWS = 24;
/** Evidence lines shown; the header still names every rule that fired. */
const MAX_EVIDENCE_LINES = 3;

const CUSTOM_REASON = "Type my own reason";
const ACTIONS = ["Allow once", "Always allow this command in session", "Reject"] as const;

function sanitizeNotify(s: string): string {
	return s.replace(/[\x00-\x1f\x7f;]/g, " ").trim();
}

function writeEscape(seq: string): void {
	if (process.env.TMUX) {
		process.stdout.write(`\x1bPtmux;${seq.replaceAll("\x1b", "\x1b\x1b")}\x1b\\`);
	} else {
		process.stdout.write(seq);
	}
}

/** Desktop reminder while a prompt is waiting. Same OSC family as notify. */
export function sendPromptNotification(title: string, body: string): void {
	const t = sanitizeNotify(title);
	const b = sanitizeNotify(body);
	if (process.env.WT_SESSION) return;
	if (process.env.KITTY_WINDOW_ID) {
		writeEscape(`\x1b]99;i=1:d=0;${t}\x1b\\`);
		writeEscape(`\x1b]99;i=1:p=body;${b}\x1b\\`);
		return;
	}
	writeEscape(`\x1b]777;notify;${t};${b}\x07`);
}

/** How many display lines of the command fit without pushing out the header. */
function commandBudget(tui: unknown, evidenceLines: number): number {
	const rows = (tui as { rows?: number }).rows ?? FALLBACK_ROWS;
	return Math.max(MIN_COMMAND_LINES, Math.min(MAX_COMMAND_LINES, rows - CHROME_LINES - evidenceLines));
}

/** Hanging indent on wrapped continuations, so a wrapped line is not read
 * as another statement. */
const WRAP_INDENT = "  ";

/**
 * The command as display lines: newlines honoured, long lines wrapped
 * with a hanging indent.
 */
export function commandLines(
	command: string,
	width: number,
	budget: number,
): { lines: string[]; hidden: number } {
	const wrapped: string[] = [];
	for (const raw of command.split("\n")) {
		const pieces = wrapTextWithAnsi(raw, Math.max(8, width), WRAP_INDENT);
		if (pieces.length === 0) wrapped.push("");
		else wrapped.push(...pieces);
	}
	if (wrapped.length <= budget) return { lines: wrapped, hidden: 0 };
	return { lines: wrapped.slice(0, budget), hidden: wrapped.length - budget };
}

export type ReviewPromptOpts = {
	settings?: PromptSettings;
	rejectReasons?: string[];
	appeal?: { goal: string; rationale: string };
	onNotify?: () => void;
};

/**
 * Show the review prompt. Listens for EVENTS.respond on the optional event
 * bus so external callers (e.g. Telegram) can dismiss it, and emits
 * EVENTS.waiting once that listener is armed — in that order, so even a
 * responder reacting synchronously to `waiting` cannot lose its answer.
 */
export async function showReviewPrompt(
	ctx: ExtensionContext,
	command: string,
	labels: string,
	events?: {
		on: (name: string, handler: (payload: unknown) => void) => () => void;
		emit: (name: string, payload?: unknown) => void;
	},
	matches: MatchDetail[] = [],
	opts: ReviewPromptOpts = {},
): Promise<GateResult> {
	const settings = opts.settings ?? DEFAULT_PROMPT_SETTINGS;
	const reasons = (opts.rejectReasons?.length ? opts.rejectReasons : DEFAULT_REJECT_REASONS)
		.map((r) => r.trim())
		.filter(Boolean);
	const rejectOpts = [...reasons, CUSTOM_REASON];

	return ctx.ui.custom<GateResult>((tui, theme, _kb, done_) => {
		let offRespond: (() => void) | undefined;
		let notifyTimer: ReturnType<typeof setTimeout> | undefined;
		let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
		let notified = false;

		const done = (result: GateResult) => {
			if (notifyTimer !== undefined) clearTimeout(notifyTimer);
			if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
			notifyTimer = undefined;
			timeoutTimer = undefined;
			offRespond?.();
			offRespond = undefined;
			done_(result);
		};

		const deadlines = promptDeadlines(Date.now(), settings);
		const notifyDelay = Math.max(0, deadlines.notifyAt - Date.now());
		const timeoutDelay = Math.max(0, deadlines.timeoutAt - Date.now());
		notifyTimer = setTimeout(() => {
			notified = true;
			opts.onNotify?.();
			sendPromptNotification("Permission prompt waiting", labels);
			tui.requestRender();
		}, notifyDelay);
		timeoutTimer = setTimeout(() => {
			done(timeoutGateResult(settings, labels));
		}, timeoutDelay);

		if (events) {
			offRespond = events.on(EVENTS.respond, (payload) => {
				const p = payload as { allow?: boolean; always?: boolean; reason?: string } | undefined;
				if (p?.allow === true) {
					done(p.always ? { allow: true, always: true } : { allow: true });
					return;
				}
				done(decisionToResult({ kind: "reject", reason: p?.reason }, labels));
			});
			events.emit(EVENTS.waiting, {
				command,
				labels,
				rejectReasons: reasons,
				actions: ["allow-once", "allow-session", "reject"],
				appeal: opts.appeal,
			});
		}

		let phase: "action" | "reject" = "action";
		let actionIndex = 0;
		let rejectIndex = 0;
		let cachedLines: string[] | undefined;

		const editorTheme: EditorTheme = {
			borderColor: (s) => theme.fg("accent", s),
			selectList: {
				selectedPrefix: (t) => theme.fg("accent", t),
				selectedText: (t) => theme.fg("accent", t),
				description: (t) => theme.fg("muted", t),
				scrollInfo: (t) => theme.fg("dim", t),
				noMatch: (t) => theme.fg("warning", t),
			},
		};
		const editor = new Editor(tui, editorTheme);

		function refresh() {
			cachedLines = undefined;
			tui.requestRender();
		}

		editor.onSubmit = (value) => {
			done(decisionToResult({ kind: "reject", reason: value }, labels));
		};

		function handleInput(data: string) {
			if (matchesKey(data, Key.escape)) {
				if (phase === "reject") {
					phase = "action";
					actionIndex = 2;
					refresh();
					return;
				}
				done(decisionToResult({ kind: "reject" }, labels));
				return;
			}

			if (phase === "action") {
				if (matchesKey(data, Key.down)) {
					actionIndex = Math.min(ACTIONS.length - 1, actionIndex + 1);
					refresh();
					return;
				}
				if (matchesKey(data, Key.up)) {
					actionIndex = Math.max(0, actionIndex - 1);
					refresh();
					return;
				}
				if (matchesKey(data, Key.enter)) {
					if (actionIndex === 0) done(decisionToResult({ kind: "allow-once" }, labels));
					else if (actionIndex === 1) done(decisionToResult({ kind: "allow-session" }, labels));
					else {
						phase = "reject";
						rejectIndex = 0;
						refresh();
					}
				}
				return;
			}

			const custom = rejectIndex === rejectOpts.length - 1;
			if (custom && !matchesKey(data, Key.up) && !matchesKey(data, Key.down) && !matchesKey(data, Key.enter)) {
				editor.handleInput(data);
				refresh();
				return;
			}
			if (matchesKey(data, Key.down)) {
				rejectIndex = Math.min(rejectOpts.length - 1, rejectIndex + 1);
				refresh();
				return;
			}
			if (matchesKey(data, Key.up)) {
				rejectIndex = Math.max(0, rejectIndex - 1);
				refresh();
				return;
			}
			if (matchesKey(data, Key.enter)) {
				if (custom) {
					editor.handleInput(data);
					refresh();
					return;
				}
				done(decisionToResult({ kind: "reject", reason: rejectOpts[rejectIndex] }, labels));
			}
		}

		function render(width: number): string[] {
			if (cachedLines) return cachedLines;
			const lines: string[] = [];
			const add = (s: string) => lines.push(truncateToWidth(s, width));

			lines.push("");
			add(theme.fg("warning", " ⚠️ Dangerous command ") + theme.fg("muted", `(${labels})`));
			if (opts.appeal) {
				add(theme.fg("muted", "   goal: ") + theme.fg("text", opts.appeal.goal));
				add(theme.fg("muted", "   why:  ") + theme.fg("text", opts.appeal.rationale));
			}
			const evidence = matches
				.filter((m) => m.evidence && m.evidence !== command.trim())
				.slice(0, MAX_EVIDENCE_LINES);
			for (const m of evidence) {
				add(theme.fg("muted", `   ↳ ${m.label}: `) + theme.fg("warning", m.evidence!));
			}
			const cmd = commandLines(command, width - 1, commandBudget(tui, evidence.length));
			for (const line of cmd.lines) add(` ${theme.fg("text", line)}`);
			if (cmd.hidden > 0) {
				add(theme.fg("dim", ` … ${cmd.hidden} more line${cmd.hidden === 1 ? "" : "s"} (not shown)`));
			}
			lines.push("");

			if (phase === "action") {
				for (let i = 0; i < ACTIONS.length; i++) {
					const sel = i === actionIndex;
					add(`${sel ? theme.fg("accent", " > ") : "   "}${theme.fg(sel ? "accent" : "text", ACTIONS[i])}`);
				}
				lines.push("");
				const hint = notified
					? " reminder sent • waiting for an answer"
					: " Enter select • ↑↓ move • Esc reject";
				add(theme.fg("dim", hint));
			} else {
				add(theme.fg("muted", " Why reject?"));
				for (let i = 0; i < rejectOpts.length; i++) {
					const sel = i === rejectIndex;
					add(`${sel ? theme.fg("accent", " > ") : "   "}${theme.fg(sel ? "accent" : "text", rejectOpts[i])}`);
				}
				lines.push("");
				if (rejectIndex === rejectOpts.length - 1) {
					add(theme.fg("muted", " Reason:"));
					for (const line of editor.render(width - 2)) add(` ${line}`);
					lines.push("");
					add(theme.fg("dim", " Enter submit • ↑↓ reasons • Esc back"));
				} else {
					add(theme.fg("dim", " Enter reject with this reason • ↑↓ • Esc back"));
				}
			}
			lines.push("");

			cachedLines = lines;
			return lines;
		}

		return { render, invalidate: () => { cachedLines = undefined; }, handleInput };
	});
}
