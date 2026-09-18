# Hashline Pro-Steal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Implementers write code+tests; the controller merges and verifies. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the fail-closed guards and UX of YuGiMob `pi-hashline-edit-pro` into the vendored RimuruW `pi-hashline-edit` 0.8.3 tree, keeping derived `LINE#HASH` identity and the tool name `edit`, and make `redact-secrets.ts` edit-safe with unique per-finding placeholders.

**Architecture:** All work lives in the `fork/own-my-pi` checkout. The plugin tree is `vendor/src/pi-hashline-edit` (live-linked into `~/.pi/agent/vendor/node_modules/pi-hashline-edit`). New config fields load through the existing `src/config.ts` singleton from `~/.pi/agent/hashline.json`, which becomes a tracked file at `agent/shared/hashline.json` linked by `nix/home-module.nix`. Guards are pure functions in the plugin `src/`, wired at the existing seams: `hashline/parse.ts` (payload shape), `hashline/apply.ts` (boundary dedup), `src/edit.ts` (span freshness, undo capture, insert op), and a new `src/write-hook.ts` (write echo + auto-read). Redaction stays entirely in `agent/extensions/redact-secrets.ts` and restores secrets by mutating `event.input` in a `tool_call` handler before hashline executes.

**Tech Stack:** TypeScript, `@earendil-works/pi-coding-agent` extension API, `@sinclair/typebox` (the plugin's existing Type import — **not** bare `typebox`), `bun:test`, Nix Home Manager.

**Spec:** `docs/superpowers/specs/2026-09-18-hashline-pro-steal-design.md`

**Controller verify:**

```bash
cd /etc/nix-darwin/fork/own-my-pi && bun test tests
```

## Global Constraints

- Identity stays derived `LINE#HASH` (xxh32 over `prev\0curr\0next`). Do **not** introduce allocated anchors, an anchor registry, SQLite, or `~/.config/pi-hashline-edit-pro/`.
- The tool stays named `edit`. Do **not** call `pi.setActiveTools(...)` to hide it, and do **not** register sibling `replace` / `insert` tools. `insert` is a new `op` on the existing `edit` tool.
- `hashLength` stays 2 unless `/hashline-config` changes it. `HASH_LENGTH_MIN=2`, `HASH_LENGTH_MAX=4` are unchanged.
- Tracked config defaults in `agent/shared/hashline.json`: `{"hashLength": 2, "grep": true, "replaceText": false, "boundaryDedup": "on"}`. Plugin-internal defaults when no file exists stay `hashLength=2, grep=false, replaceText=true, boundaryDedup="warn"` so upstream behavior is byte-identical without a config file.
- `boundaryDedup` accepts exactly `"off" | "warn" | "on" | "strict"`. Any other value falls back to `"warn"` plus one warning. Never throw from config parsing.
- Hashing and freshness compare against **disk bytes**. Never hash or match the redacted view.
- Redaction placeholders are unique per finding: `<redacted:ak1>`, `<redacted:aws2>`, … Never reuse one token for two distinct secrets.
- New error codes exactly: `[E_WRITE_HASH_ECHO]`, `[E_BOUNDARY_DUP]`, `[E_STALE_SPAN]`, `[E_NO_UNDO]`, `[E_REDACT_PLACEHOLDER]`. Existing `[E_INVALID_PATCH]`, `[E_REPLACE_TEXT_DISABLED]`, `[E_STALE_ANCHOR]`, `[E_WOULD_EMPTY]`, `[E_NOOP_LOOP]` keep their current text unless a task says otherwise.
- Plugin `src/**` uses **tabs** (match neighbors). `agent/extensions/*.ts` uses **tabs** (match `learn-mode.ts`/`personal-mode.ts`). `tests/**` uses tabs. Nix uses 2 spaces. JSON uses 2 spaces.
- Tests are `bun:test` under `fork/own-my-pi/tests/`. Do **not** put tests in `vendor/src/**` (that tree is live-linked into `~/.pi/agent` and loads as a plugin). Do **not** add `vitest` to the harness.
- Every exported helper a test imports must be a **named** export.
- Task 0 builds the test harness and **must land first**. The plugin tree imports `@earendil-works/pi-coding-agent`, which ships only inside the Nix-store `pi` derivation and is unresolvable from this checkout, so a `bunfig.toml` preload stubs it. `vendor/node_modules` is a gitignored symlink to the parent checkout's copy.
- Tests may compute real anchors with `computeLineHash(fileLines, zeroBasedIndex)` from `vendor/src/pi-hashline-edit/src/hashline/hash`. Never hardcode a hash like `"MQ"` in a test that runs the real apply engine — hardcoded hashes are fine only in pure parse/validation tests that never touch file content.
- Do not commit. The controller commits.
- Do not run `darwin-rebuild`, `nix build`, or `npm install`.

---

## File structure

| Path | Responsibility |
|---|---|
| `agent/shared/hashline.json` | Tracked hashline config (new) |
| `nix/home-module.nix` | Link `hashline.json` into `~/.pi/agent/` |
| `vendor/src/pi-hashline-edit/src/config.ts` | `boundaryDedup` field, `reloadConfig`, `writeHashlineConfig` |
| `vendor/src/pi-hashline-edit/src/hashline/parse.ts` | Strip display prefixes then fail closed; `insert` op parsing |
| `vendor/src/pi-hashline-edit/src/hashline/apply.ts` | Boundary dedup modes |
| `vendor/src/pi-hashline-edit/src/span-freshness.ts` | Whole-span freshness check (new) |
| `vendor/src/pi-hashline-edit/src/write-hook.ts` | `[E_WRITE_HASH_ECHO]` + auto-read after `write` (new) |
| `vendor/src/pi-hashline-edit/src/undo.ts` | In-memory one-shot undo store (new) |
| `vendor/src/pi-hashline-edit/src/undo-tool.ts` | `undo_last_change` tool (new) |
| `vendor/src/pi-hashline-edit/src/config-command.ts` | `/hashline-config` TUI (new) |
| `vendor/src/pi-hashline-edit/src/edit.ts` | Insert schema, freshness call, undo capture |
| `vendor/src/pi-hashline-edit/index.ts` | Register write hook, undo tool, config command |
| `vendor/src/pi-hashline-edit/prompts/edit.md` | Document `insert`; drop the "never copy neighbor" absolute |
| `agent/extensions/redact-secrets.ts` | Unique tokens, restore-on-`tool_call`, placeholder refusal |
| `agent/extensions/README.md` | Document new behavior |
| `bunfig.toml` | bun:test preload registration (new) |
| `tests/setup.ts` | Stub for `@earendil-works/pi-coding-agent` (new) |
| `tests/hashline-config.test.ts` | Task 1 tests |
| `tests/hashline-prefix-strip.test.ts` | Task 2 tests |
| `tests/hashline-boundary-dedup.test.ts` | Task 3 tests |
| `tests/hashline-span-freshness.test.ts` | Task 4 tests |
| `tests/hashline-write-echo.test.ts` | Task 5 tests |
| `tests/hashline-undo.test.ts` | Task 6 tests |
| `tests/hashline-insert.test.ts` | Task 7 tests |
| `tests/redact-tokens.test.ts` | Task 9 tests |

---

## Waves

- **W0:** Task 0 (harness; everything else depends on it)
- **W1:** Task 1, Task 9 (disjoint: `config.ts`+Nix+JSON vs `redact-secrets.ts`)
- **W2:** Task 2 (`parse.ts`)
- **W3:** Task 3 (`apply.ts`), Task 4 (`span-freshness.ts` new file only)
- **W4:** Task 5 (`write-hook.ts` + `index.ts`), Task 6 (`undo.ts`, `undo-tool.ts`)
- **W5:** Task 7 (`parse.ts` + `edit.ts` — depends on 2, 4, 6)
- **W6:** Task 8 (`config-command.ts` + `index.ts`)
- **W7:** Task 10 (docs; depends on all)

---

### Task 0: bun:test harness

**Status:** already applied in the worktree and proven green. Verify it is present; only re-create it if missing.

**Problem being fixed:** `src/config.ts` imports `getAgentDir` from `@earendil-works/pi-coding-agent`, and `src/read.ts` imports `createReadTool` / `formatSize` / `DEFAULT_MAX_LINES` / `DEFAULT_MAX_BYTES` / `truncateHead` from it. That package lives only at `/nix/store/*-pi-coding-agent-*/lib/node_modules/@earendil-works/pi-coding-agent`, so a bare `bun test` fails with `Cannot find module '@earendil-works/pi-coding-agent'`. Pinning a store path in a tracked file would break on every `pi` bump, so stub the module instead.

**Files:**
- Create: `bunfig.toml`
- Create: `tests/setup.ts`
- Create (gitignored symlink, not committed): `vendor/node_modules` → the parent checkout's `vendor/node_modules`

**Interfaces:**
- Consumes: nothing.
- Produces: a working `bun test tests` in this checkout. `tests/setup.ts` exports `AGENT_DIR` (a fresh `mkdtempSync` directory) so a test may write a `hashline.json` there and call `reloadConfig()`.

**Controller verify after merge:**
```bash
cd /etc/nix-darwin/fork/own-my-pi/.worktrees/feat-hashline-pro-steal && bun test tests
```

- [ ] **Step 1 (implementer): Confirm or create the harness**

`bunfig.toml`:

```toml
[test]
preload = ["./tests/setup.ts"]
```

`tests/setup.ts`:

```ts
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
```

The symlink (third-party deps `@sinclair/typebox`, `diff`, `xxhashjs`, `file-type` all resolve through it):

```bash
cd /etc/nix-darwin/fork/own-my-pi/.worktrees/feat-hashline-pro-steal
ln -sfn /etc/nix-darwin/fork/own-my-pi/vendor/node_modules vendor/node_modules
```

If a later task needs another export from the coding-agent package, add it to the `mock.module` factory — do not add the real package as a dependency.

- [ ] **Step 2 (controller): `bun test tests` runs (zero tests is a pass at this point)**
- [ ] **Step 3 (controller): Commit if green**

```bash
git add bunfig.toml tests/setup.ts
git commit -m "test(harness): stub pi-coding-agent for bun:test"
```

---

### Task 1: `boundaryDedup` config, tracked `hashline.json`, Nix link

**Files:**
- Modify: `vendor/src/pi-hashline-edit/src/config.ts`
- Create: `agent/shared/hashline.json`
- Modify: `nix/home-module.nix:36-48` (the `home.file` attrset)
- Test (implementer writes): `tests/hashline-config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export type BoundaryDedupMode = "off" | "warn" | "on" | "strict";`
  - `HashlineConfig` gains `boundaryDedup: BoundaryDedupMode`
  - `export function getBoundaryDedupMode(): BoundaryDedupMode`
  - `export function reloadConfig(): void`
  - `export async function writeHashlineConfig(next: HashlineConfig): Promise<void>`
  - `export function hashlineConfigPath(): string`
  - `export function __setBoundaryDedupForTests(v: BoundaryDedupMode): void`
  - `__resetConfigForTests()` also resets `boundaryDedup` to `"warn"`

**Controller verify after merge:**
```bash
cd /etc/nix-darwin/fork/own-my-pi && bun test tests/hashline-config.test.ts
```

- [ ] **Step 1 (implementer): Write tests + implementation, then format changed files**

`agent/shared/hashline.json`:

```json
{
  "hashLength": 2,
  "grep": true,
  "replaceText": false,
  "boundaryDedup": "on"
}
```

`nix/home-module.nix` — add one line inside the existing `home.file` attrset, after the `personal.json` line:

```nix
    ".pi/agent/hashline.json".source = mkLive "agent/shared/hashline.json";
```

`src/config.ts` — the module currently declares `HashlineConfig`, `parseHashlineConfig`, a singleton block, getters, and test helpers. Make these changes:

1. Add the type and extend the config type:

```ts
export type BoundaryDedupMode = "off" | "warn" | "on" | "strict";

export type HashlineConfig = {
	hashLength: 2 | 3 | 4;
	grep: boolean;
	replaceText: boolean;
	boundaryDedup: BoundaryDedupMode;
};

const BOUNDARY_DEDUP_MODES: readonly BoundaryDedupMode[] = [
	"off",
	"warn",
	"on",
	"strict",
];

function isBoundaryDedupMode(value: unknown): value is BoundaryDedupMode {
	return (
		typeof value === "string" &&
		(BOUNDARY_DEDUP_MODES as readonly string[]).includes(value)
	);
}
```

2. In `parseHashlineConfig`, add `let boundaryDedup: BoundaryDedupMode = "warn";` beside the other defaults, include it in **both** `return { config: { ... } }` sites (the early bail for non-objects and the final return), and add this validation block after the existing `replaceText` block:

```ts
	// Validate boundaryDedup
	if ("boundaryDedup" in obj) {
		const bd = obj.boundaryDedup;
		if (isBoundaryDedupMode(bd)) {
			boundaryDedup = bd;
		} else {
			warnings.push(
				`hashline.json: "boundaryDedup" must be one of ${BOUNDARY_DEDUP_MODES.join(", ")}; got ${JSON.stringify(bd)}. Using default (warn).`,
			);
		}
	}
```

3. Singleton: add `let _boundaryDedup: BoundaryDedupMode = "warn";`, set it in `loadConfig()` (`_boundaryDedup = config.boundaryDedup;`), and reset `_warnings = []` at the top of `loadConfig()` so a reload cannot accumulate stale warnings.

4. Export the new API. `hashlineConfigPath()` replaces the inline `join(getAgentDir(), "hashline.json")` inside `loadConfig()` — call the helper there too so the command and the loader cannot drift:

```ts
export function hashlineConfigPath(): string {
	return join(getAgentDir(), "hashline.json");
}

export function getBoundaryDedupMode(): BoundaryDedupMode {
	return _boundaryDedup;
}

/** Re-read hashline.json. Used by /hashline-config after a write. */
export function reloadConfig(): void {
	loadConfig();
}

export function currentHashlineConfig(): HashlineConfig {
	return {
		hashLength: _hashLength,
		grep: _grep,
		replaceText: _replaceText,
		boundaryDedup: _boundaryDedup,
	};
}

/** Persist config to hashline.json, then reload the singleton. */
export async function writeHashlineConfig(next: HashlineConfig): Promise<void> {
	await writeFile(
		hashlineConfigPath(),
		`${JSON.stringify(next, null, 2)}\n`,
		"utf8",
	);
	reloadConfig();
}
```

Add `import { writeFile } from "node:fs/promises";` at the top. `loadConfig()` keeps using `readFileSync`; only the writer is async.

5. Test helpers:

```ts
/** @internal */
export function __setBoundaryDedupForTests(v: BoundaryDedupMode): void {
	_boundaryDedup = v;
}
```

and extend `__resetConfigForTests()` with `_boundaryDedup = "warn";`.

`tests/hashline-config.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHashlineConfig } from "../vendor/src/pi-hashline-edit/src/config";

const HARNESS_ROOT = join(import.meta.dir, "..");

describe("parseHashlineConfig boundaryDedup", () => {
	test("defaults to warn so a missing field keeps upstream behavior", () => {
		const { config, warnings } = parseHashlineConfig({});
		expect(config.boundaryDedup).toBe("warn");
		expect(warnings).toEqual([]);
	});

	test("accepts every supported mode", () => {
		for (const mode of ["off", "warn", "on", "strict"] as const) {
			const { config, warnings } = parseHashlineConfig({ boundaryDedup: mode });
			expect(config.boundaryDedup).toBe(mode);
			expect(warnings).toEqual([]);
		}
	});

	test("an unknown mode falls back to warn and warns instead of throwing", () => {
		const { config, warnings } = parseHashlineConfig({ boundaryDedup: "strip" });
		expect(config.boundaryDedup).toBe("warn");
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("boundaryDedup");
	});

	test("a non-object top level still yields a complete config", () => {
		const { config } = parseHashlineConfig(["nope"]);
		expect(config.boundaryDedup).toBe("warn");
		expect(config.hashLength).toBe(2);
	});

	test("other fields are unaffected by the new one", () => {
		const { config } = parseHashlineConfig({
			hashLength: 3,
			grep: true,
			replaceText: false,
			boundaryDedup: "strict",
		});
		expect(config).toEqual({
			hashLength: 3,
			grep: true,
			replaceText: false,
			boundaryDedup: "strict",
		});
	});
});

describe("tracked hashline.json", () => {
	test("ships anchor-only editing, grep on, dedup on", () => {
		const raw = readFileSync(
			join(HARNESS_ROOT, "agent/shared/hashline.json"),
			"utf8",
		);
		const { config, warnings } = parseHashlineConfig(JSON.parse(raw));
		expect(warnings).toEqual([]);
		expect(config.replaceText).toBe(false);
		expect(config.grep).toBe(true);
		expect(config.boundaryDedup).toBe("on");
	});

	test("home-module links it into the agent dir", () => {
		const nix = readFileSync(join(HARNESS_ROOT, "nix/home-module.nix"), "utf8");
		expect(nix).toContain('".pi/agent/hashline.json".source');
		expect(nix).toContain('mkLive "agent/shared/hashline.json"');
	});
});
```

- [ ] **Step 2 (controller): Merge, run verify command, adjust tests if needed**
- [ ] **Step 3 (controller): Commit if green**

```bash
git add agent/shared/hashline.json nix/home-module.nix vendor/src/pi-hashline-edit/src/config.ts tests/hashline-config.test.ts
git commit -m "feat(hashline): add boundaryDedup config and track hashline.json"
```

---

### Task 2: Strip display prefixes, then fail closed

**Problem being fixed:** today `assertNoDisplayPrefixes` rejects the whole `edit` call when any `lines` entry carries a `12#MQ:` / `+12#MQ:` / diff-minus prefix. Pro strips the slip with a warning instead. Strip one pass, then fail closed if the line still looks like a display row (that means the model pasted nested rows, not a single slip).

**Files:**
- Modify: `vendor/src/pi-hashline-edit/src/hashline/parse.ts` (the `assertNoDisplayPrefixes` / `hashlineParseText` block at `:186-214`, and `resolveEditAnchors` at `:325-370`)
- Test (implementer writes): `tests/hashline-prefix-strip.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `export function stripDisplayPrefix(line: string): string` — one pass, returns the line unchanged when no prefix matched.
  - `export function stripDisplayPrefixes(lines: string[]): { lines: string[]; stripped: number }`
  - `resolveEditAnchors(edits: HashlineToolEdit[], warnings?: string[]): HashlineEdit[]` — new **optional second parameter**. When provided, one warning per call is pushed if anything was stripped. Existing single-argument callers keep compiling.

**Controller verify after merge:**
```bash
cd /etc/nix-darwin/fork/own-my-pi && bun test tests/hashline-prefix-strip.test.ts
```

- [ ] **Step 1 (implementer): Write tests + implementation, then format changed files**

In `parse.ts`, the three existing regexes (`DISPLAY_PREFIX_RE`, `DISPLAY_PREFIX_PLUS_RE`, `DIFF_MINUS_RE`) stay exactly as they are. Add stripping in front of the assert:

```ts
/**
 * Remove ONE leading display prefix from a line: `12#MQ:`, `+12#MQ:`, `#MQ:`,
 * or a diff-minus gutter. Returns the line unchanged when nothing matched.
 *
 * Pro strips these slips and warns instead of rejecting the call, because a
 * model pasting a read row into `lines` is a copy slip, not a semantic error.
 * Only one pass runs: a line that still looks like a display row after
 * stripping is nested rendered output, which is rejected by
 * assertNoDisplayPrefixes below.
 */
export function stripDisplayPrefix(line: string): string {
	for (const re of [DISPLAY_PREFIX_PLUS_RE, DISPLAY_PREFIX_RE, DIFF_MINUS_RE]) {
		const match = re.exec(line);
		if (match) return line.slice(match[0].length);
	}
	return line;
}

export function stripDisplayPrefixes(lines: string[]): {
	lines: string[];
	stripped: number;
} {
	let stripped = 0;
	const out = lines.map((line) => {
		if (!line.length) return line;
		const next = stripDisplayPrefix(line);
		if (next !== line) stripped += 1;
		return next;
	});
	return { lines: out, stripped };
}
```

Change `hashlineParseText` to strip first, count, then assert:

```ts
function hashlineParseText(
	edit: string[] | undefined,
	stripCount: { n: number },
): string[] {
	const { lines, stripped } = stripDisplayPrefixes(edit ?? []);
	stripCount.n += stripped;
	assertNoDisplayPrefixes(lines);
	return lines;
}
```

Update the `[E_INVALID_PATCH]` message in `assertNoDisplayPrefixes` so it explains that stripping was already attempted:

```ts
			throw new Error(
				`[E_INVALID_PATCH] "lines" still contains a rendered "LINE#HASH:" or diff prefix after one strip pass — this looks like nested read/diff output, not file content. Offending line: ${JSON.stringify(line)}`,
			);
```

In `resolveEditAnchors`, thread the counter and emit one warning:

```ts
export function resolveEditAnchors(
	edits: HashlineToolEdit[],
	warnings?: string[],
): HashlineEdit[] {
	const result: HashlineEdit[] = [];
	const stripCount = { n: 0 };
	for (const [index, edit] of edits.entries()) {
		// ...unchanged body, but every hashlineParseText(edit.lines) call becomes
		// hashlineParseText(edit.lines, stripCount)
	}
	if (stripCount.n > 0 && warnings) {
		warnings.push(
			`Stripped a rendered display prefix from ${stripCount.n} replacement line(s). "lines" must be literal file content; the LINE#HASH prefix is context for you, not payload.`,
		);
	}
	return result;
}
```

In `src/edit.ts`, the single existing call site is `const resolved = resolveEditAnchors(toolEdits);` (inside `executeEditPipeline`, just above `const extraWarnings: string[] = [];`). Reorder so the array exists first and pass it:

```ts
	const extraWarnings: string[] = [];
	const resolved = resolveEditAnchors(toolEdits, extraWarnings);
```

`tests/hashline-prefix-strip.test.ts`:

```ts
import { afterEach, describe, expect, test } from "bun:test";
import {
	resolveEditAnchors,
	stripDisplayPrefix,
	stripDisplayPrefixes,
} from "../vendor/src/pi-hashline-edit/src/hashline/parse";
import { __resetConfigForTests } from "../vendor/src/pi-hashline-edit/src/config";

afterEach(() => {
	__resetConfigForTests();
});

describe("stripDisplayPrefix", () => {
	test("removes a LINE#HASH read prefix and keeps indentation", () => {
		expect(stripDisplayPrefix("12#MQ:\tconst x = 1;")).toBe("\tconst x = 1;");
	});

	test("removes a diff-plus prefix", () => {
		expect(stripDisplayPrefix("+12#MQ:const x = 1;")).toBe("const x = 1;");
	});

	test("leaves literal content alone", () => {
		expect(stripDisplayPrefix("const url = `http://x`;")).toBe(
			"const url = `http://x`;",
		);
	});

	test("leaves a plain colon line alone", () => {
		expect(stripDisplayPrefix("default: return null;")).toBe(
			"default: return null;",
		);
	});

	test("strips only one pass, so nested rows stay detectable", () => {
		expect(stripDisplayPrefix("12#MQ:13#VR:const x = 1;")).toBe(
			"13#VR:const x = 1;",
		);
	});
});

describe("stripDisplayPrefixes", () => {
	test("counts only the lines it changed", () => {
		const out = stripDisplayPrefixes(["12#MQ:a", "b", "+13#VR:c"]);
		expect(out.lines).toEqual(["a", "b", "c"]);
		expect(out.stripped).toBe(2);
	});

	test("preserves explicit blank lines", () => {
		const out = stripDisplayPrefixes(["", "12#MQ:a", ""]);
		expect(out.lines).toEqual(["", "a", ""]);
		expect(out.stripped).toBe(1);
	});
});

describe("resolveEditAnchors prefix handling", () => {
	test("applies the edit and warns instead of rejecting a copy slip", () => {
		const warnings: string[] = [];
		const resolved = resolveEditAnchors(
			[{ op: "replace", pos: "12#MQ", lines: ["12#MQ:const x = 1;"] }],
			warnings,
		);
		expect(resolved[0]).toMatchObject({ op: "replace", lines: ["const x = 1;"] });
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("Stripped a rendered display prefix from 1");
	});

	test("emits one warning for a whole call, not one per line", () => {
		const warnings: string[] = [];
		resolveEditAnchors(
			[
				{ op: "replace", pos: "12#MQ", lines: ["12#MQ:a", "13#VR:b"] },
				{ op: "append", pos: "20#KT", lines: ["+21#TP:c"] },
			],
			warnings,
		);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("3 replacement line(s)");
	});

	test("stays silent when the payload is already literal", () => {
		const warnings: string[] = [];
		resolveEditAnchors(
			[{ op: "replace", pos: "12#MQ", lines: ["const x = 1;"] }],
			warnings,
		);
		expect(warnings).toEqual([]);
	});

	test("fails closed on nested rendered rows", () => {
		expect(() =>
			resolveEditAnchors([
				{ op: "replace", pos: "12#MQ", lines: ["12#MQ:13#VR:const x = 1;"] },
			]),
		).toThrow(/E_INVALID_PATCH/);
	});
});
```

- [ ] **Step 2 (controller): Merge, run verify command, adjust tests if needed**
- [ ] **Step 3 (controller): Commit if green**

```bash
git add vendor/src/pi-hashline-edit/src/hashline/parse.ts vendor/src/pi-hashline-edit/src/edit.ts tests/hashline-prefix-strip.test.ts
git commit -m "feat(hashline): strip display prefixes once, then fail closed"
```

---

### Task 3: Boundary dedup modes

**Problem being fixed:** `validateAnchorEdits` (`apply.ts:706-731`) only *warns* when a replacement's first/last line duplicates the surviving neighbor, so the file gains a duplicated line. Pro strips the duplicate (or rejects in strict mode).

**Files:**
- Modify: `vendor/src/pi-hashline-edit/src/hashline/apply.ts`
- Test (implementer writes): `tests/hashline-boundary-dedup.test.ts`

**Interfaces:**
- Consumes: `getBoundaryDedupMode`, `BoundaryDedupMode` from Task 1's `src/config.ts`.
- Produces:
  ```ts
  export function dedupBoundaryLines(params: {
  	lines: string[];
  	prevLine: string | undefined;
  	nextLine: string | undefined;
  	mode: BoundaryDedupMode;
  }): { lines: string[]; strippedFirst: boolean; strippedLast: boolean };
  ```

**Controller verify after merge:**
```bash
cd /etc/nix-darwin/fork/own-my-pi && bun test tests/hashline-boundary-dedup.test.ts
```

- [ ] **Step 1 (implementer): Write tests + implementation, then format changed files**

`apply.ts` already imports `RE_SIGNIFICANT` from `./hash`. Add `import { getBoundaryDedupMode, type BoundaryDedupMode } from "../config";`.

Add the pure helper near the other warn helpers:

```ts
/**
 * Drop replacement lines that merely re-state the surviving neighbor lines
 * around the replaced span.
 *
 * Models routinely echo the line above/below the range they are replacing, and
 * a warning-only guard still writes the duplicate. Never strip down to an
 * empty payload: an empty `lines` array means "delete the span", which is a
 * different operation than "replace with one line".
 */
export function dedupBoundaryLines(params: {
	lines: string[];
	prevLine: string | undefined;
	nextLine: string | undefined;
	mode: BoundaryDedupMode;
}): { lines: string[]; strippedFirst: boolean; strippedLast: boolean } {
	const { prevLine, nextLine, mode } = params;
	let lines = params.lines;
	let strippedFirst = false;
	let strippedLast = false;

	if (mode === "off" || mode === "warn" || lines.length === 0) {
		return { lines, strippedFirst, strippedLast };
	}

	const duplicates = (candidate: string | undefined, neighbor: string | undefined) =>
		candidate !== undefined &&
		neighbor !== undefined &&
		RE_SIGNIFICANT.test(candidate.trim()) &&
		candidate.trim() === neighbor.trim();

	// Never reduce a replacement to a deletion.
	if (lines.length > 1 && duplicates(lines.at(-1), nextLine)) {
		lines = lines.slice(0, -1);
		strippedLast = true;
	}
	if (lines.length > 1 && duplicates(lines[0], prevLine)) {
		lines = lines.slice(1);
		strippedFirst = true;
	}

	return { lines, strippedFirst, strippedLast };
}
```

Then rewrite the two warn-only blocks in the `case "replace":` arm of `validateAnchorEdits`. The existing code computes `nextLine` (`lineIndex.fileLines[endLine]`) and `prevLine` (`lineIndex.fileLines[edit.pos.line - 2]`) and pushes "Potential boundary duplication" warnings. Replace both blocks with:

```ts
				const nextLine = lineIndex.fileLines[endLine];
				const prevLine = lineIndex.fileLines[edit.pos.line - 2];
				const mode = getBoundaryDedupMode();
				const dedup = dedupBoundaryLines({
					lines: edit.lines,
					prevLine,
					nextLine,
					mode,
				});

				if (mode === "strict" && (dedup.strippedFirst || dedup.strippedLast)) {
					throw new Error(
						`[E_BOUNDARY_DUP] ${describeEdit(edit)} re-includes a surviving neighbor line; strict boundary dedup refuses it. Resend "lines" with only the content that changes.`,
					);
				}

				if (dedup.strippedFirst || dedup.strippedLast) {
					// Mutating edit.lines is how the stripped payload reaches
					// resolveEditSpans — spans are computed from this same object later
					// in applyHashlineEdits.
					edit.lines = dedup.lines;
					warnings.push(
						`Stripped ${[dedup.strippedFirst && "the leading", dedup.strippedLast && "the trailing"].filter(Boolean).join(" and ")} replacement line at ${describeEdit(edit)}: it duplicated a surviving neighbor line.`,
					);
				} else if (mode === "warn" || mode === "off") {
					// Preserve upstream warning-only behavior for mode=warn.
					if (mode === "warn") {
						const last = edit.lines.at(-1)?.trim();
						const first = edit.lines[0]?.trim();
						if (
							nextLine !== undefined &&
							last &&
							RE_SIGNIFICANT.test(last) &&
							last === nextLine.trim()
						) {
							warnings.push(
								`Potential boundary duplication after ${describeEdit(edit)}: the replacement ends with a line that matches the next surviving line after trim.`,
							);
						}
						if (
							prevLine !== undefined &&
							first &&
							RE_SIGNIFICANT.test(first) &&
							first === prevLine.trim()
						) {
							warnings.push(
								`Potential boundary duplication before ${describeEdit(edit)}: the replacement starts with a line that matches the preceding surviving line after trim.`,
							);
						}
					}
				}
				break;
```

Keep the existing single-anchor-replace warning above this block untouched.

`tests/hashline-boundary-dedup.test.ts`:

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { dedupBoundaryLines } from "../vendor/src/pi-hashline-edit/src/hashline/apply";
import {
	__resetConfigForTests,
	__setBoundaryDedupForTests,
} from "../vendor/src/pi-hashline-edit/src/config";

afterEach(() => {
	__resetConfigForTests();
});

const call = (
	lines: string[],
	mode: "off" | "warn" | "on" | "strict",
	prevLine?: string,
	nextLine?: string,
) => dedupBoundaryLines({ lines, prevLine, nextLine, mode });

describe("dedupBoundaryLines", () => {
	test("drops a trailing line that repeats the next surviving line", () => {
		const out = call(["body();", "}"], "on", "function f() {", "}");
		expect(out.lines).toEqual(["body();"]);
		expect(out.strippedLast).toBe(true);
		expect(out.strippedFirst).toBe(false);
	});

	test("drops a leading line that repeats the preceding surviving line", () => {
		const out = call(["function f() {", "body();"], "on", "function f() {", "}");
		expect(out.lines).toEqual(["body();"]);
		expect(out.strippedFirst).toBe(true);
	});

	test("drops both ends when both duplicate", () => {
		const out = call(
			["function f() {", "body();", "}"],
			"on",
			"function f() {",
			"}",
		);
		expect(out.lines).toEqual(["body();"]);
		expect(out.strippedFirst).toBe(true);
		expect(out.strippedLast).toBe(true);
	});

	test("ignores indentation differences when comparing", () => {
		const out = call(["body();", "    }"], "on", undefined, "}");
		expect(out.lines).toEqual(["body();"]);
	});

	test("never strips a single-line replacement into a deletion", () => {
		const out = call(["}"], "on", undefined, "}");
		expect(out.lines).toEqual(["}"]);
		expect(out.strippedLast).toBe(false);
	});

	test("never strips an explicit empty payload", () => {
		const out = call([], "on", "a", "b");
		expect(out.lines).toEqual([]);
	});

	test("does not treat insignificant lines as duplicates", () => {
		const out = call(["body();", ""], "on", undefined, "");
		expect(out.lines).toEqual(["body();", ""]);
	});

	test("mode off and mode warn leave the payload untouched", () => {
		for (const mode of ["off", "warn"] as const) {
			const out = call(["body();", "}"], mode, undefined, "}");
			expect(out.lines).toEqual(["body();", "}"]);
			expect(out.strippedLast).toBe(false);
		}
	});

	test("strict reports the same detection as on, so the caller can reject", () => {
		const out = call(["body();", "}"], "strict", undefined, "}");
		expect(out.strippedLast).toBe(true);
	});
});

describe("config wiring", () => {
	test("the test setter drives the mode the apply engine reads", () => {
		__setBoundaryDedupForTests("strict");
		// Imported lazily so the setter above is observed.
		const { getBoundaryDedupMode } = require("../vendor/src/pi-hashline-edit/src/config");
		expect(getBoundaryDedupMode()).toBe("strict");
	});
});
```

- [ ] **Step 2 (controller): Merge, run verify command, adjust tests if needed**
- [ ] **Step 3 (controller): Commit if green**

```bash
git add vendor/src/pi-hashline-edit/src/hashline/apply.ts tests/hashline-boundary-dedup.test.ts
git commit -m "feat(hashline): strip or reject duplicated boundary lines"
```

---

### Task 4: Whole-span freshness

**Problem being fixed:** a range replace validates only the two endpoint hashes. A concurrent change *inside* the span leaves both endpoints valid, so the edit applies over content the model never saw. Pro requires every line in the removed range to match what was last shown.

**Files:**
- Create: `vendor/src/pi-hashline-edit/src/span-freshness.ts`
- Test (implementer writes): `tests/hashline-span-freshness.test.ts`

**Interfaces:**
- Consumes: `HashlineEdit` type from `./hashline/parse`.
- Produces:
  ```ts
  export function findStaleSpan(params: {
  	edits: HashlineEdit[];
  	liveLines: readonly string[];
  	snapshotLines: readonly string[] | undefined;
  }): { startLine: number; endLine: number; firstDivergentLine: number } | undefined;

  export function assertSpansFresh(params: {
  	path: string;
  	edits: HashlineEdit[];
  	liveContent: string;
  	snapshotContent: string | undefined;
  }): void;
  ```
  `assertSpansFresh` throws `[E_STALE_SPAN]` when `findStaleSpan` reports drift. Both are no-ops when `snapshotContent` is `undefined`.

**Controller verify after merge:**
```bash
cd /etc/nix-darwin/fork/own-my-pi && bun test tests/hashline-span-freshness.test.ts
```

- [ ] **Step 1 (implementer): Write tests + implementation, then format changed files**

`vendor/src/pi-hashline-edit/src/span-freshness.ts`:

```ts
/**
 * Whole-span freshness for range replaces.
 *
 * Endpoint hashes cover lines `pos` and `end` (and, via context hashing, their
 * immediate neighbors). They do NOT cover the interior of a long span: an
 * external write that changes line 40 of a 10..60 replace leaves both endpoint
 * hashes intact, and the edit would silently overwrite content the model never
 * read.
 *
 * The comparison is disk-vs-snapshot, never disk-vs-rendered-output: the
 * snapshot store holds the unredacted bytes hashline itself read, so a
 * redaction extension rewriting the model's view cannot make a fresh span look
 * stale (or a stale span look fresh).
 */
import type { HashlineEdit } from "./hashline/parse";

function splitLines(content: string): string[] {
	const lines = content.split("\n");
	return content.endsWith("\n") ? lines.slice(0, -1) : lines;
}

export function findStaleSpan(params: {
	edits: HashlineEdit[];
	liveLines: readonly string[];
	snapshotLines: readonly string[] | undefined;
}): { startLine: number; endLine: number; firstDivergentLine: number } | undefined {
	const { edits, liveLines, snapshotLines } = params;
	if (!snapshotLines) return undefined;

	for (const edit of edits) {
		// Only range replaces have an unvalidated interior.
		if (edit.op !== "replace" || !edit.end) continue;
		const startLine = edit.pos.line;
		const endLine = edit.end.line;
		if (endLine < startLine) continue;

		for (let line = startLine; line <= endLine; line++) {
			const live = liveLines[line - 1];
			const shown = snapshotLines[line - 1];
			if (live === shown) continue;
			return { startLine, endLine, firstDivergentLine: line };
		}
	}
	return undefined;
}

export function assertSpansFresh(params: {
	path: string;
	edits: HashlineEdit[];
	liveContent: string;
	snapshotContent: string | undefined;
}): void {
	const { path, edits, liveContent, snapshotContent } = params;
	if (snapshotContent === undefined) return;

	const stale = findStaleSpan({
		edits,
		liveLines: splitLines(liveContent),
		snapshotLines: splitLines(snapshotContent),
	});
	if (!stale) return;

	throw new Error(
		`[E_STALE_SPAN] Line ${stale.firstDivergentLine} inside the replaced range ${stale.startLine}..${stale.endLine} of ${path} changed since it was last shown to you, even though both range endpoints still match. Nothing was written. Re-read ${path} and retry with current anchors.`,
	);
}
```

Wire it in `src/edit.ts` inside `executeEditPipeline`, immediately after `const resolved = resolveEditAnchors(toolEdits, extraWarnings);` and **before** the `applyHashlineEdits` try block. The path variable is `absolutePath`; use `getReadSnapshot`, which is already imported:

```ts
	// Endpoint hashes do not cover a long span's interior. Compare the whole
	// replaced range against the last bytes hashline read for this file.
	assertSpansFresh({
		path,
		edits: resolved,
		liveContent: originalNormalized,
		snapshotContent: absolutePath ? (getReadSnapshot(absolutePath) ?? undefined) : undefined,
	});
```

Add `import { assertSpansFresh } from "./span-freshness";`.

`tests/hashline-span-freshness.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
	assertSpansFresh,
	findStaleSpan,
} from "../vendor/src/pi-hashline-edit/src/span-freshness";
import type { HashlineEdit } from "../vendor/src/pi-hashline-edit/src/hashline/parse";

const rangeReplace = (start: number, end: number): HashlineEdit => ({
	op: "replace",
	pos: { line: start, hash: "MQ" },
	end: { line: end, hash: "VR" },
	lines: ["new"],
});

const singleReplace = (line: number): HashlineEdit => ({
	op: "replace",
	pos: { line, hash: "MQ" },
	lines: ["new"],
});

const FILE = "a\nb\nc\nd\ne\n";

describe("findStaleSpan", () => {
	test("returns undefined when the span matches what was shown", () => {
		expect(
			findStaleSpan({
				edits: [rangeReplace(2, 4)],
				liveLines: ["a", "b", "c", "d", "e"],
				snapshotLines: ["a", "b", "c", "d", "e"],
			}),
		).toBeUndefined();
	});

	test("catches interior drift that both endpoint hashes would miss", () => {
		expect(
			findStaleSpan({
				edits: [rangeReplace(2, 4)],
				liveLines: ["a", "b", "CHANGED", "d", "e"],
				snapshotLines: ["a", "b", "c", "d", "e"],
			}),
		).toEqual({ startLine: 2, endLine: 4, firstDivergentLine: 3 });
	});

	test("ignores drift outside the replaced range", () => {
		expect(
			findStaleSpan({
				edits: [rangeReplace(2, 3)],
				liveLines: ["a", "b", "c", "CHANGED", "e"],
				snapshotLines: ["a", "b", "c", "d", "e"],
			}),
		).toBeUndefined();
	});

	test("ignores single-line replaces, whose anchor already covers the line", () => {
		expect(
			findStaleSpan({
				edits: [singleReplace(3)],
				liveLines: ["a", "b", "CHANGED", "d", "e"],
				snapshotLines: ["a", "b", "c", "d", "e"],
			}),
		).toBeUndefined();
	});

	test("treats a truncated file as drift", () => {
		expect(
			findStaleSpan({
				edits: [rangeReplace(2, 4)],
				liveLines: ["a", "b"],
				snapshotLines: ["a", "b", "c", "d", "e"],
			}),
		).toEqual({ startLine: 2, endLine: 4, firstDivergentLine: 3 });
	});

	test("is a no-op without a snapshot, so the first edit of a session works", () => {
		expect(
			findStaleSpan({
				edits: [rangeReplace(2, 4)],
				liveLines: ["a", "b", "c"],
				snapshotLines: undefined,
			}),
		).toBeUndefined();
	});

	test("reports the first divergent line across several edits", () => {
		const stale = findStaleSpan({
			edits: [rangeReplace(1, 2), rangeReplace(4, 5)],
			liveLines: ["a", "b", "c", "d", "CHANGED"],
			snapshotLines: ["a", "b", "c", "d", "e"],
		});
		expect(stale).toEqual({ startLine: 4, endLine: 5, firstDivergentLine: 5 });
	});
});

describe("assertSpansFresh", () => {
	test("throws E_STALE_SPAN naming the range and the divergent line", () => {
		expect(() =>
			assertSpansFresh({
				path: "src/x.ts",
				edits: [rangeReplace(2, 4)],
				liveContent: "a\nb\nCHANGED\nd\ne\n",
				snapshotContent: FILE,
			}),
		).toThrow(/E_STALE_SPAN.*Line 3.*2\.\.4.*src\/x\.ts/s);
	});

	test("does not throw when the span is fresh", () => {
		expect(() =>
			assertSpansFresh({
				path: "src/x.ts",
				edits: [rangeReplace(2, 4)],
				liveContent: FILE,
				snapshotContent: FILE,
			}),
		).not.toThrow();
	});

	test("does not throw without a snapshot", () => {
		expect(() =>
			assertSpansFresh({
				path: "src/x.ts",
				edits: [rangeReplace(2, 4)],
				liveContent: FILE,
				snapshotContent: undefined,
			}),
		).not.toThrow();
	});

	test("handles a file with no trailing newline", () => {
		expect(() =>
			assertSpansFresh({
				path: "src/x.ts",
				edits: [rangeReplace(1, 2)],
				liveContent: "a\nb",
				snapshotContent: "a\nb",
			}),
		).not.toThrow();
	});
});
```

- [ ] **Step 2 (controller): Merge, run verify command, adjust tests if needed**
- [ ] **Step 3 (controller): Commit if green**

```bash
git add vendor/src/pi-hashline-edit/src/span-freshness.ts vendor/src/pi-hashline-edit/src/edit.ts tests/hashline-span-freshness.test.ts
git commit -m "feat(hashline): verify the whole replaced span, not just endpoints"
```

---

### Task 5: Write echo guard and auto-read after `write`

**Problem being fixed:** the builtin `write` tool has no hashline hook, so a model that copies `read` output and dumps it through `write` stores `12#MQ:code` rows into the file. Also, after a `write` the model holds no anchors and must spend a turn on `read`.

**Files:**
- Create: `vendor/src/pi-hashline-edit/src/write-hook.ts`
- Modify: `vendor/src/pi-hashline-edit/index.ts`
- Test (implementer writes): `tests/hashline-write-echo.test.ts`

**Interfaces:**
- Consumes: `stripDisplayPrefix` is *not* used here; this task owns its own detector. `formatHashlineReadPreview` from `./read` (already exported), `rememberReadSnapshot` from `./read-snapshot`, `resolveMutationTargetPath` from `./fs-write`, `resolveToCwd` from `./path-utils`, `loadFileKindAndText` from `./file-kind`, `normalizeToLF`/`stripBom` from `./edit-diff`.
- Produces:
  - `export function findDisplayPrefixEcho(content: string): { line: number; text: string } | undefined`
  - `export function writeEchoDenial(path: string, content: string): string | undefined`
  - `export function registerWriteHook(pi: ExtensionAPI): void`

**Controller verify after merge:**
```bash
cd /etc/nix-darwin/fork/own-my-pi && bun test tests/hashline-write-echo.test.ts
```

- [ ] **Step 1 (implementer): Write tests + implementation, then format changed files**

`vendor/src/pi-hashline-edit/src/write-hook.ts`:

```ts
/**
 * Guards and conveniences for the builtin `write` tool.
 *
 * 1. Echo guard. Hashline `read` output is `LINE#HASH:content`. A model that
 *    copies that output into `write` stores the display prefixes as file
 *    content. Unlike the pro plugin we have no per-session served-anchor set to
 *    consult, so detection is shape-based: any line that looks like a rendered
 *    read or diff row refuses the write. False positives are possible in files
 *    that legitimately start lines with `12#MQ:`; those writes must go through
 *    bash.
 *
 * 2. Auto-read. After a successful `write`, append a hashline preview and
 *    record a read snapshot so the next `edit` has anchors without a separate
 *    `read` round-trip.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { NIBBLE_STR } from "./hashline/hash";
import { HASH_LENGTH_MAX, HASH_LENGTH_MIN } from "./config";
import { normalizeToLF, stripBom } from "./edit-diff";
import { loadFileKindAndText } from "./file-kind";
import { resolveMutationTargetPath } from "./fs-write";
import { resolveToCwd } from "./path-utils";
import { formatHashlineReadPreview } from "./read";
import { rememberReadSnapshot } from "./read-snapshot";

const ECHO_RE = new RegExp(
	`^[+ -]?\\s*(?:\\d+\\s*#\\s*|#\\s*)[${NIBBLE_STR}]{${HASH_LENGTH_MIN},${HASH_LENGTH_MAX}}:`,
);

export function findDisplayPrefixEcho(
	content: string,
): { line: number; text: string } | undefined {
	const lines = content.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const text = lines[i]!;
		if (text.length > 0 && ECHO_RE.test(text)) {
			return { line: i + 1, text };
		}
	}
	return undefined;
}

