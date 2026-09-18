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
