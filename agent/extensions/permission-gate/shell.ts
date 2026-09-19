/**
 * permission-gate — shell command structure: pipelines and script traversal.
 *
 * Composes the tokenizer (tokenize.ts) with the wrapper/executor knowledge
 * (argv.ts) into the shapes rules consume:
 *
 *   - `pipelines`: assembles tokens into pipelines of simple commands,
 *     deciding which herestrings/heredoc bodies are scripts vs. data.
 *   - `scriptSources`: the single list of every script a command carries
 *     (substitutions, inline scripts, deferred tasks, local script files).
 *   - `simpleCommands` / `collectPipelines`: the two recursive walks over
 *     that list — flat argvs for simple rules, pipelines (plus synthesized
 *     `fetcher | shell` correlations) for the matcher.
 *
 * Also re-exports the public surface of both layers, so consumers keep a
 * single import point.
 */

import type { ArgvPipeline } from "./types.ts"; // type-only: erased, no runtime cycle
import {
	braceExpand, REDIRECT_OPS, hasSubPlaceholder, PARSE_BUDGET_SENTINEL, tokenize,
} from "./tokenize.ts";
import * as path from "node:path";
import {
	basenameCmd, deferredScripts, EXEC_BUILTINS, FETCHERS, isDecoder,
	nestedScripts, SHELLS, SOURCE_BUILTINS, STDIN_RUNNERS, unwrap,
} from "./argv.ts";
import {
	emitterScript,
	envExecScripts,
	extractEmbeddedShell,
	fetcherOutputFile,
	loadScriptFiles,
} from "./hardening.ts";

export {
	collapseBrackets, hasSubPlaceholder, heredocSubstitutions, isSubPlaceholder,
	PARSE_BUDGET_SENTINEL, tokenize, type Token,
} from "./tokenize.ts";
export {
	deferredScripts, EXEC_BUILTINS, FETCHERS, isDecoder,
	MAX_UNWRAP_STEPS, nestedScripts, SHELLS, SOURCE_BUILTINS, STDIN_RUNNERS,
	unwrap, unwrapSteps,
} from "./argv.ts";

// Reserved words that precede a command in compound statements. Skipped at
// command position so `then sudo x` / `do rm -r f` still expose the real
// command. `for f in …` degrades to argv ["f","in",…] — harmless noise.
// `coproc <cmd>` runs its command asynchronously with argv[0] hidden at
// argv[1] — skipping it exposes the real command (the compound
// `coproc NAME { … }` form is already split at the `{` boundary).
// `in` is skipped too: after `case $x` the subject word is dropped (see
// pipelines), leaving `in` at command position, where it is never a
// program name.
const RESERVED = new Set([
	"if", "then", "elif", "else", "fi",
	"while", "until", "for", "do", "done",
	"case", "esac", "in", "{", "}", "!", "time", "function", "coproc",
]);

/** One command in a pipeline: its argv plus the inner scripts of any
 * command/process substitutions appearing in its words. */
export interface ShellCommand {
	argv: string[];
	/** Leading VAR=value prefixes dropped from argv. */
	env: string[];
	subs: string[];
	/** Inner scripts of output process substitutions `>(…)` — kept apart
	 * from `subs` because their processes *consume* this pipeline's output
	 * (the out-sub synthesis needs the direction). */
	outSubs: string[];
	/** True when this command executes its stdin and that stdin is fed by a
	 * substitution spelled as a redirect target or herestring (`bash <
	 * <(curl u)`, `bash <<< "$(curl u)"`) — the placeholder never reaches
	 * argv, so the fetch/decoder synthesis needs this flag to correlate. */
	stdinSub: boolean;
	/** Literal `< file` targets. Interpreters that run stdin as a script
	 * (`python3 < /tmp/x.py`) execute these files; they are not argv words. */
	inFiles: string[];
	/** Literal `>`, `>>`, `>|`, `&>` (and `>& file`) targets. `2>&1` is an
	 * fd dup and is not recorded. */
	outFiles: string[];
}

/** Commands connected by `|` / `|&`, in order. */
export type Pipeline = ShellCommand[];

