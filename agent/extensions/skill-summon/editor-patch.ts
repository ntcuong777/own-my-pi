import { findTrailingSlashCommandStart, isMidPromptSkillSlash } from "./provider";

export type SlashTriggerEditor = {
	insertCharacter(char: string, skipUndoCoalescing?: boolean): void;
	tryTriggerAutocomplete(): void;
	isShowingAutocomplete(): boolean;
	getLines(): string[];
	getCursor(): { line: number; col: number };
};

export type SlashTriggerEditorCtor = {
	prototype: SlashTriggerEditor;
};

const patched = new WeakSet<object>();

export function patchEditorSlashTrigger(editorCtor: SlashTriggerEditorCtor): boolean {
	const proto = editorCtor.prototype;
	if (patched.has(proto)) return false;
	if (typeof proto.insertCharacter !== "function" || typeof proto.tryTriggerAutocomplete !== "function") {
		return false;
	}
	patched.add(proto);
	const original = proto.insertCharacter;
	proto.insertCharacter = function (this: SlashTriggerEditor, char: string, skipUndoCoalescing?: boolean) {
		original.call(this, char, skipUndoCoalescing);
		if (char !== "/" || this.isShowingAutocomplete()) return;
		const cursor = this.getCursor();
		const before = (this.getLines()[cursor.line] ?? "").slice(0, cursor.col);
		// Line 0 leading `/` is Pi's job. Later lines and mid-prompt `/` are not.
		if (
			isMidPromptSkillSlash(before) ||
			(cursor.line > 0 && findTrailingSlashCommandStart(before) !== null)
		) {
			this.tryTriggerAutocomplete();
		}
	};
	return true;
}
