/**
 * Own-my-pi default overlay for permission-gate.
 *
 * Built-in rules already cover rm -rf, sudo, force-push, whole-tree scans,
 * ssh remote commands, interpreter -c, crontab, env command injection,
 * PI_NO_GATE persistence, python/sed/perl/cat/tee file rewrites (hard
 * block, not appealable), shell rg/grep file searches (use hashline
 * `grep` for LINE#HASH edit anchors; piped filters stay allowed), and
 * the documented syntax-gate gaps that argv can actually see. This file
 * adds harness-specific extras.
 *
 * Loaded from ~/.config/pi-agent-extensions/permission-gate/rules.ts
 * (live-linked by Home Manager). `/gate add` still writes rules.json
 * beside this file — do not replace this with JSON.
 *
 * This remains a confirmation layer, not a sandbox. Remote hosts, later
 * cron payloads, and unread imports still need OS isolation. Local
 * interpreter and shell script files are read and scanned, including
 * test runners (`bun test`, `node --test`, `pytest`). File rewrites are
 * a built-in hard block. A later run of a session-allowed command still
 * warns if it matches.
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
				label: "shell rg/grep",
				group: "scan",
				reason:
					"Use the hashline `grep` tool, not shell rg/grep. Hashline grep returns `LINE#HASH:content` anchors you can pass straight to `edit`. Shell rg/grep is not hashed — copying line numbers from it into `edit` will miss or go stale.",
				appealHint:
					"Acceptable: filtering command output (already allowed for `| grep`), `rg --files`, or features hashline grep cannot express (`--replace`, `--pre`, `--json` output, remote host, zip, follow, or stdin). Hashline grep now covers hidden files, type filters, multiple globs, no-ignore searches, and pagination. Not acceptable: using shell rg/grep to find code to edit.",
				test: (p: string[][]) => {
					const head = p[0];
					if (!head) return false;
					return anyCmd([head], ["rg", "grep"], (a) =>
						!a.includes("--files") && !a.includes("--files-without-match"),
					);
				},
			},
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
		],
	};
}