/**
 * Parse a command string into pipelines of simple commands. Pipelines are
 * separated by `;`, `&&`, `||`, `&`, newlines and parentheses. Substitution
 * scripts are attached to the command they appear in (not parsed further;
 * callers recurse via `pipelines(sub)` if needed). Leading VAR=value
 * prefixes are dropped so argv[0] is the program.
 */
export type SequencedPipeline = { pipeline: Pipeline; op: string };

export function pipelines(command: string): Pipeline[] {
	return sequencedPipelines(command).map((u) => u.pipeline);
}

export function sequencedPipelines(command: string): SequencedPipeline[] {
	const result: SequencedPipeline[] = [];
	let pipeline: Pipeline = [];
	let argv: string[] = [];
	let env: string[] = [];
	let subs: string[] = [];
	let outSubs: string[] = [];
	// Pending stdin data (herestrings and heredoc bodies) — script or data
	// depending on the receiving command, decided in flushCommand.
	let herestrings: string[] = [];
	let heredocs: { value: string; subs: string[] }[] = [];
	// The redirect operator whose target word is still pending, so the
	// target can be told apart from arguments — and so a herestring aimed
	// at a shell can be recognized as a script rather than dropped.
	let pendingRedirect: string | null = null;
	// True when a `<` redirect target carried a substitution placeholder —
	// that substitution's output becomes this command's stdin (`bash <
	// <(curl u)`); the target word itself is dropped, so flushCommand
	// records the fact on the command instead.
	let redirectSub = false;
	let inFiles: string[] = [];
	let outFiles: string[] = [];
	// Sequence number of the current simple command, counted exactly like
	// the tokenizer counts it (see tokenize). Heredoc tokens carry the seq
	// of the command that had the << operator, so an operator between <<
	// and the newline (`bash <<EOF | cat`) cannot hand the body to
	// whichever command happens to be open when the body is read — that
	// mis-binding was both a bypass and a `cat <<EOF && bash` false
	// positive.
	let seq = 0;
	const flushedBySeq = new Map<number, { cmd: ShellCommand; pl: Pipeline }>();
	// True right after the RESERVED word `time` — its -p / -- options must
	// be skipped too or they land at argv[0] and hide the real command.
	let afterTime = false;
	// True right after `case` — the next word is the case *subject*
	// (`case $x in …`), an expansion sitting at what looks like command
	// position; skipping it keeps the non-literal-command rule from
	// misreading it as a program name.
	let caseWord = false;

	// Shells run their stdin as a script; GNU parallel hands each line to
	// one; `.`/`source` execute a stdin-spelled file in the current shell.
	const executesStdin = (head: string | undefined) =>
		head !== undefined &&
		(SHELLS.has(head) || STDIN_RUNNERS.has(head) || SOURCE_BUILTINS.has(head));

	const flushCommand = () => {
		// A herestring or heredoc aimed at a shell puts a *script* on its stdin
		// (`bash <<< 'sudo rm -rf /'`, `bash <<EOF … EOF`) — dropping it like a
		// file target would hide the script from every rule. Decided here,
		// once the final argv is known, because bash accepts redirections
		// *before* the command word (`<<<'rm -rf /' bash`). For non-shells
		// (`cat <<EOF … EOF`) the body stays data — minus the substitutions
		// bash expands in unquoted-delimiter heredoc bodies regardless of the
		// receiver — except parallel, which runs its stdin through a shell.
		const head = unwrap(argv)[0];
		const execsStdin = executesStdin(head);
		// A redirect target or herestring carrying a substitution placeholder
		// feeds that substitution's output to this command's stdin — when the
		// command executes stdin, that is fetch-and-execute with one character
		// changed (`bash < <(curl u)` vs `bash <(curl u)`), so mark it for the
		// same synthesis the argv-placeholder spelling gets.
		const stdinSub = execsStdin && (redirectSub || herestrings.some(hasSubPlaceholder));
		if (herestrings.length && execsStdin) subs.push(...herestrings);
		for (const h of heredocs) {
			if (execsStdin) subs.push(h.value);
			else subs.push(...h.subs);
		}
		herestrings = [];
		heredocs = [];
		redirectSub = false;
		const cmd: ShellCommand = { argv, env, subs, outSubs, stdinSub, inFiles, outFiles };
		flushedBySeq.set(seq, { cmd, pl: pipeline });
		if (argv.length || subs.length || outSubs.length || env.length || inFiles.length || outFiles.length) pipeline.push(cmd);
		argv = [];
		env = [];
		subs = [];
		outSubs = [];
		inFiles = [];
		outFiles = [];
		afterTime = false;
		caseWord = false;
	};
	const flushPipeline = (op: string) => {
		flushCommand();
		if (pipeline.length || op === "(" || op === ")") result.push({ pipeline, op });
		pipeline = [];
	};

	// Late-bind a heredoc whose command was already flushed — an operator
	// between << and the newline means the body token arrives after its
	// command.
	const attachHeredoc = (token: { value: string; subs: string[]; cmd: number }) => {
		const rec = flushedBySeq.get(token.cmd);
		if (!rec) return;
		const head = unwrap(rec.cmd.argv)[0];
		const add = executesStdin(head) ? [token.value] : token.subs;
		if (!add.length) return;
		rec.cmd.subs.push(...add);
		// The command (or its whole pipeline) may have been dropped as empty
		// at flush time — reinstate it now that it carries a script.
		if (!rec.pl.includes(rec.cmd)) rec.pl.push(rec.cmd);
		if (rec.pl !== pipeline && !result.includes(rec.pl)) result.push(rec.pl);
	};

	for (const token of tokenize(command)) {
		// Standalone { } group commands without being operators; treat them as
		// boundaries so `function f { sudo x; }` doesn't bury sudo mid-argv.
		if (token.type === "word" && (token.value === "{" || token.value === "}")) {
			flushPipeline(token.value);
			seq++; // the tokenizer counts these boundaries too
			continue;
		}
		if (token.type === "op") {
			if (REDIRECT_OPS.has(token.value)) {
				pendingRedirect = token.value;
				continue;
			}
			pendingRedirect = null;
			// Heredoc delimiter/body are consumed by the tokenizer; << itself does
			// not end the command.
			if (token.value === "<<" || token.value === "<<-") continue;
			if (token.value === "|" || token.value === "|&") flushCommand();
			else flushPipeline(token.value);
			seq++;
			continue;
		}
		if (token.type === "sub") {
			(token.out ? outSubs : subs).push(token.value);
			continue;
		}
		if (token.type === "heredoc") {
			if (token.cmd === seq) heredocs.push(token);
			else attachHeredoc(token);
			continue;
		}
		if (pendingRedirect) {
			const op = pendingRedirect;
			pendingRedirect = null;
			// Herestring data is held until flushCommand decides whether the
			// command is a shell (see comment there); other redirect targets
			// are dropped — except that an input target carrying a
			// substitution placeholder pipes that substitution's output into
			// this command, which flushCommand must know.
			const writes = op === ">" || op === ">>" || op === ">|" || op === "&>"
				|| (op === ">&" && token.value !== "-" && !/^\d+$/.test(token.value));
			if (op === "<<<") herestrings.push(token.value);
			else if (op === "<") {
				if (hasSubPlaceholder(token.value)) redirectSub = true;
				else inFiles.push(token.value);
			} else if (writes) {
				if (!hasSubPlaceholder(token.value)) outFiles.push(token.value);
			}
			continue;
		}
		// Brace expansion may split one word into several (`{rm,-rf,/}` runs
		// `rm -rf /`), so every expanded word lands in argv individually.
		for (const w of braceExpand(token.value)) {
			if (argv.length === 0) {
				if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) { env.push(w); continue; }
				if (RESERVED.has(w)) {
					// bash's `time` keyword accepts -p and -- before the pipeline
					// it times — skipping only the keyword left "-p" at argv[0],
					// hiding the real command from every rule.
					afterTime = w === "time";
					caseWord = w === "case";
					continue;
				}
				if (afterTime && (w === "-p" || w === "--")) continue;
				afterTime = false;
				if (caseWord) { caseWord = false; continue; } // the case subject
				// Path-spelled commands resolve to the basename (see basenameCmd).
				argv.push(basenameCmd(w));
				continue;
			}
			argv.push(w);
		}
	}
	flushPipeline("");
	return result;
}

