/**
 * Extra argv knowledge used to close documented syntax-gate gaps.
 * Still a confirmation layer, not a sandbox: file contents, remote hosts,
 * and later cron payloads cannot be proven safe from argv alone.
 */

import {
	FETCHERS,
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

const INTERPRETER_INLINE: Record<string, (args: string[]) => string | undefined> = {
	python: pythonInline,
	python3: pythonInline,
	python2: pythonInline,
	pypy: pythonInline,
	pypy3: pythonInline,
	perl: (a) => flagValue(a, /^-[a-zA-Z]*e[a-zA-Z]*$/),
	ruby: (a) => flagValue(a, /^-[a-zA-Z]*e[a-zA-Z]*$/),
	node: (a) => flagValue(a, /^-[ep]$/) ?? flagValue(a, /^--eval$/),
	nodejs: (a) => flagValue(a, /^-[ep]$/) ?? flagValue(a, /^--eval$/),
	php: (a) => flagValue(a, /^-[a-zA-Z]*r[a-zA-Z]*$/),
	lua: (a) => flagValue(a, /^-e$/),
	osascript: (a) => flagValue(a, /^-e$/),
	pwsh: (a) => flagValue(a, /^-Command$/) ?? flagValue(a, /^--command$/),
	powershell: (a) => flagValue(a, /^-Command$/),
	julia: (a) => flagValue(a, /^-e$/),
	Rscript: (a) => flagValue(a, /^-e$/),
};

function extractEmbeddedShell(code: string): string[] {
	const out: string[] = [];
	const re =
		/(?:os\.system|os\.popen|os\.execv|subprocess\.(?:call|run|Popen|check_output|check_call)|exec(?:l|lp|le|v|vp)?|system|popen)\s*\(\s*(['"])([\s\S]*?)\1/g;
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
