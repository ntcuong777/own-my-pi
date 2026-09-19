/**
 * Extra argv knowledge used to close documented syntax-gate gaps.
 * Still a confirmation layer, not a sandbox: unread imports, remote hosts,
 * and later cron payloads cannot be proven safe from argv alone. Local
 * interpreter/shell script operands are read and scanned.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { hasSubPlaceholder } from "./tokenize.ts";
import {
	FETCHERS,
	SHELLS,
	SOURCE_BUILTINS,
	unwrap,
	unwrapSteps,
} from "./argv.ts";

const ENV_ASSIGN = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

/** Environment variables whose value is executed as a command. */
export const ENV_EXEC_VARS = new Set([
	"GIT_PAGER", "GIT_EDITOR", "GIT_SEQUENCE_EDITOR", "GIT_SSH_COMMAND",
	"PAGER", "EDITOR", "VISUAL", "FCEDIT", "SUDO_EDITOR", "SELECTED_EDITOR",
	"BASH_ENV", "ENV", "PROMPT_COMMAND", "PS0",
	"GIT_EXTERNAL_DIFF",
]);

export function envExecScripts(assignments: string[]): string[] {
	const scripts: string[] = [];
	for (const a of assignments) {
		const m = ENV_ASSIGN.exec(a);
		if (!m) continue;
		if (ENV_EXEC_VARS.has(m[1]) && m[2]) scripts.push(m[2]);
	}
	return scripts;
}

export function envWrapperAssignments(argv: string[]): string[] {
	const out: string[] = [];
	const words = unwrap(argv)[0] === "env" ? unwrap(argv) : argv[0] === "env" ? argv : [];
	const src = argv[0] === "env" ? argv : words[0] === "env" ? words : [];
	const step = src.length ? src : unwrapSteps(argv).find((s) => s[0] === "env") ?? [];
	for (let i = 1; i < step.length; i++) {
		if (ENV_ASSIGN.test(step[i])) out.push(step[i]);
		else if (step[i].startsWith("-")) {
			if (step[i] === "-u" || step[i] === "-C" || step[i] === "--unset" || step[i] === "--chdir") i++;
		} else break;
	}
	return out;
}

export function fetcherOutputFile(rawArgv: string[]): string | undefined {
	const [cmd, ...args] = unwrap(rawArgv);
	if (!FETCHERS.has(cmd) && !EXTRA_FETCHERS.has(cmd)) return undefined;
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === "-o" || a === "--output" || a === "-O" || a === "--output-document") {
			return args[i + 1];
		}
		if (a.startsWith("--output=") || a.startsWith("--output-document=")) {
			return a.slice(a.indexOf("=") + 1);
		}
	}
	return undefined;
}

export function emitterScript(rawArgv: string[]): string | undefined {
	const argv = unwrap(rawArgv);
	if (argv[0] === "echo") {
		let i = 1;
		while (i < argv.length && /^-[neE]+$/.test(argv[i])) i++;
		const rest = argv.slice(i).join(" ");
		return rest || undefined;
	}
	if (argv[0] === "printf") {
		let i = 1;
		if (argv[i] && argv[i].startsWith("-")) i++;
		const rest = argv.slice(i).join(" ");
		return rest || undefined;
	}
	return undefined;
}

function flagValue(args: string[], flag: RegExp): string | undefined {
	for (let i = 0; i < args.length; i++) {
		if (flag.test(args[i])) return args[i + 1];
	}
	return undefined;
}

function pythonInline(args: string[]): string | undefined {
	return flagValue(args, /^-c$/) ?? flagValue(args, /^--command$/);
}

function nodeInline(args: string[]): string | undefined {
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === "-e" || a === "-p" || a === "--eval" || a === "--print") return args[i + 1];
		if (a.startsWith("--eval=") || a.startsWith("--print=")) return a.slice(a.indexOf("=") + 1);
	}
	return undefined;
}

const INTERPRETER_INLINE: Record<string, (args: string[]) => string | undefined> = {
	python: pythonInline,
	python3: pythonInline,
	python2: pythonInline,
	pypy: pythonInline,
	pypy3: pythonInline,
	perl: (a) => flagValue(a, /^-[a-zA-Z]*e[a-zA-Z]*$/),
	ruby: (a) => flagValue(a, /^-[a-zA-Z]*e[a-zA-Z]*$/),
	node: nodeInline,
	nodejs: nodeInline,
	bun: nodeInline,
	tsx: nodeInline,
	"ts-node": nodeInline,
	"ts-node-esm": nodeInline,
	php: (a) => flagValue(a, /^-[a-zA-Z]*r[a-zA-Z]*$/),
	lua: (a) => flagValue(a, /^-e$/),
	osascript: (a) => flagValue(a, /^-e$/),
	pwsh: (a) => flagValue(a, /^-Command$/) ?? flagValue(a, /^--command$/),
	powershell: (a) => flagValue(a, /^-Command$/),
	julia: (a) => flagValue(a, /^-e$/),
	Rscript: (a) => flagValue(a, /^-e$/),
};

