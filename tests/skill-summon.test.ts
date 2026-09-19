import { describe, expect, test } from "bun:test";
import { patchEditorSlashTrigger } from "../agent/extensions/skill-summon/editor-patch";
import {
	applyMidPromptSkillCompletion,
	findTrailingSlashCommandStart,
	isMidPromptSkillSlash,
	wrapSkillSummonProvider,
} from "../agent/extensions/skill-summon/provider";
import type { SkillSummonItem, SkillSummonProvider } from "../agent/extensions/skill-summon/provider";
import { registerSkillSummon } from "../agent/extensions/skill-summon/register";

const skills: SkillSummonItem[] = [
	{ value: "skill:security-scan", label: "skill:security-scan", description: "Scan" },
	{ value: "skill:reviewer", label: "skill:reviewer", description: "Review" },
];
const commands: SkillSummonItem[] = [
	...skills,
	{ value: "model", label: "model", description: "Switch model" },
	{ value: "quit", label: "quit", description: "Quit" },
];

function fakeInner(items: SkillSummonItem[]): SkillSummonProvider {
	return {
		async getSuggestions(lines, cursorLine, cursorCol, options) {
			if (options.force) {
				return { items: [{ value: "/tmp", label: "/tmp/" }], prefix: "/" };
			}
			const text = (lines[cursorLine] ?? "").slice(0, cursorCol);
			if (!text.startsWith("/")) return null;
			if (text.includes(" ")) return null;
			const prefix = text.slice(1).toLowerCase();
			const matches = items.filter((item) => item.value.toLowerCase().includes(prefix));
			if (matches.length === 0) return null;
			return { items: matches, prefix: text };
		},
		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			const currentLine = lines[cursorLine] ?? "";
			const beforePrefix = currentLine.slice(0, cursorCol - prefix.length);
			const afterCursor = currentLine.slice(cursorCol);
			const isSlashCommand = prefix.startsWith("/") && beforePrefix.trim() === "";
			const insert = isSlashCommand ? `/${item.value} ` : item.value;
			const newLine = `${beforePrefix}${insert}${afterCursor}`;
			const next = [...lines];
			next[cursorLine] = newLine;
			return {
				lines: next,
				cursorLine,
				cursorCol: beforePrefix.length + insert.length,
			};
		},
	};
}

describe("isMidPromptSkillSlash", () => {
	test("leading slash commands stay closed", () => {
		expect(isMidPromptSkillSlash("/")).toBe(false);
		expect(isMidPromptSkillSlash("/skill:")).toBe(false);
		expect(isMidPromptSkillSlash("/skill:security-scan")).toBe(false);
		expect(isMidPromptSkillSlash("  /skill:")).toBe(false);
	});

	test("opens after prose", () => {
		expect(isMidPromptSkillSlash("run a /")).toBe(true);
		expect(isMidPromptSkillSlash("run a /sk")).toBe(true);
	});

	test("opens for a second / after a leading /skill: token", () => {
		expect(isMidPromptSkillSlash("/skill:security-scan then /")).toBe(true);
		expect(isMidPromptSkillSlash("/skill:security-scan then /sk")).toBe(true);
	});

	test("stays closed without a trailing slash token", () => {
		expect(isMidPromptSkillSlash("hello")).toBe(false);
		expect(isMidPromptSkillSlash("/skill:foo then ")).toBe(false);
	});
});

describe("findTrailingSlashCommandStart", () => {
	test("finds the last slash token", () => {
		expect(findTrailingSlashCommandStart("/skill:security-scan then /")).toBe(
			"/skill:security-scan then ".length,
		);
		expect(findTrailingSlashCommandStart("run a /sk")).toBe("run a ".length);
		expect(findTrailingSlashCommandStart("/skill:foo")).toBe(0);
		expect(findTrailingSlashCommandStart("no slash")).toBe(null);
	});
});