/**
 * Recursion budget for script re-parsing. Adversarial nesting
 * (`"$(".repeat(3500)`) must degrade to "stop recursing", never overflow
 * the stack — the tool_call handler contract is "never throw" (same
 * budget idea as braceExpand).
 */
export const MAX_PARSE_DEPTH = 64;

/**
 * Cap on pipeline stages analyzed per pipeline. Every stage recurses into
 * its own script sources, so an unbounded `a|a|a|…` (80KB spells ~40k
 * stages) stalls the gate inside tool_call — and a hung gate is a disabled
 * gate. 512 is far beyond any legitimate pipeline.
 */
export const MAX_PIPELINE_STAGES = 512;

/** Pipelines as argv lists, recursing into every script source (command/
 * process substitutions, inline scripts, deferred tasks) and synthesizing
 * `fetcher | shell` pipelines for substitution-fed shells. */
export type TrackedCwd = string | "unknown";
export const pipelineCwd = new WeakMap<string[][], TrackedCwd>();

// PARSE_BUDGET_SENTINEL (re-exported above) lives in tokenize.ts so that
// argv.ts's unwrap-step budget can emit it without an import cycle.

/**
 * Every script source a command carries: its command/process substitution
 * scripts, then the inline scripts (`sh -c '…'`, `eval …`) and deferred
 * tasks (`pueue add …`, `tmux new-session …`, `find -exec …`) of the
 * unwrapped argv, plus local interpreter/shell files those commands run.
 * This is the single walk both `simpleCommands` and `collectPipelines`
 * recurse through — add new script sources here so the two can never
 * diverge. Order contract: `cmd.subs` come first (in order), then
 * `cmd.outSubs` (in order), so callers can correlate the leading entries
 * back to the substitutions.
 */