export function writeEchoDenial(
	path: string,
	content: string,
): string | undefined {
	const echo = findDisplayPrefixEcho(content);
	if (!echo) return undefined;
	return `[E_WRITE_HASH_ECHO] Refused write to ${path}: line ${echo.line} is a rendered hashline row, not file content (${JSON.stringify(echo.text.slice(0, 40))}). The LINE#HASH prefix from read output is context for you, not payload. Resend the content without anchors.`;
}

export function registerWriteHook(pi: ExtensionAPI): void {
	pi.on("tool_call", async (event) => {
		if (event.toolName !== "write") return;
		const input = event.input as Record<string, unknown> | undefined;
		if (!input) return;
		const path = input.path ?? input.file_path;
		const content = input.content;
		if (typeof path !== "string" || typeof content !== "string") return;
		const reason = writeEchoDenial(path, content);
		if (reason !== undefined) return { block: true, reason };
		return;
	});

	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "write" || event.isError) return;
		const input = event.input as Record<string, unknown> | undefined;
		const rawPath = input?.path ?? input?.file_path;
		if (typeof rawPath !== "string") return;

		try {
			const absolutePath = resolveToCwd(rawPath, ctx.cwd);
			const canonicalPath = await resolveMutationTargetPath(absolutePath);
			const file = await loadFileKindAndText(canonicalPath);
			if (file.kind !== "text") return;
			const normalized = normalizeToLF(stripBom(file.text).text);
			rememberReadSnapshot(canonicalPath, normalized);
			const preview = formatHashlineReadPreview(normalized, {});
			return {
				content: [
					...(event.content ?? []),
					{
						type: "text",
						text: `\n\n--- Auto-read (hashline anchors) ---\n${preview.text}`,
					},
				],
			};
		} catch (error) {
			console.error("[pi-hashline-edit] auto-read after write failed:", error);
			return;
		}
	});
}
```

`index.ts` — add the import and the registration call:

```ts
import { registerWriteHook } from "./src/write-hook";
```

and inside the default export, after `registerEditTool(pi);`:

```ts
	registerWriteHook(pi);
