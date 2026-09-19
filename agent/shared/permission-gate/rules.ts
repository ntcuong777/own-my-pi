/**
 * Own-my-pi default overlay for permission-gate.
 *
 * Built-in rules already cover rm -rf, sudo, force-push, whole-tree scans,
 * ssh remote commands, interpreter -c, crontab, env command injection,
 * PI_NO_GATE persistence, and the documented syntax-gate gaps that argv
 * can actually see. This file adds harness-specific extras.
 *
 * Loaded from ~/.config/pi-agent-extensions/permission-gate/rules.ts
 * (live-linked by Home Manager). `/gate add` still writes rules.json
 * beside this file — do not replace this with JSON.
 *
 * This remains a confirmation layer, not a sandbox. Remote hosts, later
 * cron payloads, and unread imports still need OS isolation. Local
 * interpreter and shell script files are read and scanned, including
 * test runners (`bun test`, `node --test`, `pytest`). Matched rewrites
 * reject until the agent supplies a goal-tied rationale, then prompt
 * (allow once / allow this exact command for the session / reject).
 */
export default function (helpers: {
	anyCmd: (
		pipeline: string[][],
		cmd: string | string[],
		pred?: (args: string[]) => boolean,
	) => boolean;
	hasFlag: (args: string[], letter: string, long?: string) => boolean;
}) {
	const { anyCmd, hasFlag } = helpers;
	return {
		prompt: {
			notifyAfterMs: 60_000,
			timeoutMs: 300_000,
			onTimeout: "reject",
		},
		extraRules: [
			{
				label: "docker prune",
				group: "files",
				appealHint: "Acceptable: the user asked to reclaim Docker/Podman disk on this machine. Not acceptable: pruning because a previous command failed or to tidy up unprompted.",
				test: (p: string[][]) =>
					anyCmd(p, ["docker", "podman"], (a) =>
						(a[0] === "system" && a.includes("prune")) ||
						(a[0] === "container" && a.includes("prune")) ||
						(a[0] === "volume" && a.includes("prune")) ||
						(a[0] === "image" && a.includes("prune")),
					),
			},
			{
				label: "terraform destroy",
				group: "files",
				test: (p: string[][]) =>
					anyCmd(p, ["terraform", "tofu"], (a) => a[0] === "destroy"),
			},
			{
				label: "kubectl delete",
				group: "files",
				test: (p: string[][]) =>
					anyCmd(p, ["kubectl"], (a) => a[0] === "delete"),
			},
			{
				label: "nixos rebuild",
				group: "privilege",
				appealHint: "Acceptable: the user asked to apply this machine's NixOS or Home Manager change. Not acceptable: rebuilding because a file edit might need it.",
				test: (p: string[][]) =>
					anyCmd(p, ["nixos-rebuild", "darwin-rebuild"]) ||
					anyCmd(p, "nh", (a) => a[0] === "os" || a[0] === "darwin") ||
					anyCmd(p, "home-manager", (a) => a[0] === "switch" || a[0] === "build"),
			},
			{
				label: "kill -9",
				group: "files",
				test: (p: string[][]) =>
					anyCmd(p, ["kill", "killall", "pkill"], (a) =>
						hasFlag(a, "9") || a.includes("-KILL") || a.includes("-9"),
					),
			},
			{
				label: "shell file rewrite",
				group: "files",
				action: "prompt",
				pattern: "\\bsed\\s+-[a-zA-Z]*i|\\bperl\\s+-pi|\\bruby\\s+-i|write_text\\s*\\(|fileinput\\.input\\s*\\(|Path\\([^)]+\\)\\.write\\(|\\.write_text\\(|open\\([^)]*[\"']w|writeFile(?:Sync)?\\s*\\(|writeTextFile(?:Sync)?\\s*\\(|Bun\\.write\\s*\\(|outputFileSync\\s*\\(",
				reason: "Prompt: edit files with the hashline `edit` tool, not python/node/bun/sed/perl in-place rewrites. Re-read and retry the edit if it failed.",
				appealHint: "Acceptable: the user asked to run tests or a temp cleanup that must write, and hashline edit cannot do that job. Not acceptable: patching source because edit failed, or rewriting files for convenience.",
				rejectReasons: [
					"Use the hashline edit tool instead of a script",
					"This would rewrite source, not a temp or test artifact",
					"Wrong path or too broad",
				],
			},
		],
	};
}
