/**
 * bun:test preload.
 *
 * The plugin tree imports @earendil-works/pi-coding-agent, which ships only in
 * the Nix-store pi package and is therefore unresolvable from this checkout.
 * Stub the handful of values the tested modules actually pull from it so unit
 * tests need neither the store path nor a running pi.
 */
import { mock } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-hashline-test-"));

mock.module("@earendil-works/pi-coding-agent", () => ({
	getAgentDir: () => AGENT_DIR,
	DEFAULT_MAX_LINES: 2000,
	DEFAULT_MAX_BYTES: 50 * 1024,
	formatSize: (n: number) => `${n}B`,
	truncateHead: (text: string) => ({ content: text, truncated: false }),
	createReadTool: () => ({}),
	withFileMutationQueue: async <T>(_p: string, fn: () => Promise<T>) => fn(),
}));

export { AGENT_DIR };