```

`tests/hashline-write-echo.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
	findDisplayPrefixEcho,
	writeEchoDenial,
} from "../vendor/src/pi-hashline-edit/src/write-hook";

describe("findDisplayPrefixEcho", () => {
	test("finds a read row and reports its 1-based line", () => {
		expect(findDisplayPrefixEcho("ok\n12#MQ:const x = 1;\n")).toEqual({
			line: 2,
			text: "12#MQ:const x = 1;",
		});
	});

	test("finds a diff-plus row", () => {
		expect(findDisplayPrefixEcho("+12#MQ:const x = 1;")?.line).toBe(1);
	});

	test("finds a padded read row", () => {
		expect(findDisplayPrefixEcho(" 8#VR:function hello() {")?.line).toBe(1);
	});

	test("finds a 4-char hash row from a different hashLength config", () => {
		expect(findDisplayPrefixEcho("12#MQQV:x")?.line).toBe(1);
	});

	test("returns undefined for ordinary source", () => {
		expect(
			findDisplayPrefixEcho('const url = "http://x";\nswitch (k) {\ndefault: break;\n'),
		).toBeUndefined();
	});

	test("does not flag a 5+ char run, which is not a valid anchor shape", () => {
		expect(findDisplayPrefixEcho("12#MQQVRR:x")).toBeUndefined();
	});

	test("does not flag markdown headings or YAML keys", () => {
		expect(findDisplayPrefixEcho("# Title\nkey: value\n")).toBeUndefined();
	});

	test("ignores empty lines", () => {
		expect(findDisplayPrefixEcho("\n\n")).toBeUndefined();
	});
});

