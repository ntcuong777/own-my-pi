export type SkillSummonItem = {
	value: string;
	label: string;
	description?: string;
};

export type SkillSummonSuggestions = {
	items: SkillSummonItem[];
	prefix: string;
};

export type SkillSummonProvider = {
	triggerCharacters?: string[];
	getSuggestions(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		options: { signal: AbortSignal; force?: boolean },
	): Promise<SkillSummonSuggestions | null>;
	applyCompletion(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		item: SkillSummonItem,
		prefix: string,
	): { lines: string[]; cursorLine: number; cursorCol: number };
	shouldTriggerFileCompletion?(lines: string[], cursorLine: number, cursorCol: number): boolean;
};

/** `/` of the slash token at the end of `text` (`prose … /tok`). */
export function findTrailingSlashCommandStart(text: string): number | null {
	const match = /(?:^|\s)\/([^\s/]*)$/.exec(text);
	if (!match || match.index === undefined) return null;
	const slashOffset = match[0].indexOf("/");
	return match.index + slashOffset;
}

/**
 * A later `/` after prompt text is a skill summon, not arguments to the first
 * leading slash command (`/skill:foo then /`).
 */
export function isMidPromptSkillSlash(textBeforeCursor: string): boolean {
	const slashStart = findTrailingSlashCommandStart(textBeforeCursor);
	if (slashStart === null) return false;
	return textBeforeCursor.slice(0, slashStart).trim() !== "";
}

export function applyMidPromptSkillCompletion(
	lines: string[],
	cursorLine: number,
	cursorCol: number,
	item: SkillSummonItem,
): { lines: string[]; cursorLine: number; cursorCol: number } {
	const currentLine = lines[cursorLine] ?? "";
	const textBeforeCursor = currentLine.slice(0, cursorCol);
	const slashStart = findTrailingSlashCommandStart(textBeforeCursor);
	if (slashStart === null) {
		return { lines: [...lines], cursorLine, cursorCol };
	}
	const afterCursor = currentLine.slice(cursorCol);
	const insert = `/${item.value} `;
	const newLine = `${currentLine.slice(0, slashStart)}${insert}${afterCursor}`;
	const next = [...lines];
	next[cursorLine] = newLine;
	return {
		lines: next,
		cursorLine,
		cursorCol: slashStart + insert.length,
	};
}

function skillItems(items: SkillSummonItem[] | undefined): SkillSummonItem[] {
	return (items ?? []).filter((item) => item.value.startsWith("skill:"));
}

export function wrapSkillSummonProvider(current: SkillSummonProvider): SkillSummonProvider {
	return {
		triggerCharacters: current.triggerCharacters,
		shouldTriggerFileCompletion: current.shouldTriggerFileCompletion?.bind(current),
		async getSuggestions(lines, cursorLine, cursorCol, options) {
			if (!options.force) {
				const textBeforeCursor = (lines[cursorLine] ?? "").slice(0, cursorCol);
				if (isMidPromptSkillSlash(textBeforeCursor)) {
					const slashStart = findTrailingSlashCommandStart(textBeforeCursor);
					if (slashStart !== null) {
						const token = textBeforeCursor.slice(slashStart);
						const inner = await current.getSuggestions([token], 0, token.length, options);
						const items = skillItems(inner?.items);
						if (items.length > 0) {
							return { items, prefix: token };
						}
					}
				}
			}
			return current.getSuggestions(lines, cursorLine, cursorCol, options);
		},
		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			const textBeforeCursor = (lines[cursorLine] ?? "").slice(0, cursorCol);
			if (item.value.startsWith("skill:") && isMidPromptSkillSlash(textBeforeCursor)) {
				return applyMidPromptSkillCompletion(lines, cursorLine, cursorCol, item);
			}
			return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
		},
	};
}
