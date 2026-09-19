/**
 * permission-gate — non-temp files a command would create or truncate
 * via `>`, `>>`, tee, or `dd of=`. Heredoc *bodies* are not inspected;
 * only redirect operators and argv (tee/dd) count.
 */

import { homedir, tmpdir } from "node:os";
import {
	hasSubPlaceholder,
	MAX_PARSE_DEPTH,
	scriptSources,
	sequencedPipelines,
	unwrap,
} from "./shell.ts";

const TEMP_WRITE =
	/^(?:\/tmp\/|\/var\/tmp\/|\/private\/tmp\/|\/dev\/(?:null|zero|stdout|stderr|tty|fd\/))/;

/** True when a redirect/tee/dd target is a working-tree (or other non-temp) file. */
export function isProjectWriteTarget(file: string): boolean {
	const target = file.trim();
	if (!target || target === "-" || /^\d+$/.test(target)) return false;
	if (hasSubPlaceholder(target) || target.includes("$")) return false;
	const expanded = target === "~" || target.startsWith("~/")
		? homedir() + target.slice(1)
		: target;
	const n = expanded.replace(/\\/g, "/");
	if (TEMP_WRITE.test(n) || n === "/tmp" || n === "/var/tmp") return false;
	const tmp = tmpdir().replace(/\/+$/, "");
	if (tmp && (n === tmp || n.startsWith(tmp + "/"))) return false;
	return true;
}

function teeOutputFiles(argv: string[]): string[] {
	const u = unwrap(argv);
	if (u[0] !== "tee") return [];
	const files: string[] = [];
	for (let i = 1; i < u.length; i++) {
		const a = u[i];
		if (a === "--") {
			files.push(...u.slice(i + 1).filter((name) => name && name !== "-"));
			break;
		}
		if (a === "-" || a.startsWith("-")) continue;
		files.push(a);
	}
	return files;
}

function ddOutputFile(argv: string[]): string[] {
	const u = unwrap(argv);
	if (u[0] !== "dd") return [];
	return u.slice(1).filter((a) => a.startsWith("of=")).map((a) => a.slice(3));
}

/** Non-temp files this command would create or truncate via redirect, tee, or dd. */
export function collectProjectWriteTargets(command: string, sessionCwd?: string): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	const add = (file: string) => {
		if (!isProjectWriteTarget(file) || seen.has(file)) return;
		seen.add(file);
		out.push(file);
	};
	const walk = (script: string, depth: number) => {
		if (depth > MAX_PARSE_DEPTH) return;
		for (const unit of sequencedPipelines(script)) {
			for (const cmd of unit.pipeline) {
				for (const f of cmd.outFiles ?? []) add(f);
				for (const f of teeOutputFiles(cmd.argv)) add(f);
				for (const f of ddOutputFile(cmd.argv)) add(f);
				for (const inner of scriptSources(cmd, undefined, sessionCwd)) walk(inner, depth + 1);
			}
		}
	};
	walk(command, 0);
	return out;
}
