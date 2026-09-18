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