export function scriptSources(cmd: ShellCommand, cwd?: TrackedCwd, sessionCwd?: string): string[] {
	const argv = unwrap(cmd.argv);
	const base = cwd && cwd !== "unknown" ? cwd : sessionCwd;
	const files = loadScriptFiles(argv, cmd.inFiles ?? [], base);
	return [
		...cmd.subs,
		...cmd.outSubs,
		...nestedScripts(argv),
		...deferredScripts(argv),
		...envExecScripts(cmd.env ?? []),
		...files.filter((s) => s.kind === "shell").map((s) => s.text),
		...files.filter((s) => s.kind === "code").flatMap((s) => extractEmbeddedShell(s.text)),
	];
}

/**
 * Flatten a command string into simple commands (argv arrays), recursing
 * into every script source. Convenience wrapper over `pipelines`.
 */
export function simpleCommands(command: string): string[][] {
	const commands: string[][] = [];
	const walk = (script: string, depth: number) => {
		// Fail closed on depth exhaustion (see PARSE_BUDGET_SENTINEL) so this
		// walk and collectPipelines can never disagree about giving up.
		if (depth > MAX_PARSE_DEPTH) {
			commands.push([PARSE_BUDGET_SENTINEL]);
			return;
		}
		for (const pipeline of pipelines(script)) {
			for (const cmd of pipeline) {
				if (cmd.argv.length) commands.push(cmd.argv);
				for (const s of scriptSources(cmd)) walk(s, depth + 1);
			}
		}
	};
	walk(command, 0);
	return commands;
}

/**
 * A shell (or eval) consuming a `$(…)`/`<(…)` substitution executes its
 * output — when curl/wget produce it, synthesize the equivalent
 * `curl … | shell` pipeline so the pipe-to-shell rule correlates the two
 * (`bash <(curl u)`, `eval "$(curl u)"`, `sh -c "$(wget -qO- u)"`).
 * Decoders get the same synthesis (`eval "$(base64 -d f)"`) for the "shell
 * executes decoded data" rule. The substitution may sit in argv (a
 * placeholder word) or feed stdin via a redirect target or herestring
 * (`bash < <(curl u)`, `bash <<< "$(curl u)"` — `cmd.stdinSub`); both
 * spellings execute the same bytes. Plain substitutions (`$(git rev-parse
 * HEAD)`) synthesize nothing and stay clean. `subPipes` are the
 * already-collected pipelines of `cmd.subs`, in the same order.
 */
