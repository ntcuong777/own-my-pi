import { wrapSkillSummonProvider, type SkillSummonProvider } from "./provider";

type SkillSummonUI = {
	addAutocompleteProvider?(factory: (current: SkillSummonProvider) => SkillSummonProvider): void;
};

type SkillSummonAPI = {
	on(
		event: "session_start",
		handler: (event: unknown, ctx: { ui?: SkillSummonUI }) => void | Promise<void>,
	): void;
};

/** Autocomplete lives on ctx.ui, not the factory `pi` object. */
export function registerSkillSummon(pi: SkillSummonAPI): void {
	pi.on("session_start", (_event, ctx) => {
		const add = ctx.ui?.addAutocompleteProvider;
		if (typeof add !== "function") return;
		add((current) => wrapSkillSummonProvider(current));
	});
}