describe("wrapSkillSummonProvider", () => {
	const abort = { signal: new AbortController().signal };

	test("lists only skills for a second / after a leading /skill: token", async () => {
		const provider = wrapSkillSummonProvider(fakeInner(commands));
		const line = "/skill:security-scan then /";
		const result = await provider.getSuggestions([line], 0, line.length, abort);
		expect(result?.prefix).toBe("/");
		expect(result?.items.map((item) => item.value)).toEqual([
			"skill:security-scan",
			"skill:reviewer",
		]);
	});

	test("lists skills for a mid-prompt / after prose", async () => {
		const provider = wrapSkillSummonProvider(fakeInner(commands));
		const line = "run a /";
		const result = await provider.getSuggestions([line], 0, line.length, abort);
		expect(result?.prefix).toBe("/");
		expect(result?.items.map((item) => item.value)).toEqual([
			"skill:security-scan",
			"skill:reviewer",
		]);
	});

	test("does not steal a leading slash command popup", async () => {
		const provider = wrapSkillSummonProvider(fakeInner(commands));
		const line = "/m";
		const result = await provider.getSuggestions([line], 0, line.length, abort);
		expect(result?.items.map((item) => item.value)).toEqual(["model"]);
	});

	test("falls through to files when Tab forces completion", async () => {
		const provider = wrapSkillSummonProvider(fakeInner(commands));
		const line = "/skill:security-scan then /";
		const result = await provider.getSuggestions([line], 0, line.length, { ...abort, force: true });
		expect(result?.items.map((item) => item.value)).toEqual(["/tmp"]);
	});

	test("inserts a second skill token without wiping the first", () => {
		const provider = wrapSkillSummonProvider(fakeInner(commands));
		const line = "/skill:security-scan then /";
		const result = provider.applyCompletion([line], 0, line.length, skills[1]!, "/");
		expect(result.lines[0]).toBe("/skill:security-scan then /skill:reviewer ");
	});
});

describe("applyMidPromptSkillCompletion", () => {
	test("replaces only the trailing slash token", () => {
		const line = "fix this /sk";
		const result = applyMidPromptSkillCompletion([line], 0, line.length, {
			value: "skill:security-scan",
			label: "skill:security-scan",
		});
		expect(result.lines[0]).toBe("fix this /skill:security-scan ");
		expect(result.cursorCol).toBe("fix this /skill:security-scan ".length);
	});
});

describe("patchEditorSlashTrigger", () => {
	class FakeEditor {
		text = "";
		triggered = 0;
		insertCharacter(char: string) {
			this.text += char;
		}
		tryTriggerAutocomplete() {
			this.triggered += 1;
		}
		isShowingAutocomplete() {
			return false;
		}
		getLines() {
			return [this.text];
		}
		getCursor() {
			return { line: 0, col: this.text.length };
		}
	}

	test("opens the popup when typing a second slash after a leading skill token", () => {
		patchEditorSlashTrigger(FakeEditor);
		const editor = new FakeEditor();
		editor.text = "/skill:security-scan then ";
		editor.insertCharacter("/");
		expect(editor.text).toBe("/skill:security-scan then /");
		expect(editor.triggered).toBe(1);
	});

	test("does not open on a leading slash command", () => {
		patchEditorSlashTrigger(FakeEditor);
		const editor = new FakeEditor();
		editor.insertCharacter("/");
		expect(editor.text).toBe("/");
		expect(editor.triggered).toBe(0);
	});
});
describe("registerSkillSummon", () => {
	test("does not call addAutocompleteProvider on the factory pi object", () => {
		const events: Array<(event: unknown, ctx: { ui?: { addAutocompleteProvider?: Function } }) => void> = [];
		const pi = {
			addAutocompleteProvider() {
				throw new Error("pi.addAutocompleteProvider should not be called");
			},
			on(_event: "session_start", handler: (event: unknown, ctx: { ui?: { addAutocompleteProvider?: Function } }) => void) {
				events.push(handler);
			},
		};
		registerSkillSummon(pi);
		expect(events).toHaveLength(1);
	});

	test("registers on ctx.ui during session_start", async () => {
		const wrapped: SkillSummonProvider[] = [];
		const ui = {
			addAutocompleteProvider(factory: (current: SkillSummonProvider) => SkillSummonProvider) {
				wrapped.push(factory(fakeInner(commands)));
			},
		};
		let handler: ((event: unknown, ctx: { ui?: typeof ui }) => void) | undefined;
		registerSkillSummon({
			on(_event, next) {
				handler = next;
			},
		});
		await handler?.({ type: "session_start", reason: "resume" }, { ui });
		expect(wrapped).toHaveLength(1);
		const line = "/skill:security-scan then /";
		const result = await wrapped[0]!.getSuggestions([line], 0, line.length, {
			signal: new AbortController().signal,
		});
		expect(result?.items.map((item) => item.value)).toEqual([
			"skill:security-scan",
			"skill:reviewer",
		]);
	});

	test("skips session_start when ctx.ui has no addAutocompleteProvider", async () => {
		let handler: ((event: unknown, ctx: { ui?: object }) => void) | undefined;
		registerSkillSummon({
			on(_event, next) {
				handler = next;
			},
		});
		await handler?.({ type: "session_start", reason: "resume" }, { ui: {} });
	});
});