describe("writeEchoDenial", () => {
	test("names the code, the path, and the offending line", () => {
		const reason = writeEchoDenial("src/x.ts", "12#MQ:const x = 1;");
		expect(reason).toContain("[E_WRITE_HASH_ECHO]");
		expect(reason).toContain("src/x.ts");
		expect(reason).toContain("line 1");
	});

	test("allows a clean write", () => {
		expect(writeEchoDenial("src/x.ts", "const x = 1;\n")).toBeUndefined();
	});
});
```

- [ ] **Step 2 (controller): Merge, run verify command, adjust tests if needed**
- [ ] **Step 3 (controller): Commit if green**

```bash
git add vendor/src/pi-hashline-edit/src/write-hook.ts vendor/src/pi-hashline-edit/index.ts tests/hashline-write-echo.test.ts
git commit -m "feat(hashline): block write echo and auto-read after write"
```

---

### Task 6: In-memory one-shot undo

**Problem being fixed:** a wrong-but-valid edit has no cheap reversal. Pro persists full pre/post file text in SQLite; that is a secret store on disk, so this port keeps the snapshot in memory for the process only.

**Files:**
- Create: `vendor/src/pi-hashline-edit/src/undo.ts`
- Create: `vendor/src/pi-hashline-edit/src/undo-tool.ts`
- Modify: `vendor/src/pi-hashline-edit/src/edit.ts` (capture before the atomic write)
- Modify: `vendor/src/pi-hashline-edit/index.ts`
- Test (implementer writes): `tests/hashline-undo.test.ts`

**Interfaces:**
- Consumes: `writeFileAtomically`, `resolveMutationTargetPath` from `./fs-write`; `rememberReadSnapshot` from `./read-snapshot`; `resolveToCwd` from `./path-utils`.
- Produces:
  - `export function rememberUndo(canonicalPath: string, beforeContent: string): void`
  - `export function peekUndo(canonicalPath: string): string | undefined`
  - `export function takeUndo(canonicalPath: string): string | undefined`
  - `export function lastUndoPath(): string | undefined`
  - `export function clearUndo(canonicalPath?: string): void`
  - `export function registerUndoTool(pi: ExtensionAPI): void`

**Controller verify after merge:**
```bash
cd /etc/nix-darwin/fork/own-my-pi && bun test tests/hashline-undo.test.ts
```

- [ ] **Step 1 (implementer): Write tests + implementation, then format changed files**

`vendor/src/pi-hashline-edit/src/undo.ts`:

```ts
/**
 * One-shot in-memory undo for hashline edits.
 *
 * Deliberately NOT persisted. The pro plugin keeps full pre/post file text in
 * a SQLite store under ~/.config, which becomes a durable copy of every secret
 * that ever passed through an edited file. This store dies with the process and
 * holds exactly one pre-edit snapshot per path.
 */