export function extractEmbeddedShell(code: string): string[] {
	const out: string[] = [];
	const re =
		/(?:os\.system|os\.popen|os\.execv|subprocess\.(?:call|run|Popen|check_output|check_call)|execSync|execFileSync|exec(?:l|lp|le|v|vp)?|system|popen)\s*\(\s*(['"])([\s\S]*?)\1/g;
	for (let m = re.exec(code); m; m = re.exec(code)) out.push(m[2]);
	return out;
}

export function interpreterScripts(argv: string[]): string[] {
	const pick = INTERPRETER_INLINE[argv[0]];
	if (!pick) return [];
	const code = pick(argv.slice(1));
	if (!code) return [];
	return [code, ...extractEmbeddedShell(code)];
}

export function isInlineInterpreter(argv: string[]): boolean {
	const pick = INTERPRETER_INLINE[argv[0]];
	return !!pick && pick(argv.slice(1)) !== undefined;
}

const SSH_VALUE_OPTS = new Set([
	"-o", "-i", "-F", "-l", "-p", "-b", "-c", "-D", "-E", "-e", "-L", "-R", "-W",
	"-J", "-Q", "-S", "-w",
]);

export function sshRemoteScript(argv: string[]): string | undefined {
	if (argv[0] !== "ssh") return undefined;
	let i = 1;
	while (i < argv.length) {
		const a = argv[i];
		if (a === "--") { i++; break; }
		if (SSH_VALUE_OPTS.has(a)) { i += 2; continue; }
		if (a.startsWith("-")) { i++; continue; }
		break;
	}
	if (i + 1 >= argv.length) return undefined;
	return argv.slice(i + 1).join(" ");
}

export function extraDecoder(rawArgv: string[]): boolean {
	const [cmd, ...args] = unwrap(rawArgv);
	if (cmd === "base32" || cmd === "xxd" || cmd === "uudecode") return true;
	if (cmd === "zcat" || cmd === "gzcat" || cmd === "xzcat" || cmd === "bzcat" || cmd === "lzcat") return true;
	if ((cmd === "gzip" || cmd === "gunzip" || cmd === "bzip2" || cmd === "xz" || cmd === "zstd") &&
		args.some((a) => a === "-d" || a === "--decompress" || a === "-dc" || a === "-c")) return true;
	if (cmd === "openssl" && args.some((a) => a === "enc" || a === "base64") &&
		args.some((a) => a === "-d" || a === "-base64")) return true;
	if (cmd === "gpg" && args.some((a) => a === "-d" || a === "--decrypt")) return true;
	return false;
}

export const EXTRA_FETCHERS = new Set(["wget2", "aria2c", "http", "https", "httpie", "fetch"]);

const MAX_SCRIPT_BYTES = 256 * 1024;

const PYTHON_HEADS = new Set(["python", "python2", "python3", "pypy", "pypy3"]);
const PYTHON_VALUE_OPTS = new Set(["-W", "-X", "--check-hash-based-pycs"]);
const SHELL_VALUE_OPTS = new Set(["-c", "-o", "-O"]);
const NODE_HEADS = new Set(["node", "nodejs", "tsx", "ts-node", "ts-node-esm"]);
const NODE_VALUE_OPTS = new Set([
	"-e", "-p", "-r", "-c", "--eval", "--print", "--require", "--import",
	"--loader", "--input-type", "--conditions", "-C",
]);
const RUBY_VALUE_OPTS = new Set(["-e", "-r", "-I", "-C", "-E"]);
const PERL_VALUE_OPTS = new Set(["-e", "-E", "-I", "-m", "-M"]);
const BUN_VALUE_OPTS = new Set([
	"-e", "--eval", "-p", "--print", "-r", "--preload", "--require", "--import",
	"--inspect", "--inspect-wait", "--inspect-brk",
	"--cpu-prof-name", "--cpu-prof-dir", "--cpu-prof-interval",
	"--heap-prof-name", "--heap-prof-dir",
	"--install", "--port", "--conditions", "--fetch-preconnect",
	"--max-http-header-size", "--dns-result-order", "--title",
	"--cwd", "--config", "-c", "--env-file", "--define", "--loader",
]);
const BUN_SKIP_SUBS = new Set([
	"install", "i", "add", "a", "remove", "rm", "update", "audit",
	"outdated", "link", "unlink", "publish", "patch", "pm", "info", "why",
	"build", "init", "create", "c", "upgrade", "feedback", "repl",
]);
const BUN_TEST_VALUE_OPTS = new Set([
	"--timeout", "-t", "--bail", "--reporter", "--preload", "--filter",
	"--test-name-pattern", "--rerun-each", "--max-concurrency", "--seed",
	"--coverage-reporter", "--coverage-dir",
]);
const PYTEST_HEADS = new Set(["pytest", "py.test", "pytest-3"]);
const PYTEST_MODULES = new Set(["pytest", "unittest", "nose", "nose2"]);
const JS_PATH = /\.(c|m)?[jt]sx?$/;
const PRELOAD_FLAGS = new Set(["-r", "--require", "--import", "--preload", "--loader"]);

export type LoadedScript = {
	path: string;
	text: string;
	kind: "shell" | "code";
};

function firstPositional(args: string[], valueOpts: Set<string>): string | undefined {
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === "--") return args[i + 1];
		if (valueOpts.has(a)) {
			i++;
			continue;
		}
		if (a.startsWith("-") && a !== "-") continue;
		return a;
	}
	return undefined;
}

function skipValueFlags(args: string[], valueOpts: Set<string>): string[] {
	const out: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === "--") {
			out.push(...args.slice(i + 1));
			break;
		}
		if (valueOpts.has(a)) {
			i++;
			continue;
		}
		if (a.startsWith("--") && a.includes("=")) continue;
		if (a.startsWith("-") && a !== "-") continue;
		out.push(a);
	}
	return out;
}

