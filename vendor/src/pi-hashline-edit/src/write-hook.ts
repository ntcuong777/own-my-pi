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