const undoByPath = new Map<string, string>();
let mostRecentPath: string | undefined;

export function rememberUndo(canonicalPath: string, beforeContent: string): void {
	undoByPath.set(canonicalPath, beforeContent);
	mostRecentPath = canonicalPath;
}

export function peekUndo(canonicalPath: string): string | undefined {
	return undoByPath.get(canonicalPath);
}

/** Return and consume the snapshot: undo is one-shot. */
export function takeUndo(canonicalPath: string): string | undefined {
	const content = undoByPath.get(canonicalPath);
	if (content === undefined) return undefined;
	undoByPath.delete(canonicalPath);
	if (mostRecentPath === canonicalPath) mostRecentPath = undefined;
	return content;
}

export function lastUndoPath(): string | undefined {
	return mostRecentPath !== undefined && undoByPath.has(mostRecentPath)
		? mostRecentPath
		: undefined;
}

export function clearUndo(canonicalPath?: string): void {
	if (canonicalPath === undefined) {
		undoByPath.clear();
		mostRecentPath = undefined;
		return;
	}
	undoByPath.delete(canonicalPath);
	if (mostRecentPath === canonicalPath) mostRecentPath = undefined;
}
```

In `src/edit.ts`, capture immediately before the existing `await writeFileAtomically(...)` call in `execute`. `originalNormalized`, `bom`, and `originalEnding` are already in scope from the pipeline result; store the exact bytes that were on disk:

```ts
			rememberUndo(
				mutationTargetPath,
				bom + restoreLineEndings(originalNormalized, originalEnding),
			);
			throwIfAborted(signal);
			await writeFileAtomically(
```

Add `import { rememberUndo } from "./undo";`.

`vendor/src/pi-hashline-edit/src/undo-tool.ts`:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { writeFileAtomically, resolveMutationTargetPath } from "./fs-write";
import { resolveToCwd } from "./path-utils";
import { rememberReadSnapshot } from "./read-snapshot";
import { normalizeToLF, stripBom } from "./edit-diff";
import { lastUndoPath, takeUndo } from "./undo";

export function registerUndoTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "undo_last_change",
		label: "Undo",
		description:
			"Revert the most recent hashline edit to a file, restoring the exact pre-edit bytes. One shot per edit, in memory only: it does not survive a pi restart and cannot undo a write or a bash change.",
		promptSnippet:
			"Revert the most recent hashline edit to a file (one shot, in-memory)",
		parameters: Type.Object(
			{
				path: Type.Optional(
					Type.String({
						description:
							"File to revert. Omit to revert the most recently edited file.",
					}),
				),
			},
			{ additionalProperties: false },
		),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const requested = (params as { path?: string }).path;
			const canonicalPath =
				requested === undefined
					? lastUndoPath()
					: await resolveMutationTargetPath(resolveToCwd(requested, ctx.cwd));

			if (canonicalPath === undefined) {
				throw new Error(
					"[E_NO_UNDO] No hashline edit is available to undo in this process. Undo is in-memory and one-shot: it is consumed by the first undo and cleared on restart.",
				);
			}

			const before = takeUndo(canonicalPath);
			if (before === undefined) {
				throw new Error(
					`[E_NO_UNDO] No undo snapshot for ${requested ?? canonicalPath}. Only the most recent hashline edit per file is revertible, and it is consumed by the first undo.`,
				);
			}

			await writeFileAtomically(canonicalPath, before, { alreadyResolved: true });
			rememberReadSnapshot(canonicalPath, normalizeToLF(stripBom(before).text));

			return {
				content: [
					{
						type: "text",
						text: `Reverted the last hashline edit to ${canonicalPath}. Anchors from before that edit are valid again; anchors from the edit response are now stale.`,
					},
				],
				details: {},
			};
		},
	});
}
```

`index.ts` — add `import { registerUndoTool } from "./src/undo-tool";` and call `registerUndoTool(pi);` after `registerWriteHook(pi);`.

`tests/hashline-undo.test.ts`:

```ts
import { afterEach, describe, expect, test } from "bun:test";
import {
	clearUndo,
	lastUndoPath,
	peekUndo,
	rememberUndo,
	takeUndo,
} from "../vendor/src/pi-hashline-edit/src/undo";

afterEach(() => {
	clearUndo();
});

describe("undo store", () => {
	test("returns the exact pre-edit bytes", () => {
		rememberUndo("/tmp/a.ts", "before\r\n");
		expect(peekUndo("/tmp/a.ts")).toBe("before\r\n");
	});

	test("is one-shot: the second take finds nothing", () => {
		rememberUndo("/tmp/a.ts", "before");
		expect(takeUndo("/tmp/a.ts")).toBe("before");
		expect(takeUndo("/tmp/a.ts")).toBeUndefined();
	});

	test("keeps only the latest snapshot per path", () => {
		rememberUndo("/tmp/a.ts", "v1");
		rememberUndo("/tmp/a.ts", "v2");
		expect(takeUndo("/tmp/a.ts")).toBe("v2");
	});

	test("tracks separate snapshots for separate paths", () => {
		rememberUndo("/tmp/a.ts", "a");
		rememberUndo("/tmp/b.ts", "b");
		expect(takeUndo("/tmp/a.ts")).toBe("a");
		expect(takeUndo("/tmp/b.ts")).toBe("b");
	});

	test("lastUndoPath names the most recently edited file", () => {
		rememberUndo("/tmp/a.ts", "a");
		rememberUndo("/tmp/b.ts", "b");
		expect(lastUndoPath()).toBe("/tmp/b.ts");
	});

	test("lastUndoPath goes undefined once that snapshot is consumed", () => {
		rememberUndo("/tmp/a.ts", "a");
		takeUndo("/tmp/a.ts");
		expect(lastUndoPath()).toBeUndefined();
	});

	test("an unknown path yields no snapshot", () => {
		expect(takeUndo("/tmp/missing.ts")).toBeUndefined();
	});

	test("clearUndo with a path leaves other paths intact", () => {
		rememberUndo("/tmp/a.ts", "a");
		rememberUndo("/tmp/b.ts", "b");
		clearUndo("/tmp/a.ts");
		expect(peekUndo("/tmp/a.ts")).toBeUndefined();
		expect(peekUndo("/tmp/b.ts")).toBe("b");
	});
});
```

- [ ] **Step 2 (controller): Merge, run verify command, adjust tests if needed**
- [ ] **Step 3 (controller): Commit if green**

```bash
git add vendor/src/pi-hashline-edit/src/undo.ts vendor/src/pi-hashline-edit/src/undo-tool.ts vendor/src/pi-hashline-edit/src/edit.ts vendor/src/pi-hashline-edit/index.ts tests/hashline-undo.test.ts
git commit -m "feat(hashline): add in-memory one-shot undo_last_change"
```

---

### Task 7: `insert` op with `direction`

**Problem being fixed:** models trained on pro (and on other agents) emit an insert-with-direction shape. Today that is `[E_BAD_OP]`. Accept it as sugar that normalizes to the existing `prepend` / `append` ops, so `apply.ts` keeps exactly three anchored ops plus `replace_text`.

**Files:**
- Modify: `vendor/src/pi-hashline-edit/src/hashline/parse.ts` (`ITEM_KEYS`, `assertEditItem`, `resolveEditAnchors`)
- Modify: `vendor/src/pi-hashline-edit/src/edit.ts` (schema union)
- Test (implementer writes): `tests/hashline-insert.test.ts`

**Interfaces:**
- Consumes: `stripDisplayPrefixes` (Task 2), `HashlineEdit` / `HashlineToolEdit` types.
- Produces: `HashlineToolEdit` gains `direction?: string`. `resolveEditAnchors` maps `{op:"insert", direction:"after"}` → `{op:"append"}` and `{op:"insert", direction:"before"}` → `{op:"prepend"}`. `HashlineEdit` is **unchanged** — no `insert` variant reaches `apply.ts`.

**Controller verify after merge:**
```bash
cd /etc/nix-darwin/fork/own-my-pi && bun test tests/hashline-insert.test.ts tests/hashline-prefix-strip.test.ts
```

- [ ] **Step 1 (implementer): Write tests + implementation, then format changed files**

In `parse.ts`:

1. Extend the tool-edit type and the allowed-key set:

```ts
export type HashlineToolEdit = {
	op: string;
	pos?: string;
	end?: string;
	lines?: string[];
	oldText?: string;
	newText?: string;
	direction?: string;
};

const ITEM_KEYS = new Set([
	"op",
	"pos",
	"end",
	"lines",
	"oldText",
	"newText",
	"direction",
]);
```

2. In `assertEditItem`, add `"insert"` to the accepted ops list (keep the `[E_BAD_OP]` message listing all five), require `pos` and a valid `direction` for it, and reject `direction` on every other op:

```ts
	if ("direction" in edit && edit.op !== "insert") {
		throw new Error(
			`Edit ${index} with op "${edit.op}" does not support "direction". Use op "insert" for directional insertion.`,
		);
	}

	if (edit.op === "insert") {
		if (typeof edit.pos !== "string") {
			throw new Error(
				`[E_BAD_OP] Edit ${index} with op "insert" requires a "pos" anchor string.`,
			);
		}
		if (edit.direction !== "before" && edit.direction !== "after") {
			throw new Error(
				`[E_BAD_OP] Edit ${index} with op "insert" requires "direction" to be "before" or "after".`,
			);
		}
		if ("end" in edit) {
			throw new Error(
				`[E_BAD_OP] Edit ${index} with op "insert" does not support "end".`,
			);
		}
	}
```

3. In `resolveEditAnchors`, add the case. It desugars — nothing downstream learns a new op:

```ts
			case "insert": {
				// Sugar for prepend/append. apply.ts never sees op:"insert".
				result.push({
					op: edit.direction === "before" ? "prepend" : "append",
					pos: parseAnchorRef(edit.pos!),
					lines: hashlineParseText(edit.lines, stripCount),
				});
				break;
			}
```

In `src/edit.ts`, add the schema variant and include it in both unions. Note the file imports `Type` from `@sinclair/typebox`:

```ts
const hashlineInsertEditSchema = Type.Object(
	{
		op: literalStringSchema("insert", {
			description:
				"insert lines before or after pos without removing anything",
		}),
		pos: Type.String({ description: "anchor (LINE#HASH from read)" }),
		direction: Type.Unsafe<"before" | "after">({
			type: "string",
			enum: ["before", "after"],
			description: '"after" inserts below pos, "before" inserts above it',
		}),
		lines: hashlineEditLinesSchema,
	},
	{ additionalProperties: false },
);
```

Add `hashlineInsertEditSchema` to the members of `hashlineEditItemSchema` and `hashlineEditItemSchemaNoReplaceText`.

`tests/hashline-insert.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { resolveEditAnchors } from "../vendor/src/pi-hashline-edit/src/hashline/parse";

describe("insert op", () => {
	test('direction "after" desugars to append at the same anchor', () => {
		const resolved = resolveEditAnchors([
			{ op: "insert", pos: "12#MQ", direction: "after", lines: ["added();"] },
		]);
		expect(resolved).toEqual([
			{ op: "append", pos: { line: 12, hash: "MQ" }, lines: ["added();"] },
		]);
	});

	test('direction "before" desugars to prepend at the same anchor', () => {
		const resolved = resolveEditAnchors([
			{ op: "insert", pos: "12#MQ", direction: "before", lines: ["added();"] },
		]);
		expect(resolved[0]).toMatchObject({
			op: "prepend",
			pos: { line: 12, hash: "MQ" },
		});
	});

	test("still strips a pasted display prefix from the inserted lines", () => {
		const warnings: string[] = [];
		const resolved = resolveEditAnchors(
			[
				{
					op: "insert",
					pos: "12#MQ",
					direction: "after",
					lines: ["+13#VR:added();"],
				},
			],
			warnings,
		);
		expect(resolved[0]).toMatchObject({ lines: ["added();"] });
		expect(warnings).toHaveLength(1);
	});

	test("requires an anchor", () => {
		expect(() =>
			resolveEditAnchors([{ op: "insert", direction: "after", lines: ["x"] }]),
		).toThrow(/E_BAD_OP.*requires a "pos"/);
	});

	test("requires a valid direction", () => {
		expect(() =>
			resolveEditAnchors([
				{ op: "insert", pos: "12#MQ", direction: "sideways", lines: ["x"] },
			]),
		).toThrow(/E_BAD_OP.*direction/);
	});

	test("rejects a range", () => {
		expect(() =>
			resolveEditAnchors([
				{
					op: "insert",
					pos: "12#MQ",
					end: "14#VR",
					direction: "after",
					lines: ["x"],
				},
			]),
		).toThrow(/E_BAD_OP.*does not support "end"/);
	});

	test("rejects direction on other ops instead of silently ignoring it", () => {
		expect(() =>
			resolveEditAnchors([
				{ op: "replace", pos: "12#MQ", direction: "after", lines: ["x"] },
			]),
		).toThrow(/does not support "direction"/);
	});

	test("an unknown op still lists the supported set", () => {
		expect(() =>
			resolveEditAnchors([{ op: "splice", pos: "12#MQ", lines: ["x"] }]),
		).toThrow(/E_BAD_OP/);
	});
});
```

- [ ] **Step 2 (controller): Merge, run verify command, adjust tests if needed**
- [ ] **Step 3 (controller): Commit if green**

```bash
git add vendor/src/pi-hashline-edit/src/hashline/parse.ts vendor/src/pi-hashline-edit/src/edit.ts tests/hashline-insert.test.ts
git commit -m "feat(hashline): accept insert op as prepend/append sugar"
```

---

### Task 8: `/hashline-config`

**Files:**
- Create: `vendor/src/pi-hashline-edit/src/config-command.ts`
- Modify: `vendor/src/pi-hashline-edit/index.ts`
- Test: none. This is a `ctx.ui.select` loop with no extractable logic beyond `writeHashlineConfig` (covered by Task 1) — a test here would assert the mock, not behavior.

**Interfaces:**
- Consumes: `currentHashlineConfig`, `writeHashlineConfig`, `HashlineConfig`, `BoundaryDedupMode` (Task 1); `registerGrepTool` from `./grep`; `registerEditTool` from `./edit`.
- Produces: `export function registerConfigCommand(pi: ExtensionAPI): void`

**Controller verify after merge:**
```bash
cd /etc/nix-darwin/fork/own-my-pi && bun test tests
```

- [ ] **Step 1 (implementer): Write implementation, then format changed files**

`vendor/src/pi-hashline-edit/src/config-command.ts`:

```ts
/**
 * /hashline-config — edit ~/.pi/agent/hashline.json from the TUI.
 *
 * hashLength and boundaryDedup take effect immediately. replaceText is baked
 * into the published tool schema at registration time, so the tool is
 * re-registered after a change; grep registration is additive only (turning it
 * off needs a restart, because pi has no unregisterTool).
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
	type BoundaryDedupMode,
	currentHashlineConfig,
	getGrepEnabled,
	hashlineConfigPath,
	writeHashlineConfig,
} from "./config";
import { registerEditTool } from "./edit";
import { registerGrepTool } from "./grep";

const DEDUP_MODES: BoundaryDedupMode[] = ["off", "warn", "on", "strict"];

export function registerConfigCommand(pi: ExtensionAPI): void {
	pi.registerCommand("hashline-config", {
		description:
			"Edit hashline settings (hash length, grep, anchor-only edits, boundary dedup)",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const current = currentHashlineConfig();
			const field = await ctx.ui.select("hashline setting to change", [
				`hashLength: ${current.hashLength}`,
				`grep: ${current.grep}`,
				`replaceText (anchor-only when false): ${current.replaceText}`,
				`boundaryDedup: ${current.boundaryDedup}`,
			]);
			if (field === undefined) return;

			const next = { ...current };
			if (field.startsWith("hashLength")) {
				const picked = await ctx.ui.select("hashLength", ["2", "3", "4"]);
				if (picked === undefined) return;
				next.hashLength = Number(picked) as 2 | 3 | 4;
			} else if (field.startsWith("grep")) {
				next.grep = !current.grep;
			} else if (field.startsWith("replaceText")) {
				next.replaceText = !current.replaceText;
			} else {
				const picked = await ctx.ui.select("boundaryDedup", DEDUP_MODES);
				if (picked === undefined) return;
				next.boundaryDedup = picked as BoundaryDedupMode;
			}

			try {
				await writeHashlineConfig(next);
			} catch (error) {
				ctx.ui.notify(
					`Could not write ${hashlineConfigPath()}: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
				return;
			}

			// replaceText changes the published schema; re-register to apply it.
			registerEditTool(pi);
			if (getGrepEnabled()) registerGrepTool(pi);

			const restartNote =
				current.grep && !next.grep
					? " Turning grep off needs a pi restart."
					: current.hashLength !== next.hashLength
						? " Anchors from earlier reads in this session are now stale; re-read before editing."
						: "";
			ctx.ui.notify(
				`hashline: ${JSON.stringify(next)}.${restartNote}`,
				"info",
			);
		},
	});
}
```

`index.ts` — add `import { registerConfigCommand } from "./src/config-command";` and call `registerConfigCommand(pi);` after `registerUndoTool(pi);`.

- [ ] **Step 2 (controller): Merge, run full `bun test tests`, confirm nothing regressed**
- [ ] **Step 3 (controller): Commit if green**

```bash
git add vendor/src/pi-hashline-edit/src/config-command.ts vendor/src/pi-hashline-edit/index.ts
git commit -m "feat(hashline): add /hashline-config"
```

---

### Task 9: Unique redaction tokens, restore on apply, refuse leftovers

**Problem being fixed:** `redact-secrets.ts` replaces every finding with the same `<redacted>`, so two distinct secrets become indistinguishable to the model, and any payload the model writes back carries the placeholder into the file.

**Files:**
- Modify: `agent/extensions/redact-secrets.ts`
- Test (implementer writes): `tests/redact-tokens.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks. `redactum` is already in `vendor/package.json` and installed; do **not** run `npm install`.
- Produces (all named exports from `redact-secrets.ts`):
  - `export const PLACEHOLDER_RE: RegExp` — global, matches `<redacted:ak12>`
  - `export function resetRedactionRegistry(): void`
  - `export function mintToken(category: string, secret: string): string`
  - `export function lookupSecret(token: string): string | undefined`
  - `export function containsPlaceholder(value: string): boolean`
  - `export function restorePlaceholders(value: unknown): { value: unknown; restored: number; unresolved: string[] }`
  - `redactText` keeps its `(input: string) => { text: string; hits: number }` signature.