function synthesizeFetchExecPipelines(cmd: ShellCommand, subPipes: ArgvPipeline[][]): ArgvPipeline[] {
	const argv = unwrap(cmd.argv);
	if (!(SHELLS.has(argv[0]) || EXEC_BUILTINS.has(argv[0]))) return [];
	if (!cmd.argv.some(hasSubPlaceholder) && !cmd.stdinSub) return [];
	const synthesized: ArgvPipeline[] = [];
	for (const pipes of subPipes) {
		for (const sp of pipes) {
			if (sp.some((stage) => FETCHERS.has(unwrap(stage)[0]) || isDecoder(stage))) {
				synthesized.push([...sp, cmd.argv]);
			}
		}
	}
	return synthesized;
}

/**
 * An output process substitution whose sub-pipeline starts with a bare
 * shell (`tee >(sh)`, `cmd > >(bash)`) feeds the surrounding pipeline's
 * data into that shell — synthesize `upstream… | shell` so "shell executes
 * stdin" can correlate the two. `upstream` is the outer pipeline up to and
 * including the command carrying the substitution; `outSubPipes` are the
 * already-collected pipelines of `cmd.outSubs`. The stdin rule applies its
 * own bareness check, so `>(sh -c '…')` is synthesized but does not fire.
 */
function synthesizeOutSubPipelines(upstream: ArgvPipeline, outSubPipes: ArgvPipeline[][]): ArgvPipeline[] {
	if (!upstream.length) return [];
	const synthesized: ArgvPipeline[] = [];
	for (const pipes of outSubPipes) {
		for (const sp of pipes) {
			if (sp.length && SHELLS.has(unwrap(sp[0])[0])) {
				synthesized.push([...upstream, ...sp]);
			}
		}
	}
	return synthesized;
}

function applyCd(argv: string[], cwd: TrackedCwd | undefined, sessionCwd?: string): TrackedCwd | undefined {
	const u = unwrap(argv);
	if (u[0] !== "cd") return cwd;
	const dests: string[] = [];
	for (let i = 1; i < u.length; i++) {
		const a = u[i];
		if (a === "--") continue;
		if (a === "-") { dests.push("-"); continue; }
		if (a.startsWith("-")) continue;
		dests.push(a);
	}
	const dest = dests[0];
	if (!dest) {
		const home = process.env.HOME;
		return home ? path.posix.normalize(home) : "unknown";
	}
	if (dest === "-" || dest.includes("$") || hasSubPlaceholder(dest) || dest.startsWith("~")) return "unknown";
	if (dest.startsWith("/")) return path.posix.normalize(dest);
	const base = cwd && cwd !== "unknown" ? cwd : sessionCwd;
	if (!base) return "unknown";
	return path.posix.normalize(path.posix.join(base, dest));
}

function sameFile(a: string, b: string): boolean {
	return a === b || path.posix.basename(a) === path.posix.basename(b);
}

function isShellOfFile(argv: string[], file: string): boolean {
	const u = unwrap(argv);
	if (SHELLS.has(u[0]) || SOURCE_BUILTINS.has(u[0])) {
		return u.slice(1).some((a) => a === "--" || (!a.startsWith("-") && sameFile(a, file)));
	}
	const base = path.posix.basename(file);
	return u[0] === file || u[0] === "./" + file || u[0] === "./" + base || path.posix.basename(u[0]) === base;
}

