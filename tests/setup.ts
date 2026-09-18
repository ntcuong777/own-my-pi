/**
 * bun:test preload.
 *
 * The plugin tree imports @earendil-works/pi-coding-agent and
 * @earendil-works/pi-tui, which ship only in the Nix-store pi package and are
 * therefore unresolvable from this checkout. Stub the handful of values the
 * tested modules actually pull from them so unit tests need neither the store
 * path nor a running pi.
 *
 * Keep these stubs minimal. Every value added here is a place where a test can
 * pass against a fiction, so add one only when a module under test genuinely
 * imports it.
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
	keyHint: (key: string) => key,
}));

// edit.ts and grep.ts import TUI components purely for renderCall/renderResult,
// which unit tests never invoke. These stubs only need to be constructible.
class StubComponent {
	constructor(..._args: unknown[]) {}
	setText(_text: string): void {}
	addChild(_child: unknown): void {}
	render(): string[] {
		return [];
	}
	invalidate(): void {}
}

mock.module("@earendil-works/pi-tui", () => ({
	Text: StubComponent,
	Markdown: StubComponent,
	Component: StubComponent,
	matchesKey: () => false,
}));

export { AGENT_DIR };