**Controller verify after merge:**
```bash
cd /etc/nix-darwin/fork/own-my-pi && bun test tests/redact-tokens.test.ts
```

- [ ] **Step 1 (implementer): Write tests + implementation, then format changed files**

Changes to `agent/extensions/redact-secrets.ts`, keeping the existing `SECRET_CATEGORIES`, `vendorPackageJson`, and `loadRedactum` as they are:

1. `RedactumFn`'s options gain a callable replacement so each finding gets its own token. redactum's `replacement` is a string in the installed version, so do **not** rely on a callback: instead call redactum **without** a replacement to get `findings`, then substitute by matched text. Declare the finding shape and widen the type:

```ts
type RedactumFinding = {
	category?: string;
	value?: string;
	match?: string;
	text?: string;
};

type RedactumFn = (
	text: string,
	options?: {
		replacement?: string;
		categories?: Record<string, boolean>;
	},
) => { redactedText: string; findings?: RedactumFinding[] } | string;
```

2. Token registry. Tokens are per-secret, so the same secret seen twice reuses one token (the model can then reason "same value"), while two different secrets never collide:

```ts
const CATEGORY_ABBREV: Record<string, string> = {
	API_KEY: "ak",
	AWS_KEY: "aws",
	PRIVATE_KEY: "pk",
	DATABASE_CREDENTIALS: "db",
	DEV_SECRET: "ds",
};

export const PLACEHOLDER_RE = /<redacted:([a-z]+)(\d+)>/g;

const tokenToSecret = new Map<string, string>();
const secretToToken = new Map<string, string>();
const counters = new Map<string, number>();

export function resetRedactionRegistry(): void {
	tokenToSecret.clear();
	secretToToken.clear();
	counters.clear();
}

function abbrev(category: string): string {
	return CATEGORY_ABBREV[category] ?? "sec";
}

/**
 * Mint (or reuse) a unique placeholder for one secret.
 *
 * Uniqueness is the point: a shared "<redacted>" destroys the distinction
 * between two different keys, which is exactly how an anchored edit can be
 * aimed at the wrong occurrence.
 */
export function mintToken(category: string, secret: string): string {
	const existing = secretToToken.get(secret);
	if (existing) return existing;
	const prefix = abbrev(category);
	const next = (counters.get(prefix) ?? 0) + 1;
	counters.set(prefix, next);
	const token = `<redacted:${prefix}${next}>`;
	secretToToken.set(secret, token);
	tokenToSecret.set(token, secret);
	return token;
}

export function lookupSecret(token: string): string | undefined {
	return tokenToSecret.get(token);
}

export function containsPlaceholder(value: string): boolean {
	PLACEHOLDER_RE.lastIndex = 0;
	return PLACEHOLDER_RE.test(value);
}
```