function positionalFiles(args: string[], valueOpts: Set<string> = new Set()): string[] {
	return skipValueFlags(args, valueOpts).filter((a) => a && a !== "-");
}

function pythonModule(args: string[]): { module: string; rest: string[] } | undefined {
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === "-m" && args[i + 1]) return { module: args[i + 1], rest: args.slice(i + 2) };
		if (a.startsWith("-m") && a.length > 2) return { module: a.slice(2), rest: args.slice(i + 1) };
	}
	return undefined;
}

function pytestModule(name: string): boolean {
	const root = name.split(".")[0];
	return PYTEST_MODULES.has(root);
}

function isJsPath(file: string): boolean {
	return JS_PATH.test(file) || file.startsWith(".") || file.includes("/");
}

function preloadFilePaths(args: string[]): string[] {
	const out: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (PRELOAD_FLAGS.has(a) && args[i + 1]) {
			out.push(args[++i]);
			continue;
		}
		for (const flag of PRELOAD_FLAGS) {
			if (flag.startsWith("--") && a.startsWith(flag + "=")) {
				out.push(a.slice(flag.length + 1));
			}
		}
	}
	return out;
}

function bunFilePaths(head: string, args: string[], inFiles: string[]): string[] {
	const preloads = preloadFilePaths(args);
	if (nodeInline(args) !== undefined) return preloads;
	if (head === "bunx") {
		const rest = skipValueFlags(args, BUN_VALUE_OPTS);
		if (!rest.length) return [...preloads, ...inFiles];
		if (isJsPath(rest[0])) return [...preloads, rest[0]];
		return [...preloads, ...interpreterFilePaths(rest, inFiles)];
	}
	const rest = skipValueFlags(args, BUN_VALUE_OPTS);
	const sub = rest[0];
	if (!sub) return [...preloads, ...inFiles];
	if (sub === "x") return [...preloads, ...bunFilePaths("bunx", rest.slice(1), inFiles)];
	if (sub === "test") {
		return [...preloads, ...positionalFiles(rest.slice(1), BUN_TEST_VALUE_OPTS)];
	}
	if (BUN_SKIP_SUBS.has(sub)) return [];
	if (sub === "exec" || sub === "run") {
		const file = rest[1];
		if (file && file !== "-") return [...preloads, file];
		return [...preloads, ...inFiles];
	}
	return [...preloads, sub];
}

function bunExec(argv: string[]): boolean {
	if (argv[0] !== "bun") return false;
	return skipValueFlags(argv.slice(1), BUN_VALUE_OPTS)[0] === "exec";
}