function emitPipeline(full: Pipeline, depth: number, cwd: TrackedCwd | undefined, sessionCwd?: string): ArgvPipeline[] {
	const over = full.length > MAX_PIPELINE_STAGES;
	const p = over ? full.slice(0, MAX_PIPELINE_STAGES) : full;
	const argvPipe = p.map((c) => c.argv).filter((argv) => argv.length);
	if (cwd && argvPipe.length) pipelineCwd.set(argvPipe, cwd);
	const nested: ArgvPipeline[] = [];
	for (let ci = 0; ci < p.length; ci++) {
		const c = p[ci];
		const nextOpts = sessionCwd ? { sessionCwd } : undefined;
		const sourcePipes = scriptSources(c, cwd, sessionCwd).map((s) => collectPipelines(s, depth + 1, nextOpts));
		const subPipes = sourcePipes.slice(0, c.subs.length);
		const outSubPipes = sourcePipes.slice(c.subs.length, c.subs.length + c.outSubs.length);
		const upstream = c.outSubs.length
			? p.slice(0, ci + 1).map((x) => x.argv).filter((argv) => argv.length)
			: [];
		nested.push(
			...sourcePipes.flat(),
			...synthesizeFetchExecPipelines(c, subPipes),
			...synthesizeOutSubPipelines(upstream, outSubPipes),
		);
		const head = unwrap(c.argv)[0];
		if ((SHELLS.has(head) || EXEC_BUILTINS.has(head)) && (c.argv.some(hasSubPlaceholder) || c.stdinSub)) {
			for (const sub of c.subs) {
				const units = pipelines(sub);
				if (units.length === 1 && units[0].length === 1) {
					const emitted = emitterScript(units[0][0].argv);
					if (emitted) nested.push(...collectPipelines(emitted, depth + 1, nextOpts));
				}
			}
		}
	}
	return [argvPipe, ...nested, ...(over ? [[[PARSE_BUDGET_SENTINEL]]] : [])].filter((pl) => pl.length);
}

export function collectPipelines(script: string, depth = 0, opts?: { sessionCwd?: string }): ArgvPipeline[] {
	if (depth > MAX_PARSE_DEPTH) return [[[PARSE_BUDGET_SENTINEL]]];
	if (depth > 0) {
		return sequencedPipelines(script).flatMap((u) => emitPipeline(u.pipeline, depth, undefined, opts?.sessionCwd));
	}
	let cwd: TrackedCwd | undefined;
	const stack: Array<TrackedCwd | undefined> = [];
	const downloads: { file: string; argv: string[] }[] = [];
	const out: ArgvPipeline[] = [];
	for (const unit of sequencedPipelines(script)) {
		out.push(...emitPipeline(unit.pipeline, depth, cwd, opts?.sessionCwd));
		for (const cmd of unit.pipeline) {
			const file = fetcherOutputFile(cmd.argv);
			if (file) downloads.push({ file, argv: cmd.argv });
			for (const d of downloads) {
				if (isShellOfFile(cmd.argv, d.file)) {
					out.push([d.argv, cmd.argv]);
				}
			}
		}
		const op = unit.op;
		if (unit.pipeline.length === 1 && (op === "&&" || op === ";" || op === "\n" || op === "" || op === ")")) {
			cwd = applyCd(unit.pipeline[0].argv, cwd, opts?.sessionCwd);
		}
		if (op === "(") stack.push(cwd);
		if (op === ")") cwd = stack.pop();
	}
	return out;
}

/** Bodies of local files an interpreter or shell will execute, for regex rules. */
export function collectFileScriptBodies(command: string, sessionCwd?: string): string {
	const chunks: string[] = [];
	const seen = new Set<string>();
	const walk = (script: string, depth: number, cwd?: string) => {
		if (depth > MAX_PARSE_DEPTH) return;
		for (const unit of sequencedPipelines(script)) {
			for (const cmd of unit.pipeline) {
				for (const file of loadScriptFiles(unwrap(cmd.argv), cmd.inFiles ?? [], cwd)) {
					if (seen.has(file.path)) continue;
					seen.add(file.path);
					chunks.push(file.text);
					if (file.kind === "shell") walk(file.text, depth + 1, cwd);
				}
				const argv = unwrap(cmd.argv);
				for (const inner of [...cmd.subs, ...cmd.outSubs, ...nestedScripts(argv), ...deferredScripts(argv)]) {
					walk(inner, depth + 1, cwd);
				}
			}
		}
	};
	walk(command, 0, sessionCwd);
	return chunks.join("\n");
}