3. `redactText` mints one token per distinct finding value, longest-first so a shorter secret contained in a longer one cannot corrupt it:

```ts
export function redactText(input: string): { text: string; hits: number } {
	if (!redactum) return { text: input, hits: 0 };
	const result = redactum(input, { categories: SECRET_CATEGORIES });
	if (typeof result === "string") {
		// No findings metadata: fall back to the opaque single-token form.
		return { text: result, hits: result === input ? 0 : 1 };
	}

	const findings = result.findings ?? [];
	const values = new Map<string, string>();
	for (const finding of findings) {
		const secret = finding.value ?? finding.match ?? finding.text;
		if (typeof secret !== "string" || secret.length === 0) continue;
		values.set(secret, finding.category ?? "DEV_SECRET");
	}
	if (values.size === 0) {
		return { text: input, hits: 0 };
	}

	let text = input;
	let hits = 0;
	for (const secret of [...values.keys()].sort((a, b) => b.length - a.length)) {
		const token = mintToken(values.get(secret)!, secret);
		if (!text.includes(secret)) continue;
		text = text.split(secret).join(token);
		hits += 1;
	}
	return { text, hits };
}
```

4. Restoration walker, mirroring the existing `redactAny` shape:

```ts
/**
 * Swap placeholders back to the real secret before a tool writes to disk.
 *
 * Hashline matches disk bytes, so the file itself was never redacted; only the
 * model's view was. Without this, a replacement payload quoting the redacted
 * line would overwrite a live secret with "<redacted:ak1>".
 */
export function restorePlaceholders(value: unknown): {
	value: unknown;
	restored: number;
	unresolved: string[];
} {
	let restored = 0;
	const unresolved: string[] = [];

	const walk = (node: unknown): unknown => {
		if (typeof node === "string") {
			if (!containsPlaceholder(node)) return node;
			return node.replace(PLACEHOLDER_RE, (match) => {
				const secret = lookupSecret(match);
				if (secret === undefined) {
					unresolved.push(match);
					return match;
				}
				restored += 1;
				return secret;
			});
		}
		if (Array.isArray(node)) return node.map(walk);
		if (node && typeof node === "object") {
			const out: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
				out[k] = walk(v);
			}
			return out;
		}
		return node;
	};

	return { value: walk(value), restored, unresolved };
}
```

5. In the default export, keep the existing `tool_result` and `context` handlers, and add a `tool_call` handler ahead of them. `event.input` is mutable, so restoration mutates in place before the tool executes:

