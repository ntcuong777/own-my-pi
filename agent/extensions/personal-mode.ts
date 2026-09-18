/*
 * personal-mode — personal billing overlay for company Pi.
 *
 * RAM-only. Never writes settings.json. Roles come from personal.json while
 * on; company model-roles.json while off. PI_PERSONAL=1 (pi-personal) forces
 * on for the process and cannot be dropped with /personal off.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";

export type RoleName = "default" | "plan" | "advisor" | "task" | "reviewer" | "tiny";

export type ModelSelector = {
	provider: string;
	model: string;
	thinkingLevel?: ThinkingName;
};

export type PersonalConfig = {
	disabledProviders: string[];
	modelRoles: Record<string, string>;
};

export type ThinkingName = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

const STATUS_KEY = "personal";
const STATE_ENTRY = "personal-mode-state";
const THINKING = new Set<string>(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

export function personalConfigPath(): string {
	return join(homedir(), ".pi/agent/personal.json");
}

export function companyRolesPath(): string {
	return join(homedir(), ".pi/agent/model-roles.json");
}

export function isPersonalOverlayLaunch(env: NodeJS.ProcessEnv = process.env): boolean {
	return env.PI_PERSONAL === "1";
}

export function parseSelector(raw: string): ModelSelector {
	const slash = raw.indexOf("/");
	if (slash <= 0) throw new Error(`selector missing provider: ${raw}`);
	const provider = raw.slice(0, slash);
	const rest = raw.slice(slash + 1);
	const colon = rest.lastIndexOf(":");
	if (colon >= 0) {
		const maybe = rest.slice(colon + 1);
		if (THINKING.has(maybe)) {
			return { provider, model: rest.slice(0, colon), thinkingLevel: maybe as ThinkingName };
		}
	}
	return { provider, model: rest };
}

export function isProviderDenied(providerOrSelector: string, denied: string[]): boolean {
	const provider = providerOrSelector.includes("/")
		? providerOrSelector.slice(0, providerOrSelector.indexOf("/"))
		: providerOrSelector;
	return denied.includes(provider);
}

export function asStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((v): v is string => typeof v === "string" && v.length > 0);
}

export function asRoleMap(value: unknown): Record<string, string> {
	if (typeof value !== "object" || value === null) return {};
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(value)) {
		if (typeof v === "string" && v.length > 0) out[k] = v;
	}
	return out;
}

export function parsePersonalConfig(text: string): PersonalConfig {
	const parsed: unknown = JSON.parse(text);
	if (typeof parsed !== "object" || parsed === null) throw new Error("personal.json must be an object");
	const obj = parsed as Record<string, unknown>;
	const disabledProviders = asStringArray(obj.disabledProviders);
	const modelRoles = asRoleMap(obj.modelRoles);
	if (!modelRoles.default) throw new Error("personal.json modelRoles.default is required");
	return { disabledProviders, modelRoles };
}

type StateBlob = { enabled: boolean };

function coerceState(data: unknown): StateBlob | undefined {
	if (typeof data !== "object" || data === null) return undefined;
	if (!("enabled" in data) || typeof data.enabled !== "boolean") return undefined;
	return { enabled: data.enabled };
}

function latestState(ctx: ExtensionContext): StateBlob | undefined {
	let latest: StateBlob | undefined;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type === "custom" && entry.customType === STATE_ENTRY) {
			const parsed = coerceState(entry.data);
			if (parsed) latest = parsed;
		}
	}
	return latest;
}

async function readJsonFile(path: string): Promise<string> {
	return await readFile(path, "utf8");
}

async function loadPersonalConfig(): Promise<{ ok: true; cfg: PersonalConfig } | { ok: false; error: string }> {
	const path = personalConfigPath();
	try {
		return { ok: true, cfg: parsePersonalConfig(await readJsonFile(path)) };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : `${path}: ${String(error)}` };
	}
}

async function loadCompanyDefault(): Promise<string | undefined> {
	try {
		const parsed: unknown = JSON.parse(await readJsonFile(companyRolesPath()));
		if (typeof parsed !== "object" || parsed === null) return undefined;
		const def = (parsed as Record<string, unknown>).default;
		return typeof def === "string" ? def : undefined;
	} catch {
		return undefined;
	}
}

function findModel(ctx: ExtensionContext, provider: string, id: string): Model | undefined {
	const scoped = ctx.scopedModels.find((s) => s.model.provider === provider && s.model.id === id);
	if (scoped) return scoped.model;
	return ctx.modelRegistry.find(provider, id);
}

async function applySelector(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	raw: string,
): Promise<{ ok: true; model: Model } | { ok: false; error: string }> {
	let sel: ModelSelector;
	try {
		sel = parseSelector(raw);
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
	const model = findModel(ctx, sel.provider, sel.model);
	if (!model) return { ok: false, error: `model not found: ${sel.provider}/${sel.model}` };
	if (!ctx.modelRegistry.hasConfiguredAuth(model)) {
		return { ok: false, error: `not logged in: ${sel.provider}` };
	}
	const ok = await pi.setModel(model);
	if (!ok) return { ok: false, error: `setModel refused ${sel.provider}/${sel.model}` };
	if (sel.thinkingLevel) pi.setThinkingLevel(sel.thinkingLevel);
	return { ok: true, model };
}

function selectorFromToolInput(input: unknown): string | undefined {
	if (typeof input !== "object" || input === null) return undefined;
	const obj = input as Record<string, unknown>;
	if (typeof obj.model === "string" && obj.model.includes("/")) return obj.model;
	if (typeof obj.provider === "string" && typeof obj.model === "string") return `${obj.provider}/${obj.model}`;
	if (typeof obj.provider === "string" && typeof obj.modelId === "string") return `${obj.provider}/${obj.modelId}`;
	return undefined;
}

const SPAWN_TOOLS: Record<string, true> = {
	spawn: true,
	spawn_task: true,
	spawn_review: true,
	task: true,
};

export default function personalMode(pi: ExtensionAPI): void {
	let runtimeOn = false;
	let cfg: PersonalConfig | undefined;
	let lastAllowed: Model | undefined;
	let reverting = false;
	const overlayLocked = () => isPersonalOverlayLaunch();
	const isOn = () => overlayLocked() || runtimeOn;

	function persist(enabled: boolean): void {
		pi.appendEntry(STATE_ENTRY, { enabled } satisfies StateBlob);
	}

	function updateStatus(ctx: ExtensionContext | ExtensionCommandContext): void {
		ctx.ui.setStatus(STATUS_KEY, isOn() ? "PERSONAL" : undefined);
	}

	async function ensureConfig(): Promise<{ ok: true; cfg: PersonalConfig } | { ok: false; error: string }> {
		if (cfg) return { ok: true, cfg };
		const loaded = await loadPersonalConfig();
		if (loaded.ok) cfg = loaded.cfg;
		return loaded;
	}

	async function switchTo(piApi: ExtensionAPI, ctx: ExtensionContext, raw: string): Promise<boolean> {
		const applied = await applySelector(piApi, ctx, raw);
		if (!applied.ok) {
			ctx.ui.notify(`Personal mode: ${applied.error}`, "error");
			return false;
		}
		lastAllowed = applied.model;
		return true;
	}

	async function enable(ctx: ExtensionCommandContext | ExtensionContext, fromRestore: boolean): Promise<void> {
		if (overlayLocked()) {
			runtimeOn = true;
			updateStatus(ctx);
			if (!fromRestore) {
				ctx.ui.notify("Personal mode already on via PI_PERSONAL=1. Restart without pi-personal to leave it.", "info");
			}
			const loaded = await ensureConfig();
			if (loaded.ok && ctx.model && isProviderDenied(ctx.model.provider, loaded.cfg.disabledProviders)) {
				await switchTo(pi, ctx, loaded.cfg.modelRoles.default);
			}
			return;
		}
		if (runtimeOn) {
			updateStatus(ctx);
			if (!fromRestore) ctx.ui.notify("Personal mode already on.", "info");
			return;
		}

		const loaded = await ensureConfig();
		if (!loaded.ok) {
			ctx.ui.notify(`Personal mode aborted: ${loaded.error}`, "error");
			return;
		}

		const switched = await switchTo(pi, ctx, loaded.cfg.modelRoles.default);
		if (!switched) return;

		runtimeOn = true;
		persist(true);
		updateStatus(ctx);
		if (!fromRestore) {
			ctx.ui.notify(
				"Personal mode on: Anthropic blocked; roles remapped to overlay defaults. Does not write settings.json.",
				"info",
			);
		}
	}

	async function disable(ctx: ExtensionCommandContext): Promise<void> {
		if (overlayLocked()) {
			ctx.ui.notify("Launched with PI_PERSONAL=1; /personal off cannot drop the overlay. Restart without pi-personal.", "warning");
			return;
		}
		if (!runtimeOn) {
			ctx.ui.notify("Personal mode already off.", "info");
			return;
		}
		const company = await loadCompanyDefault();
		if (company) await switchTo(pi, ctx, company);
		runtimeOn = false;
		cfg = undefined;
		persist(false);
		updateStatus(ctx);
		ctx.ui.notify("Personal mode off: company default restored for this process.", "info");
	}

	async function status(ctx: ExtensionCommandContext): Promise<void> {
		if (overlayLocked()) {
			ctx.ui.notify("Personal mode: on (process overlay via PI_PERSONAL=1). /personal off needs a restart without pi-personal.", "info");
			return;
		}
		if (runtimeOn) {
			ctx.ui.notify("Personal mode: on (session overlay).", "info");
			return;
		}
		ctx.ui.notify("Personal mode: off.", "info");
	}

	pi.registerCommand("personal", {
		description: "Personal billing overlay: block Anthropic and remap roles without writing settings.json",
		getArgumentCompletions: (prefix: string) => {
			const subcommands = ["on", "off", "status"];
			if (/\s/.test(prefix)) return null;
			const first = prefix.trim();
			const items = subcommands
				.filter((command) => command.startsWith(first))
				.map((command) => ({ value: command, label: command }));
			return items.length > 0 ? items : null;
		},
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const sub = (args.trim().split(/\s+/).filter(Boolean)[0] ?? "status").toLowerCase();
			switch (sub) {
				case "on":
					await enable(ctx, false);
					return;
				case "off":
					await disable(ctx);
					return;
				case "status":
					await status(ctx);
					return;
				default:
					ctx.ui.notify("Usage: /personal on|off|status", "warning");
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		const restored = latestState(ctx);
		if (overlayLocked() || restored?.enabled) {
			await enable(ctx, true);
			return;
		}
		updateStatus(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		if (overlayLocked()) {
			runtimeOn = true;
			updateStatus(ctx);
			return;
		}
		runtimeOn = latestState(ctx)?.enabled === true;
		updateStatus(ctx);
	});

	pi.on("turn_start", async (_event, ctx) => {
		updateStatus(ctx);
		if (!isOn()) return;
		const loaded = await ensureConfig();
		if (!loaded.ok) return;
		const current = ctx.model;
		if (current && isProviderDenied(current.provider, loaded.cfg.disabledProviders)) {
			await switchTo(pi, ctx, loaded.cfg.modelRoles.default);
		}
	});

	pi.on("model_select", async (event, ctx) => {
		if (reverting) return;
		if (!isOn()) {
			lastAllowed = event.model;
			return;
		}
		const loaded = await ensureConfig();
		if (!loaded.ok) return;
		if (!isProviderDenied(event.model.provider, loaded.cfg.disabledProviders)) {
			lastAllowed = event.model;
			return;
		}
		ctx.ui.notify(`Personal mode: ${event.model.provider} is blocked. Keeping the previous model.`, "error");
		reverting = true;
		try {
			if (lastAllowed && !isProviderDenied(lastAllowed.provider, loaded.cfg.disabledProviders)) {
				await pi.setModel(lastAllowed);
				return;
			}
			await switchTo(pi, ctx, loaded.cfg.modelRoles.default);
		} finally {
			reverting = false;
		}
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!isOn() || !SPAWN_TOOLS[event.toolName]) return;
		const loaded = await ensureConfig();
		if (!loaded.ok) return;
		const sel = selectorFromToolInput(event.input);
		if (!sel) return;
		if (!isProviderDenied(sel, loaded.cfg.disabledProviders)) return;
		return {
			block: true,
			reason: `personal mode: provider ${sel} is blocked. Use overlay roles (z-ai / openai-codex), not Anthropic.`,
		};
	});
}
