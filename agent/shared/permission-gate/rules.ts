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
 * This remains a confirmation layer, not a sandbox. File contents, later
 * cron payloads, and commands on another machine still need OS isolation.
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
		extraRules: [
			{
				label: "docker prune",
				group: "files",
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