```ts
	const MUTATING_TOOLS = new Set(["edit", "write", "insert", "replace"]);

	pi.on("tool_call", async (event, ctx) => {
		if (!MUTATING_TOOLS.has(event.toolName)) return;
		const input = event.input as Record<string, unknown> | undefined;
		if (!input) return;

		const out = restorePlaceholders(input);
		if (out.restored > 0) {
			for (const [k, v] of Object.entries(out.value as Record<string, unknown>)) {
				input[k] = v;
			}
			ctx.ui.setStatus("redact-secrets", `restored ${out.restored}`);
		}
		if (out.unresolved.length > 0) {
			return {
				block: true,
				reason: `[E_REDACT_PLACEHOLDER] This ${event.toolName} payload contains redaction placeholders this session cannot resolve (${out.unresolved.join(", ")}). Writing them would replace a live secret with a placeholder. Re-read the file and send the literal content, or edit a range that excludes the secret.`,
			};
		}
		return;
	});
```

Also call `resetRedactionRegistry()` from a `session_start` handler so tokens do not leak across sessions in one process:

```ts
	pi.on("session_start", async () => {
		resetRedactionRegistry();
	});
```

`tests/redact-tokens.test.ts`:

```ts
import { beforeEach, describe, expect, test } from "bun:test";
import {
	containsPlaceholder,
	lookupSecret,
	mintToken,
	resetRedactionRegistry,
	restorePlaceholders,
} from "../agent/extensions/redact-secrets";

beforeEach(() => {
	resetRedactionRegistry();
});

describe("mintToken", () => {
	test("two different secrets never share a token", () => {
		const a = mintToken("API_KEY", "AAAA");
		const b = mintToken("API_KEY", "BBBB");
		expect(a).not.toBe(b);
	});

	test("the same secret reuses its token", () => {
		expect(mintToken("API_KEY", "AAAA")).toBe(mintToken("API_KEY", "AAAA"));
	});

	test("the category drives the token prefix", () => {
		expect(mintToken("AWS_KEY", "AKIA1")).toMatch(/^<redacted:aws\d+>$/);
		expect(mintToken("PRIVATE_KEY", "pem1")).toMatch(/^<redacted:pk\d+>$/);
		expect(mintToken("DATABASE_CREDENTIALS", "pg1")).toMatch(/^<redacted:db\d+>$/);
	});

	test("an unknown category still yields a usable token", () => {
		expect(mintToken("SOMETHING_NEW", "x")).toMatch(/^<redacted:sec\d+>$/);
	});

	test("counters are per prefix", () => {
		expect(mintToken("API_KEY", "a1")).toBe("<redacted:ak1>");
		expect(mintToken("AWS_KEY", "a2")).toBe("<redacted:aws1>");
		expect(mintToken("API_KEY", "a3")).toBe("<redacted:ak2>");
	});

	test("resetRedactionRegistry drops the mapping", () => {
		const token = mintToken("API_KEY", "AAAA");
		resetRedactionRegistry();
		expect(lookupSecret(token)).toBeUndefined();
	});
});

describe("containsPlaceholder", () => {
	test("detects a token anywhere in the line", () => {
		expect(containsPlaceholder('key = "<redacted:ak1>"')).toBe(true);
	});

	test("is stateless across repeated calls despite the global regex", () => {
		const line = "a <redacted:ak1> b";
		expect(containsPlaceholder(line)).toBe(true);
		expect(containsPlaceholder(line)).toBe(true);
	});

	test("ignores ordinary text", () => {
		expect(containsPlaceholder("redacted, sort of")).toBe(false);
	});
});

describe("restorePlaceholders", () => {
	test("restores the exact secret bytes in nested payloads", () => {
		const token = mintToken("API_KEY", "sk-live-9");
		const out = restorePlaceholders({
			path: "a.ts",
			edits: [{ op: "replace", lines: [`key = "${token}"`] }],
		});
		expect(out.restored).toBe(1);
		expect(out.unresolved).toEqual([]);
		expect(out.value).toEqual({
			path: "a.ts",
			edits: [{ op: "replace", lines: ['key = "sk-live-9"'] }],
		});
	});

	test("maps two tokens back to their own secrets", () => {
		const one = mintToken("API_KEY", "AAAA");
		const two = mintToken("API_KEY", "BBBB");
		const out = restorePlaceholders([`x=${one}`, `y=${two}`]);
		expect(out.value).toEqual(["x=AAAA", "y=BBBB"]);
		expect(out.restored).toBe(2);
	});

	test("restores several tokens in one string", () => {
		const one = mintToken("API_KEY", "AAAA");
		const two = mintToken("AWS_KEY", "BBBB");
		const out = restorePlaceholders(`${one}:${two}`);
		expect(out.value).toBe("AAAA:BBBB");
		expect(out.restored).toBe(2);
	});

	test("reports an unknown token instead of writing it to disk", () => {
		const out = restorePlaceholders({ lines: ["k = <redacted:ak7>"] });
		expect(out.restored).toBe(0);
		expect(out.unresolved).toEqual(["<redacted:ak7>"]);
	});

	test("leaves payloads without placeholders untouched", () => {
		const input = { path: "a.ts", lines: ["const x = 1;"] };
		const out = restorePlaceholders(input);
		expect(out.value).toEqual(input);
		expect(out.restored).toBe(0);
	});

	test("preserves non-string scalars", () => {
		const out = restorePlaceholders({ n: 1, ok: true, nil: null });
		expect(out.value).toEqual({ n: 1, ok: true, nil: null });
	});
});
```

- [ ] **Step 2 (controller): Merge, run verify command, adjust tests if needed**
- [ ] **Step 3 (controller): Commit if green**

```bash
git add agent/extensions/redact-secrets.ts tests/redact-tokens.test.ts
git commit -m "feat(redact): unique per-finding tokens with restore-on-apply"
```

---

### Task 10: Documentation

**Files:**
- Modify: `vendor/src/pi-hashline-edit/prompts/edit.md`
- Modify: `vendor/src/pi-hashline-edit/README.md` (Configuration table + Features list)
- Modify: `agent/extensions/README.md`
- Modify: `AGENTS.md`
- Test: none (prose).

**Controller verify after merge:**
```bash
cd /etc/nix-darwin/fork/own-my-pi && bun test tests
```

- [ ] **Step 1 (implementer): Edit the four files**

`prompts/edit.md` — in the Ops list, add after the `prepend` bullet:

```markdown
- `insert` — `{ "op": "insert", "pos": ..., "direction": "before"|"after", "lines": [...] }` inserts without removing anything. Sugar for `prepend`/`append`.
```

In the Rules list, replace the first bullet (the one forbidding prefixes and neighbor copies) with:

```markdown
- `lines` is literal file content with exact indentation. A pasted `LINE#HASH:` or diff `+`/`-` prefix is stripped with a warning, and a replacement line that merely repeats the surviving neighbor line is dropped — but send literal content: nested rendered rows are rejected with `[E_INVALID_PATCH]`.
- A range replace validates every line between `pos` and `end`, not just the endpoints. If the interior changed since your last read, the edit is refused with `[E_STALE_SPAN]` and nothing is written.
- Never copy `LINE#HASH:` rows into the `write` tool; that is refused with `[E_WRITE_HASH_ECHO]`.
- `undo_last_change` reverts the most recent hashline edit to a file. One shot, in-memory, does not survive a restart.
```

`README.md` — add `boundaryDedup` to the Configuration table:

```markdown
| `boundaryDedup` | `"warn"` | `off` / `warn` / `on` / `strict` | What to do when a replacement re-includes a surviving neighbor line: nothing, warn only (upstream behavior), strip it, or reject with `[E_BOUNDARY_DUP]`. |
```

and add to Features:

```markdown
- 🧹 **Payload repair** — pasted `LINE#HASH:` prefixes are stripped once with a warning; nested rendered rows still fail closed
- 🔒 **Whole-span freshness** — a range replace verifies every line in the range, not just its endpoints (`[E_STALE_SPAN]`)
- 🚧 **Write echo guard** — refuses a `write` whose content is copied `read` output (`[E_WRITE_HASH_ECHO]`)
- ↩️ **One-shot undo** — `undo_last_change`, in memory only (no on-disk copy of file contents)
- ⚙️ **`/hashline-config`** — change settings without hand-editing JSON
```

`agent/extensions/README.md` — replace the `redact-secrets.ts` bullet with:

```markdown
- `redact-secrets.ts` — scrub secrets from tool results and the LLM context copy
  via [redactum](https://github.com/alexwhin/redactum) (API_KEY, AWS_KEY,
  PRIVATE_KEY, DATABASE_CREDENTIALS, DEV_SECRET). Placeholders are unique per
  finding (`<redacted:ak1>`), and an `edit`/`write` payload carrying one is
  restored to the real bytes before the tool runs — or blocked with
  `[E_REDACT_PLACEHOLDER]` when the token is unknown. Not a sandbox.
```

`AGENTS.md` — append to the Plugins section:

```markdown
vendor/src/pi-hashline-edit is a local fork of RimuruW 0.8.3, not a clean
snapshot. It carries guards ported from YuGiMob/pi-hashline-edit-pro while
keeping derived LINE#HASH anchors and the tool name `edit`: payload prefix
stripping, boundary dedup, whole-span freshness, a write echo guard,
auto-read after write, in-memory undo, an `insert` op, and
`/hashline-config`. Settings live in the tracked agent/shared/hashline.json
(anchor-only edits: replaceText is false). Re-syncing upstream means
re-applying these; see docs/superpowers/plans/2026-09-18-hashline-pro-steal.md
in the nix-darwin parent repo.
```

- [ ] **Step 2 (controller): Merge, run full `bun test tests`**
- [ ] **Step 3 (controller): Commit if green**

```bash
git add vendor/src/pi-hashline-edit/prompts/edit.md vendor/src/pi-hashline-edit/README.md agent/extensions/README.md AGENTS.md
git commit -m "docs(hashline): document ported pro guards"
```

---

## Self-review

**Spec coverage:** steal items 1–6 → Tasks 1 (replaceText via tracked JSON), 5 (write echo), 2 (prefix strip), 3 (boundary dedup), 4 (span freshness), 5 (auto-read). Optional items → Task 6 (undo), Task 1 (`grep: true`), Task 7 (insert), Task 8 (TUI). Redact extras → Task 9 (unique tokens, restore, refuse; hashing stays on disk by construction — Task 4 reads `getReadSnapshot`, never the redacted view). Docs → Task 10.

**Placeholder scan:** no TBD/TODO. Every code step carries real content.

**Type consistency:** `BoundaryDedupMode` is defined in Task 1 and consumed by name in Tasks 3 and 8. `stripDisplayPrefixes` (Task 2) is consumed by Task 7. `resolveEditAnchors(edits, warnings?)` gains its second parameter once, in Task 2, and Task 7 uses that same signature. `HashlineEdit` is never extended: Task 7 desugars in `resolveEditAnchors`, so Task 4's `findStaleSpan` only ever sees `replace`/`append`/`prepend`/`replace_text`.

**Known accepted risks:** the write echo guard is shape-based, so a file that legitimately contains `12#MQ:`-shaped lines cannot be written through `write` (use bash). Turning `grep` off via `/hashline-config` needs a restart. Undo dies with the process, by design.