function pythonFileArg(args: string[]): string | undefined | null {
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === "--") return args[i + 1];
		if (a === "-c" || a === "--command" || a.startsWith("--command=") ||
			(a.startsWith("-c") && a.length > 2)) return null;
		if (a === "-m" || (a.startsWith("-m") && a.length > 2)) return null;
		if (PYTHON_VALUE_OPTS.has(a)) {
			i++;
			continue;
		}
		if (a.startsWith("-W") || a.startsWith("-X") || a.startsWith("--check-hash-based-pycs=")) continue;
		if (a.startsWith("-") && a !== "-") continue;
		return a;
	}
	return undefined;
}

function hasShellDashC(args: string[]): boolean {
	return args.some((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a));
}

/**
 * File operands an interpreter or shell will execute (`python3 /tmp/x.py`,
 * `bash patch.sh`, `source ./x.sh`, `bun /tmp/x.ts`, `bun test x.test.ts`,
 * `python3 -m pytest tests/foo.py`). Inline `-c`/`-e` spellings return
 * nothing — those bodies already sit in argv. `null` from python means
 * `-c`/`-m` so stdin redirects are ignored too, except pytest/unittest
 * modules whose remaining positionals are test files.
 */
export function interpreterFilePaths(argv: string[], inFiles: string[] = []): string[] {
	const head = argv[0];
	if (!head) return [];
	const args = argv.slice(1);
	if (SOURCE_BUILTINS.has(head)) {
		const file = firstPositional(args, new Set());
		if (file && file !== "-") return [file];
		return inFiles;
	}
	if (SHELLS.has(head)) {
		if (hasShellDashC(args)) return [];
		const file = firstPositional(args, SHELL_VALUE_OPTS);
		if (file && file !== "-") return [file];
		return inFiles;
	}
	if (PYTHON_HEADS.has(head)) {
		const mod = pythonModule(args);
		if (mod && pytestModule(mod.module)) return positionalFiles(mod.rest);
		const file = pythonFileArg(args);
		if (file === null) return [];
		if (file && file !== "-") return [file];
		return inFiles;
	}
	if (PYTEST_HEADS.has(head)) return positionalFiles(args);
	if (head === "bun" || head === "bunx") return bunFilePaths(head, args, inFiles);
	if (NODE_HEADS.has(head)) {
		const preloads = preloadFilePaths(args);
		if (nodeInline(args) !== undefined) return preloads;
		const withoutTest = args.filter((a) => a !== "--test");
		const file = firstPositional(withoutTest, NODE_VALUE_OPTS);
		if (head === "tsx" && file === "watch") {
			const idx = args.indexOf("watch");
			const after = firstPositional(args.slice(idx + 1), NODE_VALUE_OPTS);
			if (after && after !== "-") return [...preloads, after];
			return [...preloads, ...inFiles];
		}
		if (file && file !== "-") return [...preloads, file];
		return [...preloads, ...inFiles];
	}
	const pick = INTERPRETER_INLINE[head];
	if (pick) {
		if (pick(args) !== undefined) return [];
		const valueOpts =
			head === "ruby" ? RUBY_VALUE_OPTS
			: head === "perl" ? PERL_VALUE_OPTS
			: new Set<string>();
		const file = firstPositional(args, valueOpts);
		if (file && file !== "-") return [file];
		return inFiles;
	}
	return [];
}

function unsafeScriptPath(file: string): boolean {
	return file.includes("$") || file.includes("`") || /[?*[]/.test(file) || hasSubPlaceholder(file);
}

export function loadScriptFiles(argv: string[], inFiles: string[], cwd?: string): LoadedScript[] {
	const head = argv[0];
	const kind: LoadedScript["kind"] =
		SHELLS.has(head) || SOURCE_BUILTINS.has(head) || bunExec(argv) ? "shell" : "code";
	const out: LoadedScript[] = [];
	for (const rel of interpreterFilePaths(argv, inFiles)) {
		if (!rel || unsafeScriptPath(rel)) continue;
		const abs = path.isAbsolute(rel) ? rel : path.resolve(cwd ?? process.cwd(), rel);
		try {
			const st = fs.statSync(abs);
			if (!st.isFile()) continue;
			const text = fs.readFileSync(abs, "utf8").slice(0, MAX_SCRIPT_BYTES);
			out.push({ path: abs, text, kind });
		} catch {
			// Missing or unreadable: still unprovable from argv.
		}
	}
	return out;
}
